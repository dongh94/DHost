# 배포 절차 (관리자용)

## 자동 검사 (CI)
`main`에 푸시하거나 PR을 열면 GitHub Actions가 돌린다 ([.github/workflows/ci.yml](../.github/workflows/ci.yml)).

| 작업 | 내용 |
|---|---|
| 비밀 정보 검사 | `scripts/check-secrets.sh`(파일 이름·개인키·실서버 IP), gitleaks(전체 이력) |
| 빌드·테스트 | macOS Apple Silicon 러너: vitest, 타입 검사·빌드, `cargo fmt --check`, clippy(경고=실패), Rust 단위 테스트 |
| 의존성 취약점 | `cargo audit`, `pnpm audit --prod` |

Docker E2E는 macOS 러너에 Docker가 없어 CI에서 돌리지 않는다. 아래 배포 전 점검에서 로컬로 돌린다.

## 배포 전 점검
1. 로컬 E2E (실제 ssh + Docker 테스트 서버)
   ```bash
   docker compose -f dev/test-env/docker-compose.yml up -d --build
   cd src-tauri && cargo test --test e2e_docker -- --ignored --test-threads=1
   ```
2. 사전 테스트 기록(TEST-01~14)을 갱신한다.
3. `main`의 CI가 모두 통과했는지 확인한다.

## 배포
1. 버전을 올린다: `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `package.json`의 `version`을 같은 값으로.
2. 커밋 후 태그를 올린다.
   ```bash
   git tag v0.2.0
   git push origin v0.2.0
   ```
3. [Release 워크플로](../.github/workflows/release.yml)가 태그와 앱 버전이 같은지 확인하고, 테스트 후 `.dmg`와 `SHA256SUMS.txt`를 **초안(Draft) Release**로 올린다.
4. GitHub에서 초안 Release의 변경 내용을 적고 **Publish**한다. 팀에는 [설치 안내](install.md)를 함께 공유한다.

## 로컬에서 .dmg 만들기
```bash
pnpm tauri build --bundles dmg
# 결과: src-tauri/target/release/bundle/dmg/DHost_<버전>_aarch64.dmg
```

## 서명 정책
- 팀 내부 전용이라 Apple Developer 인증서 서명·공증은 하지 않는다 ([decisions.md](decisions.md) 배포 범위).
- 대신 ad-hoc 서명(`signingIdentity: "-"`)을 한다. Apple Silicon은 서명이 전혀 없는 앱을 실행하지 않는다.
