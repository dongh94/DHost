//! 기존 SSH 파일 활용 (OPEN-01 결정).
//! - ~/.ssh/known_hosts: 사용자가 고른 항목만 DHost 저장소로 가져온다. 계속 함께 읽지는 않는다.
//! - ~/.ssh/config: Host 항목을 서버 프로필 후보로 보여준다. 값은 `ssh -G`로 해석한다.
//! 두 파일 모두 읽기만 하고 고치지 않는다.

use std::path::PathBuf;
use std::process::Command;

use base64::engine::general_purpose::{STANDARD, STANDARD_NO_PAD};
use base64::Engine;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::error::{AppError, AppResult};
use crate::ssh::Endpoint;

pub fn ssh_dir() -> AppResult<PathBuf> {
    dirs::home_dir()
        .map(|h| h.join(".ssh"))
        .ok_or_else(|| AppError::Internal("홈 폴더를 찾을 수 없습니다".into()))
}

/// OpenSSH와 같은 형식의 지문: "SHA256:" + base64(sha256(키 바이트)), 패딩 없음
pub fn fingerprint(key_b64: &str) -> Option<String> {
    let bytes = STANDARD.decode(key_b64).ok()?;
    let digest = Sha256::digest(&bytes);
    Some(format!("SHA256:{}", STANDARD_NO_PAD.encode(digest.as_slice())))
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct KnownHostCandidate {
    pub host: String,
    pub key_type: String,
    pub key: String,
    pub fingerprint: String,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KnownHostsScan {
    pub candidates: Vec<KnownHostCandidate>,
    /// 해시된 호스트 이름(|1|...)이라 어떤 서버인지 알 수 없어 가져올 수 없는 항목
    pub hashed: usize,
    /// 와일드카드·@cert-authority·@revoked 등 가져오지 않는 항목
    pub skipped: usize,
}

pub fn parse_known_hosts(content: &str) -> KnownHostsScan {
    let mut scan = KnownHostsScan::default();
    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if line.starts_with('@') {
            scan.skipped += 1;
            continue;
        }
        let mut parts = line.split_whitespace();
        let (Some(hosts), Some(key_type), Some(key)) = (parts.next(), parts.next(), parts.next()) else {
            scan.skipped += 1;
            continue;
        };
        if hosts.starts_with("|1|") {
            scan.hashed += 1;
            continue;
        }
        let Some(fp) = fingerprint(key) else {
            scan.skipped += 1;
            continue;
        };
        for host in hosts.split(',') {
            if host.is_empty() || host.contains(['*', '?', '!']) {
                scan.skipped += 1;
                continue;
            }
            let c = KnownHostCandidate {
                host: host.to_string(),
                key_type: key_type.to_string(),
                key: key.to_string(),
                fingerprint: fp.clone(),
            };
            if !scan.candidates.contains(&c) {
                scan.candidates.push(c);
            }
        }
    }
    scan
}

pub fn scan_known_hosts() -> AppResult<KnownHostsScan> {
    let path = ssh_dir()?.join("known_hosts");
    match std::fs::read_to_string(&path) {
        Ok(c) => Ok(parse_known_hosts(&c)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(KnownHostsScan::default()),
        Err(e) => Err(AppError::Internal(format!("{}: {e}", path.display()))),
    }
}

/// ~/.ssh/config의 Host 별칭 (와일드카드·부정 패턴 제외). Include는 따라가지 않는다.
pub fn parse_config_aliases(content: &str) -> Vec<String> {
    let mut out = vec![];
    for line in content.lines() {
        let line = line.trim();
        let mut it = line.splitn(2, |c: char| c.is_whitespace() || c == '=');
        let (Some(k), Some(rest)) = (it.next(), it.next()) else { continue };
        if !k.eq_ignore_ascii_case("host") {
            continue;
        }
        for alias in rest.split_whitespace() {
            let alias = alias.trim_matches('"');
            if alias.is_empty() || alias.contains(['*', '?', '!']) || out.iter().any(|a| a == alias) {
                continue;
            }
            out.push(alias.to_string());
        }
    }
    out
}

/// `ssh -G` 출력("키 값" 줄)을 해석한다. 키는 소문자다.
pub fn parse_ssh_g(output: &str) -> Vec<(String, String)> {
    output
        .lines()
        .filter_map(|l| {
            let (k, v) = l.split_once(' ')?;
            Some((k.to_string(), v.to_string()))
        })
        .collect()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigCandidate {
    pub alias: String,
    pub host: String,
    pub port: u16,
    pub user: String,
    /// "none"이 아니면 원래 값 그대로 (예: "bastion", "a,b")
    pub proxy_jump: Option<String>,
    /// 가져올 수 없는 이유 (주소 형식이 맞지 않음 등)
    pub problem: Option<String>,
}

pub fn scan_config() -> AppResult<Vec<ConfigCandidate>> {
    let path = ssh_dir()?.join("config");
    let content = match std::fs::read_to_string(&path) {
        Ok(c) => c,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(vec![]),
        Err(e) => return Err(AppError::Internal(format!("{}: {e}", path.display()))),
    };
    let mut out = vec![];
    for alias in parse_config_aliases(&content) {
        // 별칭은 ssh 인자로 넘기므로 옵션처럼 보이는 값은 건너뛴다.
        if alias.starts_with('-') {
            continue;
        }
        let output = Command::new("/usr/bin/ssh")
            .args(["-G", "--", &alias])
            .output()
            .map_err(|e| AppError::Internal(format!("ssh -G 실행 실패: {e}")))?;
        let kv = parse_ssh_g(&String::from_utf8_lossy(&output.stdout));
        let get = |k: &str| kv.iter().find(|(key, _)| key == k).map(|(_, v)| v.clone());
        let host = get("hostname").unwrap_or_else(|| alias.clone());
        let user = get("user").unwrap_or_default();
        let port = get("port").and_then(|p| p.parse().ok()).unwrap_or(22);
        let proxy_jump = get("proxyjump").filter(|v| v != "none");
        let problem = Endpoint { host: host.clone(), port, user: user.clone() }
            .validate()
            .err()
            .map(|e| e.to_string())
            .or_else(|| {
                proxy_jump
                    .as_ref()
                    .filter(|p| p.contains(','))
                    .map(|_| "여러 단계 경유는 지원하지 않아 경유 없이 가져옵니다".to_string())
            });
        out.push(ConfigCandidate { alias, host, port, user, proxy_jump, problem });
    }
    Ok(out)
}

/// ProxyJump 값 "user@host:port" 또는 "alias"에서 이름(호스트)만 뽑는다.
pub fn proxy_jump_host(value: &str) -> String {
    let v = value.rsplit_once('@').map(|(_, h)| h).unwrap_or(value);
    let v = v.trim_start_matches('[');
    match v.rsplit_once(':') {
        Some((h, p)) if p.chars().all(|c| c.is_ascii_digit()) => h.trim_end_matches(']').to_string(),
        _ => v.trim_end_matches(']').to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // 테스트용 가상 키 (ssh-keygen으로 만든 공개키, 실서버 키 아님)
    const KEY: &str = "AAAAC3NzaC1lZDI1NTE5AAAAIAXI1qT+YeFMxiSH8lNimKhEhupnrWMYnHea6ZXemlk/";

    #[test]
    fn fingerprint_matches_openssh_format() {
        let fp = fingerprint(KEY).unwrap();
        assert!(fp.starts_with("SHA256:"));
        assert!(!fp.ends_with('='));
        assert_eq!(fp.len(), "SHA256:".len() + 43);
    }

    #[test]
    fn parses_known_hosts() {
        let content = format!(
            "# comment\n\
             host.example.com,192.0.2.10 ssh-ed25519 {KEY}\n\
             [192.0.2.11]:2222 ssh-ed25519 {KEY} comment here\n\
             |1|abc=|def= ssh-ed25519 {KEY}\n\
             @cert-authority *.example.com ssh-ed25519 {KEY}\n\
             *.lab.example.com ssh-ed25519 {KEY}\n\
             broken-line\n"
        );
        let s = parse_known_hosts(&content);
        let hosts: Vec<_> = s.candidates.iter().map(|c| c.host.as_str()).collect();
        assert_eq!(hosts, ["host.example.com", "192.0.2.10", "[192.0.2.11]:2222"]);
        assert_eq!(s.hashed, 1);
        assert_eq!(s.skipped, 3);
    }

    #[test]
    fn parses_config_aliases() {
        let c = "Host *\n  ServerAliveInterval 30\nHost bastion web-01\n  HostName 192.0.2.10\nhost=db \"lab vm\"\nHost !bad *.x\nMatch host foo\n";
        assert_eq!(parse_config_aliases(c), ["bastion", "web-01", "db", "lab", "vm"]);
    }

    #[test]
    fn proxy_jump_hosts() {
        assert_eq!(proxy_jump_host("bastion"), "bastion");
        assert_eq!(proxy_jump_host("ops@bastion.example.com:2222"), "bastion.example.com");
        assert_eq!(proxy_jump_host("ops@[192.0.2.1]:22"), "192.0.2.1");
    }
}
