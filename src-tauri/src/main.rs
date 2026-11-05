// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // ssh가 KnownHostsCommand / SSH_ASKPASS로 DHost를 다시 실행한 경우
    if let Some(code) = dhost_lib::run_if_helper() {
        std::process::exit(code);
    }
    dhost_lib::run()
}
