//! PTY 위에서 돌아가는 SSH 세션 관리. 세션마다 ssh 프로세스가 하나씩 독립적으로 뜬다 (FUN-06).

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use portable_pty::{native_pty_system, ChildKiller, MasterPty, PtySize};

use crate::error::{AppError, AppResult};
use crate::events::{AppEvent, EventSink, SessionExit};
use crate::history::HistoryStore;
use crate::ipc::Broker;
use crate::meta::{Flags, Hop, SessionMeta};
use crate::ssh::{ConnectRequest, HelperContext, SshEngine};

/// 새로 저장한 비밀번호가 이 시간 안에 ssh 오류(255)로 끝나면 틀린 것으로 보고 지운다.
const SAVE_CONFIRM_WINDOW: Duration = Duration::from_secs(30);

struct Session {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
    meta: Arc<SessionMeta>,
}

/// 원격 출력 바이트를 받는 콜백
pub type OutputFn = Box<dyn FnMut(&[u8]) -> bool + Send>;

/// 세션 이름과 구간별 서버 프로필 ID. 빠른 접속이면 ID가 없다.
#[derive(Debug, Clone, Default)]
pub struct SessionLabel {
    pub title: String,
    pub target_server_id: Option<String>,
    pub jump_server_id: Option<String>,
    pub jump_title: Option<String>,
}

pub struct SessionManager {
    sessions: Arc<Mutex<HashMap<String, Session>>>,
    sink: Arc<dyn EventSink>,
    history: Option<Arc<HistoryStore>>,
    /// helper로 다시 실행될 DHost 실행 파일
    helper_exe: String,
}

impl SessionManager {
    pub fn new(sink: Arc<dyn EventSink>, helper_exe: String, history: Option<Arc<HistoryStore>>) -> Self {
        Self { sessions: Arc::new(Mutex::new(HashMap::new())), sink, history, helper_exe }
    }

