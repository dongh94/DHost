use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::State;

use crate::error::{AppError, AppResult};
use crate::ipc::Answer;
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
