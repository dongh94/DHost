#!/usr/bin/env bash
# 비밀 정보·실서버 정보가 저장소에 들어가지 않았는지 검사한다 (PRD SEC-P07).
#
#   scripts/check-secrets.sh           # 추적 중인 모든 파일 (CI)
#   scripts/check-secrets.sh --staged  # 커밋하려고 스테이징한 변경만
#
# 허용하는 IP: 127.0.0.1, 0.0.0.0, 문서용 대역 192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

fail=0
report() { echo "✗ $1"; fail=1; }

# 잠금 파일·이미지 등은 내용 검사에서 뺀다.
skip='(^|/)(pnpm-lock\.yaml|Cargo\.lock)$|\.(png|icns|ico|jpg|svg)$'

if [[ "${1:-}" == "--staged" ]]; then
  files=$(git diff --cached --name-only --diff-filter=ACMR)
  content() { git diff --cached -U0 -- "$1" | grep '^+' | grep -v '^+++' || true; }
else
  files=$(git ls-files)
  content() { cat -- "$1"; }
fi

# 1) 파일 이름
bad_names='(^|/)(id_rsa|id_ed25519|id_ecdsa|id_dsa)[^/]*$|\.(pem|key|ppk|p12|pfx|db|sqlite|dhost-backup)$|(^|/)known_hosts[^/]*$|(^|/)\.env(\.[^/]*)?$'
while IFS= read -r f; do
  [[ -z "$f" ]] && continue
  [[ "$f" == ".env.example" || "$f" == */.env.example ]] && continue
  if [[ "$f" =~ $bad_names ]]; then report "비밀 정보로 보이는 파일: $f"; fi
done <<< "$files"

# 2) 내용: 개인키, 허용되지 않은 IP
allowed_ip='^(127\.0\.0\.1|0\.0\.0\.0|192\.0\.2\.[0-9]{1,3}|198\.51\.100\.[0-9]{1,3}|203\.0\.113\.[0-9]{1,3})$'
while IFS= read -r f; do
  [[ -z "$f" || ! -f "$f" ]] && continue
  [[ "$f" =~ $skip ]] && continue
  [[ "$f" == "scripts/check-secrets.sh" ]] && continue
  text=$(content "$f" | LC_ALL=C tr -d '\000') || continue
  if grep -qE -- '-----BEGIN ([A-Z]+ )?PRIVATE KEY-----' <<< "$text"; then
    report "개인키가 들어 있음: $f"
  fi
  # 숫자.숫자.숫자.숫자 중 앞뒤가 숫자·점이 아닌 것만 IP로 본다 (버전 문자열 1.2.3.4.5 제외)
  ips=$(grep -oE '(^|[^0-9.])([0-9]{1,3}\.){3}[0-9]{1,3}($|[^0-9.])' <<< "$text" \
        | grep -oE '([0-9]{1,3}\.){3}[0-9]{1,3}' | sort -u || true)
  for ip in $ips; do
    if ! [[ "$ip" =~ $allowed_ip ]]; then report "허용되지 않은 IP $ip: $f"; fi
  done
done <<< "$files"

if [[ $fail -ne 0 ]]; then
  echo "비밀 정보 검사 실패. 테스트용 값은 192.0.2.x 같은 문서용 대역을 쓰세요."
  exit 1
fi
echo "✓ 비밀 정보 검사 통과"
