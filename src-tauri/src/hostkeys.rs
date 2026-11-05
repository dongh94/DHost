//! DHost가 신뢰한 호스트 키 저장소.
//! 사용자가 승인한 키만 저장한다. 파일 위치: 앱 데이터 폴더/known_hosts.json

use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HostKey {
    /// ssh가 known_hosts에서 찾는 이름 (예: "[192.0.2.10]:2222", "target")
    pub host: String,
    pub key_type: String,
    pub key: String,
    pub fingerprint: String,
    pub added_at: u64,
}

impl HostKey {
    pub fn known_hosts_line(&self) -> String {
        format!("{} {} {}", self.host, self.key_type, self.key)
    }
}

pub struct HostKeyStore {
    path: PathBuf,
    keys: Mutex<Vec<HostKey>>,
}

impl HostKeyStore {
    pub fn load(path: PathBuf) -> Self {
        let keys = std::fs::read(&path)
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default();
        Self { path, keys: Mutex::new(keys) }
    }

    pub fn find(&self, host: &str) -> Vec<HostKey> {
        self.keys.lock().unwrap().iter().filter(|k| k.host == host).cloned().collect()
    }

    pub fn add(&self, host: &str, key_type: &str, key: &str, fingerprint: &str) -> std::io::Result<HostKey> {
        let entry = HostKey {
            host: host.into(),
            key_type: key_type.into(),
            key: key.into(),
            fingerprint: fingerprint.into(),
            added_at: SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0),
        };
        let mut keys = self.keys.lock().unwrap();
        keys.push(entry.clone());
        if let Some(dir) = self.path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        std::fs::write(&self.path, serde_json::to_vec_pretty(&*keys)?)?;
        Ok(entry)
    }
}
