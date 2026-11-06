//! DHost가 신뢰한 호스트 키 저장소. 사용자가 승인한 키만 저장한다.

use std::sync::Arc;

use rusqlite::params;
use serde::{Deserialize, Serialize};

use crate::db::{Db, now};
use crate::error::AppResult;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HostKey {
    pub id: i64,
    /// ssh가 known_hosts에서 찾는 이름 (예: "[192.0.2.10]:2222", "target")
    pub host: String,
    pub key_type: String,
    pub key: String,
    pub fingerprint: String,
    pub added_at: i64,
}

impl HostKey {
    pub fn known_hosts_line(&self) -> String {
        format!("{} {} {}", self.host, self.key_type, self.key)
    }
}

pub struct HostKeyStore {
    db: Arc<Db>,
}

const COLUMNS: &str = "id, host, key_type, key, fingerprint, added_at";

fn row(r: &rusqlite::Row) -> rusqlite::Result<HostKey> {
    Ok(HostKey {
        id: r.get(0)?,
        host: r.get(1)?,
        key_type: r.get(2)?,
        key: r.get(3)?,
        fingerprint: r.get(4)?,
        added_at: r.get(5)?,
    })
}

impl HostKeyStore {
    pub fn new(db: Arc<Db>) -> Self {
        Self { db }
    }

    /// 백업처럼 잠깐 읽기만 할 때
    pub fn new_for(db: &Db) -> HostKeyReader<'_> {
        HostKeyReader { db }
    }

    pub fn find(&self, host: &str) -> AppResult<Vec<HostKey>> {
        self.db.with(|c| {
            let mut st = c.prepare(&format!("SELECT {COLUMNS} FROM host_keys WHERE host = ?1"))?;
            st.query_map([host], row)?.collect()
        })
    }

    pub fn list(&self) -> AppResult<Vec<HostKey>> {
        self.db.with(|c| {
            let mut st = c.prepare(&format!("SELECT {COLUMNS} FROM host_keys ORDER BY host"))?;
            st.query_map([], row)?.collect()
        })
    }

    pub fn add(&self, host: &str, key_type: &str, key: &str, fingerprint: &str) -> AppResult<HostKey> {
        self.db.with(|c| {
            c.execute(
                "INSERT OR IGNORE INTO host_keys (host, key_type, key, fingerprint, added_at) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![host, key_type, key, fingerprint, now()],
            )?;
            c.query_row(
                &format!("SELECT {COLUMNS} FROM host_keys WHERE host = ?1 AND key_type = ?2 AND key = ?3"),
                params![host, key_type, key],
                row,
            )
        })
    }

    /// 키가 바뀐 서버를 관리자와 확인한 뒤, 사용자가 직접 기존 키를 지울 때 쓴다.
    pub fn remove(&self, id: i64) -> AppResult<()> {
        self.db
            .with(|c| c.execute("DELETE FROM host_keys WHERE id = ?1", [id]).map(|_| ()))
    }

    /// 스파이크 때 쓰던 known_hosts.json이 있으면 한 번 가져오고 지운다.
    pub fn import_legacy_json(&self, path: &std::path::Path) {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Legacy {
            host: String,
            key_type: String,
            key: String,
            fingerprint: String,
        }
        let Ok(bytes) = std::fs::read(path) else { return };
        if let Ok(items) = serde_json::from_slice::<Vec<Legacy>>(&bytes) {
            for k in items {
                let _ = self.add(&k.host, &k.key_type, &k.key, &k.fingerprint);
            }
            let _ = std::fs::remove_file(path);
        }
    }
}

pub struct HostKeyReader<'a> {
    db: &'a Db,
}

impl HostKeyReader<'_> {
    pub fn list(&self) -> AppResult<Vec<HostKey>> {
        self.db.with(|c| {
            let mut st = c.prepare(&format!("SELECT {COLUMNS} FROM host_keys ORDER BY host"))?;
            st.query_map([], row)?.collect()
        })
    }
}
