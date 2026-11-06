//! 설정 백업·복원 (POL-05, FUN-12, GAP-03, GAP-08).
//!
//! - 백업에 들어가는 것: 고객사·폴더·서버 프로필, 앱 설정, (선택) 신뢰한 호스트 키
//! - 들어가지 않는 것: 비밀번호(키체인), 개인키, 접속 이력
//! - 복원해도 자동으로 접속하지 않는다.
//! - 복원 파일은 신뢰하지 않는다: 형식·크기·주소·참조·지문을 모두 다시 검사한다.

use std::collections::{HashMap, HashSet};
use std::os::unix::fs::PermissionsExt;
use std::path::Path;

use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::db::{now, Db};
use crate::error::{AppError, AppResult};
use crate::ssh::Endpoint;

pub const FORMAT: &str = "dhost-backup";
pub const VERSION: u32 = 1;
/// 이보다 큰 파일은 백업 파일로 보지 않는다.
const MAX_BYTES: u64 = 10 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupCustomer {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupFolder {
    pub id: String,
    pub customer_id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupServer {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub customer_id: Option<String>,
    pub folder_id: Option<String>,
    pub jump_server_id: Option<String>,
    #[serde(default)]
    pub is_production: bool,
    #[serde(default)]
    pub favorite: bool,
    #[serde(default)]
    pub note: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupHostKey {
    pub host: String,
    pub key_type: String,
    pub key: String,
    pub fingerprint: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupFile {
    pub format: String,
    pub version: u32,
    pub exported_at: i64,
    pub app_version: String,
    pub customers: Vec<BackupCustomer>,
    pub folders: Vec<BackupFolder>,
    pub servers: Vec<BackupServer>,
    #[serde(default)]
    pub settings: HashMap<String, String>,
    #[serde(default)]
    pub host_keys: Vec<BackupHostKey>,
}

/// 현재 저장소를 백업 데이터로 만든다.
pub fn build(db: &Db, include_host_keys: bool) -> AppResult<BackupFile> {
    let cat = crate::profiles::catalog(db)?;
    let settings = crate::settings::get_all(db)?.into_iter().collect();
    let host_keys = if include_host_keys {
        crate::hostkeys::HostKeyStore::new_for(db)
            .list()?
            .into_iter()
            .map(|k| BackupHostKey { host: k.host, key_type: k.key_type, key: k.key, fingerprint: k.fingerprint })
            .collect()
    } else {
        vec![]
    };
    Ok(BackupFile {
        format: FORMAT.into(),
        version: VERSION,
        exported_at: now(),
        app_version: env!("CARGO_PKG_VERSION").into(),
        customers: cat.customers.into_iter().map(|c| BackupCustomer { id: c.id, name: c.name }).collect(),
        folders: cat
            .folders
            .into_iter()
            .map(|f| BackupFolder { id: f.id, customer_id: f.customer_id, name: f.name })
            .collect(),
        servers: cat
            .servers
            .into_iter()
            .map(|s| BackupServer {
                id: s.id,
                name: s.name,
                host: s.host,
                port: s.port,
                username: s.username,
                customer_id: s.customer_id,
                folder_id: s.folder_id,
                jump_server_id: s.jump_server_id,
                is_production: s.is_production,
                favorite: s.favorite,
                note: s.note,
            })
            .collect(),
        settings,
        host_keys,
    })
}

/// 백업 파일을 쓴다. 서버 주소·계정 이름이 들어 있으므로 본인만 읽을 수 있게 한다.
pub fn export(db: &Db, path: &Path, include_host_keys: bool) -> AppResult<BackupFile> {
    let data = build(db, include_host_keys)?;
    let json = serde_json::to_vec_pretty(&data).map_err(|e| AppError::Internal(e.to_string()))?;
    std::fs::write(path, json).map_err(|e| AppError::Internal(format!("{}: {e}", path.display())))?;
    let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
    Ok(data)
}

pub fn read(path: &Path) -> AppResult<BackupFile> {
    let meta = std::fs::metadata(path).map_err(|e| AppError::InvalidInput(format!("파일을 열 수 없습니다: {e}")))?;
    if meta.len() > MAX_BYTES {
        return Err(AppError::InvalidInput("파일이 너무 큽니다. DHost 백업 파일이 아닙니다".into()));
    }
    let bytes = std::fs::read(path).map_err(|e| AppError::InvalidInput(format!("파일을 읽을 수 없습니다: {e}")))?;
    parse(&bytes)
}

pub fn parse(bytes: &[u8]) -> AppResult<BackupFile> {
    let data: BackupFile =
        serde_json::from_slice(bytes).map_err(|e| AppError::InvalidInput(format!("DHost 백업 파일 형식이 아닙니다: {e}")))?;
    if data.format != FORMAT {
        return Err(AppError::InvalidInput("DHost 백업 파일이 아닙니다".into()));
    }
    if data.version > VERSION {
        return Err(AppError::InvalidInput(format!(
            "더 새로운 버전(v{})의 백업 파일입니다. DHost를 업데이트하세요",
            data.version
        )));
    }
    Ok(data)
}

/// 복원 방식
#[derive(Debug, Clone, Copy, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum RestoreMode {
    /// 기존 목록에 합친다. 같은 서버(주소·포트·사용자)는 건너뛴다.
    Merge,
    /// 기존 고객사·폴더·서버를 모두 지우고 백업 내용으로 바꾼다.
    Replace,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreOptions {
    pub mode: RestoreMode,
    pub host_keys: bool,
    pub settings: bool,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreReport {
    pub customers: usize,
    pub folders: usize,
    pub servers: usize,
    pub host_keys: usize,
    pub settings: usize,
    /// 건너뛴 항목과 이유
    pub skipped: Vec<String>,
    /// 교체 모드에서 지운 서버 ID (키체인 비밀번호 정리용)
    #[serde(skip)]
    pub removed_server_ids: Vec<String>,
}

/// 복원 전에 보여줄 요약
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    pub exported_at: i64,
    pub app_version: String,
    pub customers: usize,
    pub folders: usize,
    pub servers: usize,
    pub production_servers: usize,
    pub host_keys: usize,
    pub settings: usize,
    /// 합치기 모드에서 이미 있어 건너뛸 서버 수
    pub duplicates: usize,
    /// 복원할 수 없는 항목과 이유
    pub problems: Vec<String>,
}

pub fn preview(db: &Db, data: &BackupFile) -> AppResult<Preview> {
    let existing = crate::profiles::catalog(db)?.servers;
    let duplicates = data
        .servers
        .iter()
        .filter(|s| existing.iter().any(|e| e.host == s.host && e.port == s.port && e.username == s.username))
        .count();
    let (_, problems) = validate(data);
    Ok(Preview {
        exported_at: data.exported_at,
        app_version: data.app_version.clone(),
        customers: data.customers.len(),
        folders: data.folders.len(),
        servers: data.servers.len(),
        production_servers: data.servers.iter().filter(|s| s.is_production).count(),
        host_keys: data.host_keys.len(),
        settings: data.settings.len(),
        duplicates,
        problems,
    })
}

/// 쓸 수 있는 서버 ID 집합과 문제 목록을 돌려준다.
fn validate(data: &BackupFile) -> (HashSet<String>, Vec<String>) {
    let mut problems = vec![];
    let customer_ids: HashSet<&str> = data.customers.iter().map(|c| c.id.as_str()).collect();
    let folder_owner: HashMap<&str, &str> =
        data.folders.iter().map(|f| (f.id.as_str(), f.customer_id.as_str())).collect();
    for f in &data.folders {
        if !customer_ids.contains(f.customer_id.as_str()) {
            problems.push(format!("폴더 '{}': 고객사를 찾을 수 없습니다", f.name));
        }
    }
    let mut ok: HashSet<String> = HashSet::new();
    let mut seen: HashSet<&str> = HashSet::new();
    for s in &data.servers {
        let mut why = None;
        if !seen.insert(&s.id) {
            why = Some("ID가 중복됩니다".to_string());
        } else if s.name.trim().is_empty() || s.name.chars().count() > 100 {
            why = Some("이름이 올바르지 않습니다".into());
        } else if s.note.chars().count() > 2000 {
            why = Some("메모가 너무 깁니다".into());
        } else if let Err(e) = (Endpoint { host: s.host.clone(), port: s.port, user: s.username.clone() }).validate() {
            why = Some(e.to_string());
        } else if s.customer_id.as_deref().is_some_and(|c| !customer_ids.contains(c)) {
            why = Some("고객사를 찾을 수 없습니다".into());
        } else if let Some(f) = &s.folder_id {
            match folder_owner.get(f.as_str()) {
                Some(owner) if Some(*owner) == s.customer_id.as_deref() => {}
                _ => why = Some("폴더가 고객사와 맞지 않습니다".into()),
            }
        }
        match why {
            Some(w) => problems.push(format!("서버 '{}': {w}", s.name)),
            None => {
                ok.insert(s.id.clone());
            }
        }
    }
    // 경유 서버는 한 단계만: 경유 대상이 있고, 그 대상은 다시 경유하지 않아야 한다.
    let by_id: HashMap<&str, &BackupServer> = data.servers.iter().map(|s| (s.id.as_str(), s)).collect();
    for s in &data.servers {
        if let Some(j) = &s.jump_server_id {
            let valid = j != &s.id && by_id.get(j.as_str()).is_some_and(|t| t.jump_server_id.is_none());
            if !valid {
                problems.push(format!("서버 '{}': 경유 서버 설정이 올바르지 않아 경유 없이 복원합니다", s.name));
            }
        }
    }
    for k in &data.host_keys {
        if crate::sshfiles::fingerprint(&k.key).as_deref() != Some(k.fingerprint.as_str()) {
            problems.push(format!("호스트 키 '{}': 지문이 키와 맞지 않아 가져오지 않습니다", k.host));
        }
    }
    for (key, value) in &data.settings {
        if crate::settings::validate(key, value).is_err() {
            problems.push(format!("설정 '{key}': 알 수 없거나 올바르지 않은 값이라 건너뜁니다"));
        }
    }
    (ok, problems)
}

/// 한 트랜잭션으로 복원한다. 중간에 실패하면 아무것도 바뀌지 않는다.
pub fn restore(db: &Db, data: &BackupFile, opts: &RestoreOptions) -> AppResult<RestoreReport> {
    let (valid_servers, _) = validate(data);
    db.with_mut(|conn| {
        let tx = conn.transaction()?;
        let mut r = RestoreReport::default();
        let t = now();

        if opts.mode == RestoreMode::Replace {
            let ids: Vec<String> = {
                let mut st = tx.prepare("SELECT id FROM servers")?;
                st.query_map([], |row| row.get(0))?.collect::<rusqlite::Result<_>>()?
            };
            r.removed_server_ids = ids;
            tx.execute("UPDATE servers SET jump_server_id = NULL", [])?;
            tx.execute("DELETE FROM servers", [])?;
            tx.execute("DELETE FROM folders", [])?;
            tx.execute("DELETE FROM customers", [])?;
        }

        // 고객사: 이름이 같으면 기존 것을 쓴다.
        let mut customer_map: HashMap<String, String> = HashMap::new();
        for c in &data.customers {
            let name = c.name.trim();
            if name.is_empty() || name.chars().count() > 100 {
                r.skipped.push(format!("고객사 '{}': 이름이 올바르지 않습니다", c.name));
                continue;
            }
            let existing: Option<String> =
                tx.query_row("SELECT id FROM customers WHERE name = ?1", [name], |row| row.get(0)).optional()?;
            let id = match existing {
                Some(id) => id,
                None => {
                    let id = uuid::Uuid::new_v4().to_string();
                    tx.execute("INSERT INTO customers (id, name, created_at) VALUES (?1, ?2, ?3)", params![id, name, t])?;
                    r.customers += 1;
                    id
                }
            };
            customer_map.insert(c.id.clone(), id);
        }

        // 폴더: (고객사, 이름)이 같으면 기존 것을 쓴다.
        let mut folder_map: HashMap<String, String> = HashMap::new();
        for f in &data.folders {
            let Some(cid) = customer_map.get(&f.customer_id) else { continue };
            let name = f.name.trim();
            if name.is_empty() || name.chars().count() > 100 {
                r.skipped.push(format!("폴더 '{}': 이름이 올바르지 않습니다", f.name));
                continue;
            }
            let existing: Option<String> = tx
                .query_row("SELECT id FROM folders WHERE customer_id = ?1 AND name = ?2", params![cid, name], |row| row.get(0))
                .optional()?;
            let id = match existing {
                Some(id) => id,
                None => {
                    let id = uuid::Uuid::new_v4().to_string();
                    tx.execute(
                        "INSERT INTO folders (id, customer_id, name, created_at) VALUES (?1, ?2, ?3, ?4)",
                        params![id, cid, name, t],
                    )?;
                    r.folders += 1;
                    id
                }
            };
            folder_map.insert(f.id.clone(), id);
        }

        // 서버: 같은 주소·포트·사용자가 이미 있으면 건너뛰고, 그 서버를 경유 대상으로 쓸 수 있게 기억한다.
        let mut server_map: HashMap<String, String> = HashMap::new();
        for s in &data.servers {
            if !valid_servers.contains(&s.id) {
                continue;
            }
            let dup: Option<String> = tx
                .query_row(
                    "SELECT id FROM servers WHERE host = ?1 AND port = ?2 AND username = ?3",
                    params![s.host, s.port, s.username],
                    |row| row.get(0),
                )
                .optional()?;
            if let Some(id) = dup {
                r.skipped.push(format!("서버 '{}': 같은 서버가 이미 있습니다", s.name));
                server_map.insert(s.id.clone(), id);
                continue;
            }
            let id = uuid::Uuid::new_v4().to_string();
            let customer = s.customer_id.as_ref().and_then(|c| customer_map.get(c));
            let folder = s.folder_id.as_ref().and_then(|f| folder_map.get(f)).filter(|_| customer.is_some());
            tx.execute(
                "INSERT INTO servers (id, name, host, port, username, customer_id, folder_id, jump_server_id,
                                      is_production, favorite, note, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, ?8, ?9, ?10, ?11, ?11)",
                params![id, s.name.trim(), s.host, s.port, s.username, customer, folder, s.is_production, s.favorite, s.note, t],
            )?;
            r.servers += 1;
            server_map.insert(s.id.clone(), id);
        }

        // 경유 서버 연결 (새로 만든 서버에만, 단일 Jump Host 규칙을 지킬 때만)
        let by_id: HashMap<&str, &BackupServer> = data.servers.iter().map(|s| (s.id.as_str(), s)).collect();
        for s in &data.servers {
            let (Some(j), Some(new_id)) = (&s.jump_server_id, server_map.get(&s.id)) else { continue };
            let jump_ok = j != &s.id && by_id.get(j.as_str()).is_some_and(|t| t.jump_server_id.is_none());
            let Some(jump_new) = server_map.get(j).filter(|_| jump_ok) else { continue };
            let jump_has_jump: bool = tx
                .query_row("SELECT jump_server_id IS NOT NULL FROM servers WHERE id = ?1", [jump_new], |row| row.get(0))
                .optional()?
                .unwrap_or(true);
            let used_as_jump: i64 =
                tx.query_row("SELECT COUNT(*) FROM servers WHERE jump_server_id = ?1", [new_id], |row| row.get(0))?;
            if !jump_has_jump && used_as_jump == 0 {
                tx.execute(
                    "UPDATE servers SET jump_server_id = ?2 WHERE id = ?1 AND jump_server_id IS NULL",
                    params![new_id, jump_new],
                )?;
            }
        }

        if opts.host_keys {
            for k in &data.host_keys {
                if crate::sshfiles::fingerprint(&k.key).as_deref() != Some(k.fingerprint.as_str()) {
                    continue;
                }
                // 같은 호스트에 다른 키가 이미 있으면 덮어쓰지 않는다 (신뢰를 조용히 바꾸지 않음).
                let conflict: i64 = tx.query_row(
                    "SELECT COUNT(*) FROM host_keys WHERE host = ?1 AND NOT (key_type = ?2 AND key = ?3)",
                    params![k.host, k.key_type, k.key],
                    |row| row.get(0),
                )?;
                if conflict > 0 {
                    r.skipped.push(format!("호스트 키 '{}': 이미 다른 키를 신뢰하고 있어 건너뜁니다", k.host));
                    continue;
                }
                r.host_keys += tx.execute(
                    "INSERT OR IGNORE INTO host_keys (host, key_type, key, fingerprint, added_at) VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![k.host, k.key_type, k.key, k.fingerprint, t],
                )?;
            }
        }

        if opts.settings {
            for (key, value) in &data.settings {
                if crate::settings::validate(key, value).is_ok() {
                    tx.execute(
                        "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                        params![key, value],
                    )?;
                    r.settings += 1;
                }
            }
        }

        tx.commit()?;
        Ok(r)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::profiles::{self, ServerInput};

    const KEY: &str = "AAAAC3NzaC1lZDI1NTE5AAAAIAXI1qT+YeFMxiSH8lNimKhEhupnrWMYnHea6ZXemlk/";

    fn db() -> std::sync::Arc<Db> {
        let p = std::env::temp_dir().join(format!("dhost-test-{}.db", uuid::Uuid::new_v4()));
        Db::open(&p).unwrap()
    }

    fn server(name: &str, host: &str, customer: Option<&str>, jump: Option<&str>) -> ServerInput {
        ServerInput {
            name: name.into(),
            host: host.into(),
            port: 22,
            username: "ops".into(),
            customer_id: customer.map(Into::into),
            folder_id: None,
            jump_server_id: jump.map(Into::into),
            is_production: name.starts_with("prod"),
            favorite: false,
            note: String::new(),
        }
    }

    fn seed(db: &Db) {
        let c = profiles::create_customer(db, "고객사A").unwrap();
        let f = profiles::create_folder(db, &c.id, "운영").unwrap();
        let b = profiles::create_server(db, &server("bastion", "192.0.2.1", Some(&c.id), None)).unwrap();
        let mut p = server("prod-web", "192.0.2.10", Some(&c.id), Some(&b.id));
        p.folder_id = Some(f.id);
        profiles::create_server(db, &p).unwrap();
        crate::settings::set(db, "theme", "dark").unwrap();
        db.with(|c| {
            c.execute(
                "INSERT INTO host_keys (host, key_type, key, fingerprint, added_at) VALUES ('[192.0.2.1]:22', 'ssh-ed25519', ?1, ?2, 0)",
                params![KEY, crate::sshfiles::fingerprint(KEY).unwrap()],
            )
        })
        .unwrap();
    }

    fn all() -> RestoreOptions {
        RestoreOptions { mode: RestoreMode::Merge, host_keys: true, settings: true }
    }

    #[test]
    fn backup_has_no_secrets_and_round_trips() {
        let src = db();
        seed(&src);
        let data = build(&src, true).unwrap();
        let json = serde_json::to_string(&data).unwrap();
        let lower = json.to_lowercase();
        assert!(!lower.contains("password") && !lower.contains("passphrase") && !lower.contains("private"));

        let dst = db();
        let r = restore(&dst, &parse(json.as_bytes()).unwrap(), &all()).unwrap();
        assert_eq!((r.customers, r.folders, r.servers, r.host_keys, r.settings), (1, 1, 2, 1, 1));
        let cat = profiles::catalog(&dst).unwrap();
        let bastion = cat.servers.iter().find(|s| s.name == "bastion").unwrap();
        let web = cat.servers.iter().find(|s| s.name == "prod-web").unwrap();
        assert_eq!(web.jump_server_id.as_deref(), Some(bastion.id.as_str()));
        assert!(web.folder_id.is_some() && web.is_production);
        // 복원은 접속 기록을 만들지 않는다 (자동 접속 없음)
        assert!(cat.servers.iter().all(|s| s.last_connected_at.is_none()));

        // 같은 파일을 다시 합치면 중복은 건너뛴다
        let again = restore(&dst, &data, &all()).unwrap();
        assert_eq!((again.customers, again.servers, again.host_keys), (0, 0, 0));
        assert_eq!(profiles::catalog(&dst).unwrap().servers.len(), 2);
    }

    #[test]
    fn replace_mode_clears_existing() {
        let src = db();
        seed(&src);
        let data = build(&src, false).unwrap();
        let dst = db();
        profiles::create_server(&dst, &server("old", "192.0.2.99", None, None)).unwrap();
        let r = restore(&dst, &data, &RestoreOptions { mode: RestoreMode::Replace, host_keys: false, settings: false })
            .unwrap();
        assert_eq!(r.removed_server_ids.len(), 1);
        let names: Vec<_> = profiles::catalog(&dst).unwrap().servers.into_iter().map(|s| s.name).collect();
        assert!(!names.contains(&"old".to_string()));
        assert_eq!(names.len(), 2);
    }

    #[test]
    fn rejects_bad_files_and_entries() {
        assert!(parse(b"not json").is_err());
        assert!(parse(br#"{"format":"other","version":1,"exportedAt":0,"appVersion":"x","customers":[],"folders":[],"servers":[]}"#).is_err());
        assert!(parse(br#"{"format":"dhost-backup","version":99,"exportedAt":0,"appVersion":"x","customers":[],"folders":[],"servers":[]}"#).is_err());

        let src = db();
        seed(&src);
        let mut data = build(&src, true).unwrap();
        // 주입 시도, 2단 경유, 없는 고객사, 위조 지문, 알 수 없는 설정
        data.servers.push(BackupServer {
            id: "evil".into(),
            name: "evil".into(),
            host: "-oProxyCommand=sh".into(),
            port: 22,
            username: "x".into(),
            customer_id: None,
            folder_id: None,
            jump_server_id: None,
            is_production: false,
            favorite: false,
            note: String::new(),
        });
        let web_id = data.servers.iter().find(|s| s.name == "prod-web").unwrap().id.clone();
        data.servers.push(BackupServer {
            id: "deep".into(),
            name: "deep".into(),
            host: "192.0.2.50".into(),
            port: 22,
            username: "ops".into(),
            customer_id: Some("nope".into()),
            folder_id: None,
            jump_server_id: Some(web_id),
            is_production: false,
            favorite: false,
            note: String::new(),
        });
        data.host_keys[0].fingerprint = "SHA256:forged".into();
        data.settings.insert("password".into(), "x".into());

        let p = preview(&db(), &data).unwrap();
        assert!(p.problems.iter().any(|m| m.contains("evil")));
        assert!(p.problems.iter().any(|m| m.contains("deep")));
        assert!(p.problems.iter().any(|m| m.contains("지문")));
        assert!(p.problems.iter().any(|m| m.contains("password")));

        let dst = db();
        let r = restore(&dst, &data, &all()).unwrap();
        assert_eq!(r.servers, 2, "올바른 서버만 복원");
        assert_eq!(r.host_keys, 0, "위조된 호스트 키는 가져오지 않음");
        assert!(crate::settings::get_all(&dst).unwrap().get("password").is_none());
    }

    #[test]
    fn host_key_conflict_is_not_overwritten() {
        let src = db();
        seed(&src);
        let data = build(&src, true).unwrap();
        let dst = db();
        let other = "AAAAC3NzaC1lZDI1NTE5AAAAIBmuGKqvHPqC/em8Qqh9JyukI/o4NCuFRUdyT6uBTOx7";
        dst.with(|c| {
            c.execute(
                "INSERT INTO host_keys (host, key_type, key, fingerprint, added_at) VALUES ('[192.0.2.1]:22', 'ssh-ed25519', ?1, 'x', 0)",
                [other],
            )
        })
        .unwrap();
        let r = restore(&dst, &data, &all()).unwrap();
        assert_eq!(r.host_keys, 0);
        assert!(r.skipped.iter().any(|m| m.contains("이미 다른 키")));
    }
}
