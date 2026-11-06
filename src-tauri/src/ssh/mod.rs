//! SSH 엔진 추상화.
//!
//! MVP는 시스템 OpenSSH를 PTY로 실행하는 방식(`openssh`)을 쓴다.
//! 나중에 기능별로 다른 엔진(예: russh)으로 바꿀 수 있도록 trait 뒤에 둔다.

pub mod openssh;

use portable_pty::CommandBuilder;
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineInfo {
    /// 엔진 이름 (예: "openssh")
    pub name: String,
    /// 원본 버전 문자열 (예: "OpenSSH_10.3p1, LibreSSL 3.3.6")
    pub version: String,
    /// DHost가 요구하는 기능(KnownHostsCommand, SSH_ASKPASS_REQUIRE)을 지원하는지
    pub supported: bool,
}

/// 접속 대상 하나 (대상 서버 또는 Jump Host)
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Endpoint {
    pub host: String,
    pub port: u16,
    pub user: String,
    /// 이 구간에 쓸 개인키 파일 경로 (선택). 키 내용은 저장하지 않고 경로만 넘긴다.
    #[serde(default)]
    pub identity_file: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectRequest {
    pub target: Endpoint,
    /// 단일 Jump Host (FUN-13)
    pub jump: Option<Endpoint>,
    /// 구간별 연결 시간 제한(초). 앱 설정값을 넣는다.
    #[serde(default)]
    pub connect_timeout: Option<u32>,
}

/// ssh가 실행하는 DHost helper(호스트 키 확인, 비밀번호 입력)와 앱을 잇는 정보
#[derive(Debug, Clone)]
pub struct HelperContext {
    /// DHost 실행 파일 경로. helper 모드로 다시 실행된다.
    pub exe: String,
    pub socket_path: String,
    pub session_token: String,
}

pub trait SshEngine: Send + Sync {
    /// 엔진을 사용할 수 있는지 확인한다. 네트워크 연결은 하지 않는다.
    fn probe(&self) -> AppResult<EngineInfo>;

    /// PTY에서 실행할 명령을 만든다.
    fn build_command(&self, req: &ConnectRequest, ctx: &HelperContext) -> AppResult<CommandBuilder>;

    /// 실제로 적용될 ssh 설정을 보여준다 (`ssh -G`, SEC-P02). 연결하지 않는다.
    fn effective_config(&self, req: &ConnectRequest, ctx: &HelperContext) -> AppResult<Vec<ConfigEntry>>;

    fn clone_box(&self) -> Box<dyn SshEngine>;
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigEntry {
    pub key: String,
    pub value: String,
    /// DHost가 보안을 위해 직접 정하는 값 (사용자 ssh_config보다 우선)
    pub forced: bool,
}

impl Endpoint {
    /// 셸·옵션 주입을 막기 위해 허용 문자를 좁게 제한한다.
    pub fn validate(&self) -> AppResult<()> {
        let host_ok = !self.host.is_empty()
            && self.host.len() <= 253
            && !self.host.starts_with('-')
            && self
                .host
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | ':' | '_'));
        if !host_ok {
            return Err(AppError::InvalidInput(format!(
                "호스트 이름이 올바르지 않습니다: {}",
                self.host
            )));
        }
        let user_ok = !self.user.is_empty()
            && self.user.len() <= 64
            && !self.user.starts_with('-')
            && self
                .user
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'));
        if !user_ok {
            return Err(AppError::InvalidInput(format!(
                "사용자 이름이 올바르지 않습니다: {}",
                self.user
            )));
        }
        if self.port == 0 {
            return Err(AppError::InvalidInput("포트가 올바르지 않습니다".into()));
        }
        if let Some(path) = &self.identity_file {
            validate_identity_path(path)?;
        }
        Ok(())
    }

    /// 접속 직전에 개인키 파일이 실제로 있는지 확인한다. 없으면 ssh가 경고만 하고 비밀번호로 넘어가므로 먼저 알린다.
    pub fn check_identity_exists(&self) -> AppResult<()> {
        if let Some(path) = &self.identity_file
            && !expand_home(path).is_file()
        {
            return Err(AppError::InvalidInput(format!(
                "개인키 파일을 찾을 수 없습니다: {path}"
            )));
        }
        Ok(())
    }
}

/// 개인키 경로 규칙: 절대 경로 또는 `~/`로 시작. ssh가 `%`·`$`를 토큰으로 치환하므로 쓰지 않는다.
pub fn validate_identity_path(path: &str) -> AppResult<()> {
    let ok = !path.is_empty()
        && path.len() <= 1024
        && (path.starts_with('/') || path.starts_with("~/"))
        && !path
            .chars()
            .any(|c| c.is_control() || matches!(c, '%' | '$' | '"' | '\\'));
    if !ok {
        return Err(AppError::InvalidInput(format!(
            "개인키 파일 경로가 올바르지 않습니다 (절대 경로나 ~/로 시작, % $ \" \\ 제외): {path}"
        )));
    }
    Ok(())
}

/// `~/`를 홈 폴더로 바꾼다.
pub fn expand_home(path: &str) -> std::path::PathBuf {
    match (path.strip_prefix("~/"), dirs::home_dir()) {
        (Some(rest), Some(home)) => home.join(rest),
        _ => std::path::PathBuf::from(path),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ep(host: &str, user: &str) -> Endpoint {
        Endpoint {
            host: host.into(),
            port: 22,
            user: user.into(),
            identity_file: None,
        }
    }

    #[test]
    fn rejects_injection() {
        assert!(ep("example.com", "dhost").validate().is_ok());
        assert!(ep("192.0.2.10", "dhost").validate().is_ok());
        assert!(ep("-oProxyCommand=x", "dhost").validate().is_err());
        assert!(ep("a;rm -rf /", "dhost").validate().is_err());
        assert!(ep("host", "a'b").validate().is_err());
        assert!(ep("host", "$(id)").validate().is_err());
        assert!(ep("", "dhost").validate().is_err());
    }

    #[test]
    fn identity_path_rules() {
        let with = |p: &str| Endpoint {
            identity_file: Some(p.into()),
            ..ep("example.com", "dhost")
        };
        assert!(with("~/.ssh/customer_a").validate().is_ok());
        assert!(with("/Users/me/keys/my key.pem").validate().is_ok());
        for bad in ["", "id_rsa", "./k", "~/k%h", "~/$HOME/k", "~/a\nb", "~/a\"b"] {
            assert!(with(bad).validate().is_err(), "{bad:?}");
        }
    }
}
