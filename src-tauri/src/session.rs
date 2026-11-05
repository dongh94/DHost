//! PTY 위에서 돌아가는 SSH 세션 관리. 세션마다 ssh 프로세스가 하나씩 독립적으로 뜬다 (FUN-06).

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};

use portable_pty::{native_pty_system, ChildKiller, MasterPty, PtySize};

use crate::error::{AppError, AppResult};
use crate::events::{AppEvent, EventSink, SessionExit};
use crate::ipc::Broker;
use crate::ssh::{ConnectRequest, HelperContext, SshEngine};

struct Session {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
}

/// 원격 출력 바이트를 받는 콜백
pub type OutputFn = Box<dyn FnMut(&[u8]) -> bool + Send>;

pub struct SessionManager {
    sessions: Arc<Mutex<HashMap<String, Session>>>,
    sink: Arc<dyn EventSink>,
    /// helper로 다시 실행될 DHost 실행 파일
    helper_exe: String,
}

impl SessionManager {
    pub fn new(sink: Arc<dyn EventSink>, helper_exe: String) -> Self {
        Self { sessions: Arc::new(Mutex::new(HashMap::new())), sink, helper_exe }
    }

    pub fn open(
        &self,
        engine: &dyn SshEngine,
        broker: Arc<Broker>,
        req: ConnectRequest,
        size: (u16, u16),
        mut output: OutputFn,
    ) -> AppResult<String> {
        let session_id = uuid::Uuid::new_v4().to_string();
        let token = uuid::Uuid::new_v4().to_string();
        let ctx = HelperContext {
            exe: self.helper_exe.clone(),
            socket_path: broker.socket_path.to_string_lossy().into_owned(),
            session_token: token.clone(),
        };
        let cmd = engine.build_command(&req, &ctx)?;

        let pair = native_pty_system()
            .openpty(PtySize { cols: size.0, rows: size.1, pixel_width: 0, pixel_height: 0 })
            .map_err(|e| AppError::Internal(format!("PTY 생성 실패: {e}")))?;
        broker.register_session(&token, &session_id);
        let mut child = match pair.slave.spawn_command(cmd) {
            Ok(c) => c,
            Err(e) => {
                broker.unregister_session(&token);
                return Err(AppError::Internal(format!("ssh 실행 실패: {e}")));
            }
        };
        drop(pair.slave);

        let mut reader = pair.master.try_clone_reader().map_err(|e| AppError::Internal(e.to_string()))?;
        let writer = pair.master.take_writer().map_err(|e| AppError::Internal(e.to_string()))?;
        let killer = child.clone_killer();

        // 원격 출력 -> 화면
        std::thread::spawn(move || {
            let mut buf = [0u8; 16 * 1024];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        if !output(&buf[..n]) {
                            break;
                        }
                    }
                }
            }
        });

        // 프로세스 종료 감시 -> 정리 후 화면에 알림. 자동 재접속은 하지 않는다 (FUN-07).
        let sessions = self.sessions.clone();
        let sid = session_id.clone();
        let sink = self.sink.clone();
        std::thread::spawn(move || {
            let code = child.wait().ok().map(|s| s.exit_code());
            sessions.lock().unwrap().remove(&sid);
            broker.unregister_session(&token);
            sink.emit(AppEvent::SessionExit(SessionExit { session_id: sid, exit_code: code }));
        });

        self.sessions
            .lock()
            .unwrap()
            .insert(session_id.clone(), Session { master: pair.master, writer, killer });
        Ok(session_id)
    }

    pub fn write(&self, id: &str, data: &[u8]) -> AppResult<()> {
        let mut sessions = self.sessions.lock().unwrap();
        let s = sessions.get_mut(id).ok_or_else(|| AppError::SessionNotFound(id.into()))?;
        s.writer.write_all(data).map_err(|e| AppError::Internal(e.to_string()))
    }

    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> AppResult<()> {
        let sessions = self.sessions.lock().unwrap();
        let s = sessions.get(id).ok_or_else(|| AppError::SessionNotFound(id.into()))?;
        s.master
            .resize(PtySize { cols, rows, pixel_width: 0, pixel_height: 0 })
            .map_err(|e| AppError::Internal(e.to_string()))
    }

    pub fn close(&self, id: &str) -> AppResult<()> {
        let mut sessions = self.sessions.lock().unwrap();
        if let Some(s) = sessions.get_mut(id) {
            let _ = s.killer.kill();
        }
        Ok(())
    }

    /// 앱 종료 시 남은 ssh 프로세스를 모두 정리한다 (GAP-01).
    pub fn close_all(&self) {
        for s in self.sessions.lock().unwrap().values_mut() {
            let _ = s.killer.kill();
        }
    }
}
