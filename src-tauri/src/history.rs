//! 접속 이력 (FUN-15, SEC-P04).
//! 언제 어느 서버에 접속했고 결과가 어땠는지만 남긴다. 명령·출력·비밀번호는 기록하지 않는다.
//! 30일이 지난 기록은 지운다 (OPEN-03 결정).

use std::sync::Arc;

use rusqlite::params;
use serde::Serialize;

use crate::db::{now, Db};
use crate::error::AppResult;

pub const RETENTION_DAYS: i64 = 30;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub id: i64,
    pub server_id: Option<String>,
    pub title: String,
    pub target: String,
    pub via: Option<String>,
    pub started_at: i64,
    pub ended_at: Option<i64>,
    /// connecting | closed | auth_failed | hostkey_rejected | hostkey_changed | cancelled | error | interrupted
    pub result: String,
    pub exit_code: Option<i64>,
    /// 실패 원인 코드 (diagnose.rs)
    pub reason: Option<String>,
}

pub struct HistoryStore {
    db: Arc<Db>,
}

impl HistoryStore {
    pub fn new(db: Arc<Db>) -> Self {
        Self { db }
    }

    /// 앱 시작 시: 오래된 기록을 지우고, 앱이 비정상 종료돼 끝나지 않은 기록을 정리한다.
    pub fn maintain(&self) -> AppResult<()> {
        let cutoff = now() - RETENTION_DAYS * 86400;
        self.db.with(|c| {
            c.execute("DELETE FROM connection_history WHERE started_at < ?1", [cutoff])?;
            c.execute(
                "UPDATE connection_history SET result = 'interrupted' WHERE result = 'connecting'",
                [],
            )
        })?;
        Ok(())
    }

    pub fn start(&self, server_id: Option<&str>, title: &str, target: &str, via: Option<&str>) -> AppResult<i64> {
        self.db.with(|c| {
            c.execute(
                "INSERT INTO connection_history (server_id, title, target, via, started_at, result)
                 VALUES (?1, ?2, ?3, ?4, ?5, 'connecting')",
                params![server_id, title, target, via, now()],
            )?;
            Ok(c.last_insert_rowid())
        })
    }

    pub fn finish(&self, id: i64, result: &str, exit_code: Option<i64>, reason: Option<&str>) -> AppResult<()> {
        self.db.with(|c| {
            c.execute(
                "UPDATE connection_history SET ended_at = ?2, result = ?3, exit_code = ?4, reason = ?5 WHERE id = ?1",
                params![id, now(), result, exit_code, reason],
            )
        })?;
        Ok(())
    }

    pub fn list(&self, limit: i64) -> AppResult<Vec<HistoryEntry>> {
        self.db.with(|c| {
            let mut st = c.prepare(
                "SELECT id, server_id, title, target, via, started_at, ended_at, result, exit_code, reason
                 FROM connection_history ORDER BY started_at DESC, id DESC LIMIT ?1",
            )?;
            st.query_map([limit], |r| {
                Ok(HistoryEntry {
                    id: r.get(0)?,
                    server_id: r.get(1)?,
                    title: r.get(2)?,
                    target: r.get(3)?,
                    via: r.get(4)?,
                    started_at: r.get(5)?,
                    ended_at: r.get(6)?,
                    result: r.get(7)?,
                    exit_code: r.get(8)?,
                    reason: r.get(9)?,
                })
            })?
            .collect()
        })
    }

    pub fn clear(&self) -> AppResult<()> {
        self.db.with(|c| c.execute("DELETE FROM connection_history", []))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn start_finish_list_maintain() {
        let p = std::env::temp_dir().join(format!("dhost-test-{}.db", uuid::Uuid::new_v4()));
        let db = Db::open(&p).unwrap();
        let h = HistoryStore::new(db.clone());
        let a = h.start(Some("s1"), "web-01", "ops@192.0.2.11:22", Some("bastion")).unwrap();
        let b = h.start(None, "quick", "x@192.0.2.12:22", None).unwrap();
        h.finish(a, "closed", Some(0), None).unwrap();
        // 아주 오래된 기록
        db.with(|c| c.execute("UPDATE connection_history SET started_at = 1 WHERE id = ?1", [a])).unwrap();
        h.maintain().unwrap();
        let list = h.list(10).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, b);
        assert_eq!(list[0].result, "interrupted");
        h.clear().unwrap();
        assert!(h.list(10).unwrap().is_empty());
        let _ = std::fs::remove_file(&p);
    }
}
