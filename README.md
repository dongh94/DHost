# DHost

여러 고객사의 Linux 서버에 안전하게 접속하고 작업하는 macOS용 SSH 데스크톱 클라이언트.

- 요구사항: [docs/DHost_PRD_v1.0.md](docs/DHost_PRD_v1.0.md)
- 분석·설계 메모: [docs/DHost_분석정리.md](docs/DHost_분석정리.md)

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
  ssh/                SSH 엔진 trait + OpenSSH 구현
docs/                 PRD, 설계 문서
```

## 보안 규칙

실서버 IP, 계정, 비밀번호, 개인키, known_hosts를 커밋하지 않는다. 예제에는 가상 값(`example.com`, `192.0.2.0/24`)만 쓴다.
