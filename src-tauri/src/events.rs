//! 백엔드에서 화면으로 보내는 이벤트. Tauri에 묶지 않아서 테스트에서 대신 받을 수 있다.

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostKeyPrompt {
    pub request_id: String,
    pub session_id: String,
    pub host: String,
    pub key_type: String,
    pub fingerprint: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostKeyChanged {
    pub session_id: String,
    pub host: String,
    pub key_type: String,
    pub fingerprint: String,
    pub known_fingerprints: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AskpassPrompt {
    pub request_id: String,
    pub session_id: String,
    pub prompt: String,
    pub confirm: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionExit {
    pub session_id: String,
    pub exit_code: Option<u32>,
}

#[derive(Debug, Clone)]
pub enum AppEvent {
    HostKeyPrompt(HostKeyPrompt),
    HostKeyChanged(HostKeyChanged),
    AskpassPrompt(AskpassPrompt),
    SessionExit(SessionExit),
}

pub trait EventSink: Send + Sync {
    fn emit(&self, event: AppEvent);
}

/// 실제 앱: Tauri 이벤트로 프런트엔드에 보낸다.
pub struct TauriSink(pub tauri::AppHandle);

impl EventSink for TauriSink {
    fn emit(&self, event: AppEvent) {
        use tauri::Emitter;
        let _ = match event {
            AppEvent::HostKeyPrompt(p) => self.0.emit("hostkey-prompt", p),
            AppEvent::HostKeyChanged(p) => self.0.emit("hostkey-changed", p),
            AppEvent::AskpassPrompt(p) => self.0.emit("askpass-prompt", p),
            AppEvent::SessionExit(p) => self.0.emit("session-exit", p),
        };
    }
}
