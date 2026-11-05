mod commands;
pub mod error;
pub mod events;
mod helper;
pub mod hostkeys;
pub mod ipc;
pub mod session;
pub mod ssh;

use std::sync::Arc;

use tauri::Manager;

use events::{EventSink, TauriSink};
use hostkeys::HostKeyStore;
use ipc::Broker;
use session::SessionManager;
use ssh::openssh::OpenSshEngine;
use ssh::SshEngine;

pub use helper::run_if_helper;

/// 앱 전역 상태. SSH 엔진은 trait 뒤에 두어 나중에 교체할 수 있게 한다.
pub struct AppState {
    pub engine: Box<dyn SshEngine>,
    pub broker: Arc<Broker>,
    pub sessions: SessionManager,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            let hostkeys = HostKeyStore::load(data_dir.join("known_hosts.json"));
            let sink: Arc<dyn EventSink> = Arc::new(TauriSink(app.handle().clone()));
            let broker = Broker::start(sink.clone(), hostkeys)?;
            let exe = std::env::current_exe()?.to_string_lossy().into_owned();
            app.manage(AppState {
                engine: Box::new(OpenSshEngine::new()),
                broker,
                sessions: SessionManager::new(sink, exe),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::ssh_engine_info,
            commands::session_open,
            commands::session_write,
            commands::session_resize,
            commands::session_close,
            commands::answer_hostkey,
            commands::answer_askpass,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                if let Some(state) = app.try_state::<AppState>() {
                    state.sessions.close_all();
                    state.broker.shutdown();
                }
            }
        });
}
