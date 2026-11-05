# DHost

여러 고객사의 Linux 서버에 안전하게 접속하고 작업하는 macOS용 SSH 데스크톱 클라이언트.

- 요구사항: [docs/DHost_PRD_v1.0.md](docs/DHost_PRD_v1.0.md)
- 분석·설계 메모: [docs/DHost_분석정리.md](docs/DHost_분석정리.md)
- SSH 엔진 스파이크 결과: [docs/spike_ssh_engine.md](docs/spike_ssh_engine.md)

## 기술 스택

Tauri 2 · Rust · React 19 · TypeScript · Vite · Tailwind CSS 4 · xterm.js · Zustand
SSH 엔진: 시스템 OpenSSH(`/usr/bin/ssh`, 8.5 이상)

## 개발 환경

- macOS (Apple Silicon), Xcode Command Line Tools
- Rust stable (`rustup`)
- Node.js 20+, pnpm

```bash
pnpm install
pnpm tauri dev
```

### 테스트

```bash
# 단위 테스트
cd src-tauri && cargo test

# 실제 ssh + Docker 테스트 서버 E2E (dev/test-env/README.md 참고)
docker compose -f dev/test-env/docker-compose.yml up -d --build
cd src-tauri && cargo test --test e2e_docker -- --ignored --test-threads=1
```

## 구조

```
src/                  React 프런트엔드
  components/         Sidebar, TerminalView, StatusBar
  stores/             Zustand 상태
  lib/                Tauri 호출(api.ts), 테마 훅
src-tauri/src/
  lib.rs              앱 진입점, 상태 등록
  commands.rs         프런트엔드에 노출하는 Tauri 명령
  error.rs            오류 타입
  ssh/                SSH 엔진 trait + OpenSSH 구현 (인자 구성, 입력값 검증)
  session.rs          PTY 세션 관리
  ipc.rs              helper ↔ 앱 Unix 소켓 통신, 호스트 키 판단
  helper.rs           ssh가 실행하는 helper 모드 (KnownHostsCommand, SSH_ASKPASS)
  hostkeys.rs         신뢰한 호스트 키 저장소
  events.rs           화면으로 보내는 이벤트
src-tauri/tests/      Docker E2E 테스트
dev/test-env/         로컬 SSH 테스트 서버 (가상 값)
docs/                 PRD, 설계 문서, 스파이크 결과
```

## 보안 규칙

실서버 IP, 계정, 비밀번호, 개인키, known_hosts를 커밋하지 않는다. 예제에는 가상 값(`example.com`, `192.0.2.0/24`)만 쓴다.
