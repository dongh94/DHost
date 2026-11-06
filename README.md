# DHost

여러 고객사의 Linux 서버에 안전하게 접속하고 작업하는 macOS용 SSH 데스크톱 클라이언트.

- 요구사항: [docs/DHost_PRD_v1.0.md](docs/DHost_PRD_v1.0.md)
- 분석·설계 메모: [docs/DHost_분석정리.md](docs/DHost_분석정리.md)
- SSH 엔진 스파이크 결과: [docs/spike_ssh_engine.md](docs/spike_ssh_engine.md)
- 정책 결정 기록: [docs/decisions.md](docs/decisions.md)

## 설치 (팀원)

[docs/install.md](docs/install.md) — macOS 12 이상, Apple Silicon. 배포 절차는 [docs/release.md](docs/release.md).

## 단축키

| 단축키 | 동작 |
|---|---|
| ⌘K, ⌘T | 서버 검색 (↑↓ 선택, Enter 접속) |
| ⌘W | 탭 닫기 (연결 중이면 확인) |
| ⌘R | 끊긴 탭 재접속 |
| ⌘1~⌘8, ⌘9 | n번째 탭, 마지막 탭 |
| ⌘⇧] / ⌘⇧[ | 다음 / 이전 탭 |
| ⌘+클릭 | 터미널 속 링크 열기 (확인 창) |

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

### 브라우저에서 화면만 확인

```bash
pnpm dev
```

`http://localhost:1420/?mock`을 열면 가상 데이터로 화면을 볼 수 있다. 실제 접속은 `pnpm tauri dev`로 띄운 앱에서만 된다.

### 테스트

```bash
# 프런트엔드 단위 테스트 (붙여넣기 위험 분석 등)
pnpm test

# Rust 단위 테스트
cd src-tauri && cargo test

# 실제 ssh + Docker 테스트 서버 E2E (dev/test-env/README.md 참고)
docker compose -f dev/test-env/docker-compose.yml up -d --build
cd src-tauri && cargo test --test e2e_docker -- --ignored --test-threads=1
```

## 구조

```
src/                  React 프런트엔드 (Docker Desktop형 레이아웃: 상단 검색, 왼쪽 내비, 하단 상태바)
  pages/              서버 목록, 세션, 호스트 키, 설정
  components/         헤더·내비·상태바, 대화상자, 공통 UI(ui/)
  stores/             Zustand 상태 (catalog, sessions, ui, settings)
  lib/                Tauri 호출(api.ts), 세션 연결, 터미널 보관, 개발용 가짜 백엔드(devMock.ts)
src-tauri/src/
  lib.rs              앱 진입점, 상태 등록
  commands.rs         프런트엔드에 노출하는 Tauri 명령
  error.rs            오류 타입
  db.rs               SQLite 저장소와 마이그레이션 (앱 데이터 폴더/dhost.db, 권한 0600)
  profiles.rs         고객사 > 폴더 > 서버 프로필, 단일 Jump Host 규칙
  ssh/                SSH 엔진 trait + OpenSSH 구현 (인자 구성, 입력값 검증, ssh -G)
  secrets.rs          비밀번호 저장소 (macOS 키체인)
  history.rs          접속 이력 (30일)
  meta.rs             세션별 상태 (비밀번호 시도, 취소, 결과 판단)
  diagnose.rs         연결 실패 원인과 해결 방법 (FUN-16)
  backup.rs           설정 백업·복원
  sshfiles.rs         ~/.ssh/known_hosts, ~/.ssh/config 읽기
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
