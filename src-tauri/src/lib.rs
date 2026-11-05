mod commands;
mod error;
mod ssh;

use ssh::openssh::OpenSshEngine;
use ssh::SshEngine;

/// 앱 전역 상태. SSH 엔진은 trait 뒤에 두어 나중에 교체할 수 있게 한다.
pub struct AppState {
    pub engine: Box<dyn SshEngine>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState {
            engine: Box::new(OpenSshEngine::new()),
        })
        .invoke_handler(tauri::generate_handler![commands::ssh_engine_info])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
