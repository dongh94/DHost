# SSH 엔진 검증 스파이크 결과

작성일: 2026-11-05 · 환경: macOS 27.0.1 (M2), OpenSSH_10.3p1, Docker 테스트 서버(`dev/test-env`)

## 결론

**시스템 OpenSSH + PTY 방식으로 MVP·v1.0을 진행할 수 있다.** 검증하려던 다섯 가지 모두 실제 ssh와 테스트 서버로 통과했다.

## 구조

```
React(xterm.js) ── invoke / Channel(raw bytes) / events ── Rust(Tauri)
                                                             │ PTY
                                                             ▼
                                                     /usr/bin/ssh
                                     KnownHostsCommand │   │ SSH_ASKPASS
                                                       ▼   ▼
                                    dhost(helper 모드) ── Unix 소켓(0600, 폴더 0700) ── Broker
```

- ssh가 호스트 키 확인·비밀번호 입력이 필요할 때 DHost 실행 파일을 helper 모드로 다시 실행한다.
- helper는 세션 토큰과 함께 앱에 요청하고, 앱은 화면에서 사용자 응답을 받아 돌려준다.
- 앱과 통신할 수 없으면 helper가 실패하고, 그러면 ssh가 연결을 중단한다 (fail-closed).

### 강제로 거는 ssh 옵션

| 옵션 | 이유 |
|---|---|
| `StrictHostKeyChecking=yes` | 승인되지 않은 키로는 절대 연결하지 않는다 |
| `UserKnownHostsFile=none`, `GlobalKnownHostsFile=none`, `UpdateHostKeys=no` | 호스트 키 신뢰를 DHost 저장소만으로 판단한다 |
| `KnownHostsCommand="<dhost>" --dhost-known-hosts %I %H %t %K %f` | 접속할 때 제시된 키를 앱에 전달한다 |
| `ControlMaster=no`, `ControlPath=none` | 세션끼리 연결을 공유하지 않는다 (FUN-06) |
| `ProxyJump=none` (경유 없음) | 사용자 ssh_config의 ProxyJump가 끼어들어 검증을 우회하지 못하게 한다 |
| `ProxyCommand=/usr/bin/ssh <같은 옵션> -W [%h]:%p <jump>` (경유) | `-J`는 `-o` 옵션을 경유용 ssh에 넘기지 않아서 직접 구성한다 |
| 환경변수 `SSH_ASKPASS=<dhost>`, `SSH_ASKPASS_REQUIRE=force` | 비밀번호를 TTY가 아니라 DHost 입력창으로 받는다 |

## 검증 결과

`cargo test --test e2e_docker -- --ignored --test-threads=1` (실제 ssh + Docker)

| 시나리오 | 결과 |
|---|---|
| 최초 접속: 승인 창 1회, 비밀번호 1회, `whoami`·`hostname`·`uptime` 실행 | 통과 |
| 재접속: 저장된 키라서 승인 창 없이 비밀번호만 | 통과 |
| 저장된 키와 다른 키: `hostkey-changed` 이벤트, 비밀번호를 묻지 않고 종료 코드 255 | 통과 |
| 승인 거절: 인증 단계로 가지 않고, 키도 저장하지 않음 | 통과 |
| Jump Host 경유: 경유·대상 서버 각각 승인과 비밀번호, 두 키 모두 저장 | 통과 |
| 세션 닫기: ssh 프로세스 종료, 종료 이벤트 수신 | 통과 |
| 한글·ANSI 색상 출력이 그대로 전달 | 통과 |
| 부모 프로세스 `kill -9`: PTY가 닫히면서 ssh도 종료 (`examples/hold_session.rs`) | 통과 |
| 비정상 종료로 남은 소켓 폴더: 다음 실행 때 정리 | 통과 |

단위 테스트 5개: 버전 해석, 최소 버전 비교, 입력값 검증(옵션·셸 주입 차단), 직접 접속 인자, 경유 ProxyCommand 이스케이프

### 아직 확인하지 못한 것
- **GUI 상호작용**: 화면의 승인·비밀번호 대화상자, 탭, 재접속, vim/top/less는 사람이 직접 확인해야 한다.
- 키보드 대화형 인증(OTP 등): 테스트 서버(Alpine, PAM 없음)에서는 재현하지 못했다. askpass 경로를 그대로 쓰므로 동작할 것으로 보이지만 미검증이다.
- 개인키 암호(passphrase)와 SSH Agent: 미검증이다.
- 오류 진단(FUN-16): 지금은 ssh가 출력하는 메시지를 터미널에 그대로 보여준다.

## 결정이 필요한 정책

1. **사용자 `~/.ssh/known_hosts` 무시**: 스파이크는 DHost 저장소만 쓴다. 기존 키를 가져올지 정해야 한다.
2. **사용자 ssh_config의 ProxyJump 무시**: 검증 우회를 막으려고 강제로 끈다. FUN-14(기존 SSH 설정 활용)와 충돌하므로 OPEN-01에서 정해야 한다.
3. **호스트 키 저장소**: 지금은 앱 데이터 폴더의 `known_hosts.json`이다. OPEN-09 결정에 따라 옮긴다.
4. **승인 대기 시간**: 5분이 지나면 거절로 처리한다.
