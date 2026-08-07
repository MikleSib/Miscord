# AGENTS.md

## Cursor Cloud specific instructions

Miscord is a Discord-like chat app: a **FastAPI backend** (`backend/`, Python 3.11) and a
**Next.js 14 frontend** (`frontend/`, Node). It uses **PostgreSQL** (required) and **Redis** (optional).
General docs live in `README.md`; only the non-obvious, cloud-environment caveats are captured below.

### Services & how to run them (dev mode)

| Service | Port | Start command | Required |
|---|---|---|---|
| PostgreSQL 16 | 5432 | `sudo pg_ctlcluster 16 main start` | Yes |
| Redis 7 | 6379 | `sudo redis-server --daemonize yes` | No (see note) |
| Backend (FastAPI) | 8000 | `cd backend && ./venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000 --reload` | Yes |
| Frontend (Next.js) | 3000 | `cd frontend && npm run dev` | Yes |

PostgreSQL and Redis are **not auto-started** (no systemd in this VM). Start them at the beginning of a
session with the commands above. The `miscord` database, the `miscord_user` role (password
`miscord_password`), and the app tables persist in the VM snapshot; the backend also auto-creates any
missing tables on startup (`Base.metadata.create_all`), so no migration step is needed.

### Non-obvious caveats (important)

- **Python must be 3.11, not the system 3.12.** `requirements.txt` pins `aiortc==1.5.0`, which pulls an
  old `av`/PyAV that has no wheels anymore and does not compile against the system's ffmpeg 6. The
  backend `venv` is built with `python3.11` (installed from the deadsnakes PPA).
- **`aiortc` / `av` are intentionally NOT installed.** They are listed in `requirements.txt` but are
  never imported anywhere in the code (voice uses browser WebRTC + WebSocket signaling only). The
  update script installs everything from `requirements.txt` *except* those two lines, which keeps the
  environment installable. Do not try to "fix" this by installing `aiortc`.
- **`bcrypt` must be pinned to `4.0.1`.** `passlib==1.7.4` is incompatible with `bcrypt>=5`
  (registration/login 500s with `password cannot be longer than 72 bytes`). The update script installs
  `bcrypt==4.0.1` after the requirements.
- **Frontend needs `frontend/.env.local`** pointing at localhost:
  `NEXT_PUBLIC_API_URL=http://localhost:8000` and `NEXT_PUBLIC_WS_URL=ws://localhost:8000`. Without it,
  the code defaults to the hardcoded production host `https://miscord.ru`. This file is git-ignored
  (`.env*.local`), so it is not committed; the startup update script recreates it if missing. Real env
  vars (e.g. the Docker build args) still take precedence over this file, so production builds are
  unaffected.
- **Do not run `next build` while `next dev` is running.** They share `frontend/.next` and the dev
  server starts returning HTTP 500. If it happens, stop dev, `rm -rf frontend/.next`, and restart
  `npm run dev`. `next build` already runs type-checking + ESLint, so it doubles as the lint/type check.
- **Redis hostname is hardcoded** to `redis://redis:6379` in
  `backend/app/websocket/connection_manager.py` (it ignores `REDIS_URL`). For it to connect locally,
  add a hosts alias: `echo "127.0.0.1 redis" | sudo tee -a /etc/hosts`. This is optional — if Redis is
  unavailable the backend logs it and continues; single-instance text chat works via in-memory routing.

### Tests / lint / build

- **No automated test suite** exists (no pytest/jest config or test files).
- **Lint:** `cd frontend && npm run lint` (`next lint`) prompts for interactive first-time ESLint setup
  because no eslint config is committed; use `npm run build` instead, which type-checks and lints.
- **Build:** `cd frontend && npm run build`.

### Known pre-existing app bug (not an environment issue)

Sending a chat message over the WebSocket fails: `/ws/chat/{channel_id}` closes with
`'Depends' object has no attribute 'execute'`. The route wrapper in `backend/main.py` calls
`websocket_chat_endpoint(...)` directly, so its `db: AsyncSession = Depends(get_db)` parameter is never
injected. Auth, server/channel creation, and the REST API all work; only WS message send is broken in
the repo as-is. Do not treat this as a setup problem.
