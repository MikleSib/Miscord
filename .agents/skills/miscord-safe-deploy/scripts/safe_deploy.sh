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

echo "[1/6] validating compose configuration"
"${COMPOSE[@]}" config --quiet

echo "[2/6] building replacement images while live services stay up"
"${COMPOSE[@]}" build "${services[@]}"

contains_service() {
  local wanted=$1 item
  for item in "${services[@]}"; do
    [[ "$item" == "$wanted" ]] && return 0
  done
  return 1
}

if contains_service backend; then
  echo "[3/6] importing backend in a disposable container"
  "${COMPOSE[@]}" run --rm --no-deps backend python -c "import main; print('backend import: ok')"
else
  echo "[3/6] backend preflight not required"
fi

echo "[4/6] replacing only requested services"
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

echo "[5/6] refreshing Nginx Docker upstream addresses"
if contains_service nginx; then
  wait_for_service nginx
else
  "${COMPOSE[@]}" restart nginx
  wait_for_service nginx
fi

echo "[6/6] checking public frontend and API proxy"
root_code=$(curl -sS -o /dev/null --max-time 15 -w '%{http_code}' "$PUBLIC_URL/")
api_code=$(curl -sS -o /dev/null --max-time 15 -w '%{http_code}' "$PUBLIC_URL/api/health")
[[ "$root_code" =~ ^[23][0-9][0-9]$ ]] || { echo "public root returned $root_code" >&2; exit 1; }
[[ "$api_code" != "000" && "$api_code" -lt 500 ]] || { echo "public API returned $api_code" >&2; exit 1; }

trap - EXIT
echo "deployment accepted: root=$root_code api=$api_code"
