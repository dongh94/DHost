//! 세션 하나에 대한 정보와 진행 상태. 비밀번호 저장·접속 이력 판단에 쓴다.

use std::collections::{HashMap, HashSet};
use std::sync::Mutex;
use std::time::Instant;

/// 접속 경로의 한 구간 (경유 서버 또는 대상 서버)
#[derive(Debug, Clone)]
pub struct Hop {
    /// 저장된 서버 프로필이면 그 ID. 빠른 접속이면 None (비밀번호 저장 안 함)
    pub server_id: Option<String>,
    pub user: String,
    pub host: String,
}

#[derive(Debug, Default)]
pub struct Flags {
    pub hostkey_changed: bool,
    pub hostkey_rejected: bool,
    /// 사용자가 비밀번호 창에서 취소함. 이후 질문은 모두 거절한다.
    pub auth_cancelled: bool,
    pub closed_by_user: bool,
    pub permission_denied: bool,
    /// 구간별 비밀번호 질문 횟수
    pub password_prompts: HashMap<usize, u32>,
    /// 저장된 비밀번호를 자동으로 넣은 구간
    pub autofilled: HashSet<usize>,
    /// 이번 세션에서 새로 저장한 구간과 시각
    pub saved_at: HashMap<usize, Instant>,
}

#[derive(Debug)]
pub struct SessionMeta {
    pub session_id: String,
    pub history_id: Option<i64>,
    /// [경유 서버, 대상 서버] 또는 [대상 서버]
    pub hops: Vec<Hop>,
    pub flags: Mutex<Flags>,
}

impl SessionMeta {
    /// ssh 비밀번호 질문("user@host's password: ")이 어느 구간인지 찾는다.
    pub fn hop_for_prompt(&self, prompt: &str) -> Option<usize> {
        let p = prompt.trim();
        let who = p.strip_suffix("'s password:")?;
        let (user, host) = who.rsplit_once('@')?;
        self.hops.iter().position(|h| h.user == user && h.host == host)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_password_prompt_to_hop() {
        let m = SessionMeta {
            session_id: "s".into(),
            history_id: None,
            hops: vec![
                Hop { server_id: Some("j".into()), user: "dhost".into(), host: "127.0.0.1".into() },
                Hop { server_id: Some("t".into()), user: "dhost".into(), host: "target".into() },
            ],
            flags: Mutex::new(Flags::default()),
        };
        assert_eq!(m.hop_for_prompt("dhost@127.0.0.1's password: "), Some(0));
        assert_eq!(m.hop_for_prompt("dhost@target's password: "), Some(1));
        assert_eq!(m.hop_for_prompt("Enter passphrase for key '/x/id_ed25519': "), None);
        assert_eq!(m.hop_for_prompt("root@target's password: "), None);
    }
}
