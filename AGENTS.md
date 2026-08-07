# AGENTS.md

## Cursor Cloud specific instructions

Miscord (актуальная ветка разработки — **`new-4`**) — Discord-подобный чат:
**FastAPI** backend (`backend/`, Python **3.11**) + **Next.js 14** frontend (`frontend/`) +
**PostgreSQL 16** + **Redis 7**. Полные инструкции: `LOCAL-DEVELOPMENT.md`, `QUICK-START.md`,
`start-local-dev.sh` / `stop-local-dev.sh`. Ниже — только неочевидные нюансы для Cloud Agent.

### Сервисы (dev)

| Сервис | Порт | Команда | Обязателен |
|---|---|---|---|
| PostgreSQL 16 | 5432 | `sudo pg_ctlcluster 16 main start` | Да |
| Redis 7 | 6379 | `sudo redis-server --daemonize yes` | Да (realtime) |
| Backend | 8000 | `cd backend && ./venv/bin/uvicorn main:app --reload --host 0.0.0.0 --port 8000` | Да |
| Frontend | 3000 | `cd frontend && npm run dev` | Да |
| coturn / ClamAV / nginx / Electron | — | см. docker-compose / ELECTRON-SETUP.md | Нет для текстового чата |

systemd в этой VM нет — Postgres/Redis нужно стартовать вручную в начале сессии.
БД `miscord` / пользователь `miscord_user` / пароль `miscord_password` уже созданы в snapshot.
Таблицы создаются через `Base.metadata.create_all` при старте backend (на **пустой** БД).

### Важные нюансы

- **Ставьте `requirements-dev.txt`, не `requirements.txt`.** Dev-файл уже пинит `bcrypt==4.0.1`
  и **не** тянет `aiortc` (мертвая зависимость: нигде не импортируется; voice = браузерный WebRTC).
  `requirements.txt` + `aiortc==1.5.0` на Ubuntu 24.04/ffmpeg 6 не собирается.
- **Python 3.11** (deadsnakes). Системный 3.12 не использовать для venv.
- **`backend/.env`**: для локального health без ClamAV ставьте `WEBHOOK_FILES_ENABLED=false`
  (иначе `/health` может быть `degraded`). Шаблон создаёт `start-local-dev.sh`.
- **`frontend/.env.local`** (gitignored): `NEXT_PUBLIC_API_URL=http://localhost:8000` и
  `NEXT_PUBLIC_WS_URL=ws://localhost:8000`. Без него фронт ходит на `miscord.ru`.
- **`start-local-dev.sh`** ожидает Docker для postgres/redis. В Cloud Agent Docker часто нет —
  используйте хостовые Postgres/Redis (как выше) и запускайте backend/frontend вручную.
- Не запускайте `next build` при живом `next dev` (общий `.next` → HTTP 500). Если случилось:
  остановите dev, `rm -rf frontend/.next`, снова `npm run dev`.
- Алиас `127.0.0.1 redis` в `/etc/hosts` полезен, если код/клиент ждёт hostname `redis`.

### Lint / test / build

- Backend: `cd backend && PYTHONPATH=. ./venv/bin/pytest -q` (нужен `PYTHONPATH=.`).
- Frontend unit: `cd frontend && npm run test:voice`.
- Frontend build (+ typecheck/lint): `cd frontend && npm run build`.
- `npm run lint` может спросить интерактивную настройку ESLint — предпочтительнее `npm run build`.

### Миграции

На **свежей** БД `create_all` достаточно для старта. Скрипты `backend/migrate_*.py` нужны при
апгрейде существующей БД со старой схемой; на пустой БД часть из них может падать — это ок.
