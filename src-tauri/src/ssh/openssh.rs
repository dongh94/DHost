use std::process::Command;

use portable_pty::CommandBuilder;

use super::{ConfigEntry, ConnectRequest, EngineInfo, HelperContext, SshEngine};
use crate::error::{AppError, AppResult};

/// KnownHostsCommand는 OpenSSH 8.5, SSH_ASKPASS_REQUIRE는 8.4부터 지원된다.
const MIN_VERSION: (u32, u32) = (8, 5);

/// PATH에 따라 다른 ssh가 잡히지 않도록 macOS 기본 경로를 고정한다.
const SSH_PATH: &str = "/usr/bin/ssh";

#[derive(Debug, Clone)]
pub struct OpenSshEngine;

impl OpenSshEngine {
    pub fn new() -> Self {
        Self
    }
}

impl Default for OpenSshEngine {
    fn default() -> Self {
        Self::new()
    }
}

impl SshEngine for OpenSshEngine {
    fn probe(&self) -> AppResult<EngineInfo> {
        // `ssh -V`는 버전을 stderr로 출력한다.
        let output = Command::new(SSH_PATH)
            .arg("-V")
            .output()
            .map_err(|e| AppError::SshNotFound(format!("{SSH_PATH}: {e}")))?;
        let raw = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let version = parse_version(&raw).ok_or_else(|| AppError::SshVersionUnparsable(raw.clone()))?;
        Ok(EngineInfo {
            name: "openssh".to_string(),
            version: raw,
            supported: version >= MIN_VERSION,
        })
    }

    fn build_command(&self, req: &ConnectRequest, ctx: &HelperContext) -> AppResult<CommandBuilder> {
        let mut cmd = CommandBuilder::new(SSH_PATH);
        cmd.args(build_args(req, ctx)?);
        cmd.env("TERM", "xterm-256color");
        if std::env::var_os("LANG").is_none() {
            // Finder에서 실행하면 LANG이 없어 한글이 깨질 수 있다.
            cmd.env("LANG", "en_US.UTF-8");
        }
        // 비밀번호·키 암호 입력은 TTY 대신 항상 DHost 입력창으로 받는다.
        cmd.env("SSH_ASKPASS", &ctx.exe);
        cmd.env("SSH_ASKPASS_REQUIRE", "force");
        cmd.env("DHOST_IPC_SOCKET", &ctx.socket_path);
        cmd.env("DHOST_SESSION_TOKEN", &ctx.session_token);
        Ok(cmd)
    }

    fn effective_config(&self, req: &ConnectRequest, ctx: &HelperContext) -> AppResult<Vec<ConfigEntry>> {
        let mut args = build_args(req, ctx)?;
        args.insert(0, "-G".into());
        let output = Command::new(SSH_PATH)
            .args(&args)
            .output()
            .map_err(|e| AppError::Internal(format!("ssh -G 실행 실패: {e}")))?;
        if !output.status.success() {
            return Err(AppError::Internal(
                String::from_utf8_lossy(&output.stderr).trim().to_string(),
            ));
        }
        Ok(crate::sshfiles::parse_ssh_g(&String::from_utf8_lossy(&output.stdout))
            .into_iter()
            .map(|(key, value)| {
                let forced = FORCED_KEYS.contains(&key.as_str());
                ConfigEntry { key, value, forced }
            })
            .collect())
    }

    fn clone_box(&self) -> Box<dyn SshEngine> {
        Box::new(self.clone())
    }
}

/// DHost가 항상 직접 정하는 설정 (`ssh -G` 출력의 소문자 키)
const FORCED_KEYS: &[&str] = &[
    "stricthostkeychecking",
    "userknownhostsfile",
    "globalknownhostsfile",
    "updatehostkeys",
    "checkhostip",
    "controlmaster",
    "controlpath",
    "knownhostscommand",
    "proxyjump",
    "proxycommand",
    "port",
    "user",
];

/// 호스트 키 검증을 DHost가 전담하게 하는 공통 옵션.
/// 사용자 known_hosts는 읽지도 쓰지도 않는다 (스파이크 기준, 정책 결정 필요).
fn common_options(known_hosts_command: &str) -> Vec<String> {
    [
        "StrictHostKeyChecking=yes",
        "UserKnownHostsFile=none",
        "GlobalKnownHostsFile=none",
        "UpdateHostKeys=no",
        "CheckHostIP=no",
        // 세션끼리 연결을 공유하지 않는다 (FUN-06 독립 연결)
        "ControlMaster=no",
        "ControlPath=none",
    ]
    .iter()
    .map(|s| s.to_string())
    .chain(std::iter::once(known_hosts_command.to_string()))
    .flat_map(|o| ["-o".to_string(), o])
    .collect()
}

