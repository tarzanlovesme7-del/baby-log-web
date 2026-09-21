#!/bin/bash
# 스위트 하나 돌리기:  bash tests/run.sh <이름> [지연ms]
# 느린 서버가 필요하면 지연ms를 준다(응답을 일부러 늦춘 서버에서만 드러나는
# 버그가 있다 — 낙관적 UI가 진짜 낙관적인지는 빠른 서버로 물어볼 수 없다).
#
# 스위트는 반드시 이 폴더(저장소 안)에 둔다. 2026-09-21에 /tmp에 두었다가
# 컨테이너가 회수되면서 스위트 전체를 잃었다. 앱 소스는 zip으로 살아남았고
# 테스트만 사라졌다 — 같은 실수를 반복하지 않으려고 여기로 옮겼다.
cd "$(dirname "$0")/.." || exit 1
pkill -f "[m]ock_server.js" >/dev/null 2>&1
sleep 1
if [ -n "$2" ]; then
  ( MUTATE_DELAY_MS="$2" setsid node mock_server.js > /tmp/m_$1.log 2>&1 < /dev/null & )
else
  ( setsid node mock_server.js > /tmp/m_$1.log 2>&1 < /dev/null & )
fi
sleep 3
timeout 400 node "tests/$1.js" 2>&1
pkill -f "[m]ock_server.js" >/dev/null 2>&1
exit 0
