//! 연결 실패 진단 (FUN-16).
//!
//! ssh가 실패할 때 남긴 메시지(종료 직전 출력의 끝부분)를 보고 원인과 해결 방법을 고른다.
//! 출력은 메모리에서만 잠깐 보고 저장하지 않는다 (SEC-P04). 원격 셸 출력에 비슷한 문구가 섞이면
//! 틀릴 수 있으므로 ssh 메시지 형식에 맞는 줄만 보고, 마지막 줄부터 찾는다.

use serde::Serialize;

use crate::meta::{Flags, Hop};

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Diagnosis {
    /// dns | refused | timeout | unreachable | closed_early | not_ssh | auth_password | auth_key_only
    /// | auth_too_many | auth_failed | kex_legacy | forward_denied | forward_failed | lost | hostkey_rejected
    /// | hostkey_changed | unknown
    pub code: String,
    pub title: String,
    pub detail: String,
    pub hints: Vec<String>,
    /// 실패한 구간 ("경유 서버 bastion" 등). 알 수 없으면 None
    pub hop: Option<String>,
}

fn d(code: &str, title: &str, detail: String, hints: &[&str], hop: Option<String>) -> Diagnosis {
    Diagnosis {
        code: code.into(),
        title: title.into(),
        detail,
        hints: hints.iter().map(|s| s.to_string()).collect(),
        hop,
    }
}

/// 메시지 속 호스트 이름을 구간 이름으로 바꾼다.
fn hop_of(hops: &[Hop], host: &str) -> Option<String> {
    let host = host.trim_matches(|c| c == '[' || c == ']');
    hops.iter().find(|h| h.host == host).map(|h| h.label.clone())
}

fn after<'a>(line: &'a str, prefix: &str) -> Option<&'a str> {
    line.find(prefix).map(|i| &line[i + prefix.len()..])
}

/// "connect to host H port P: reason" 형식에서 H와 reason을 뽑는다.
fn connect_failure(line: &str) -> Option<(&str, &str)> {
    let rest = after(line, "connect to host ")?;
    let (host, rest) = rest.split_once(" port ")?;
    let (_, reason) = rest.split_once(": ")?;
    Some((host, reason.trim()))
}

