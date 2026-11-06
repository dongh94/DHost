//! 로컬 SQLite 저장소 (FUN-09).
//! 서버 접속 정보만 저장한다. 비밀번호·개인키 같은 비밀정보는 저장하지 않는다 (SEC-04).

use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::Connection;

use crate::error::{AppError, AppResult};

pub struct Db {
    conn: Mutex<Connection>,
}

/// 버전별 마이그레이션. 순서대로 한 번씩만 적용된다.
const MIGRATIONS: &[&str] = &[
    // v1: 고객사 > 폴더 > 서버, 신뢰한 호스트 키
    r#"
    CREATE TABLE customers (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL UNIQUE,
        created_at  INTEGER NOT NULL
    );
    CREATE TABLE folders (
        id          TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
        name        TEXT NOT NULL,
        created_at  INTEGER NOT NULL,
        UNIQUE (customer_id, name)
    );
    CREATE TABLE servers (
        id                TEXT PRIMARY KEY,
        name              TEXT NOT NULL,
        host              TEXT NOT NULL,
        port              INTEGER NOT NULL,
        username          TEXT NOT NULL,
        customer_id       TEXT REFERENCES customers(id) ON DELETE RESTRICT,
        folder_id         TEXT REFERENCES folders(id) ON DELETE RESTRICT,
        jump_server_id    TEXT REFERENCES servers(id) ON DELETE RESTRICT,
        is_production     INTEGER NOT NULL DEFAULT 0,
        favorite          INTEGER NOT NULL DEFAULT 0,
        note              TEXT NOT NULL DEFAULT '',
        created_at        INTEGER NOT NULL,
        updated_at        INTEGER NOT NULL,
        last_connected_at INTEGER
    );
    CREATE INDEX servers_customer ON servers(customer_id);
    CREATE TABLE host_keys (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        host        TEXT NOT NULL,
        key_type    TEXT NOT NULL,
        key         TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        added_at    INTEGER NOT NULL,
        UNIQUE (host, key_type, key)
    );
    CREATE INDEX host_keys_host ON host_keys(host);
    "#,
    // v2: 앱 설정 (키-값). 인증정보는 넣지 않는다.
    r#"
    CREATE TABLE settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );
    "#,
    // v3: 접속 이력. 명령·출력은 저장하지 않는다.
    r#"
    CREATE TABLE connection_history (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        server_id  TEXT,
        title      TEXT NOT NULL,
        target     TEXT NOT NULL,
        via        TEXT,
        started_at INTEGER NOT NULL,
        ended_at   INTEGER,
        result     TEXT NOT NULL,
        exit_code  INTEGER
    );
    CREATE INDEX connection_history_started ON connection_history(started_at);
    "#,
    // v4: 접속 실패 원인 코드
    r#"
    ALTER TABLE connection_history ADD COLUMN reason TEXT;
    "#,
    // v5: 서버별 개인키 파일 경로 (키 내용은 저장하지 않음)
    r#"
    ALTER TABLE servers ADD COLUMN identity_file TEXT;
    "#,
];

impl Db {
    pub fn open(path: &Path) -> AppResult<Arc<Self>> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| AppError::Internal(e.to_string()))?;
            // 데이터 폴더도 본인만 열 수 있게 한다 (TEST-11 점검에서 0755였음).
            let _ = std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700));
        }
        let conn = Connection::open(path)?;
        // 서버 주소도 민감할 수 있으므로 본인만 읽을 수 있게 한다.
        let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
        conn.execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;")?;
        migrate(&conn)?;
        Ok(Arc::new(Self { conn: Mutex::new(conn) }))
    }

    pub fn with<T>(&self, f: impl FnOnce(&Connection) -> rusqlite::Result<T>) -> AppResult<T> {
        let conn = self.conn.lock().unwrap();
        Ok(f(&conn)?)
    }

    pub fn with_mut<T>(&self, f: impl FnOnce(&mut Connection) -> AppResult<T>) -> AppResult<T> {
        let mut conn = self.conn.lock().unwrap();
        f(&mut conn)
    }
}

fn migrate(conn: &Connection) -> AppResult<()> {
    let current: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    for (i, sql) in MIGRATIONS.iter().enumerate().skip(current as usize) {
        conn.execute_batch(&format!("BEGIN; {sql}; PRAGMA user_version = {}; COMMIT;", i + 1))?;
    }
    Ok(())
}

pub fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

impl From<rusqlite::Error> for AppError {
    fn from(e: rusqlite::Error) -> Self {
        if let rusqlite::Error::SqliteFailure(f, _) = &e {
            match f.extended_code {
                rusqlite::ffi::SQLITE_CONSTRAINT_UNIQUE => {
                    return AppError::InvalidInput("같은 이름이 이미 있습니다".into());
                }
                rusqlite::ffi::SQLITE_CONSTRAINT_FOREIGNKEY | rusqlite::ffi::SQLITE_CONSTRAINT_TRIGGER => {
                    return AppError::InvalidInput("다른 항목이 사용 중이라 처리할 수 없습니다".into());
                }
                _ => {}
            }
        }
        AppError::Internal(format!("저장소 오류: {e}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    /// TEST-11: 저장 파일과 폴더는 본인만 읽을 수 있다.
    #[test]
    fn data_dir_and_db_are_private() {
        let dir = std::env::temp_dir().join(format!("dhost-perm-{}", uuid::Uuid::new_v4()));
        let db = dir.join("dhost.db");
        Db::open(&db).unwrap();
        let mode = |p: &Path| std::fs::metadata(p).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode(&dir), 0o700);
        assert_eq!(mode(&db), 0o600);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
