#!/bin/sh
set -e
# 컨테이너를 새로 만들 때마다 호스트 키가 새로 생성된다 (키 변경 시나리오 테스트용).
ssh-keygen -A
echo "dhost:${TEST_PASSWORD}" | chpasswd
echo "${HOSTNAME_LABEL:-$(hostname)}" > /etc/motd
exec /usr/sbin/sshd -D -e
