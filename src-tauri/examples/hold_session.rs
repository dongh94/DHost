//! 강제 종료 시 ssh 자식 프로세스가 남는지 확인하는 용도 (GAP-01).
//! 세션을 하나 연 뒤 멈춰 있는다. 바깥에서 kill -9로 죽인 뒤 ssh가 남았는지 본다.
//! 사전 준비: Docker 테스트 서버, `cargo build`(helper용 target/debug/dhost)

use std::sync::{Arc, OnceLock, Weak};

use dhost_lib::db::Db;
use dhost_lib::events::{AppEvent, EventSink};
use dhost_lib::hostkeys::HostKeyStore;
use dhost_lib::ipc::{Answer, Broker};
use dhost_lib::secrets::MemoryStore;
use dhost_lib::session::{SessionLabel, SessionManager};
use dhost_lib::ssh::openssh::OpenSshEngine;
use dhost_lib::ssh::{ConnectRequest, Endpoint};

struct AutoSink(OnceLock<Weak<Broker>>);

impl EventSink for AutoSink {
    fn emit(&self, event: AppEvent) {
        let Some(b) = self.0.get().and_then(|w| w.upgrade()) else {
            return;
        };
        match event {
            AppEvent::HostKeyPrompt(p) => drop(b.answer(&p.request_id, Answer::HostKey(true))),
            // dev/test-env의 가상 테스트 비밀번호
            AppEvent::AskpassPrompt(p) => drop(b.answer(
                &p.request_id,
                Answer::Secret {
                    secret: Some("dhost-test-pw".into()),
                    save: false,
                },
            )),
            AppEvent::SessionExit(_) => std::process::exit(2),
            _ => {}
        }
    }
}

fn main() {
    let helper = std::env::args()
        .nth(1)
        .expect("usage: hold_session <path to target/debug/dhost>");
    let store = std::env::temp_dir().join(format!("dhost-hold-{}.db", std::process::id()));
    let sink = Arc::new(AutoSink(OnceLock::new()));
    let broker = Broker::start(
        sink.clone(),
        Arc::new(HostKeyStore::new(Db::open(&store).unwrap())),
        Arc::new(MemoryStore::default()),
    )
    .unwrap();
    sink.0.set(Arc::downgrade(&broker)).unwrap();
    let sessions = SessionManager::new(sink, helper, None);
    let req = ConnectRequest {
        target: Endpoint {
            host: "127.0.0.1".into(),
            port: 2222,
            user: "dhost".into(),
            identity_file: None,
        },
        jump: None,
        connect_timeout: None,
    };
    sessions
        .open(
            &OpenSshEngine::new(),
            broker,
            req,
            SessionLabel::default(),
            (80, 24),
            Box::new(|b| {
                if String::from_utf8_lossy(b).contains("$ ") {
                    println!("READY");
                }
                true
            }),
        )
        .unwrap();
    loop {
        std::thread::park();
    }
}
