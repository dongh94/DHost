//! 고객사 > 폴더 > 서버 프로필 (FUN-01, FUN-02).

use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::db::{now, Db};
use crate::error::{AppError, AppResult};
use crate::session::SessionLabel;
use crate::ssh::{ConnectRequest, Endpoint};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Customer {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Folder {
    pub id: String,
    pub customer_id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Server {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub customer_id: Option<String>,
    pub folder_id: Option<String>,
    pub jump_server_id: Option<String>,
    pub is_production: bool,
    pub favorite: bool,
    pub note: String,
    pub last_connected_at: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerInput {
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub customer_id: Option<String>,
    pub folder_id: Option<String>,
    pub jump_server_id: Option<String>,
    pub is_production: bool,
    pub favorite: bool,
    pub note: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Catalog {
    pub customers: Vec<Customer>,
    pub folders: Vec<Folder>,
    pub servers: Vec<Server>,
}

const SERVER_COLUMNS: &str = "id, name, host, port, username, customer_id, folder_id, jump_server_id, \
                              is_production, favorite, note, last_connected_at";

fn server_row(r: &rusqlite::Row) -> rusqlite::Result<Server> {
    Ok(Server {
        id: r.get(0)?,
        name: r.get(1)?,
        host: r.get(2)?,
        port: r.get(3)?,
        username: r.get(4)?,
        customer_id: r.get(5)?,
        folder_id: r.get(6)?,
        jump_server_id: r.get(7)?,
        is_production: r.get(8)?,
        favorite: r.get(9)?,
        note: r.get(10)?,
        last_connected_at: r.get(11)?,
    })
}

fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

fn clean_name(name: &str, what: &str) -> AppResult<String> {
    let n = name.trim();
    if n.is_empty() || n.chars().count() > 100 {
        return Err(AppError::InvalidInput(format!("{what} 이름은 1~100자여야 합니다")));
    }
    Ok(n.to_string())
}

pub fn catalog(db: &Db) -> AppResult<Catalog> {
    db.with(|c| {
        let customers = c
            .prepare("SELECT id, name FROM customers ORDER BY name")?
            .query_map([], |r| Ok(Customer { id: r.get(0)?, name: r.get(1)? }))?
            .collect::<rusqlite::Result<_>>()?;
        let folders = c
            .prepare("SELECT id, customer_id, name FROM folders ORDER BY name")?
            .query_map([], |r| Ok(Folder { id: r.get(0)?, customer_id: r.get(1)?, name: r.get(2)? }))?
            .collect::<rusqlite::Result<_>>()?;
        let servers = c
            .prepare(&format!("SELECT {SERVER_COLUMNS} FROM servers ORDER BY name"))?
            .query_map([], server_row)?
            .collect::<rusqlite::Result<_>>()?;
        Ok(Catalog { customers, folders, servers })
    })
}

pub fn create_customer(db: &Db, name: &str) -> AppResult<Customer> {
    let name = clean_name(name, "고객사")?;
    let id = new_id();
    db.with(|c| c.execute("INSERT INTO customers (id, name, created_at) VALUES (?1, ?2, ?3)", params![id, name, now()]))?;
    Ok(Customer { id, name })
}

pub fn rename_customer(db: &Db, id: &str, name: &str) -> AppResult<()> {
    let name = clean_name(name, "고객사")?;
    db.with(|c| c.execute("UPDATE customers SET name = ?2 WHERE id = ?1", params![id, name]))?;
    Ok(())
}

/// 서버나 폴더가 남아 있으면 지우지 않는다 (실수로 대량 삭제 방지).
pub fn delete_customer(db: &Db, id: &str) -> AppResult<()> {
    db.with(|c| c.execute("DELETE FROM customers WHERE id = ?1", [id]))?;
    Ok(())
}

pub fn create_folder(db: &Db, customer_id: &str, name: &str) -> AppResult<Folder> {
    let name = clean_name(name, "폴더")?;
    let id = new_id();
    db.with(|c| {
        c.execute(
            "INSERT INTO folders (id, customer_id, name, created_at) VALUES (?1, ?2, ?3, ?4)",
            params![id, customer_id, name, now()],
        )
    })?;
    Ok(Folder { id, customer_id: customer_id.into(), name })
}

pub fn rename_folder(db: &Db, id: &str, name: &str) -> AppResult<()> {
    let name = clean_name(name, "폴더")?;
    db.with(|c| c.execute("UPDATE folders SET name = ?2 WHERE id = ?1", params![id, name]))?;
    Ok(())
}

pub fn delete_folder(db: &Db, id: &str) -> AppResult<()> {
    db.with(|c| c.execute("DELETE FROM folders WHERE id = ?1", [id]))?;
    Ok(())
}

fn get_server(c: &rusqlite::Connection, id: &str) -> rusqlite::Result<Option<Server>> {
    c.query_row(&format!("SELECT {SERVER_COLUMNS} FROM servers WHERE id = ?1"), [id], server_row)
        .optional()
}

fn validate(c: &rusqlite::Connection, input: &ServerInput, self_id: Option<&str>) -> AppResult<ServerInput> {
    let mut v = input.clone();
    v.name = clean_name(&v.name, "서버")?;
    v.host = v.host.trim().to_string();
    v.username = v.username.trim().to_string();
    if v.note.chars().count() > 2000 {
        return Err(AppError::InvalidInput("메모는 2000자 이하여야 합니다".into()));
    }
    Endpoint { host: v.host.clone(), port: v.port, user: v.username.clone() }.validate()?;

    // 폴더는 같은 고객사 안의 폴더여야 한다.
    if let Some(folder_id) = &v.folder_id {
        let owner: Option<String> = c
            .query_row("SELECT customer_id FROM folders WHERE id = ?1", [folder_id], |r| r.get(0))
            .optional()?;
        match owner {
            Some(o) if Some(&o) == v.customer_id.as_ref() => {}
            _ => return Err(AppError::InvalidInput("폴더가 선택한 고객사에 속하지 않습니다".into())),
        }
    }

    // 단일 Jump Host만 지원한다 (FUN-13): 경유 서버는 자기 자신이 아니고, 그 자신도 경유하지 않아야 한다.
    if let Some(jump_id) = &v.jump_server_id {
        if Some(jump_id.as_str()) == self_id {
            return Err(AppError::InvalidInput("자기 자신을 경유 서버로 지정할 수 없습니다".into()));
        }
        let jump = get_server(c, jump_id)?
            .ok_or_else(|| AppError::InvalidInput("경유 서버를 찾을 수 없습니다".into()))?;
        if jump.jump_server_id.is_some() {
            return Err(AppError::InvalidInput("경유 서버는 다른 서버를 경유하지 않아야 합니다 (단일 Jump Host)".into()));
        }
    }
    if let Some(id) = self_id {
        if v.jump_server_id.is_some() {
            let used: i64 = c.query_row("SELECT COUNT(*) FROM servers WHERE jump_server_id = ?1", [id], |r| r.get(0))?;
            if used > 0 {
                return Err(AppError::InvalidInput(
                    "다른 서버의 경유 서버로 쓰이는 서버는 경유 설정을 가질 수 없습니다".into(),
                ));
            }
        }
    }
    Ok(v)
}

pub fn create_server(db: &Db, input: &ServerInput) -> AppResult<Server> {
    let id = new_id();
    db.with_mut(|c| {
        let v = validate(c, input, None)?;
        let t = now();
        c.execute(
            "INSERT INTO servers (id, name, host, port, username, customer_id, folder_id, jump_server_id,
                                  is_production, favorite, note, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12)",
            params![id, v.name, v.host, v.port, v.username, v.customer_id, v.folder_id, v.jump_server_id,
                    v.is_production, v.favorite, v.note, t],
        )?;
        Ok(get_server(c, &id)?.expect("방금 저장한 서버"))
    })
}

pub fn update_server(db: &Db, id: &str, input: &ServerInput) -> AppResult<Server> {
    db.with_mut(|c| {
        get_server(c, id)?.ok_or_else(|| AppError::InvalidInput("서버를 찾을 수 없습니다".into()))?;
        let v = validate(c, input, Some(id))?;
        c.execute(
            "UPDATE servers SET name = ?2, host = ?3, port = ?4, username = ?5, customer_id = ?6, folder_id = ?7,
                    jump_server_id = ?8, is_production = ?9, favorite = ?10, note = ?11, updated_at = ?12
             WHERE id = ?1",
            params![id, v.name, v.host, v.port, v.username, v.customer_id, v.folder_id, v.jump_server_id,
                    v.is_production, v.favorite, v.note, now()],
        )?;
        Ok(get_server(c, id)?.expect("방금 수정한 서버"))
    })
}

pub fn set_favorite(db: &Db, id: &str, favorite: bool) -> AppResult<()> {
    db.with(|c| c.execute("UPDATE servers SET favorite = ?2 WHERE id = ?1", params![id, favorite]))?;
    Ok(())
}

/// 경유 서버로 쓰이는 서버는 지우지 않는다.
pub fn delete_server(db: &Db, id: &str) -> AppResult<()> {
    db.with(|c| c.execute("DELETE FROM servers WHERE id = ?1", [id]))?;
    Ok(())
}

/// 프로필로 접속 요청을 만든다. 경유 서버가 있으면 함께 넣는다.
pub fn connect_plan(db: &Db, id: &str) -> AppResult<(ConnectRequest, SessionLabel)> {
    plan(db, id, true)
}

/// touch가 false면 최근 접속 시각을 바꾸지 않는다 (설정 확인용).
pub fn plan(db: &Db, id: &str, touch: bool) -> AppResult<(ConnectRequest, SessionLabel)> {
    db.with_mut(|c| {
        let s = get_server(c, id)?.ok_or_else(|| AppError::InvalidInput("서버를 찾을 수 없습니다".into()))?;
        let jump = match &s.jump_server_id {
            Some(j) => Some(get_server(c, j)?.ok_or_else(|| AppError::InvalidInput("경유 서버를 찾을 수 없습니다".into()))?),
            None => None,
        };
        if touch {
            c.execute("UPDATE servers SET last_connected_at = ?2 WHERE id = ?1", params![id, now()])?;
        }
        let label = SessionLabel {
            title: s.name.clone(),
            target_server_id: Some(s.id.clone()),
            jump_server_id: jump.as_ref().map(|j| j.id.clone()),
            jump_title: jump.as_ref().map(|j| j.name.clone()),
        };
        let req = ConnectRequest {
            target: Endpoint { host: s.host, port: s.port, user: s.username },
            jump: jump.map(|j| Endpoint { host: j.host, port: j.port, user: j.username }),
        };
        Ok((req, label))
    })
}

/// 접속 대상(호스트·포트·사용자)이 바뀌었는지. 바뀌면 저장된 비밀번호를 지워야 한다 (SEC-P03).
pub fn target_changed(before: &Server, after: &Server) -> bool {
    before.host != after.host || before.port != after.port || before.username != after.username
}

pub fn get(db: &Db, id: &str) -> AppResult<Option<Server>> {
    db.with(|c| get_server(c, id))
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSummary {
    pub created: usize,
    /// (별칭, 이유)
    pub skipped: Vec<(String, String)>,
    pub warnings: Vec<(String, String)>,
}

/// ~/.ssh/config 후보를 서버 프로필로 만든다. 같은 주소·포트·사용자의 서버가 이미 있으면 건너뛴다.
/// ProxyJump가 한 단계이고 그 대상이 등록된(또는 함께 가져온) 서버면 경유 서버로 연결한다.
pub fn import_config(
    db: &Db,
    items: &[crate::sshfiles::ConfigCandidate],
    customer_id: Option<String>,
) -> AppResult<ImportSummary> {
    let mut summary = ImportSummary::default();
    let mut created: Vec<(String, Server)> = vec![];
    let existing = catalog(db)?.servers;

    // 경유 서버로 쓰일 항목을 먼저 만든다.
    let mut ordered: Vec<&crate::sshfiles::ConfigCandidate> = items.iter().filter(|i| i.proxy_jump.is_none()).collect();
    ordered.extend(items.iter().filter(|i| i.proxy_jump.is_some()));

    for item in ordered {
        if existing.iter().any(|s| s.host == item.host && s.port == item.port && s.username == item.user) {
            summary.skipped.push((item.alias.clone(), "같은 서버가 이미 등록되어 있습니다".into()));
            continue;
        }
        let mut jump_server_id = None;
        if let Some(pj) = item.proxy_jump.as_deref() {
            if pj.contains(',') {
                summary.warnings.push((item.alias.clone(), "여러 단계 경유는 지원하지 않아 경유 없이 가져왔습니다".into()));
            } else {
                let name = crate::sshfiles::proxy_jump_host(pj);
                let found = created
                    .iter()
                    .find(|(alias, s)| *alias == name || s.host == name)
                    .map(|(_, s)| s.clone())
                    .or_else(|| existing.iter().find(|s| s.name == name || s.host == name).cloned());
                match found {
                    Some(j) if j.jump_server_id.is_none() => jump_server_id = Some(j.id),
                    _ => summary.warnings.push((
                        item.alias.clone(),
                        format!("경유 서버 '{name}'를 찾지 못해 경유 없이 가져왔습니다"),
                    )),
                }
            }
        }
        let input = ServerInput {
            name: item.alias.clone(),
            host: item.host.clone(),
            port: item.port,
            username: item.user.clone(),
            customer_id: customer_id.clone(),
            folder_id: None,
            jump_server_id,
            is_production: false,
            favorite: false,
            note: "~/.ssh/config에서 가져옴".into(),
        };
        match create_server(db, &input) {
            Ok(s) => {
                summary.created += 1;
                created.push((item.alias.clone(), s));
            }
            Err(e) => summary.skipped.push((item.alias.clone(), e.to_string())),
        }
    }
    Ok(summary)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn db() -> std::sync::Arc<Db> {
        let p = std::env::temp_dir().join(format!("dhost-test-{}.db", uuid::Uuid::new_v4()));
        Db::open(&p).unwrap()
    }

    fn input(name: &str) -> ServerInput {
        ServerInput {
            name: name.into(),
            host: "192.0.2.10".into(),
            port: 22,
            username: "ops".into(),
            customer_id: None,
            folder_id: None,
            jump_server_id: None,
            is_production: false,
            favorite: false,
            note: String::new(),
        }
    }

    #[test]
    fn crud_and_catalog() {
        let db = db();
        let cu = create_customer(&db, " 고객사A ").unwrap();
        assert_eq!(cu.name, "고객사A");
        let f = create_folder(&db, &cu.id, "운영").unwrap();
        let mut i = input("web-01");
        i.customer_id = Some(cu.id.clone());
        i.folder_id = Some(f.id.clone());
        let s = create_server(&db, &i).unwrap();
        let cat = catalog(&db).unwrap();
        assert_eq!((cat.customers.len(), cat.folders.len(), cat.servers.len()), (1, 1, 1));
        assert_eq!(cat.servers[0].folder_id.as_deref(), Some(f.id.as_str()));

        // 서버가 남아 있으면 폴더·고객사 삭제 불가
        assert!(delete_folder(&db, &f.id).is_err());
        assert!(delete_customer(&db, &cu.id).is_err());
        delete_server(&db, &s.id).unwrap();
        delete_folder(&db, &f.id).unwrap();
        delete_customer(&db, &cu.id).unwrap();
        // 같은 이름 고객사 중복 불가
        create_customer(&db, "B").unwrap();
        assert!(create_customer(&db, "B").is_err());
    }

    #[test]
    fn folder_must_belong_to_customer() {
        let db = db();
        let a = create_customer(&db, "A").unwrap();
        let b = create_customer(&db, "B").unwrap();
        let fa = create_folder(&db, &a.id, "f").unwrap();
        let mut i = input("x");
        i.customer_id = Some(b.id);
        i.folder_id = Some(fa.id);
        assert!(create_server(&db, &i).is_err());
    }

    #[test]
    fn single_jump_host_rules() {
        let db = db();
        let bastion = create_server(&db, &input("bastion")).unwrap();
        let mut t = input("target");
        t.jump_server_id = Some(bastion.id.clone());
        let target = create_server(&db, &t).unwrap();

        // 경유 서버를 다시 경유하는 서버는 불가 (2단 경유)
        let mut t2 = input("deep");
        t2.jump_server_id = Some(target.id.clone());
        assert!(create_server(&db, &t2).is_err());
        // 경유 서버로 쓰이는 서버에 경유 설정 불가
        let mut b2 = input("bastion");
        b2.jump_server_id = Some(target.id.clone());
        assert!(update_server(&db, &bastion.id, &b2).is_err());
        // 자기 자신 불가
        let mut self_ref = t.clone();
        self_ref.jump_server_id = Some(target.id.clone());
        assert!(update_server(&db, &target.id, &self_ref).is_err());
        // 경유 서버로 쓰이는 서버 삭제 불가
        assert!(delete_server(&db, &bastion.id).is_err());

        let (req, label) = connect_plan(&db, &target.id).unwrap();
        assert_eq!(req.jump.unwrap().host, "192.0.2.10");
        assert_eq!(label.jump_server_id.as_deref(), Some(bastion.id.as_str()));
        assert_eq!(label.target_server_id.as_deref(), Some(target.id.as_str()));
        assert!(catalog(&db).unwrap().servers.iter().any(|s| s.last_connected_at.is_some()));
    }

    #[test]
    fn imports_config_with_jump() {
        use crate::sshfiles::ConfigCandidate;
        let db = db();
        let c = |alias: &str, host: &str, pj: Option<&str>| ConfigCandidate {
            alias: alias.into(),
            host: host.into(),
            port: 22,
            user: "ops".into(),
            proxy_jump: pj.map(Into::into),
            problem: None,
        };
        // 경유 대상이 목록에서 뒤에 와도 연결된다
        let items = vec![
            c("web", "192.0.2.20", Some("bastion")),
            c("bastion", "192.0.2.1", None),
            c("deep", "192.0.2.30", Some("a,b")),
            c("lost", "192.0.2.40", Some("nowhere")),
        ];
        let sum = import_config(&db, &items, None).unwrap();
        assert_eq!(sum.created, 4);
        assert_eq!(sum.warnings.len(), 2);
        let cat = catalog(&db).unwrap();
        let bastion = cat.servers.iter().find(|s| s.name == "bastion").unwrap();
        let web = cat.servers.iter().find(|s| s.name == "web").unwrap();
        assert_eq!(web.jump_server_id.as_deref(), Some(bastion.id.as_str()));
        // 다시 가져오면 중복으로 건너뛴다
        let again = import_config(&db, &items, None).unwrap();
        assert_eq!(again.created, 0);
        assert_eq!(again.skipped.len(), 4);
    }

    #[test]
    fn rejects_invalid_host() {
        let db = db();
        let mut i = input("bad");
        i.host = "-oProxyCommand=x".into();
        assert!(create_server(&db, &i).is_err());
        let mut i = input("  ");
        i.host = "ok".into();
        assert!(create_server(&db, &i).is_err());
    }
}
