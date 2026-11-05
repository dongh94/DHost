use tauri::State;

use crate::error::{AppError, AppResult};
use crate::ssh::EngineInfo;
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
