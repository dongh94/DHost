//! 서버 비밀번호 저장소 (OPEN-02 결정: macOS 키체인에 선택 저장).
//!
//! - 서버 프로필 하나당 비밀번호 하나. 키체인 계정 이름은 "server:<프로필 ID>"
//! - DB·설정 백업에는 절대 들어가지 않는다 (POL-05, SEC-04).

use std::collections::HashMap;
use std::sync::Mutex;

use crate::error::{AppError, AppResult};

pub trait SecretStore: Send + Sync {
    fn get(&self, server_id: &str) -> Option<String>;
    fn set(&self, server_id: &str, secret: &str) -> AppResult<()>;
    fn delete(&self, server_id: &str);
    fn has(&self, server_id: &str) -> bool {
        self.get(server_id).is_some()
    }
}

const SERVICE: &str = "io.github.dongh94.dhost";

fn account(server_id: &str) -> String {
    format!("server:{server_id}")
}

/// macOS 키체인
pub struct KeychainStore;

#[cfg(target_os = "macos")]
impl SecretStore for KeychainStore {
    fn get(&self, server_id: &str) -> Option<String> {
        security_framework::passwords::get_generic_password(SERVICE, &account(server_id))
            .ok()
            .and_then(|b| String::from_utf8(b).ok())
    }

    fn set(&self, server_id: &str, secret: &str) -> AppResult<()> {
        security_framework::passwords::set_generic_password(SERVICE, &account(server_id), secret.as_bytes())
            .map_err(|e| AppError::Internal(format!("키체인 저장 실패: {e}")))
    }

    fn delete(&self, server_id: &str) {
        let _ = security_framework::passwords::delete_generic_password(SERVICE, &account(server_id));
    }
}

#[cfg(not(target_os = "macos"))]
impl SecretStore for KeychainStore {
    fn get(&self, _: &str) -> Option<String> {
        None
    }
    fn set(&self, _: &str, _: &str) -> AppResult<()> {
        Err(AppError::Internal(
            "이 OS에서는 아직 비밀번호 저장을 지원하지 않습니다".into(),
        ))
    }
    fn delete(&self, _: &str) {}
}

/// 테스트용 메모리 저장소
#[derive(Default)]
pub struct MemoryStore(Mutex<HashMap<String, String>>);

impl SecretStore for MemoryStore {
    fn get(&self, server_id: &str) -> Option<String> {
        self.0.lock().unwrap().get(server_id).cloned()
    }
    fn set(&self, server_id: &str, secret: &str) -> AppResult<()> {
        self.0.lock().unwrap().insert(server_id.into(), secret.into());
        Ok(())
    }
    fn delete(&self, server_id: &str) {
        self.0.lock().unwrap().remove(server_id);
    }
}
