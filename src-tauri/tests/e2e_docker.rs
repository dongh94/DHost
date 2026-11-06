//! 실제 ssh + Docker 테스트 서버로 세션·호스트 키·askpass·Jump Host 흐름을 검증한다.
//!
//! 사전 준비: docker compose -f dev/test-env/docker-compose.yml up -d --build
//! 실행: cargo test --test e2e_docker -- --ignored --test-threads=1

use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock, Weak};
use std::time::{Duration, Instant};

use dhost_lib::db::Db;
use dhost_lib::events::{AppEvent, EventSink};
use dhost_lib::history::HistoryStore;
use dhost_lib::hostkeys::HostKeyStore;
use dhost_lib::ipc::{Answer, Broker};
use dhost_lib::secrets::{MemoryStore, SecretStore};
use dhost_lib::session::{SessionLabel, SessionManager};
use dhost_lib::ssh::openssh::OpenSshEngine;
use dhost_lib::ssh::{ConnectRequest, Endpoint};

/// dev/test-env/docker-compose.yml의 가상 테스트 값
const TEST_PASSWORD: &str = "dhost-test-pw";

#[derive(Clone, Copy)]
enum HostKeyPolicy {
    Trust,
    Reject,
}

#[derive(Clone)]
enum AskpassPolicy {
    Answer { password: String, save: bool },
    Cancel,
}

struct TestSink {
    broker: OnceLock<Weak<Broker>>,
    policy: HostKeyPolicy,
    askpass: Mutex<AskpassPolicy>,
    events: Mutex<Vec<AppEvent>>,
}

impl TestSink {
    fn new(policy: HostKeyPolicy) -> Arc<Self> {
        Arc::new(Self {
            broker: OnceLock::new(),
            policy,
            askpass: Mutex::new(AskpassPolicy::Answer {
                password: TEST_PASSWORD.into(),
                save: false,
            }),
            events: Mutex::new(vec![]),
        })
    }
}

