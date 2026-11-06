pub mod backup;
mod commands;
pub mod db;
pub mod error;
pub mod events;
mod helper;
pub mod history;
pub mod hostkeys;
pub mod ipc;
pub mod meta;
pub mod profiles;
pub mod secrets;
pub mod session;
pub mod settings;
pub mod ssh;
pub mod sshfiles;

use std::sync::Arc;

use tauri::Manager;

use db::Db;
use events::{EventSink, TauriSink};
use history::HistoryStore;
use hostkeys::HostKeyStore;
use secrets::{KeychainStore, SecretStore};
use ipc::Broker;
use session::SessionManager;
use ssh::openssh::OpenSshEngine;
use ssh::SshEngine;

pub use helper::run_if_helper;

/// 앱 전역 상태. SSH 엔진은 trait 뒤에 두어 나중에 교체할 수 있게 한다.
pub struct AppState {
    pub engine: Box<dyn SshEngine>,
    pub db: Arc<Db>,
    pub hostkeys: Arc<HostKeyStore>,
    pub secrets: Arc<dyn SecretStore>,
    pub history: Arc<HistoryStore>,
    pub broker: Arc<Broker>,
    pub sessions: SessionManager,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            let db = Db::open(&data_dir.join("dhost.db"))?;
            let hostkeys = Arc::new(HostKeyStore::new(db.clone()));
            hostkeys.import_legacy_json(&data_dir.join("known_hosts.json"));
            let sink: Arc<dyn EventSink> = Arc::new(TauriSink(app.handle().clone()));
            let secrets: Arc<dyn SecretStore> = Arc::new(KeychainStore);
            let history = Arc::new(HistoryStore::new(db.clone()));
            if let Err(e) = history.maintain() {
                eprintln!("[dhost] 접속 이력 정리 실패: {e}");
            }
            let broker = Broker::start(sink.clone(), hostkeys.clone(), secrets.clone())?;
            let exe = std::env::current_exe()?.to_string_lossy().into_owned();
            app.manage(AppState {
                engine: Box::new(OpenSshEngine::new()),
                db,
                hostkeys,
                secrets,
                history: history.clone(),
                broker,
                sessions: SessionManager::new(sink, exe, Some(history)),
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
            commands::catalog,
            commands::customer_create,
            commands::customer_rename,
            commands::customer_delete,
            commands::folder_create,
            commands::folder_rename,
            commands::folder_delete,
            commands::server_create,
            commands::server_update,
            commands::server_set_favorite,
            commands::server_delete,
            commands::server_connect,
            commands::hostkey_list,
            commands::hostkey_delete,
            commands::settings_get,
            commands::settings_set,
            commands::settings_reset,
            commands::server_password_saved,
            commands::server_password_delete,
            commands::history_list,
            commands::history_clear,
            commands::known_hosts_scan,
            commands::known_hosts_import,
            commands::ssh_config_scan,
            commands::ssh_config_import,
            commands::server_effective_config,
            commands::backup_export,
            commands::backup_preview,
            commands::backup_restore,
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
