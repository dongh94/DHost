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
2. [사전 테스트 기록](test-record.md)(TEST-01~14)을 갱신한다. 특히 맨 아래 수동 확인 목록.
3. `main`의 CI가 모두 통과했는지 확인한다.

## 처음 한 번: 업데이트 서명 키 등록
앱 안 업데이트는 **업데이트 서명 키**로 서명된 파일만 설치한다. Apple 인증서와는 별개이고 무료다.

- 키 위치: `~/.tauri/dhost-updater.key`(비밀키), `~/.tauri/dhost-updater.key.pub`(공개키). 저장소에는 넣지 않는다. 공개키만 `src-tauri/tauri.conf.json`의 `plugins.updater.pubkey`에 들어 있다.
- 비밀키를 GitHub에 등록한다:
  1. 비밀키를 클립보드로 복사한다.
     ```bash
     pbcopy < ~/.tauri/dhost-updater.key
     ```
  2. GitHub 저장소 → **Settings → Secrets and variables → Actions → New repository secret**
  3. Name: `TAURI_SIGNING_PRIVATE_KEY`, Secret: 붙여넣기 → **Add secret**
  4. 이 키는 암호 없이 만들었으므로 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`는 만들지 않아도 된다.
- **비밀키를 따로 백업한다** (비밀번호 관리자 등). 잃어버리면 새 키를 만들어야 하고, 그 전 버전을 설치한 팀원은 앱 안 업데이트를 못 받아 `.dmg`로 한 번 다시 설치해야 한다.
- 비밀키가 유출되면 키를 새로 만들고 위와 같이 공개키·Secret을 바꾼 뒤, 팀원에게 새 버전을 `.dmg`로 다시 설치하게 한다.

## 배포
고칠 버전은 **`src-tauri/tauri.conf.json`의 `version`**이다. 앱 정보 창, 파일 이름, 업데이트 비교에 쓰인다. `src-tauri/Cargo.toml`과 `package.json`의 `version`도 같은 값으로 맞춘다.

1. 버전을 올리고 커밋·push한다.
   ```bash
   git commit -am "v0.2.0"
   git push origin main
   ```
2. 태그를 올린다. **태그 push가 Release 워크플로를 시작한다.** (`main` push만으로는 배포되지 않는다.)
   ```bash
   git tag v0.2.0
   git push origin v0.2.0
   ```
3. [Release 워크플로](../.github/workflows/release.yml)가 약 10분 동안 돈다: 태그와 앱 버전 확인 → 서명 키 확인 → 비밀 정보 검사 → 테스트 → 빌드 → **초안(Draft) Release** 생성.
   - 올라가는 파일: `DHost_<버전>_aarch64.dmg`(처음 설치용), `DHost_<버전>_aarch64.app.tar.gz`와 `.sig`(앱 안 업데이트용), `latest.json`(설치된 앱이 읽는 버전 정보), `SHA256SUMS.txt`
   - 변경 내용은 이전 태그 이후 커밋 제목으로 자동으로 채운다.
4. GitHub **Releases**에서 초안을 열어(관리자 계정으로 로그인해야 보인다) 변경 내용을 다듬고 **Publish release**를 누른다.
   - Publish 전에는 팀원 앱이 새 버전을 알아채지 못한다. 앱은 "최신 공개 Release"의 `latest.json`만 읽는다.
5. 팀에 알린다. 이미 설치한 팀원은 앱 아래쪽 **새 버전 업데이트** 버튼(또는 설정 → 앱 업데이트)으로 업데이트한다. 새로 설치하는 팀원에게는 [설치 안내](install.md)를 준다.

## 로컬에서 .dmg 만들기
업데이트 파일도 함께 만들도록 설정돼 있어서 서명 키가 필요하다.
```bash
TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/dhost-updater.key)" pnpm tauri build --bundles app,dmg
# 결과: src-tauri/target/release/bundle/dmg/DHost_<버전>_aarch64.dmg
```

## 서명 정책
- 팀 내부 전용이라 Apple Developer 인증서 서명·공증은 하지 않는다 ([decisions.md](decisions.md) 배포 범위).
- 대신 ad-hoc 서명(`signingIdentity: "-"`)을 한다. Apple Silicon은 서명이 전혀 없는 앱을 실행하지 않는다.
