# 사전 테스트 기록 (TEST-01~14)

PRD 8장의 사전 테스트를 어떻게 확인했는지 기록한다. 자동 테스트는 다시 돌릴 수 있게 테스트 이름을 남긴다.

## 실행 환경 (2026-11-06)
| 항목 | 값 |
|---|---|
| Mac | Apple M2, macOS 27.0.1 |
| SSH | 시스템 OpenSSH_10.3p1 (`/usr/bin/ssh`) |
| 테스트 서버 | Docker 29.1.5, `dev/test-env` (bastion 127.0.0.1:2222, target은 bastion 경유 전용) |
| 기준 커밋 | `8034020` + 이 기록과 함께 커밋한 변경 |

다시 돌리는 방법:
```bash
pnpm test                                   # 프런트 단위 테스트 (vitest)
cd src-tauri && cargo test                  # Rust 단위 테스트
docker compose -f ../dev/test-env/docker-compose.yml up -d --build
cargo test --test e2e_docker -- --ignored --test-threads=1   # 실제 ssh E2E
```
결과: vitest 20개, Rust 단위 27개, E2E 15개 모두 통과.

## 판정 기준
- ✅ **자동**: 테스트 코드로 확인. 이름을 적어 둔다.
- ✅ **미리보기**: `pnpm dev` + `?mock` 화면에서 직접 조작해 확인.
- ⬜ **앱 수동**: 설치한 앱에서 사람이 확인해야 한다. 아래 [수동 확인 목록](#수동-확인-목록)에 적는다.

## 결과 요약
| ID | 시나리오 | 판정 | 근거 |
|---|---|---|---|
| TEST-01 | 시스템·수동 테마 변경 | ⬜ 앱 수동 | 테마를 바꿔도 터미널을 다시 만들지 않는 구조(`setAllThemes`). 연결된 세션 유지는 앱에서 확인 필요 |
| TEST-02 | 한국어 UI 주요 흐름 | ✅ 미리보기 | 서버 관리·접속·설정·백업·이력 화면 모두 한국어. 앱에서 한 번 더 확인 |
| TEST-03 | 백업 → 내용 검사 → 복원 | ✅ 자동 | 아래 상세 |
| TEST-04 | 실행 후 자동 접속 없음 | ✅ 미리보기 + 코드 | 아래 상세 |
| TEST-05 | 미등록 호스트 승인 거부 | ✅ 자동 | `rejected_host_key_never_authenticates` |
| TEST-06 | 등록 호스트 키 변경 시 차단 | ✅ 자동 | `direct_first_connect_then_reconnect_then_key_change` |
| TEST-07 | 인증 방식별 성공·실패 | ✅ 자동 (일부 제한) | 아래 상세 |
| TEST-08 | 한글·ANSI·vim·top·less | 한글·ANSI ✅ 자동 / 대화형 ⬜ 앱 수동 | `multibyte_and_ansi_pass_through` |
| TEST-09 | 세션 하나 끊김, 수동 재접속 | ✅ 자동 | `one_session_drop_keeps_others_and_no_auto_reconnect` |
| TEST-10 | 여러 줄·제어문자 붙여넣기 취소 | ✅ 자동 + 미리보기 | `paste.test.ts` |
| TEST-11 | 설정 유지, 저장 데이터 검사 | ✅ 자동 + 실제 데이터 검사 | 아래 상세. **점검 중 문제 1건 발견·수정** |
| TEST-12 | 원격 출력의 클립보드 변경 시도 | ✅ 미리보기 | 아래 상세 |
| TEST-13 | 단일 Jump Host 경유 접속 | ✅ 자동 | `jump_host_verifies_both_hops`, `diagnoses_network_failures` |
| TEST-14 | M2 설치·실행·종료, 반복 연결 | 반복 연결 ✅ 자동 / 설치·종료 ⬜ 앱 수동 | `repeated_connect_close_leaks_nothing` |

## 상세

### TEST-03 백업·복원
- `backup::tests::backup_has_no_secrets_and_round_trips`: 백업 파일에 비밀번호·개인키·접속 이력이 없고, 복원하면 같은 목록이 된다.
- `backup::tests::rejects_bad_files_and_entries`: 형식·버전·크기·주소(옵션 주입) 검사. 문제 항목은 건너뛴다.
- `backup::tests::host_key_conflict_is_not_overwritten`, `replace_mode_clears_existing`
- 복원 후 자동 접속 없음: 복원 코드는 목록만 다시 읽고 접속 함수를 부르지 않는다. 복원 결과 창에도 "자동으로 접속하지 않습니다"라고 표시한다.

### TEST-04 자동 접속 없음
- 미리보기에서 앱을 처음 열었을 때 상태 표시줄 "세션 0개 연결됨", 열린 탭 없음을 확인했다.
- 접속 함수(`connectServer`, `quickConnect`)는 연결 버튼·행 더블클릭·검색창 Enter·재접속 버튼에서만 불린다. 시작할 때는 설정과 서버 목록만 읽는다.
- 끊긴 세션이 저절로 다시 붙지 않는 것은 TEST-09 자동 테스트에서 함께 확인한다.

### TEST-07 인증
| 방식 | 결과 | 테스트 |
|---|---|---|
| 비밀번호 성공 | ✅ | `save_then_autofill_password` 외 다수 |
| 비밀번호 틀림 → 다시 묻고, 끝내 실패하면 세션 없음 | ✅ | `diagnoses_wrong_password_and_skips_cancel`, `wrong_password_saved_is_not_kept` |
| 저장된 비밀번호가 틀림 → 지우고 다시 물음 | ✅ | `wrong_saved_password_is_removed_and_reprompted` |
| 인증 창 취소 → 다시 묻지 않고 종료 | ✅ | `cancel_password_stops_without_reprompt` |
| SSH Agent의 키 (비밀번호 없이) | ✅ | `agent_key_auth_without_password`: 테스트용 키를 만들어 Agent에 넣고, 비밀번호 질문은 취소하게 해 두어도 접속된다 |
| 개인키 파일 / 키 암호(passphrase) / 키보드 대화형 | ⚠️ 별도 테스트 없음 | 모두 같은 askpass 경로로 입력을 받는다. 키 파일은 `~/.ssh/config`의 `IdentityFile`과 기본 키(`~/.ssh/id_*`)를 쓴다 |

**제한:** 서버마다 개인키 파일을 골라 지정하는 화면은 아직 없다. 지금은 `~/.ssh/config`에 적어 두면 그 설정을 따른다.

### TEST-11 저장 데이터 검사
- 설정 저장·검증: `settings::tests::set_get_reset`. 허용하지 않은 키(예: `password`)는 저장을 거부한다.
- 권한: `db::tests::data_dir_and_db_are_private`. 폴더 0700, DB 0600.
- **실제 앱 데이터 검사**(`~/Library/Application Support/io.github.dongh94.dhost/`, 읽기 전용):
  - 파일: `dhost.db`, `-wal`, `-shm` 모두 0600
  - 테이블: customers, folders, servers, host_keys, settings, connection_history. 비밀번호·토큰·개인키를 담는 열이 없다. `host_keys`는 서버의 **공개키**다.
  - DB와 WAL 파일에 `PRIVATE KEY` 문자열 없음
  - 비밀번호는 macOS 키체인(`io.github.dongh94.dhost`)에만 있다.
- **발견·수정:** 데이터 폴더 권한이 0755여서 다른 사용자 계정이 파일 이름을 볼 수 있었다 (상위 폴더가 0700이라 실제로 열 수는 없었음). 앱이 시작할 때 폴더를 0700으로 맞추도록 고쳤다.

### TEST-12 원격 클립보드 변경 차단
- 미리보기에서 원격 출력에 OSC 52 클립보드 쓰기(`ESC ] 52 ; c ; <base64> BEL`)와 창 제목 변경(`ESC ] 0`)을 섞어 보냈다.
- 결과: 클립보드 API(`writeText`, `write`, copy 이벤트, `execCommand`)가 한 번도 불리지 않았고, 창 제목도 바뀌지 않았으며, 시퀀스가 화면에 찍히지도 않았다.
- 이유: xterm.js는 클립보드 애드온을 붙여야만 OSC 52를 처리하는데, DHost는 붙이지 않는다. 창 조작 요청(`windowOptions`)도 모두 끈다 (decisions.md GAP-04).

### TEST-14 반복 연결
- `repeated_connect_close_leaks_nothing`: 접속 → 명령 → 종료를 20번 반복한다 (사용자가 탭 닫기 10번, 원격 `exit` 10번). 끝난 뒤 남은 ssh 프로세스가 없고 파일 핸들도 늘지 않았다.
- `close_kills_ssh_process`: 탭을 닫으면 ssh 프로세스가 끝난다.
- `flow_control_pauses_output_and_keeps_input`: 대량 출력 중에도 Ctrl+C가 들어간다.

## 수동 확인 목록
설치한 앱(`.dmg`)에서 확인하고, 확인한 날짜와 결과를 적는다.

| ID | 확인할 것 | 결과 | 날짜·확인자 |
|---|---|---|---|
| TEST-01 | 세션을 연 채로 설정에서 라이트/다크/시스템을 바꾸고, macOS 시스템 화면 모드도 바꾼다. 세션이 끊기지 않고 터미널 색이 바뀐다 | | |
| TEST-02 | 서버 추가 → 접속 → 설정 변경 → 백업까지 한국어로 막힘 없이 된다 | | |
| TEST-08 | 실서버(또는 테스트 서버)에서 `vim`(입력·저장·종료), `top`(갱신·`q`), `less`(스크롤·검색·`q`), 한글 입력·출력 | | |
| TEST-14 | `.dmg` 설치 → 경고 허용 후 실행 → 여러 세션 연결 → ⌘Q 종료. 종료 후 `pgrep -fl "dhost-known-hosts"`에 남은 ssh가 없다. 다시 실행해 목록·설정이 남아 있다 | | |