/// 종료 코드 255(ssh 자체 오류)일 때만 부른다.
pub fn diagnose(tail: &str, hops: &[Hop], flags: &Flags) -> Option<Diagnosis> {
    if flags.auth_cancelled || flags.closed_by_user {
        return None;
    }
    let target = hops.last().map(|h| h.label.clone());
    if flags.hostkey_changed {
        return Some(d(
            "hostkey_changed",
            "호스트 키가 바뀌어 연결을 막았습니다",
            "서버가 예전에 승인한 키와 다른 키를 보냈습니다. 서버를 다시 설치했을 수도 있지만, 중간에서 누군가 통신을 가로채고 있을 수도 있습니다.".into(),
            &[
                "서버 관리자에게 키를 바꾼 적이 있는지 확인하세요.",
                "확인이 끝나면 '호스트 키' 화면에서 기존 키를 지우고 다시 접속해 새 키를 승인하세요.",
            ],
            None,
        ));
    }
    if flags.hostkey_rejected {
        return Some(d(
            "hostkey_rejected",
            "호스트 키를 승인하지 않아 연결하지 않았습니다",
            "처음 접속하는 서버의 키를 신뢰하지 않으면 DHost는 연결하지 않습니다.".into(),
            &["서버 관리자에게 받은 지문과 같은지 확인한 뒤 다시 접속해 승인하세요."],
            None,
        ));
    }

    let lines: Vec<&str> = tail
        .lines()
        .map(|l| l.trim_matches(|c: char| c == '\r' || c.is_whitespace()))
        .filter(|l| !l.is_empty())
        .collect();
    let has = |needle: &str| lines.iter().rev().find(|l| l.contains(needle)).copied();

    // 1) 이름 풀이 실패
    if let Some(l) = has("Could not resolve hostname ") {
        let host = after(l, "Could not resolve hostname ").and_then(|r| r.split(':').next()).unwrap_or("");
        return Some(d(
            "dns",
            "서버 주소를 찾을 수 없습니다",
            format!("'{host}'라는 이름을 IP 주소로 바꾸지 못했습니다."),
            &[
                "호스트 이름에 오타가 없는지 확인하세요.",
                "사내망 전용 이름이라면 VPN에 연결되어 있는지 확인하세요.",
                "IP 주소로 직접 넣어 보세요.",
            ],
            hop_of(hops, host),
        ));
    }

    // 2) TCP 연결 실패
    if let Some((host, reason)) = lines.iter().rev().find_map(|l| connect_failure(l)) {
        let hop = hop_of(hops, host);
        let (code, title, hints): (&str, &str, &[&str]) = if reason.contains("refused") {
            (
                "refused",
                "서버가 연결을 거부했습니다",
                &["포트 번호가 맞는지 확인하세요.", "서버에서 sshd가 실행 중인지 관리자에게 확인하세요."],
            )
        } else if reason.contains("timed out") {
            (
                "timeout",
                "연결 시간이 초과되었습니다",
                &[
                    "주소가 맞는지 확인하세요.",
                    "VPN 연결이나 방화벽(접근 허용 IP)을 확인하세요.",
                    "경유 서버를 통해서만 들어갈 수 있는 서버인지 확인하세요.",
                ],
            )
        } else if reason.contains("No route") || reason.contains("unreachable") {
            (
                "unreachable",
                "네트워크로 서버에 갈 수 없습니다",
                &["인터넷·VPN 연결을 확인하세요.", "사내망 서버라면 경유 서버 설정이 필요한지 확인하세요."],
            )
        } else {
            ("unknown", "서버에 연결하지 못했습니다", &["주소와 포트, 네트워크 상태를 확인하세요."])
        };
        return Some(d(code, title, format!("{host} 포트 연결 실패: {reason}"), hints, hop));
    }
    if let Some(l) = has("Connection timed out during banner exchange") {
        let _ = l;
        return Some(d(
            "timeout",
            "서버가 응답하지 않습니다",
            "연결은 됐지만 SSH 서버가 제시간에 응답하지 않았습니다.".into(),
            &["서버 부하가 높거나 방화벽이 중간에서 막고 있을 수 있습니다. 잠시 뒤 다시 시도하세요."],
            None,
        ));
    }

    // 3) 경유 서버가 대상으로 가는 길을 열지 못함
    if let Some(l) = has("open failed: administratively prohibited") {
        let _ = l;
        return Some(d(
            "forward_denied",
            "경유 서버가 다른 서버로 가는 연결을 허용하지 않습니다",
            "경유 서버의 sshd 설정에서 포워딩이 막혀 있습니다 (AllowTcpForwarding).".into(),
            &["경유 서버 관리자에게 이 계정의 TCP 포워딩 허용을 요청하세요."],
            hops.first().filter(|_| hops.len() > 1).map(|h| h.label.clone()),
        ));
    }
    if let Some(l) = has("open failed: connect failed") {
        let reason = after(l, "connect failed: ").unwrap_or("").trim();
        return Some(d(
            "forward_failed",
            "경유 서버에서 대상 서버로 연결하지 못했습니다",
            format!("경유 서버까지는 접속했지만, 거기서 대상 서버로 가는 연결이 실패했습니다: {reason}"),
            &[
                "대상 서버의 주소가 경유 서버 기준으로 맞는지 확인하세요 (내부 IP나 내부 이름).",
                "대상 서버의 포트와 sshd 실행 여부를 확인하세요.",
            ],
            target,
        ));
    }

    // 4) 알고리즘 협상 실패 (오래된 서버·장비)
    if let Some(l) = has("Unable to negotiate with ") {
        let host = after(l, "Unable to negotiate with ").and_then(|r| r.split(' ').next()).unwrap_or("");
        let what = if l.contains("host key type") {
            "호스트 키 종류"
        } else if l.contains("key exchange") {
            "키 교환 방식"
        } else if l.contains("cipher") {
            "암호화 방식"
        } else {
            "보안 알고리즘"
        };
        return Some(d(
            "kex_legacy",
            "서버와 맞는 보안 방식이 없습니다",
            format!("서버가 오래된 {what}만 지원해서 현재 OpenSSH가 연결하지 않습니다."),
            &[
                "서버(또는 장비) 관리자에게 SSH 업데이트를 요청하는 것이 가장 안전합니다.",
                "꼭 접속해야 한다면 ~/.ssh/config에 해당 호스트만 예외 설정을 추가할 수 있지만, 보안이 약해집니다.",
            ],
            hop_of(hops, host),
        ));
    }

    // 5) 인증 실패
    // 비밀번호를 다시 물었다면(=틀렸다면) 서버 메시지가 "시도 횟수 초과"여도 원인은 비밀번호다.
    let password_retried = flags.password_prompts.values().any(|&n| n > 1);
    if password_retried && (has("Permission denied (").is_some() || has("Too many authentication failures").is_some()) {
        let hop = flags
            .password_prompts
            .iter()
            .filter(|(_, n)| **n > 1)
            .map(|(i, _)| *i)
            .max()
            .and_then(|i| hops.get(i))
            .map(|h| h.label.clone());
        return Some(d(
            "auth_password",
            "비밀번호가 맞지 않습니다",
            "입력한 비밀번호로 로그인하지 못했습니다.".into(),
            &["사용자 이름과 비밀번호를 확인하세요.", "여러 번 틀리면 계정이 잠길 수 있습니다."],
            hop,
        ));
    }
    if let Some(l) = has("Too many authentication failures") {
        let _ = l;
        return Some(d(
            "auth_too_many",
            "인증 시도가 너무 많아 서버가 끊었습니다",
            "SSH Agent에 키가 많으면 비밀번호를 묻기 전에 시도 횟수를 다 써버릴 수 있습니다.".into(),
            &["~/.ssh/config에서 이 호스트에 'IdentitiesOnly yes'와 사용할 IdentityFile만 지정하세요."],
            None,
        ));
    }
    if let Some(l) = has("Permission denied (") {
        let who = l.split(": Permission denied").next().unwrap_or("");
        let host = who.rsplit_once('@').map(|(_, h)| h).unwrap_or("");
        let hop = hop_of(hops, host).or(target.clone());
        let methods = after(l, "Permission denied (").and_then(|r| r.split(')').next()).unwrap_or("");
        if !methods.contains("password") && !methods.contains("keyboard-interactive") {
            return Some(d(
                "auth_key_only",
                "이 서버는 SSH 키로만 로그인할 수 있습니다",
                format!("서버가 허용하는 방식: {methods}. 등록된 키가 없거나 맞지 않습니다."),
                &[
                    "이 서버에 내 공개키(~/.ssh/id_ed25519.pub 등)가 등록되어 있는지 관리자에게 확인하세요.",
                    "다른 키를 써야 한다면 ~/.ssh/config에 IdentityFile을 지정하세요.",
                ],
                hop,
            ));
        }
        let typed = flags.password_prompts.values().any(|&n| n > 0);
        return Some(if typed {
            d(
                "auth_password",
                "비밀번호가 맞지 않습니다",
                "입력한 비밀번호로 로그인하지 못했습니다.".into(),
                &["사용자 이름과 비밀번호를 확인하세요.", "여러 번 틀리면 계정이 잠길 수 있습니다."],
                hop,
            )
        } else {
            d(
                "auth_failed",
                "로그인하지 못했습니다",
                format!("서버가 허용하는 방식({methods})으로 인증하지 못했습니다."),
                &["사용자 이름이 맞는지 확인하세요."],
                hop,
            )
        });
    }

    // 6) 접속 도중이나 직후 끊김
    if lines.iter().rev().take(5).any(|l| {
        l.contains("Broken pipe") || l.contains("not responding") || l.contains("closed by remote host")
    }) && !lines.iter().any(|l| l.contains("kex_exchange_identification"))
    {
        return Some(d(
            "lost",
            "연결이 끊어졌습니다",
            "네트워크가 끊기거나 서버가 연결을 닫았습니다.".into(),
            &["네트워크·VPN 상태를 확인한 뒤 재접속하세요.", "오래 쓰지 않으면 방화벽이 연결을 끊을 수 있습니다."],
            None,
        ));
    }
    if let Some(l) = has("kex_exchange_identification").or_else(|| has("Connection closed by ")).or_else(|| has("Connection reset by ")) {
        let host = after(l, "by ").and_then(|r| r.split(' ').next()).unwrap_or("");
        let invalid = l.contains("invalid format") || l.contains("banner");
        return Some(d(
            if invalid { "not_ssh" } else { "closed_early" },
            if invalid { "SSH 서버가 아닌 것 같습니다" } else { "서버가 접속 직후 연결을 끊었습니다" },
            if invalid {
                "포트에서 SSH가 아닌 응답이 왔습니다.".into()
            } else {
                "인증 전에 서버가 연결을 닫았습니다.".into()
            },
            if invalid {
                &["포트 번호가 SSH 포트가 맞는지 확인하세요."]
            } else {
                &[
                    "접근 허용 IP(방화벽·TCP Wrapper)에 내 IP가 있는지 관리자에게 확인하세요.",
                    "로그인 실패가 많아 잠시 차단됐을 수 있습니다 (fail2ban 등). 잠시 뒤 다시 시도하세요.",
                ]
            },
            hop_of(hops, host),
        ));
    }

    Some(d(
        "unknown",
        "연결이 실패했습니다",
        lines.iter().rev().find(|l| l.starts_with("ssh:") || l.contains("error")).map(|l| l.to_string()).unwrap_or_else(
            || "ssh가 오류로 끝났지만 원인을 특정하지 못했습니다.".into(),
        ),
        &["터미널에 남은 메시지를 확인하세요."],
        None,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hops() -> Vec<Hop> {
        vec![
            Hop { server_id: None, user: "dhost".into(), host: "127.0.0.1".into(), label: "경유 서버 bastion".into() },
            Hop { server_id: None, user: "dhost".into(), host: "target".into(), label: "대상 서버 target".into() },
        ]
    }

    fn run(tail: &str) -> Diagnosis {
        diagnose(tail, &hops(), &Flags::default()).unwrap()
    }

    #[test]
    fn network_failures() {
        let x = run("ssh: connect to host 127.0.0.1 port 2299: Connection refused\r\nConnection closed by UNKNOWN port 65535\r\n");
        assert_eq!((x.code.as_str(), x.hop.as_deref()), ("refused", Some("경유 서버 bastion")));
        assert_eq!(run("ssh: connect to host 192.0.2.1 port 22: Operation timed out").code, "timeout");
        assert_eq!(run("ssh: connect to host 192.0.2.1 port 22: No route to host").code, "unreachable");
        let x = run("ssh: Could not resolve hostname nosuch.invalid: nodename nor servname provided, or not known");
        assert_eq!(x.code, "dns");
        assert!(x.detail.contains("nosuch.invalid"));
    }

    #[test]
    fn jump_forwarding() {
        let x = run("channel 0: open failed: connect failed: Name does not resolve\r\nstdio forwarding failed\r\n");
        assert_eq!((x.code.as_str(), x.hop.as_deref()), ("forward_failed", Some("대상 서버 target")));
        assert_eq!(run("channel 0: open failed: administratively prohibited: open failed").code, "forward_denied");
    }

    #[test]
    fn auth() {
        let mut f = Flags::default();
        f.password_prompts.insert(1, 3);
        let x = diagnose("dhost@target: Permission denied (publickey,password,keyboard-interactive).", &hops(), &f).unwrap();
        assert_eq!((x.code.as_str(), x.hop.as_deref()), ("auth_password", Some("대상 서버 target")));
        let x = run("dhost@127.0.0.1: Permission denied (publickey).");
        assert_eq!((x.code.as_str(), x.hop.as_deref()), ("auth_key_only", Some("경유 서버 bastion")));
        assert_eq!(run("Received disconnect from 192.0.2.1 port 22:2: Too many authentication failures").code, "auth_too_many");
        // 비밀번호를 다시 물었다면 시도 횟수 초과 메시지여도 비밀번호 문제로 본다
        let mut f = Flags::default();
        f.password_prompts.insert(0, 3);
        let x = diagnose("Received disconnect from 127.0.0.1 port 22:2: Too many authentication failures", &hops(), &f).unwrap();
        assert_eq!((x.code.as_str(), x.hop.as_deref()), ("auth_password", Some("경유 서버 bastion")));
    }

    #[test]
    fn negotiation_and_early_close() {
        let x = run("Unable to negotiate with 127.0.0.1 port 2222: no matching host key type found. Their offer: ssh-rsa");
        assert_eq!(x.code, "kex_legacy");
        assert!(x.detail.contains("호스트 키 종류"));
        assert_eq!(run("kex_exchange_identification: Connection closed by remote host").code, "closed_early");
        assert_eq!(run("kex_exchange_identification: banner line contains invalid characters\r\nbanner exchange: Connection to 127.0.0.1 port 2399: invalid format").code, "not_ssh");
        assert_eq!(run("Last login: today\r\n$ uptime\r\nclient_loop: send disconnect: Broken pipe").code, "lost");
    }

    #[test]
    fn user_intent_and_hostkeys() {
        let mut f = Flags::default();
        f.auth_cancelled = true;
        assert!(diagnose("whatever", &hops(), &f).is_none());
        let mut f = Flags::default();
        f.hostkey_changed = true;
        assert_eq!(diagnose("", &hops(), &f).unwrap().code, "hostkey_changed");
        assert_eq!(run("something odd happened").code, "unknown");
    }
}