fn known_hosts_command(exe: &str, pct: &str) -> AppResult<String> {
    if exe.contains('"') || exe.contains('\\') {
        return Err(AppError::Internal(
            "실행 파일 경로에 허용되지 않는 문자가 있습니다".into(),
        ));
    }
    // ssh는 이 값에서 %토큰을 치환하므로 경로 안의 %는 이스케이프한다.
    let exe = exe.replace('%', &pct.repeat(2));
    let p = pct;
    Ok(format!(
        "KnownHostsCommand=\"{exe}\" --dhost-known-hosts {p}I {p}H {p}t {p}K {p}f"
    ))
}

fn build_args(req: &ConnectRequest, ctx: &HelperContext) -> AppResult<Vec<String>> {
    req.target.validate()?;
    let mut args = common_options(&known_hosts_command(&ctx.exe, "%")?);
    let timeout = req.connect_timeout.map(|t| t.clamp(1, 600));
    if let Some(t) = timeout {
        args.extend(["-o".into(), format!("ConnectTimeout={t}")]);
    }

    match &req.jump {
        None => {
            // 사용자 ssh_config의 ProxyJump가 끼어들면 경유 서버가 DHost 검증을 거치지 않는다.
            args.extend(["-o".into(), "ProxyJump=none".into()]);
        }
        Some(jump) => {
            jump.validate()?;
            // ProxyJump(-J)는 -o 옵션을 경유용 ssh에 넘기지 않으므로 ProxyCommand를 직접 만든다.
            // ProxyCommand는 바깥 ssh가 %를 한 번 치환한 뒤 /bin/sh로 실행한다.
            let inner_kh = known_hosts_command(&ctx.exe, "%%")?;
            let mut inner: Vec<String> = vec![SSH_PATH.into()];
            for (i, o) in common_options(&inner_kh).into_iter().enumerate() {
                inner.push(if i % 2 == 1 { sh_quote(&o) } else { o });
            }
            if let Some(t) = timeout {
                inner.extend(["-o".into(), format!("ConnectTimeout={t}")]);
            }
            // 경유 서버에 지정한 키는 경유용 ssh에만 준다.
            for a in identity_args(jump) {
                inner.push(sh_quote(&a));
            }
            inner.extend([
                "-o".into(),
                "ProxyJump=none".into(),
                "-p".into(),
                jump.port.to_string(),
                "-l".into(),
                sh_quote(&jump.user),
                "-W".into(),
                "'[%h]:%p'".into(),
                "--".into(),
                sh_quote(&jump.host),
            ]);
            args.extend(["-o".into(), format!("ProxyCommand={}", inner.join(" "))]);
        }
    }

    args.extend(identity_args(&req.target));
    args.extend([
        "-p".into(),
        req.target.port.to_string(),
        "-l".into(),
        req.target.user.clone(),
        "--".into(),
        req.target.host.clone(),
    ]);
    Ok(args)
}

/// 구간에 개인키를 지정했으면 그 키만 쓴다 (IdentitiesOnly). Agent에 키가 많아 서버 시도 횟수를 넘기는 것도 막는다.
/// 비밀번호 인증은 그대로 남는다.
fn identity_args(ep: &crate::ssh::Endpoint) -> Vec<String> {
    match &ep.identity_file {
        Some(path) => vec![
            "-i".into(),
            crate::ssh::expand_home(path).to_string_lossy().into_owned(),
            "-o".into(),
            "IdentitiesOnly=yes".into(),
        ],
        None => vec![],
    }
}

fn sh_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

