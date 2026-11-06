# DHost 설치 안내 (팀 내부)

DHost는 팀 안에서만 쓰는 앱이라 Apple 개발자 인증서로 서명·공증하지 않았습니다. 처음 열 때 macOS가 경고를 띄우는데, 아래 순서대로 한 번만 허용하면 됩니다.

## 지원 환경
- **macOS 12 Monterey 이상**, **Apple Silicon(M1~M4)** Mac
  - macOS 12부터 기본으로 들어 있는 OpenSSH 8.6 이상이 필요합니다. 앱이 `/usr/bin/ssh`를 그대로 씁니다.
  - Intel Mac용 빌드는 아직 만들지 않습니다. 필요하면 요청해 주세요.

## 설치
1. GitHub 저장소의 **Releases**에서 `DHost_<버전>_aarch64.dmg`를 내려받습니다.
2. (선택) 같은 Release의 `SHA256SUMS.txt`와 비교해 파일이 손상되지 않았는지 확인합니다.
   ```bash
   shasum -a 256 ~/Downloads/DHost_*_aarch64.dmg
   ```
3. `.dmg`를 열고 **DHost**를 **응용 프로그램(Applications)** 폴더로 끌어 놓습니다.

## 처음 열 때 경고 허용

### macOS 15 Sequoia 이상
1. 응용 프로그램 폴더에서 DHost를 엽니다. "Apple은 DHost에 악성 코드가 없음을 확인할 수 없습니다" 창이 뜨면 **완료**를 누릅니다.
2. **시스템 설정 → 개인정보 보호 및 보안**으로 가서 아래쪽 "DHost이(가) 차단되었습니다" 옆의 **그래도 열기**를 누릅니다.
3. Mac 암호를 입력하고, 다시 뜨는 창에서 **열기**를 누릅니다.

### macOS 12 ~ 14
- 응용 프로그램 폴더에서 DHost를 **Control+클릭(오른쪽 클릭) → 열기**를 누르고, 경고 창에서 다시 **열기**를 누릅니다.

### 위 방법이 안 될 때 (터미널)
"손상되었기 때문에 열 수 없습니다"라고 나오면 내려받을 때 붙은 격리 표시를 지웁니다. **팀 Release에서 받은 파일에만** 쓰세요.
```bash
xattr -dr com.apple.quarantine /Applications/DHost.app
```

## 업데이트
- 새 `.dmg`로 같은 방법으로 덮어 설치합니다. 서버 목록·설정·신뢰한 호스트 키는 그대로 남습니다 (`~/Library/Application Support/io.github.dongh94.dhost/`).
- 새 버전을 처음 열 때 위의 경고 허용을 다시 해야 할 수 있습니다.
- **키체인 접근 창:** 비밀번호를 저장해 둔 서버에 처음 접속하면 "DHost이(가) 키체인에 저장된 기밀 정보를 사용하려고 합니다" 창이 뜰 수 있습니다. 서명하지 않은 앱은 버전이 바뀌면 macOS가 다른 앱으로 보기 때문입니다. Mac 로그인 암호를 넣고 **항상 허용**을 누르면 됩니다.

## 지우기
1. 응용 프로그램 폴더에서 DHost를 휴지통으로 옮깁니다.
2. 데이터까지 지우려면 `~/Library/Application Support/io.github.dongh94.dhost/` 폴더를 지웁니다.
3. 저장한 비밀번호는 **키체인 접근** 앱에서 `io.github.dongh94.dhost`를 검색해 지웁니다.
