# 로컬 SSH 테스트 환경

Docker로 SSH 서버 두 대를 띄운다. 실서버가 아니라 가상 테스트 값만 쓴다.

| 이름 | 접속 | 용도 |
|---|---|---|
| bastion | `127.0.0.1:2222` | 직접 접속, Jump Host |
| target | `127.0.0.1:2223` (직접) / bastion에서 `target:22` | 경유 접속 대상 |

계정은 `dhost`, 비밀번호는 `docker-compose.yml`의 `TEST_PASSWORD` 값이다.

```bash
docker compose -f dev/test-env/docker-compose.yml up -d --build
```

호스트 키 변경 시나리오: 컨테이너를 새로 만들면 키가 바뀐다.

```bash
docker compose -f dev/test-env/docker-compose.yml up -d --force-recreate bastion
```