/// "OpenSSH_10.3p1, LibreSSL 3.3.6" -> (10, 3)
fn parse_version(raw: &str) -> Option<(u32, u32)> {
    let rest = raw.strip_prefix("OpenSSH_")?;
    let mut parts = rest.split(|c: char| !c.is_ascii_digit());
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next()?.parse().ok()?;
    Some((major, minor))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ssh::Endpoint;

    #[test]
    fn parses_openssh_versions() {
        assert_eq!(parse_version("OpenSSH_10.3p1, LibreSSL 3.3.6"), Some((10, 3)));
        assert_eq!(parse_version("OpenSSH_8.4p1"), Some((8, 4)));
        // Windows 형식은 Windows 지원 단계에서 처리한다.
        assert_eq!(parse_version("OpenSSH_for_Windows_9.5p1"), None);
        assert_eq!(parse_version("garbage"), None);
    }

    #[test]
    fn min_version_comparison() {
        assert!((8, 5) >= MIN_VERSION);
        assert!((10, 3) >= MIN_VERSION);
        assert!((8, 4) < MIN_VERSION);
    }

    fn ctx() -> HelperContext {
        HelperContext {
            exe: "/Applications/DHost.app/Contents/MacOS/dhost".into(),
            socket_path: "/tmp/x.sock".into(),
            session_token: "t".into(),
        }
    }

    #[test]
    fn direct_args_end_with_destination() {
        let req = ConnectRequest {
            target: Endpoint {
                host: "192.0.2.10".into(),
                port: 2222,
                user: "dhost".into(),
                identity_file: None,
            },
            jump: None,
            connect_timeout: Some(15),
        };
        let args = build_args(&req, &ctx()).unwrap();
        assert!(args.contains(&"ConnectTimeout=15".to_string()));
        assert!(args.contains(&"StrictHostKeyChecking=yes".to_string()));
        assert!(args.contains(&"ProxyJump=none".to_string()));
        assert!(args.contains(
            &"KnownHostsCommand=\"/Applications/DHost.app/Contents/MacOS/dhost\" --dhost-known-hosts %I %H %t %K %f"
                .to_string()
        ));
        assert_eq!(
            &args[args.len() - 6..],
            ["-p", "2222", "-l", "dhost", "--", "192.0.2.10"]
        );
    }

    #[test]
    fn jump_uses_escaped_proxy_command() {
        let req = ConnectRequest {
            target: Endpoint {
                host: "target".into(),
                port: 22,
                user: "dhost".into(),
                identity_file: None,
            },
            jump: Some(Endpoint {
                host: "bastion.example.com".into(),
                port: 2222,
                user: "ops".into(),
                identity_file: None,
            }),
            connect_timeout: Some(10),
        };
        let args = build_args(&req, &ctx()).unwrap();
        let pc = args.iter().find(|a| a.starts_with("ProxyCommand=")).unwrap();
        assert!(pc.contains("--dhost-known-hosts %%I %%H %%t %%K %%f"));
        assert!(pc.contains("-W '[%h]:%p' -- 'bastion.example.com'"));
        assert!(pc.contains("-l 'ops'"));
        assert!(pc.contains("-o ConnectTimeout=10"));
        // 바깥 ssh에는 ProxyJump=none을 넣지 않는다 (ProxyCommand와 함께 쓰지 않음)
        assert!(!args.contains(&"ProxyJump=none".to_string()));
        assert!(!pc.contains("-i ") && !args.contains(&"-i".to_string()));
    }

    #[test]
    fn identity_file_goes_to_its_own_hop() {
        let home = dirs::home_dir().unwrap().to_string_lossy().into_owned();
        let req = ConnectRequest {
            target: Endpoint {
                host: "target".into(),
                port: 22,
                user: "dhost".into(),
                identity_file: Some("~/.ssh/target key".into()),
            },
            jump: Some(Endpoint {
                host: "bastion.example.com".into(),
                port: 22,
                user: "ops".into(),
                identity_file: Some("/opt/keys/it's.pem".into()),
            }),
            connect_timeout: None,
        };
        let args = build_args(&req, &ctx()).unwrap();
        // 대상 서버 키: 바깥 ssh 인자로 (~는 홈 폴더로 풀고, 공백은 인자 하나로)
        let i = args.iter().position(|a| a == "-i").unwrap();
        assert_eq!(args[i + 1], format!("{home}/.ssh/target key"));
        assert_eq!(args[i + 3], "IdentitiesOnly=yes");
        // 경유 서버 키: ProxyCommand 안에서 따옴표로 감싼다
        let pc = args.iter().find(|a| a.starts_with("ProxyCommand=")).unwrap();
        assert!(
            pc.contains(r"'-i' '/opt/keys/it'\''s.pem' '-o' 'IdentitiesOnly=yes'"),
            "{pc}"
        );
        assert!(!pc.contains("target key"));
    }
}
