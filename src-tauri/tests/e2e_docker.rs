//! 실제 ssh + Docker 테스트 서버로 세션·호스트 키·askpass·Jump Host 흐름을 검증한다.
//!
//! 사전 준비: docker compose -f dev/test-env/docker-compose.yml up -d --build
//! 실행: cargo test --test e2e_docker -- --ignored --test-threads=1

use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock, Weak};
use std::time::{Duration, Instant};

use dhost_lib::db::Db;
use dhost_lib::events::{AppEvent, EventSink};
use dhost_lib::hostkeys::HostKeyStore;
use dhost_lib::ipc::{Answer, Broker};
use dhost_lib::session::SessionManager;
use dhost_lib::ssh::openssh::OpenSshEngine;
use dhost_lib::ssh::{ConnectRequest, Endpoint};

/// dev/test-env/docker-compose.yml의 가상 테스트 값
const TEST_PASSWORD: &str = "dhost-test-pw";

#[derive(Clone, Copy)]
enum HostKeyPolicy {
    Trust,
    Reject,
}

struct TestSink {
    broker: OnceLock<Weak<Broker>>,
    policy: HostKeyPolicy,
    events: Mutex<Vec<AppEvent>>,
}

impl EventSink for TestSink {
    fn emit(&self, event: AppEvent) {
        let broker = self.broker.get().and_then(|w| w.upgrade());
        match (&event, broker) {
            (AppEvent::HostKeyPrompt(p), Some(b)) => {
                b.answer(&p.request_id, Answer::HostKey(matches!(self.policy, HostKeyPolicy::Trust)));
            }
            (AppEvent::AskpassPrompt(p), Some(b)) => {
                b.answer(&p.request_id, Answer::Secret(Some(TEST_PASSWORD.into())));
            }
            _ => {}
        }
        self.events.lock().unwrap().push(event);
    }
}

struct Harness {
    sink: Arc<TestSink>,
    broker: Arc<Broker>,
    sessions: SessionManager,
    store: Arc<HostKeyStore>,
    db: Arc<Db>,
    store_path: PathBuf,
}

impl Harness {
    fn new(store_path: PathBuf, policy: HostKeyPolicy) -> Self {
        let sink = Arc::new(TestSink { broker: OnceLock::new(), policy, events: Mutex::new(vec![]) });
        let db = Db::open(&store_path).unwrap();
        let store = Arc::new(HostKeyStore::new(db.clone()));
        let broker = Broker::start(sink.clone(), store.clone()).unwrap();
        sink.broker.set(Arc::downgrade(&broker)).unwrap();
        let sessions = SessionManager::new(sink.clone(), env!("CARGO_BIN_EXE_dhost").to_string());
        Self { sink, broker, sessions, store, db, store_path }
    }

    /// 같은 저장소를 쓰는 새 브로커 (앱 재실행 흉내)
    fn new_shared(other: &Harness, policy: HostKeyPolicy) -> Self {
        let sink = Arc::new(TestSink { broker: OnceLock::new(), policy, events: Mutex::new(vec![]) });
        let broker = Broker::start(sink.clone(), other.store.clone()).unwrap();
        sink.broker.set(Arc::downgrade(&broker)).unwrap();
        let sessions = SessionManager::new(sink.clone(), env!("CARGO_BIN_EXE_dhost").to_string());
        Self {
            sink,
            broker,
            sessions,
            store: other.store.clone(),
            db: other.db.clone(),
            store_path: other.store_path.clone(),
        }
    }

    /// 접속 후 셸이 뜨면 명령을 보내고, 종료될 때까지 출력과 종료 코드를 모은다.
    fn run(&self, req: ConnectRequest, command: Option<&str>) -> (String, Option<u32>) {
        let out = Arc::new(Mutex::new(Vec::<u8>::new()));
        let o = out.clone();
        let id = self
            .sessions
            .open(&OpenSshEngine::new(), self.broker.clone(), req, (120, 40), Box::new(move |b| {
                o.lock().unwrap().extend_from_slice(b);
                true
            }))
            .unwrap();

        let start = Instant::now();
        let mut sent = false;
        loop {
            if let Some(code) = self.exit_code(&id) {
                std::thread::sleep(Duration::from_millis(200));
                return (String::from_utf8_lossy(&out.lock().unwrap()).into_owned(), code);
            }
            if !sent {
                let text = String::from_utf8_lossy(&out.lock().unwrap()).into_owned();
                if let Some(cmd) = command {
                    if text.contains("$ ") {
                        self.sessions.write(&id, format!("{cmd}\n").as_bytes()).unwrap();
                        sent = true;
                    }
                }
            }
            assert!(start.elapsed() < Duration::from_secs(30), "시간 초과");
            std::thread::sleep(Duration::from_millis(50));
        }
    }

    fn exit_code(&self, id: &str) -> Option<Option<u32>> {
        self.sink.events.lock().unwrap().iter().find_map(|e| match e {
            AppEvent::SessionExit(x) if x.session_id == id => Some(x.exit_code),
            _ => None,
        })
    }

    fn count(&self, f: impl Fn(&AppEvent) -> bool) -> usize {
        self.sink.events.lock().unwrap().iter().filter(|e| f(e)).count()
    }

    fn clear(&self) {
        self.sink.events.lock().unwrap().clear();
    }
}

impl Drop for Harness {
    fn drop(&mut self) {
        self.sessions.close_all();
        self.broker.shutdown();
        if let Some(dir) = self.store_path.parent() {
            let _ = std::fs::remove_dir_all(dir);
        }
    }
}

