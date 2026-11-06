use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::State;

use crate::error::{AppError, AppResult};
use crate::hostkeys::HostKey;
use crate::ipc::Answer;
use crate::profiles::{self, Catalog, Customer, Folder, Server, ServerInput};
use crate::ssh::{ConnectRequest, EngineInfo};
use crate::AppState;

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
    state
        .sessions
        .open(
            state.engine.as_ref(),
            state.broker.clone(),
            request,
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
    let request = profiles::connect_request(&state.db, &server_id)?;
    session_open(state, request, cols, rows, on_output)
}

#[tauri::command]
pub fn session_write(state: State<'_, AppState>, session_id: String, data: String) -> AppResult<()> {
    state.sessions.write(&session_id, data.as_bytes())
}

#[tauri::command]
pub fn session_resize(state: State<'_, AppState>, session_id: String, cols: u16, rows: u16) -> AppResult<()> {
    state.sessions.resize(&session_id, cols, rows)
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
pub fn answer_askpass(state: State<'_, AppState>, request_id: String, secret: Option<String>) -> bool {
    state.broker.answer(&request_id, Answer::Secret(secret))
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
    profiles::update_server(&state.db, &id, &input)
}

#[tauri::command]
pub fn server_set_favorite(state: State<'_, AppState>, id: String, favorite: bool) -> AppResult<()> {
    profiles::set_favorite(&state.db, &id, favorite)
}

#[tauri::command]
pub fn server_delete(state: State<'_, AppState>, id: String) -> AppResult<()> {
    profiles::delete_server(&state.db, &id)
}

#[tauri::command]
pub fn hostkey_list(state: State<'_, AppState>) -> AppResult<Vec<HostKey>> {
    state.hostkeys.list()
}

#[tauri::command]
pub fn hostkey_delete(state: State<'_, AppState>, id: i64) -> AppResult<()> {
    state.hostkeys.remove(id)
}