impl EventSink for TestSink {
    fn emit(&self, event: AppEvent) {
        let broker = self.broker.get().and_then(|w| w.upgrade());
        match (&event, broker) {
            (AppEvent::HostKeyPrompt(p), Some(b)) => {
                b.answer(
                    &p.request_id,
                    Answer::HostKey(matches!(self.policy, HostKeyPolicy::Trust)),
                );
            }
            (AppEvent::AskpassPrompt(p), Some(b)) => {
                let answer = match self.askpass.lock().unwrap().clone() {
                    AskpassPolicy::Answer { password, save } => Answer::Secret {
                        secret: Some(password),
                        save,
                    },
                    AskpassPolicy::Cancel => Answer::Secret {
                        secret: None,
                        save: false,
                    },
                };
                b.answer(&p.request_id, answer);
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
    secrets: Arc<MemoryStore>,
    history: Arc<HistoryStore>,
    db: Arc<Db>,
    store_path: PathBuf,
}

impl Harness {
    fn new(store_path: PathBuf, policy: HostKeyPolicy) -> Self {
        let db = Db::open(&store_path).unwrap();
        let store = Arc::new(HostKeyStore::new(db.clone()));
        Self::build(policy, db, store, Arc::new(MemoryStore::default()), store_path)
    }

    fn build(
        policy: HostKeyPolicy,
        db: Arc<Db>,
        store: Arc<HostKeyStore>,
        secrets: Arc<MemoryStore>,
        store_path: PathBuf,
    ) -> Self {
        let sink = TestSink::new(policy);
        let broker = Broker::start(sink.clone(), store.clone(), secrets.clone()).unwrap();
        sink.broker.set(Arc::downgrade(&broker)).unwrap();
        let history = Arc::new(HistoryStore::new(db.clone()));
        let sessions = SessionManager::new(
            sink.clone(),
            env!("CARGO_BIN_EXE_dhost").to_string(),
            Some(history.clone()),
        );
        Self {
            sink,
            broker,
            sessions,
            store,
            secrets,
            history,
            db,
            store_path,
        }
    }

    /// 같은 저장소를 쓰는 새 브로커 (앱 재실행 흉내)
    fn new_shared(other: &Harness, policy: HostKeyPolicy) -> Self {
        Self::build(
            policy,
            other.db.clone(),
            other.store.clone(),
            other.secrets.clone(),
            other.store_path.clone(),
        )
    }

    /// 접속 후 셸이 뜨면 명령을 보내고, 종료될 때까지 출력과 종료 코드를 모은다.
    fn run(&self, req: ConnectRequest, command: Option<&str>) -> (String, Option<u32>) {
        self.run_as(
            req,
            SessionLabel {
                title: "test".into(),
                ..Default::default()
            },
            command,
        )
    }

    fn run_as(&self, req: ConnectRequest, label: SessionLabel, command: Option<&str>) -> (String, Option<u32>) {
        let out = Arc::new(Mutex::new(Vec::<u8>::new()));
        let o = out.clone();
        let id = self
            .sessions
            .open(
                &OpenSshEngine::new(),
                self.broker.clone(),
                req,
                label,
                (120, 40),
                Box::new(move |b| {
                    o.lock().unwrap().extend_from_slice(b);
                    true
                }),
            )
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
                if let Some(cmd) = command
                    && text.contains("$ ")
                {
                    self.sessions.write(&id, format!("{cmd}\n").as_bytes()).unwrap();
                    sent = true;
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
    Endpoint {
        host: "127.0.0.1".into(),
        port: 2222,
        user: "dhost".into(),
    }
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
    let req = || ConnectRequest {
        target: bastion(),
        jump: None,
        connect_timeout: None,
    };

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
    // 우리가 계산한 지문이 ssh가 넘겨준 지문(%f)과 같아야 known_hosts 가져오기 지문을 믿을 수 있다
    assert_eq!(
        dhost_lib::sshfiles::fingerprint(&saved[0].key).as_deref(),
        Some(saved[0].fingerprint.as_str())
    );

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
    assert_eq!(last_result(&h2), "hostkey_changed");
}

#[test]
#[ignore]
fn rejected_host_key_never_authenticates() {
    let h = Harness::new(temp_store("reject"), HostKeyPolicy::Reject);
    let (out, code) = h.run(
        ConnectRequest {
            target: bastion(),
            jump: None,
            connect_timeout: None,
        },
        None,
    );
    assert_eq!(code, Some(255), "출력: {out}");
    assert!(out.contains("Host key verification failed"), "출력: {out}");
    assert_eq!(h.count(is_hostkey_prompt), 1);
    assert_eq!(h.count(is_askpass), 0);
    assert!(h.store.list().unwrap().is_empty(), "거절한 키는 저장하지 않는다");
    assert_eq!(last_result(&h), "hostkey_rejected");
}

#[test]
#[ignore]
fn jump_host_verifies_both_hops() {
    let h = Harness::new(temp_store("jump"), HostKeyPolicy::Trust);
    let req = ConnectRequest {
        target: Endpoint {
            host: "target".into(),
            port: 22,
            user: "dhost".into(),
        },
        jump: Some(bastion()),
        connect_timeout: None,
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
        .open(
            &OpenSshEngine::new(),
            h.broker.clone(),
            ConnectRequest {
                target: bastion(),
                jump: None,
                connect_timeout: None,
            },
            SessionLabel::default(),
            (80, 24),
            Box::new(move |b| {
                o.lock().unwrap().extend_from_slice(b);
                true
            }),
        )
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
        ConnectRequest {
            target: bastion(),
            jump: None,
            connect_timeout: None,
        },
        Some("printf '\\033[31m한글출력\\033[0m\\n'; exit"),
    );
    assert_eq!(code, Some(0));
    assert!(out.contains("\u{1b}[31m한글출력\u{1b}[0m"), "출력: {out:?}");
}

fn profile_label() -> SessionLabel {
    SessionLabel {
        title: "bastion".into(),
        target_server_id: Some("srv-bastion".into()),
        ..Default::default()
    }
}

fn last_result(h: &Harness) -> String {
    h.history.list(1).unwrap()[0].result.clone()
}

fn askpass_prompts(h: &Harness) -> Vec<dhost_lib::events::AskpassPrompt> {
    h.sink
        .events
        .lock()
        .unwrap()
        .iter()
        .filter_map(|e| match e {
            AppEvent::AskpassPrompt(p) => Some(p.clone()),
            _ => None,
        })
        .collect()
}

#[test]
#[ignore]
fn cancel_password_stops_without_reprompt() {
    let h = Harness::new(temp_store("cancel"), HostKeyPolicy::Trust);
    *h.sink.askpass.lock().unwrap() = AskpassPolicy::Cancel;
    let (_, code) = h.run(
        ConnectRequest {
            target: bastion(),
            jump: None,
            connect_timeout: None,
        },
        None,
    );
    assert_eq!(code, Some(255));
    // 취소 한 번이면 다시 묻지 않는다 (예전에는 3번까지 다시 물었음)
    assert_eq!(h.count(is_askpass), 1);
    assert_eq!(last_result(&h), "cancelled");
}

#[test]
#[ignore]
fn save_then_autofill_password() {
    let h = Harness::new(temp_store("save"), HostKeyPolicy::Trust);
    *h.sink.askpass.lock().unwrap() = AskpassPolicy::Answer {
        password: TEST_PASSWORD.into(),
        save: true,
    };
    let req = || ConnectRequest {
        target: bastion(),
        jump: None,
        connect_timeout: None,
    };

    // 1) 저장 체크하고 접속 -> 키체인(테스트에서는 메모리)에 저장
    let (_, code) = h.run_as(req(), profile_label(), Some("exit"));
    assert_eq!(code, Some(0));
    assert!(askpass_prompts(&h)[0].can_save);
    assert_eq!(h.secrets.get("srv-bastion").as_deref(), Some(TEST_PASSWORD));
    assert_eq!(last_result(&h), "closed");

    // 2) 다음 접속은 묻지 않고 자동 입력
    h.clear();
    let (_, code) = h.run_as(req(), profile_label(), Some("exit"));
    assert_eq!(code, Some(0));
    assert_eq!(h.count(is_askpass), 0);

    // 3) 빠른 접속(프로필 없음)은 저장 대상이 아니다
    h.clear();
    let (_, code) = h.run(req(), Some("exit"));
    assert_eq!(code, Some(0));
    assert!(!askpass_prompts(&h)[0].can_save);
}

#[test]
#[ignore]
fn wrong_saved_password_is_removed_and_reprompted() {
    let h = Harness::new(temp_store("wrongsaved"), HostKeyPolicy::Trust);
    h.secrets.set("srv-bastion", "wrong-password").unwrap();
    let (_, code) = h.run_as(
        ConnectRequest {
            target: bastion(),
            jump: None,
            connect_timeout: None,
        },
        profile_label(),
        Some("exit"),
    );
    assert_eq!(code, Some(0));
    let prompts = askpass_prompts(&h);
    // 자동 입력이 틀려서 한 번 물었고, 그때 "저장된 비밀번호가 틀렸다"고 알린다
    assert_eq!(prompts.len(), 1);
    assert!(prompts[0].retry && prompts[0].saved_was_wrong);
    assert!(h.secrets.get("srv-bastion").is_none(), "틀린 비밀번호는 지운다");
}

#[test]
#[ignore]
fn wrong_password_saved_is_not_kept() {
    let h = Harness::new(temp_store("wrongnew"), HostKeyPolicy::Trust);
    *h.sink.askpass.lock().unwrap() = AskpassPolicy::Answer {
        password: "nope".into(),
        save: true,
    };
    let (_, code) = h.run_as(
        ConnectRequest {
            target: bastion(),
            jump: None,
            connect_timeout: None,
        },
        profile_label(),
        None,
    );
    assert_eq!(code, Some(255));
    // 틀린 비밀번호를 확인하면 다시 묻는다 (3번)
    assert_eq!(h.count(is_askpass), 3);
    assert!(h.secrets.get("srv-bastion").is_none());
    assert_eq!(last_result(&h), "auth_failed");
}

fn last_diagnosis(h: &Harness) -> Option<dhost_lib::diagnose::Diagnosis> {
    h.sink.events.lock().unwrap().iter().rev().find_map(|e| match e {
        AppEvent::SessionExit(x) => x.diagnosis.clone(),
        _ => None,
    })
}

fn ep(host: &str, port: u16) -> Endpoint {
    Endpoint {
        host: host.into(),
        port,
        user: "dhost".into(),
    }
}

#[test]
#[ignore]
fn diagnoses_network_failures() {
    let h = Harness::new(temp_store("diag-net"), HostKeyPolicy::Trust);
    let cases = [
        (
            ConnectRequest {
                target: ep("127.0.0.1", 2299),
                jump: None,
                connect_timeout: Some(5),
            },
            "refused",
            None,
        ),
        (
            ConnectRequest {
                target: ep("nonexistent.invalid", 22),
                jump: None,
                connect_timeout: Some(5),
            },
            "dns",
            None,
        ),
        // 192.0.2.0/24는 문서용 주소라 응답이 없다 -> 시간 초과
        (
            ConnectRequest {
                target: ep("192.0.2.1", 22),
                jump: None,
                connect_timeout: Some(2),
            },
            "timeout",
            None,
        ),
        // 경유 서버 포트가 틀림 -> 경유 서버 구간에서 거부
        (
            ConnectRequest {
                target: ep("target", 22),
                jump: Some(ep("127.0.0.1", 2299)),
                connect_timeout: Some(5),
            },
            "refused",
            Some("경유 서버 127.0.0.1"),
        ),
        // 경유 서버는 됐지만 대상 이름이 없음
        (
            ConnectRequest {
                target: ep("nosuch-target", 22),
                jump: Some(bastion()),
                connect_timeout: Some(5),
            },
            "forward_failed",
            Some("대상 서버 test"),
        ),
    ];
    for (req, code, hop) in cases {
        h.clear();
        let (out, exit) = h.run(req, None);
        assert_eq!(exit, Some(255), "출력: {out}");
        let d = last_diagnosis(&h).unwrap_or_else(|| panic!("진단 없음: {out}"));
        assert_eq!(d.code, code, "출력: {out}");
        if let Some(hop) = hop {
            assert_eq!(d.hop.as_deref(), Some(hop), "출력: {out}");
        }
        let r = h.history.list(1).unwrap().remove(0);
        assert_eq!(r.reason.as_deref(), Some(code));
    }
}

#[test]
#[ignore]
fn diagnoses_wrong_password_and_skips_cancel() {
    let h = Harness::new(temp_store("diag-auth"), HostKeyPolicy::Trust);
    *h.sink.askpass.lock().unwrap() = AskpassPolicy::Answer {
        password: "nope".into(),
        save: false,
    };
    let (_, code) = h.run(
        ConnectRequest {
            target: bastion(),
            jump: None,
            connect_timeout: None,
        },
        None,
    );
    assert_eq!(code, Some(255));
    assert_eq!(last_diagnosis(&h).unwrap().code, "auth_password");

    h.clear();
    *h.sink.askpass.lock().unwrap() = AskpassPolicy::Cancel;
    let (_, code) = h.run(
        ConnectRequest {
            target: bastion(),
            jump: None,
            connect_timeout: None,
        },
        None,
    );
    assert_eq!(code, Some(255));
    assert!(last_diagnosis(&h).is_none(), "사용자가 취소한 건 오류로 보지 않는다");
}

/// 화면이 출력을 따라가지 못해 읽기를 멈추면 출력이 멈추고, 그동안에도 Ctrl+C가 전달된다 (GAP-05).
#[test]
#[ignore]
fn flow_control_pauses_output_and_keeps_input() {
    let h = Harness::new(temp_store("flow"), HostKeyPolicy::Trust);
    let req = ConnectRequest {
        target: bastion(),
        jump: None,
        connect_timeout: None,
    };
    let total = Arc::new(Mutex::new(Vec::<u8>::new()));
    let o = total.clone();
    let id = h
        .sessions
        .open(
            &OpenSshEngine::new(),
            h.broker.clone(),
            req,
            SessionLabel {
                title: "flow".into(),
                ..Default::default()
            },
            (120, 40),
            Box::new(move |b| {
                o.lock().unwrap().extend_from_slice(b);
                true
            }),
        )
        .unwrap();
    let len = || total.lock().unwrap().len();
    let wait_for = |needle: &str| {
        let start = Instant::now();
        while !String::from_utf8_lossy(&total.lock().unwrap()).contains(needle) {
            assert!(start.elapsed() < Duration::from_secs(20), "{needle} 대기 시간 초과");
            std::thread::sleep(Duration::from_millis(50));
        }
    };
    wait_for("$ ");

    // 끝없이 출력하는 명령
    h.sessions.write(&id, b"yes DHOST-FLOOD\n").unwrap();
    std::thread::sleep(Duration::from_millis(500));
    assert!(len() > 100_000, "대량 출력이 나와야 한다");

    h.sessions.set_paused(&id, true).unwrap();
    std::thread::sleep(Duration::from_millis(300)); // 이미 읽은 덩어리가 지나가길 기다린다
    let paused_at = len();
    std::thread::sleep(Duration::from_millis(1000));
    assert!(
        len() - paused_at <= 32 * 1024,
        "멈춘 동안 출력이 거의 늘지 않아야 한다: {}",
        len() - paused_at
    );

    // 멈춘 상태에서 Ctrl+C를 보내고 다시 연다.
    h.sessions.write(&id, b"\x03").unwrap();
    std::thread::sleep(Duration::from_millis(300));
    h.sessions.set_paused(&id, false).unwrap();
    h.sessions.write(&id, b"echo FLOW-DONE-$((40+2))\n").unwrap();
    wait_for("FLOW-DONE-42");

    h.sessions.close(&id).unwrap();
    let start = Instant::now();
    while h.exit_code(&id).is_none() {
        assert!(start.elapsed() < Duration::from_secs(10), "닫히지 않음");
        std::thread::sleep(Duration::from_millis(50));
    }
}

// ---- 사전 테스트 기록(docs/test-record.md)용 ----

type Out = Arc<Mutex<Vec<u8>>>;

/// 세션을 열고 셸 프롬프트가 뜰 때까지 기다린다.
fn open_shell(h: &Harness, req: ConnectRequest) -> (String, Out) {
    let out: Out = Arc::new(Mutex::new(Vec::new()));
    let o = out.clone();
    let id = h
        .sessions
        .open(
            &OpenSshEngine::new(),
            h.broker.clone(),
            req,
            SessionLabel {
                title: "t".into(),
                ..Default::default()
            },
            (120, 40),
            Box::new(move |b| {
                o.lock().unwrap().extend_from_slice(b);
                true
            }),
        )
        .unwrap();
    wait_out(&out, "$ ");
    (id, out)
}

fn wait_out(out: &Out, needle: &str) {
    let start = Instant::now();
    while !String::from_utf8_lossy(&out.lock().unwrap()).contains(needle) {
        assert!(start.elapsed() < Duration::from_secs(20), "{needle:?} 대기 시간 초과");
        std::thread::sleep(Duration::from_millis(50));
    }
}

fn wait_exit(h: &Harness, id: &str) -> Option<u32> {
    let start = Instant::now();
    loop {
        if let Some(code) = h.exit_code(id) {
            return code;
        }
        assert!(start.elapsed() < Duration::from_secs(10), "종료 이벤트가 오지 않음");
        std::thread::sleep(Duration::from_millis(50));
    }
}

fn direct() -> ConnectRequest {
    ConnectRequest {
        target: bastion(),
        jump: None,
        connect_timeout: None,
    }
}

/// 이 테스트 바이너리(DHost 도우미)를 KnownHostsCommand로 쓰는 ssh 프로세스 수
fn our_ssh_processes() -> usize {
    let exe = env!("CARGO_BIN_EXE_dhost");
    let ps = std::process::Command::new("ps")
        .args(["-axo", "command="])
        .output()
        .unwrap();
    String::from_utf8_lossy(&ps.stdout)
        .lines()
        .filter(|l| l.starts_with("/usr/bin/ssh ") && l.contains(exe))
        .count()
}

fn open_fds() -> usize {
    std::fs::read_dir("/dev/fd").map(|d| d.count()).unwrap_or(0)
}

/// TEST-07: 비밀번호 없이 SSH Agent의 키로 인증한다. 키는 테스트 중에만 만들고 지운다.
#[test]
#[ignore]
fn agent_key_auth_without_password() {
    use std::process::{Command, Stdio};
    // temp_store()가 쓰는 폴더와 겹치지 않게 이름을 따로 둔다.
    let dir = std::env::temp_dir().join(format!("dhost-e2e-{}-sshagent", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let key = dir.join("k");
    let sock = dir.join("agent.sock");
    assert!(
        Command::new("ssh-keygen")
            .args(["-q", "-t", "ed25519", "-N", "", "-C", "dhost-e2e", "-f"])
            .arg(&key)
            .status()
            .unwrap()
            .success()
    );
    let pubkey = std::fs::read_to_string(dir.join("k.pub")).unwrap();
    let compose = concat!(env!("CARGO_MANIFEST_DIR"), "/../dev/test-env/docker-compose.yml");
    let docker = |script: &str, input: Option<&str>| {
        let mut c = Command::new("docker")
            .args(["compose", "-f", compose, "exec", "-T", "bastion", "sh", "-c", script])
            .stdin(Stdio::piped())
            .spawn()
            .unwrap();
        if let Some(i) = input {
            use std::io::Write;
            c.stdin.take().unwrap().write_all(i.as_bytes()).unwrap();
        }
        drop(c.stdin.take());
        assert!(c.wait().unwrap().success(), "docker exec 실패: {script}");
    };
    docker(
        "mkdir -p /home/dhost/.ssh && cat >> /home/dhost/.ssh/authorized_keys && chown -R dhost /home/dhost/.ssh && chmod 700 /home/dhost/.ssh && chmod 600 /home/dhost/.ssh/authorized_keys",
        Some(&pubkey),
    );

    let mut agent = Command::new("ssh-agent")
        .arg("-D")
        .arg("-a")
        .arg(&sock)
        .stdout(Stdio::null())
        .spawn()
        .unwrap();
    let start = Instant::now();
    while !sock.exists() {
        assert!(start.elapsed() < Duration::from_secs(5), "ssh-agent가 뜨지 않음");
        std::thread::sleep(Duration::from_millis(50));
    }
    assert!(
        Command::new("ssh-add")
            .arg("-q")
            .arg(&key)
            .env("SSH_AUTH_SOCK", &sock)
            .status()
            .unwrap()
            .success()
    );

    let old = std::env::var_os("SSH_AUTH_SOCK");
    // SAFETY: E2E는 --test-threads=1로 돈다. 이 테스트 동안만 바꾸고 되돌린다.
    unsafe { std::env::set_var("SSH_AUTH_SOCK", &sock) };
    let h = Harness::new(temp_store("agent"), HostKeyPolicy::Trust);
    // 비밀번호를 물으면 취소한다: 키 인증이 아니면 접속이 실패해야 한다.
    *h.sink.askpass.lock().unwrap() = AskpassPolicy::Cancel;
    let (out, code) = h.run(direct(), Some("echo AGENT-OK-$((20+1)); exit"));
    let prompts = askpass_prompts(&h);
    unsafe {
        match old {
            Some(v) => std::env::set_var("SSH_AUTH_SOCK", v),
            None => std::env::remove_var("SSH_AUTH_SOCK"),
        }
    }
    let _ = agent.kill();
    let _ = agent.wait();
    docker("sed -i '/dhost-e2e/d' /home/dhost/.ssh/authorized_keys", None);
    let _ = std::fs::remove_dir_all(&dir);

    assert_eq!(code, Some(0), "출력: {out:?}");
    assert!(out.contains("AGENT-OK-21"), "출력: {out:?}");
    assert!(
        prompts.iter().all(|p| !p.prompt.contains("password")),
        "키 인증이면 비밀번호를 묻지 않아야 한다: {:?}",
        prompts.iter().map(|p| &p.prompt).collect::<Vec<_>>()
    );
}

/// TEST-09: 여러 세션 중 하나가 끊겨도 다른 세션은 유지되고, 끊긴 세션은 저절로 다시 붙지 않는다.
#[test]
#[ignore]
fn one_session_drop_keeps_others_and_no_auto_reconnect() {
    let h = Harness::new(temp_store("multi"), HostKeyPolicy::Trust);
    let (a, _out_a) = open_shell(&h, direct());
    let (b, out_b) = open_shell(&h, direct());
    let (c, out_c) = open_shell(&h, direct());

    // A의 원격 sshd 세션 프로세스를 죽여 서버 쪽에서 끊긴 상황을 만든다.
    h.sessions.write(&a, b"kill -9 $PPID\n").unwrap();
    assert_eq!(wait_exit(&h, &a), Some(255), "서버 쪽 끊김은 ssh 오류(255)로 끝난다");

    for (id, out, tag) in [(&b, &out_b, "B"), (&c, &out_c, "C")] {
        h.sessions
            .write(id, format!("echo ALIVE-{tag}-$((1+1))\n").as_bytes())
            .unwrap();
        wait_out(out, &format!("ALIVE-{tag}-2"));
        assert!(h.exit_code(id).is_none(), "{tag} 세션은 살아 있어야 한다");
    }

    // 자동 재접속 없음: 잠시 기다려도 새 접속 시도(호스트 키 확인·세션 종료 이벤트)가 늘지 않는다.
    let before = h.sink.events.lock().unwrap().len();
    std::thread::sleep(Duration::from_secs(3));
    assert_eq!(
        h.sink.events.lock().unwrap().len(),
        before,
        "사용자 요청 없이 다시 접속하면 안 된다"
    );

    // 사용자가 재접속하면 새 세션으로 붙는다.
    let (a2, out_a2) = open_shell(&h, direct());
    h.sessions.write(&a2, b"echo BACK-$((3+4))\n").unwrap();
    wait_out(&out_a2, "BACK-7");

    for id in [&b, &c, &a2] {
        h.sessions.close(id).unwrap();
        wait_exit(&h, id);
    }
}

/// TEST-14: 접속·종료를 반복해도 ssh 프로세스와 파일 핸들이 남지 않는다.
#[test]
#[ignore]
fn repeated_connect_close_leaks_nothing() {
    let h = Harness::new(temp_store("repeat"), HostKeyPolicy::Trust);
    // 첫 접속에서 호스트 키 승인·소켓 생성 등 한 번만 생기는 자원을 만든다.
    let (id, _) = open_shell(&h, direct());
    h.sessions.close(&id).unwrap();
    wait_exit(&h, &id);
    std::thread::sleep(Duration::from_millis(300));
    let fds_before = open_fds();
    let procs_before = our_ssh_processes();

    for i in 0..20 {
        let (id, out) = open_shell(&h, direct());
        h.sessions
            .write(&id, format!("echo LOOP-{i}-$((i=1))\n").as_bytes())
            .unwrap();
        wait_out(&out, &format!("LOOP-{i}-1"));
        if i % 2 == 0 {
            h.sessions.close(&id).unwrap(); // 사용자가 탭을 닫음
        } else {
            h.sessions.write(&id, b"exit\n").unwrap(); // 원격에서 정상 종료
        }
        wait_exit(&h, &id);
    }
    std::thread::sleep(Duration::from_millis(500));

    assert_eq!(our_ssh_processes(), procs_before, "남은 ssh 프로세스가 없어야 한다");
    let fds_after = open_fds();
    assert!(
        fds_after <= fds_before + 4,
        "파일 핸들이 늘었다: {fds_before} → {fds_after}"
    );
}
