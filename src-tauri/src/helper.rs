//! ssh가 실행하는 helper 모드.
//!
//! - `dhost --dhost-known-hosts <reason> <host> <type> <key> <fingerprint>`: KnownHostsCommand
//! - `dhost <prompt>` + DHOST_SESSION_TOKEN 환경변수: SSH_ASKPASS
//!
//! 앱과 통신할 수 없으면 실패로 끝낸다 (ssh가 연결을 중단한다).

use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::UnixStream;

use crate::ipc::{HelperRequest, HelperResponse};

pub const KNOWN_HOSTS_FLAG: &str = "--dhost-known-hosts";

/// helper로 실행된 경우 처리 후 종료 코드를 돌려준다. 일반 실행이면 None.
pub fn run_if_helper() -> Option<i32> {
    let args: Vec<String> = std::env::args().collect();
    let token = std::env::var("DHOST_SESSION_TOKEN").ok()?;

    if args.get(1).map(String::as_str) == Some(KNOWN_HOSTS_FLAG) {
        let get = |i: usize| args.get(i).cloned().unwrap_or_default();
        let req = HelperRequest::KnownHosts {
            token,
            reason: get(2),
            host: get(3),
            key_type: get(4),
            key: get(5),
            fingerprint: get(6),
        };
        return Some(match send(&req) {
            Some(HelperResponse::KnownHosts { lines }) => {
                let mut out = std::io::stdout();
                for l in lines {
                    let _ = writeln!(out, "{l}");
                }
                0
            }
            _ => 1,
        });
    }

    // SSH_ASKPASS로 실행됨. SSH_ASKPASS_PROMPT=confirm이면 예/아니오 확인이다.
    let prompt = args.get(1).cloned().unwrap_or_default();
    let confirm = std::env::var("SSH_ASKPASS_PROMPT")
        .map(|v| v == "confirm")
        .unwrap_or(false);
    let req = HelperRequest::Askpass { token, prompt, confirm };
    Some(match send(&req) {
        Some(HelperResponse::Askpass { secret: Some(s) }) => {
            let _ = writeln!(std::io::stdout(), "{s}");
            0
        }
        _ => 1,
    })
}

fn send(req: &HelperRequest) -> Option<HelperResponse> {
    let path = std::env::var("DHOST_IPC_SOCKET").ok()?;
    let mut stream = UnixStream::connect(path).ok()?;
    let mut line = serde_json::to_string(req).ok()?;
    line.push('\n');
    stream.write_all(line.as_bytes()).ok()?;
    let mut reader = BufReader::new(stream);
    let mut resp = String::new();
    reader.read_line(&mut resp).ok()?;
    serde_json::from_str(&resp).ok()
}
