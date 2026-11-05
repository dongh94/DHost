//! ssh가 실행한 DHost helper와 앱 사이의 통신.
//!
//! helper(호스트 키 확인, 비밀번호 입력)는 Unix 소켓으로 요청 한 줄을 보내고 응답 한 줄을 받는다.
//! 요청에는 세션 토큰이 들어 있어서 앱이 만든 ssh 프로세스의 요청만 처리한다.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::os::unix::fs::PermissionsExt;
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::PathBuf;
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::events::{AppEvent, AskpassPrompt, EventSink, HostKeyChanged, HostKeyPrompt};
use crate::hostkeys::HostKeyStore;

/// 사용자가 응답하지 않으면 이 시간 뒤 거절로 처리한다.
const PROMPT_TIMEOUT: Duration = Duration::from_secs(300);

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum HelperRequest {
    #[serde(rename_all = "camelCase")]
    KnownHosts {
        token: String,
        reason: String,
        host: String,
        key_type: String,
        key: String,
        fingerprint: String,
    },
    #[serde(rename_all = "camelCase")]
    Askpass { token: String, prompt: String, confirm: bool },
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum HelperResponse {
    KnownHosts { lines: Vec<String> },
    Askpass { secret: Option<String> },
    Denied,
}

pub enum Answer {
    HostKey(bool),
    Secret(Option<String>),
}

pub struct Broker {
    pub socket_path: PathBuf,
    sink: Arc<dyn EventSink>,
    hostkeys: HostKeyStore,
    /// 세션 토큰 -> 세션 ID
    tokens: Mutex<HashMap<String, String>>,
    /// 화면 응답을 기다리는 요청 ID -> 응답 채널
    pending: Mutex<HashMap<String, mpsc::Sender<Answer>>>,
}

impl Broker {
    pub fn start(sink: Arc<dyn EventSink>, hostkeys: HostKeyStore) -> std::io::Result<Arc<Self>> {
        sweep_stale_dirs();
        // 다른 사용자가 접근할 수 없는 폴더에 소켓을 만든다.
        let nonce = uuid::Uuid::new_v4().simple().to_string();
        let dir = std::env::temp_dir().join(format!("dhost-{}-{}", std::process::id(), &nonce[..8]));
        std::fs::create_dir_all(&dir)?;
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700))?;
        let socket_path = dir.join("ipc.sock");
        let _ = std::fs::remove_file(&socket_path);
        let listener = UnixListener::bind(&socket_path)?;
        std::fs::set_permissions(&socket_path, std::fs::Permissions::from_mode(0o600))?;

        let broker = Arc::new(Self {
            socket_path,
            sink,
            hostkeys,
            tokens: Mutex::new(HashMap::new()),
            pending: Mutex::new(HashMap::new()),
        });

        let b = broker.clone();
        std::thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                let b = b.clone();
                std::thread::spawn(move || {
                    if let Err(e) = b.handle(stream) {
                        eprintln!("[dhost ipc] {e}");
                    }
                });
            }
        });
        Ok(broker)
    }

    pub fn register_session(&self, token: &str, session_id: &str) {
        self.tokens.lock().unwrap().insert(token.into(), session_id.into());
    }

    pub fn unregister_session(&self, token: &str) {
        self.tokens.lock().unwrap().remove(token);
    }

    pub fn answer(&self, request_id: &str, answer: Answer) -> bool {
        match self.pending.lock().unwrap().remove(request_id) {
            Some(tx) => tx.send(answer).is_ok(),
            None => false,
        }
    }

    fn handle(&self, stream: UnixStream) -> std::io::Result<()> {
        let mut reader = BufReader::new(stream.try_clone()?);
        let mut line = String::new();
        reader.read_line(&mut line)?;
        let response = match serde_json::from_str::<HelperRequest>(&line) {
            Ok(req) => self.dispatch(req),
            Err(_) => HelperResponse::Denied,
        };
        let mut out = serde_json::to_string(&response)?;
        out.push('\n');
        (&stream).write_all(out.as_bytes())
    }

    fn session_for(&self, token: &str) -> Option<String> {
        self.tokens.lock().unwrap().get(token).cloned()
    }

    fn dispatch(&self, req: HelperRequest) -> HelperResponse {
        match req {
            HelperRequest::KnownHosts { token, reason, host, key_type, key, fingerprint } => {
                let Some(session_id) = self.session_for(&token) else {
                    return HelperResponse::Denied;
                };
                let lines = self.known_hosts(&session_id, &reason, &host, &key_type, &key, &fingerprint);
                HelperResponse::KnownHosts { lines }
            }
            HelperRequest::Askpass { token, prompt, confirm } => {
                let Some(session_id) = self.session_for(&token) else {
                    return HelperResponse::Denied;
                };
                let (request_id, rx) = self.new_pending();
                self.sink.emit(AppEvent::AskpassPrompt(AskpassPrompt {
                    request_id: request_id.clone(),
                    session_id,
                    prompt,
                    confirm,
                }));
                let secret = match self.wait(&request_id, rx) {
                    Some(Answer::Secret(s)) => s,
                    _ => None,
                };
                HelperResponse::Askpass { secret }
            }
        }
    }

    fn known_hosts(
        &self,
        session_id: &str,
        reason: &str,
        host: &str,
        key_type: &str,
        key: &str,
        fingerprint: &str,
    ) -> Vec<String> {
        let known = self.hostkeys.find(host);
        let lines = || known.iter().map(|k| k.known_hosts_line()).collect::<Vec<_>>();

        // ORDER: 알고리즘 우선순위를 정하는 호출. 제시된 키가 없으므로 묻지 않는다.
        if reason == "ORDER" {
            return lines();
        }
        if known.iter().any(|k| k.key_type == key_type && k.key == key) {
            return lines();
        }
        if !known.is_empty() {
            // 저장된 키와 다르다. 저장된 키를 돌려주면 ssh가 연결을 차단한다 (FUN-04).
            self.sink.emit(AppEvent::HostKeyChanged(HostKeyChanged {
                    session_id: session_id.into(),
                    host: host.into(),
                    key_type: key_type.into(),
                    fingerprint: fingerprint.into(),
                known_fingerprints: known.iter().map(|k| k.fingerprint.clone()).collect(),
            }));
            return lines();
        }

        // 처음 보는 호스트: 사용자가 승인해야만 신뢰한다.
        let (request_id, rx) = self.new_pending();
        self.sink.emit(AppEvent::HostKeyPrompt(HostKeyPrompt {
                request_id: request_id.clone(),
                session_id: session_id.into(),
                host: host.into(),
                key_type: key_type.into(),
            fingerprint: fingerprint.into(),
        }));
        match self.wait(&request_id, rx) {
            Some(Answer::HostKey(true)) => match self.hostkeys.add(host, key_type, key, fingerprint) {
                Ok(entry) => vec![entry.known_hosts_line()],
                Err(e) => {
                    eprintln!("[dhost ipc] 호스트 키 저장 실패: {e}");
                    vec![]
                }
            },
            _ => vec![],
        }
    }

    fn new_pending(&self) -> (String, mpsc::Receiver<Answer>) {
        let id = uuid::Uuid::new_v4().to_string();
        let (tx, rx) = mpsc::channel();
        self.pending.lock().unwrap().insert(id.clone(), tx);
        (id, rx)
    }

    fn wait(&self, request_id: &str, rx: mpsc::Receiver<Answer>) -> Option<Answer> {
        let answer = rx.recv_timeout(PROMPT_TIMEOUT).ok();
        self.pending.lock().unwrap().remove(request_id);
        answer
    }
}

impl Broker {
    /// 소켓 파일과 폴더를 지운다. 앱 종료 시 호출한다.
    /// (std::process::exit로 끝나면 Drop이 실행되지 않으므로 명시적으로 부른다)
    pub fn shutdown(&self) {
        let _ = std::fs::remove_file(&self.socket_path);
        if let Some(dir) = self.socket_path.parent() {
            let _ = std::fs::remove_dir(dir);
        }
    }
}

/// 비정상 종료로 남은 소켓 폴더(dhost-<pid>-<nonce>) 중 프로세스가 없는 것을 지운다.
fn sweep_stale_dirs() {
    let Ok(entries) = std::fs::read_dir(std::env::temp_dir()) else { return };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        let Some(rest) = name.strip_prefix("dhost-") else { continue };
        let Some(pid) = rest.split('-').next().and_then(|p| p.parse::<i32>().ok()) else { continue };
        // kill(pid, 0): 프로세스가 살아 있는지만 확인한다
        let alive = unsafe { libc::kill(pid, 0) } == 0;
        if !alive && entry.path().join("ipc.sock").exists() {
            let _ = std::fs::remove_file(entry.path().join("ipc.sock"));
            let _ = std::fs::remove_dir(entry.path());
        }
    }
}