fn temp_store(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("dhost-e2e-{}-{name}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    dir.join("dhost.db")
}

fn bastion() -> Endpoint {
    Endpoint { host: "127.0.0.1".into(), port: 2222, user: "dhost".into() }
}

fn is_hostkey_prompt(e: &AppEvent) -> bool {
    matches!(e, AppEvent::HostKeyPrompt(_))
}
fn is_askpass(e: &AppEvent) -> bool {
    matches!(e, AppEvent::AskpassPrompt(_))
}
fn is_changed(e: &AppEvent) -> bool {
    matches!(e, AppEvent::HostKeyChanged(_))
}

#[test]
#[ignore]
fn direct_first_connect_then_reconnect_then_key_change() {
    let h = Harness::new(temp_store("direct"), HostKeyPolicy::Trust);
    let req = || ConnectRequest { target: bastion(), jump: None };

    // 1) 최초 접속: 호스트 키 승인 1회 + 비밀번호 1회, 명령 실행 결과 확인
    let (out, code) = h.run(req(), Some("echo M1-$(whoami)-$(hostname | wc -c); uptime; exit"));
    assert!(out.contains("M1-dhost-"), "출력: {out}");
    assert!(out.contains("load average"), "출력: {out}");
    assert_eq!(code, Some(0));
    assert_eq!(h.count(is_hostkey_prompt), 1);
    assert_eq!(h.count(is_askpass), 1);
    let saved = h.store.list().unwrap();
    assert_eq!(saved.len(), 1);
    assert_eq!(saved[0].host, "[127.0.0.1]:2222");

    // 2) 재접속: 저장된 키라서 승인 창 없이 비밀번호만
    h.clear();
    let (_, code) = h.run(req(), Some("exit"));
    assert_eq!(code, Some(0));
    assert_eq!(h.count(is_hostkey_prompt), 0);
    assert_eq!(h.count(is_askpass), 1);

    // 3) 키 변경: 저장된 키를 다른 키로 바꾸면 차단, 비밀번호도 묻지 않는다
    h.db.with(|c| {
        c.execute(
            "UPDATE host_keys SET key = 'AAAAC3NzaC1lZDI1NTE5AAAAIAXI1qT+YeFMxiSH8lNimKhEhupnrWMYnHea6ZXemlk/'",
            [],
        )
    })
    .unwrap();
    let h2 = Harness::new_shared(&h, HostKeyPolicy::Trust);
    let (out, code) = h2.run(req(), None);
    assert_eq!(code, Some(255), "출력: {out}");
    assert!(out.contains("REMOTE HOST IDENTIFICATION HAS CHANGED"), "출력: {out}");
    assert_eq!(h2.count(is_changed), 1);
    assert_eq!(h2.count(is_hostkey_prompt), 0);
    assert_eq!(h2.count(is_askpass), 0);
}

#[test]
#[ignore]
fn rejected_host_key_never_authenticates() {
    let h = Harness::new(temp_store("reject"), HostKeyPolicy::Reject);
    let (out, code) = h.run(ConnectRequest { target: bastion(), jump: None }, None);
    assert_eq!(code, Some(255), "출력: {out}");
    assert!(out.contains("Host key verification failed"), "출력: {out}");
    assert_eq!(h.count(is_hostkey_prompt), 1);
    assert_eq!(h.count(is_askpass), 0);
    assert!(h.store.list().unwrap().is_empty(), "거절한 키는 저장하지 않는다");
}

#[test]
#[ignore]
fn jump_host_verifies_both_hops() {
    let h = Harness::new(temp_store("jump"), HostKeyPolicy::Trust);
    let req = ConnectRequest {
        target: Endpoint { host: "target".into(), port: 22, user: "dhost".into() },
        jump: Some(bastion()),
    };
    let (out, code) = h.run(req, Some("cat /etc/motd; exit"));
    assert!(out.contains("bastion 경유 전용"), "출력: {out}");
    assert_eq!(code, Some(0));
    // 경유 서버와 대상 서버 각각 승인 + 비밀번호
    assert_eq!(h.count(is_hostkey_prompt), 2);
    assert_eq!(h.count(is_askpass), 2);
    let hosts: Vec<String> = h.store.list().unwrap().into_iter().map(|k| k.host).collect();
    assert!(hosts.contains(&"target".to_string()));
    assert!(hosts.contains(&"[127.0.0.1]:2222".to_string()));
}

#[test]
#[ignore]
fn close_kills_ssh_process() {
    let h = Harness::new(temp_store("close"), HostKeyPolicy::Trust);
    let out = Arc::new(Mutex::new(Vec::<u8>::new()));
    let o = out.clone();
    let id = h
        .sessions
        .open(&OpenSshEngine::new(), h.broker.clone(), ConnectRequest { target: bastion(), jump: None }, (80, 24),
            Box::new(move |b| { o.lock().unwrap().extend_from_slice(b); true }))
        .unwrap();
    let start = Instant::now();
    while !String::from_utf8_lossy(&out.lock().unwrap()).contains("$ ") {
        assert!(start.elapsed() < Duration::from_secs(20));
        std::thread::sleep(Duration::from_millis(50));
    }
    h.sessions.close(&id).unwrap();
    let start = Instant::now();
    while h.exit_code(&id).is_none() {
        assert!(start.elapsed() < Duration::from_secs(5), "종료 이벤트가 오지 않음");
        std::thread::sleep(Duration::from_millis(50));
    }
}

#[test]
#[ignore]
fn multibyte_and_ansi_pass_through() {
    let h = Harness::new(temp_store("utf8"), HostKeyPolicy::Trust);
    let (out, code) = h.run(
        ConnectRequest { target: bastion(), jump: None },
        Some("printf '\\033[31m한글출력\\033[0m\\n'; exit"),
    );
    assert_eq!(code, Some(0));
    assert!(out.contains("\u{1b}[31m한글출력\u{1b}[0m"), "출력: {out:?}");
}
