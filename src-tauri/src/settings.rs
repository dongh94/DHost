//! 앱 설정 (FUN-09, FUN-12). 허용된 키만 저장한다.

use std::collections::BTreeMap;

use rusqlite::params;

use crate::db::Db;
use crate::error::{AppError, AppResult};

/// 저장할 수 있는 설정과 허용 값
pub fn validate(key: &str, value: &str) -> AppResult<()> {
    let ok = match key {
        "theme" => matches!(value, "system" | "light" | "dark"),
        "terminal.fontSize" => value.parse::<u8>().map(|n| (10..=24).contains(&n)).unwrap_or(false),
        "ssh.connectTimeout" => value.parse::<u32>().map(|n| (5..=120).contains(&n)).unwrap_or(false),
        _ => return Err(AppError::InvalidInput(format!("알 수 없는 설정입니다: {key}"))),
    };
    if !ok {
        return Err(AppError::InvalidInput(format!("{key} 값이 올바르지 않습니다: {value}")));
    }
    Ok(())
}

pub fn get_all(db: &Db) -> AppResult<BTreeMap<String, String>> {
    db.with(|c| {
        let mut st = c.prepare("SELECT key, value FROM settings")?;
        st.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?.collect()
    })
}

pub fn set(db: &Db, key: &str, value: &str) -> AppResult<()> {
    validate(key, value)?;
    db.with(|c| {
        c.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )
    })?;
    Ok(())
}

/// 설정만 기본값으로 되돌린다. 서버 목록과 호스트 키는 그대로 둔다.
/// 연결 시간 제한(초). 설정이 없으면 15초.
pub fn connect_timeout(db: &Db) -> u32 {
    get_all(db)
        .ok()
        .and_then(|m| m.get("ssh.connectTimeout").and_then(|v| v.parse().ok()))
        .unwrap_or(15)
}

pub fn reset(db: &Db) -> AppResult<()> {
    db.with(|c| c.execute("DELETE FROM settings", []))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn set_get_reset() {
        let p = std::env::temp_dir().join(format!("dhost-test-{}.db", uuid::Uuid::new_v4()));
        let db = Db::open(&p).unwrap();
        set(&db, "theme", "dark").unwrap();
        set(&db, "theme", "light").unwrap();
        set(&db, "terminal.fontSize", "14").unwrap();
        let all = get_all(&db).unwrap();
        assert_eq!(all.get("theme").map(String::as_str), Some("light"));
        assert!(set(&db, "theme", "purple").is_err());
        assert!(set(&db, "terminal.fontSize", "99").is_err());
        assert!(set(&db, "password", "x").is_err());
        reset(&db).unwrap();
        assert!(get_all(&db).unwrap().is_empty());
        let _ = std::fs::remove_file(&p);
    }
}