    pub fn open(
        &self,
        engine: &dyn SshEngine,
        broker: Arc<Broker>,
        req: ConnectRequest,
        label: SessionLabel,
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

        let mut hops = vec![];
        if let Some(j) = &req.jump {
            hops.push(Hop {
                server_id: label.jump_server_id.clone(),
                user: j.user.clone(),
                host: j.host.clone(),
                label: format!("경유 서버 {}", label.jump_title.clone().unwrap_or_else(|| j.host.clone())),
            });
        }
        hops.push(Hop {
            server_id: label.target_server_id.clone(),
            user: req.target.user.clone(),
            host: req.target.host.clone(),
            label: if req.jump.is_some() { format!("대상 서버 {}", label.title) } else { label.title.clone() },
        });
        let t = &req.target;
        let history_id = self.history.as_ref().and_then(|h| {
            let via = label.jump_title.clone().or_else(|| req.jump.as_ref().map(|j| j.host.clone()));
            h.start(
                label.target_server_id.as_deref(),
                &label.title,
                &format!("{}@{}:{}", t.user, t.host, t.port),
                via.as_deref(),
            )
            .map_err(|e| eprintln!("[dhost] 접속 이력 기록 실패: {e}"))
            .ok()
        });
        let meta = Arc::new(SessionMeta {
            session_id: session_id.clone(),
            history_id,
            hops,
            flags: Mutex::new(Flags::default()),
            tail: Mutex::new(vec![]),
        });

        let pair = native_pty_system()
            .openpty(PtySize { cols: size.0, rows: size.1, pixel_width: 0, pixel_height: 0 })
            .map_err(|e| AppError::Internal(format!("PTY 생성 실패: {e}")))?;
        broker.register_session(&token, meta.clone());
        let mut child = match pair.slave.spawn_command(cmd) {
            Ok(c) => c,
            Err(e) => {
                broker.unregister_session(&token);
                if let (Some(h), Some(id)) = (&self.history, history_id) {
                    let _ = h.finish(id, "error", None, None);
                }
                return Err(AppError::Internal(format!("ssh 실행 실패: {e}")));
            }
        };
        drop(pair.slave);

        let mut reader = pair.master.try_clone_reader().map_err(|e| AppError::Internal(e.to_string()))?;
        let writer = pair.master.take_writer().map_err(|e| AppError::Internal(e.to_string()))?;
        let killer = child.clone_killer();

        // 원격 출력 -> 화면. 출력 내용은 저장하지 않고, 인증 실패 문구만 확인한다.
        let m = meta.clone();
        std::thread::spawn(move || {
            let mut buf = [0u8; 16 * 1024];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        let chunk = &buf[..n];
                        if chunk.windows(17).any(|w| w == b"Permission denied") {
                            m.flags.lock().unwrap().permission_denied = true;
                        }
                        m.push_tail(chunk);
                        if !output(chunk) {
                            break;
                        }
                    }
                }
            }
        });

        // 프로세스 종료 감시 -> 이력 기록과 정리 후 화면에 알림. 자동 재접속은 하지 않는다 (FUN-07).
        let sessions = self.sessions.clone();
        let sid = session_id.clone();
        let sink = self.sink.clone();
        let history = self.history.clone();
        let m = meta.clone();
        std::thread::spawn(move || {
            let code = child.wait().ok().map(|s| s.exit_code());
            sessions.lock().unwrap().remove(&sid);
            broker.unregister_session(&token);
            let result = {
                let mut f = m.flags.lock().unwrap();
                if code == Some(255) {
                    // 방금 저장한 비밀번호로 끝내 접속하지 못했으면 지운다.
                    let stale: Vec<usize> = f
                        .saved_at
                        .iter()
                        .filter(|(_, at)| at.elapsed() < SAVE_CONFIRM_WINDOW)
                        .map(|(i, _)| *i)
                        .collect();
                    for i in stale {
                        f.saved_at.remove(&i);
                        if let Some(id) = &m.hops[i].server_id {
                            broker.secrets().delete(id);
                        }
                    }
                }
                let diagnosis = if code == Some(255) {
                    let tail = String::from_utf8_lossy(&m.tail.lock().unwrap()).into_owned();
                    crate::diagnose::diagnose(&tail, &m.hops, &f)
                } else {
                    None
                };
                (classify(&f, code), diagnosis)
            };
            let (result, diagnosis) = result;
            // 진단이 끝나면 들고 있던 출력은 버린다.
            m.tail.lock().unwrap().clear();
            if let (Some(h), Some(id)) = (&history, m.history_id) {
                let reason = diagnosis.as_ref().map(|d| d.code.as_str());
                let _ = h.finish(id, result, code.map(i64::from), reason);
            }
            sink.emit(AppEvent::SessionExit(SessionExit { session_id: sid, exit_code: code, diagnosis }));
        });

        self.sessions
            .lock()
            .unwrap()
            .insert(session_id.clone(), Session { master: pair.master, writer, killer, meta });
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
            s.meta.flags.lock().unwrap().closed_by_user = true;
            let _ = s.killer.kill();
        }
        Ok(())
    }

    /// 앱 종료 시 남은 ssh 프로세스를 모두 정리한다 (GAP-01).
    pub fn close_all(&self) {
        for s in self.sessions.lock().unwrap().values_mut() {
            s.meta.flags.lock().unwrap().closed_by_user = true;
            let _ = s.killer.kill();
        }
    }
}

/// 종료 상태로 접속 결과를 분류한다. ssh는 자체 오류일 때 255로 끝난다.
fn classify(f: &Flags, code: Option<u32>) -> &'static str {
    if f.hostkey_changed {
        "hostkey_changed"
    } else if f.hostkey_rejected {
        "hostkey_rejected"
    } else if f.auth_cancelled {
        "cancelled"
    } else if f.closed_by_user {
        "closed"
    } else if code == Some(255) {
        if f.permission_denied || f.password_prompts.values().any(|&n| n > 1) {
            "auth_failed"
        } else {
            "error"
        }
    } else {
        "closed"
    }
}
