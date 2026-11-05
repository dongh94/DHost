use serde::Serialize;

/// 프런트엔드로 전달되는 오류. 비밀정보는 메시지에 넣지 않는다.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("ssh 실행 파일을 찾을 수 없습니다: {0}")]
    SshNotFound(String),
    #[error("ssh 버전을 해석할 수 없습니다: {0}")]
    SshVersionUnparsable(String),
    #[error("내부 오류: {0}")]
    Internal(String),
}

impl Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
