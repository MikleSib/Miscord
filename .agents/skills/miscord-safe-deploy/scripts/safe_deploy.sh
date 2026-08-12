#!/usr/bin/env bash
set -Eeuo pipefail

PUBLIC_URL="${MISCORD_PUBLIC_URL:-https://miscord.ru}"
SMOKE_URL="${MISCORD_SMOKE_URL:-$PUBLIC_URL}"
GATEWAY_URL="${MISCORD_GATEWAY_URL:-$PUBLIC_URL}"
ROOT="${MISCORD_ROOT:-$(git rev-parse --show-toplevel)}"
COMPOSE=(docker compose)
if [[ -n "${COMPOSE_PROJECT_NAME:-}" ]]; then
  COMPOSE+=(-p "$COMPOSE_PROJECT_NAME")
fi

if (( $# == 0 )); then
  echo "usage: safe_deploy.sh <backend|frontend|voice-media|nginx> [...]" >&2
  exit 64
fi

services=("$@")
for service in "${services[@]}"; do
  case "$service" in
    backend|frontend|voice-media|nginx) ;;
    *) echo "unsupported service: $service" >&2; exit 64 ;;
  esac
done

cd "$ROOT"

if [[ -z "${TURN_EXTERNAL_IP:-}" ]]; then
  echo "TURN_EXTERNAL_IP must be set for a production deployment" >&2
  exit 64
fi

if [[ -z "${VOICE_MEDIA_ANNOUNCED_ADDRESS:-}" ]]; then
  echo "VOICE_MEDIA_ANNOUNCED_ADDRESS must be set for a production deployment" >&2
  exit 64
fi

if [[ -z "${VOICE_MEDIA_JWT_SECRET:-}" || "${VOICE_MEDIA_JWT_SECRET}" == *change-me* ]]; then
  echo "VOICE_MEDIA_JWT_SECRET must be set to a non-development value" >&2
  exit 64
fi

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

if contains_service voice-media; then
  echo "[3/7] preflighting mediasoup in a disposable Node container"
  "${COMPOSE[@]}" run --rm --no-deps voice-media node dist/preflight.js
fi

if contains_service backend; then
  echo "[4/7] applying Alembic and legacy idempotent schema migrations"
  "${COMPOSE[@]}" run --rm --no-deps backend alembic upgrade head
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
      elif [[ "$service" == "voice-media" ]]; then
        "${COMPOSE[@]}" exec -T voice-media node -e "fetch('http://127.0.0.1:$port/readyz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1 && ready=1
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
contains_service voice-media && wait_for_service voice-media 3001

echo "[6/7] refreshing Nginx Docker upstream addresses"
if contains_service nginx; then
  wait_for_service nginx
else
  "${COMPOSE[@]}" restart nginx
  wait_for_service nginx
fi

echo "[7/7] checking public frontend, OAuth, API health, and Gateways"
root_code=$(curl -sS -o /dev/null --max-time 15 -w '%{http_code}' "$SMOKE_URL/")
oauth_code=$(curl -sS -L -o /dev/null --max-time 15 -w '%{http_code}' "$SMOKE_URL/oauth2/authorize")
api_code=$(curl -sS -o /dev/null --max-time 15 -w '%{http_code}' "$SMOKE_URL/api/v1/health")
[[ "$root_code" =~ ^[23][0-9][0-9]$ ]] || { echo "public root returned $root_code" >&2; exit 1; }
[[ "$oauth_code" == "200" ]] || { echo "public OAuth authorize page returned $oauth_code" >&2; exit 1; }
[[ "$api_code" == "200" ]] || { echo "public API health returned $api_code" >&2; exit 1; }

gateway_host=$(python3 -c 'import sys; from urllib.parse import urlparse; print(urlparse(sys.argv[1]).hostname or "")' "$GATEWAY_URL")
if [[ -z "$gateway_host" ]]; then
  echo "unable to determine Gateway host from MISCORD_GATEWAY_URL" >&2
  exit 1
fi

# The backend service shares a Docker network alias with the public hostname.
# Run the probe image on the host network so WSS reaches host TLS instead of
# the internal HTTP-only Nginx listener.
backend_probe_image=$("${COMPOSE[@]}" images -q backend | head -n 1)
if [[ -z "$backend_probe_image" ]]; then
  echo "unable to determine the backend image for Gateway probes" >&2
  exit 1
fi
docker run --rm -i --network host \
  -e MISCORD_GATEWAY_URL="$GATEWAY_URL" \
  "$backend_probe_image" python - <<'PY'
import asyncio
import json
import os

import websockets


async def probe() -> None:
    public_url = os.environ.get("MISCORD_GATEWAY_URL", "https://miscord.ru")
    websocket_base = public_url.replace("https://", "wss://", 1).replace("http://", "ws://", 1)
    gateway_url = websocket_base + "/gateway?v=1&encoding=json"
    async with websockets.connect(gateway_url, open_timeout=10) as socket:
        payload = json.loads(await asyncio.wait_for(socket.recv(), timeout=10))
        if payload.get("op") != 10 or not isinstance(payload.get("d", {}).get("heartbeat_interval"), int):
            raise RuntimeError("Gateway did not return a valid HELLO payload")

    voice_gateway_url = websocket_base + "/ws/voice-gateway?v=1"
    async with websockets.connect(voice_gateway_url, open_timeout=10) as socket:
        payload = json.loads(await asyncio.wait_for(socket.recv(), timeout=10))
        if payload.get("op") != 8 or not isinstance(payload.get("d", {}).get("heartbeat_interval"), int):
            raise RuntimeError("Voice Gateway did not return a valid HELLO payload")


asyncio.run(probe())
PY

trap - EXIT
echo "deployment accepted: root=$root_code oauth=$oauth_code api=$api_code gateway=hello voice_gateway=hello"
