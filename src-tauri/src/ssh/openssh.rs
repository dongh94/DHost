use std::process::Command;

use super::{EngineInfo, SshEngine};
use crate::error::{AppError, AppResult};

/// KnownHostsCommand는 OpenSSH 8.5, SSH_ASKPASS_REQUIRE는 8.4부터 지원된다.
const MIN_VERSION: (u32, u32) = (8, 5);

#[derive(Debug, Clone)]
pub struct OpenSshEngine {
    ssh_path: String,
}

impl OpenSshEngine {
    pub fn new() -> Self {
        // PATH에 따라 다른 ssh가 잡히지 않도록 macOS 기본 경로를 고정한다.
        Self {
            ssh_path: "/usr/bin/ssh".to_string(),
        }
    }
}

impl SshEngine for OpenSshEngine {
    fn probe(&self) -> AppResult<EngineInfo> {
        // `ssh -V`는 버전을 stderr로 출력한다.
        let output = Command::new(&self.ssh_path)
            .arg("-V")
            .output()
            .map_err(|e| AppError::SshNotFound(format!("{}: {e}", self.ssh_path)))?;
        let raw = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let version = parse_version(&raw).ok_or_else(|| AppError::SshVersionUnparsable(raw.clone()))?;
        Ok(EngineInfo {
            name: "openssh".to_string(),
            version: raw,
            supported: version >= MIN_VERSION,
        })
    }

    fn clone_box(&self) -> Box<dyn SshEngine> {
        Box::new(self.clone())
    }
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

    #[test]
    fn parses_openssh_versions() {
        assert_eq!(parse_version("OpenSSH_10.3p1, LibreSSL 3.3.6"), Some((10, 3)));
        assert_eq!(parse_version("OpenSSH_8.4p1"), Some((8, 4)));
        assert_eq!(parse_version("OpenSSH_for_Windows_9.5p1"), None);
        assert_eq!(parse_version("garbage"), None);
    }

    #[test]
    fn min_version_comparison() {
        assert!((8, 5) >= MIN_VERSION);
        assert!((10, 3) >= MIN_VERSION);
        assert!((8, 4) < MIN_VERSION);
    }
}
