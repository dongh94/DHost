//! SSH 엔진 추상화.
//!
//! MVP는 시스템 OpenSSH를 PTY로 실행하는 방식(`openssh`)을 쓴다.
//! 나중에 기능별로 다른 엔진(예: russh)으로 바꿀 수 있도록 trait 뒤에 둔다.
//! 연결·입출력·종료 메서드는 검증 스파이크에서 추가한다.

pub mod openssh;

use serde::Serialize;

use crate::error::AppResult;

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

pub trait SshEngine: Send + Sync {
    /// 엔진을 사용할 수 있는지 확인한다. 네트워크 연결은 하지 않는다.
    fn probe(&self) -> AppResult<EngineInfo>;

    fn clone_box(&self) -> Box<dyn SshEngine>;
}
