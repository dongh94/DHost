use tauri::State;
use tauri::ipc::{Channel, InvokeResponseBody};

use crate::AppState;
use crate::error::{AppError, AppResult};
use crate::history::HistoryEntry;
use crate::hostkeys::HostKey;
use crate::ipc::Answer;
use crate::profiles::{self, Catalog, Customer, Folder, Server, ServerInput};
use crate::session::SessionLabel;
use crate::ssh::{ConnectRequest, EngineInfo};

/// 현재 SSH 엔진의 이름, 버전, 필요 기능 지원 여부를 반환한다.
#[tauri::command]
pub async fn ssh_engine_info(state: State<'_, AppState>) -> AppResult<EngineInfo> {
    // probe는 외부 프로세스를 실행하므로 블로킹 스레드에서 돌린다.
    let engine = state.engine.clone_box();
    tauri::async_runtime::spawn_blocking(move || engine.probe())
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

/// 사용자가 요청한 경우에만 호출된다. 앱이 스스로 연결하지 않는다 (POL-06).
#[tauri::command]
pub fn session_open(
    state: State<'_, AppState>,
    request: ConnectRequest,
    cols: u16,
    rows: u16,
    on_output: Channel<InvokeResponseBody>,
) -> AppResult<String> {
    let label = SessionLabel {
        title: format!("{}@{}", request.target.user, request.target.host),
        ..Default::default()
    };
    open_with(state, request, label, cols, rows, on_output)
}

fn open_with(
    state: State<'_, AppState>,
    mut request: ConnectRequest,
    label: SessionLabel,
    cols: u16,
    rows: u16,
    on_output: Channel<InvokeResponseBody>,
) -> AppResult<String> {
    request.connect_timeout = Some(crate::settings::connect_timeout(&state.db));
    state.sessions.open(
        state.engine.as_ref(),
        state.broker.clone(),
        request,
        label,
        (cols, rows),
        Box::new(move |bytes| on_output.send(InvokeResponseBody::Raw(bytes.to_vec())).is_ok()),
    )
}

/// 저장된 서버 프로필로 접속한다. 경유 서버 설정도 프로필에서 가져온다.
#[tauri::command]
pub fn server_connect(
    state: State<'_, AppState>,
    server_id: String,
    cols: u16,
    rows: u16,
    on_output: Channel<InvokeResponseBody>,
) -> AppResult<String> {
    let (request, label) = profiles::connect_plan(&state.db, &server_id)?;
    open_with(state, request, label, cols, rows, on_output)
}

#[tauri::command]
pub fn session_write(state: State<'_, AppState>, session_id: String, data: String) -> AppResult<()> {
    state.sessions.write(&session_id, data.as_bytes())
}

#[tauri::command]
pub fn session_resize(state: State<'_, AppState>, session_id: String, cols: u16, rows: u16) -> AppResult<()> {
    state.sessions.resize(&session_id, cols, rows)
}

/// 화면이 출력을 따라가지 못하면 잠시 읽기를 멈춘다 (GAP-05).
#[tauri::command]
pub fn session_flow(state: State<'_, AppState>, session_id: String, paused: bool) -> AppResult<()> {
    state.sessions.set_paused(&session_id, paused)
}

#[tauri::command]
pub fn session_close(state: State<'_, AppState>, session_id: String) -> AppResult<()> {
    state.sessions.close(&session_id)
}

#[tauri::command]
pub fn answer_hostkey(state: State<'_, AppState>, request_id: String, trust: bool) -> bool {
    state.broker.answer(&request_id, Answer::HostKey(trust))
}

#[tauri::command]
pub fn answer_askpass(state: State<'_, AppState>, request_id: String, secret: Option<String>, save: bool) -> bool {
    state.broker.answer(&request_id, Answer::Secret { secret, save })
}

#[tauri::command]
pub fn catalog(state: State<'_, AppState>) -> AppResult<Catalog> {
    profiles::catalog(&state.db)
}

#[tauri::command]
pub fn customer_create(state: State<'_, AppState>, name: String) -> AppResult<Customer> {
    profiles::create_customer(&state.db, &name)
}

#[tauri::command]
pub fn customer_rename(state: State<'_, AppState>, id: String, name: String) -> AppResult<()> {
    profiles::rename_customer(&state.db, &id, &name)
}

#[tauri::command]
pub fn customer_delete(state: State<'_, AppState>, id: String) -> AppResult<()> {
    profiles::delete_customer(&state.db, &id)
}

#[tauri::command]
pub fn folder_create(state: State<'_, AppState>, customer_id: String, name: String) -> AppResult<Folder> {
    profiles::create_folder(&state.db, &customer_id, &name)
}

#[tauri::command]
pub fn folder_rename(state: State<'_, AppState>, id: String, name: String) -> AppResult<()> {
    profiles::rename_folder(&state.db, &id, &name)
}

#[tauri::command]
pub fn folder_delete(state: State<'_, AppState>, id: String) -> AppResult<()> {
    profiles::delete_folder(&state.db, &id)
}

#[tauri::command]
pub fn server_create(state: State<'_, AppState>, input: ServerInput) -> AppResult<Server> {
    profiles::create_server(&state.db, &input)
}

#[tauri::command]
pub fn server_update(state: State<'_, AppState>, id: String, input: ServerInput) -> AppResult<Server> {
    let before = profiles::get(&state.db, &id)?;
    let after = profiles::update_server(&state.db, &id, &input)?;
    // 접속 대상이 바뀌면 저장된 비밀번호를 지운다 (다른 서버에 잘못 쓰이지 않게).
    if before.is_some_and(|b| profiles::target_changed(&b, &after)) {
        state.secrets.delete(&id);
    }
    Ok(after)
}

#[tauri::command]
pub fn server_set_favorite(state: State<'_, AppState>, id: String, favorite: bool) -> AppResult<()> {
    profiles::set_favorite(&state.db, &id, favorite)
}

#[tauri::command]
pub fn server_delete(state: State<'_, AppState>, id: String) -> AppResult<()> {
    profiles::delete_server(&state.db, &id)?;
    state.secrets.delete(&id);
    Ok(())
}

#[tauri::command]
pub fn server_password_saved(state: State<'_, AppState>, id: String) -> bool {
    state.secrets.has(&id)
}

#[tauri::command]
pub fn server_password_delete(state: State<'_, AppState>, id: String) {
    state.secrets.delete(&id)
}

#[tauri::command]
pub fn history_list(state: State<'_, AppState>) -> AppResult<Vec<HistoryEntry>> {
    state.history.list(500)
}

#[tauri::command]
pub fn history_clear(state: State<'_, AppState>) -> AppResult<()> {
    state.history.clear()
}

#[tauri::command]
pub fn hostkey_list(state: State<'_, AppState>) -> AppResult<Vec<HostKey>> {
    state.hostkeys.list()
}

#[tauri::command]
pub fn hostkey_delete(state: State<'_, AppState>, id: i64) -> AppResult<()> {
    state.hostkeys.remove(id)
}

#[tauri::command]
pub fn settings_get(state: State<'_, AppState>) -> AppResult<std::collections::BTreeMap<String, String>> {
    crate::settings::get_all(&state.db)
}

#[tauri::command]
pub fn settings_set(state: State<'_, AppState>, key: String, value: String) -> AppResult<()> {
    crate::settings::set(&state.db, &key, &value)
}

#[tauri::command]
pub fn settings_reset(state: State<'_, AppState>) -> AppResult<()> {
    crate::settings::reset(&state.db)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KnownHostsScanView {
    pub candidates: Vec<KnownHostView>,
    pub hashed: usize,
    pub skipped: usize,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KnownHostView {
    #[serde(flatten)]
    pub item: crate::sshfiles::KnownHostCandidate,
    pub already_trusted: bool,
}

/// ~/.ssh/known_hosts를 읽어 가져올 수 있는 항목을 보여준다. 아무것도 저장하지 않는다.
#[tauri::command]
pub fn known_hosts_scan(state: State<'_, AppState>) -> AppResult<KnownHostsScanView> {
    let scan = crate::sshfiles::scan_known_hosts()?;
    let trusted = state.hostkeys.list()?;
    Ok(KnownHostsScanView {
        candidates: scan
            .candidates
            .into_iter()
            .map(|c| {
                let already_trusted = trusted.iter().any(|t| t.host == c.host && t.key == c.key);
                KnownHostView {
                    item: c,
                    already_trusted,
                }
            })
            .collect(),
        hashed: scan.hashed,
        skipped: scan.skipped,
    })
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnownHostImport {
    pub host: String,
    pub key_type: String,
    pub key: String,
}

/// 사용자가 고른 항목만 가져온다. 지문은 앱에서 다시 계산한다.
#[tauri::command]
pub fn known_hosts_import(state: State<'_, AppState>, items: Vec<KnownHostImport>) -> AppResult<usize> {
    let mut n = 0;
    for i in items {
        let Some(fp) = crate::sshfiles::fingerprint(&i.key) else {
            continue;
        };
        state.hostkeys.add(&i.host, &i.key_type, &i.key, &fp)?;
        n += 1;
    }
    Ok(n)
}

#[tauri::command]
pub async fn ssh_config_scan() -> AppResult<Vec<crate::sshfiles::ConfigCandidate>> {
    tauri::async_runtime::spawn_blocking(crate::sshfiles::scan_config)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub fn ssh_config_import(
    state: State<'_, AppState>,
    items: Vec<crate::sshfiles::ConfigCandidate>,
    customer_id: Option<String>,
) -> AppResult<profiles::ImportSummary> {
    profiles::import_config(&state.db, &items, customer_id)
}

/// 서버에 접속할 때 실제로 적용될 ssh 설정 (SEC-P02). 접속하지 않는다.
#[tauri::command]
pub fn server_effective_config(state: State<'_, AppState>, id: String) -> AppResult<Vec<crate::ssh::ConfigEntry>> {
    let (request, _) = profiles::plan(&state.db, &id, false)?;
    let ctx = crate::ssh::HelperContext {
        exe: std::env::current_exe()
            .map_err(|e| AppError::Internal(e.to_string()))?
            .to_string_lossy()
            .into_owned(),
        socket_path: String::new(),
        session_token: String::new(),
    };
    state.engine.effective_config(&request, &ctx)
}

/// 백업 파일을 만든다. 비밀번호·개인키·접속 이력은 넣지 않는다.
#[tauri::command]
pub fn backup_export(state: State<'_, AppState>, path: String, include_host_keys: bool) -> AppResult<usize> {
    let data = crate::backup::export(&state.db, std::path::Path::new(&path), include_host_keys)?;
    Ok(data.servers.len())
}

#[tauri::command]
pub fn backup_preview(state: State<'_, AppState>, path: String) -> AppResult<crate::backup::Preview> {
    let data = crate::backup::read(std::path::Path::new(&path))?;
    crate::backup::preview(&state.db, &data)
}

/// 백업에서 복원한다. 자동으로 접속하지 않는다.
#[tauri::command]
pub fn backup_restore(
    state: State<'_, AppState>,
    path: String,
    options: crate::backup::RestoreOptions,
) -> AppResult<crate::backup::RestoreReport> {
    let data = crate::backup::read(std::path::Path::new(&path))?;
    let report = crate::backup::restore(&state.db, &data, &options)?;
    // 교체로 지운 서버의 비밀번호는 키체인에서도 지운다.
    for id in &report.removed_server_ids {
        state.secrets.delete(id);
    }
    Ok(report)
}
