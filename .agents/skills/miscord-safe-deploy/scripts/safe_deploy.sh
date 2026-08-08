#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT="${COMPOSE_PROJECT_NAME:-miscord}"
PUBLIC_URL="${MISCORD_PUBLIC_URL:-https://miscord.ru}"
ROOT="${MISCORD_ROOT:-$(git rev-parse --show-toplevel)}"
COMPOSE=(docker compose -p "$PROJECT")

if (( $# == 0 )); then
  echo "usage: safe_deploy.sh <backend|frontend|nginx> [...]" >&2
  exit 64
fi

services=("$@")
for service in "${services[@]}"; do
  case "$service" in
    backend|frontend|nginx) ;;
    *) echo "unsupported service: $service" >&2; exit 64 ;;
  esac
done

cd "$ROOT"

diagnostics() {
  local exit_code=$?
  if (( exit_code != 0 )); then
    echo "deployment failed; bounded diagnostics follow" >&2
    "${COMPOSE[@]}" ps -a >&2 || true
    "${COMPOSE[@]}" logs --tail=100 "${services[@]}" >&2 || true
    "${COMPOSE[@]}" logs --tail=60 nginx >&2 || true
  fi
  exit "$exit_code"
}
trap diagnostics EXIT

echo "[1/7] validating compose configuration"
forbidden_brand="dis""cord"
if git grep -I -i -q "$forbidden_brand" -- . || git ls-files | grep -i -q "$forbidden_brand"; then
  echo "forbidden competitor branding found in tracked source" >&2
  exit 1
fi
"${COMPOSE[@]}" config --quiet

echo "[2/7] building replacement images while live services stay up"
"${COMPOSE[@]}" build "${services[@]}"

contains_service() {
  local wanted=$1 item
  for item in "${services[@]}"; do
    [[ "$item" == "$wanted" ]] && return 0
  done
  return 1
}

if contains_service backend; then
  echo "[3/7] importing backend in a disposable container"
  "${COMPOSE[@]}" run --rm --no-deps backend python -c "import main; print('backend import: ok')"
else
  echo "[3/7] backend preflight not required"
fi

if contains_service backend; then
  echo "[4/7] applying idempotent bot schema migration"
  "${COMPOSE[@]}" run --rm --no-deps backend python migrate_bot_phase4.py
  "${COMPOSE[@]}" run --rm --no-deps backend python migrate_bot_miscord_v10.py
else
  echo "[4/7] schema migration not required"
fi

echo "[5/7] replacing only requested services"
"${COMPOSE[@]}" up -d --no-deps --force-recreate "${services[@]}"

wait_for_service() {
  local service=$1 port=${2:-} deadline=$((SECONDS + 75))
  while (( SECONDS < deadline )); do
    local cid status health restarts
    cid=$("${COMPOSE[@]}" ps -q "$service")
    if [[ -z "$cid" ]]; then sleep 2; continue; fi
    status=$(docker inspect -f '{{.State.Status}}' "$cid")
    health=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$cid")
    restarts=$(docker inspect -f '{{.RestartCount}}' "$cid")
    if [[ "$status" == "exited" || "$status" == "dead" || "$status" == "restarting" || "$restarts" -gt 0 ]]; then
      echo "$service entered $status with $restarts restart(s)" >&2
      return 1
    fi
    if [[ "$status" == "running" && ( "$health" == "none" || "$health" == "healthy" ) ]]; then
      local ready=0
      if [[ -z "$port" ]]; then
        ready=1
      elif [[ "$service" == "frontend" ]]; then
        "${COMPOSE[@]}" exec -T frontend node -e "const s=require('net').connect($port,'127.0.0.1',()=>{s.end();process.exit(0)});s.on('error',()=>process.exit(1));setTimeout(()=>process.exit(1),5000)" >/dev/null 2>&1 && ready=1
      else
        "${COMPOSE[@]}" exec -T "$service" python -c "import socket; s=socket.create_connection(('127.0.0.1',$port),5); s.close()" >/dev/null 2>&1 && ready=1
      fi
      if (( ready == 1 )); then
        echo "$service readiness: ok"
        return 0
      fi
    fi
    sleep 2
  done
  echo "$service readiness timeout" >&2
  return 1
}

contains_service backend && wait_for_service backend 8000
contains_service frontend && wait_for_service frontend 3000

echo "[6/7] refreshing Nginx Docker upstream addresses"
if contains_service nginx; then
  wait_for_service nginx
else
  "${COMPOSE[@]}" restart nginx
  wait_for_service nginx
fi

echo "[7/7] checking public frontend, OAuth, API health, and Gateway"
root_code=$(curl -sS -o /dev/null --max-time 15 -w '%{http_code}' "$PUBLIC_URL/")
oauth_code=$(curl -sS -L -o /dev/null --max-time 15 -w '%{http_code}' "$PUBLIC_URL/oauth2/authorize")
api_code=$(curl -sS -o /dev/null --max-time 15 -w '%{http_code}' "$PUBLIC_URL/api/health")
[[ "$root_code" =~ ^[23][0-9][0-9]$ ]] || { echo "public root returned $root_code" >&2; exit 1; }
[[ "$oauth_code" == "200" ]] || { echo "public OAuth authorize page returned $oauth_code" >&2; exit 1; }
[[ "$api_code" == "200" ]] || { echo "public API health returned $api_code" >&2; exit 1; }

"${COMPOSE[@]}" exec -T backend python - <<'PY'
import asyncio
import json
import os

import websockets


async def probe() -> None:
    public_url = os.environ.get("MISCORD_PUBLIC_URL", "https://miscord.ru")
    gateway_url = public_url.replace("https://", "wss://", 1).replace("http://", "ws://", 1) + "/gateway?v=10&encoding=json"
    async with websockets.connect(gateway_url, open_timeout=10) as socket:
        payload = json.loads(await asyncio.wait_for(socket.recv(), timeout=10))
        if payload.get("op") != 10 or not isinstance(payload.get("d", {}).get("heartbeat_interval"), int):
            raise RuntimeError("Gateway did not return a valid HELLO payload")


asyncio.run(probe())
PY

trap - EXIT
echo "deployment accepted: root=$root_code oauth=$oauth_code api=$api_code gateway=hello"
