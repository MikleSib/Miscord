---
name: miscord-safe-deploy
description: Safely validate, commit, push, deploy, and recover Miscord changes. Use for every Miscord backend or frontend change, Docker Compose update, production deployment, server restart, 502 investigation, migration, hotfix, or request to commit/push/deploy. Enforce image preflight, backend import checks, service health checks, Nginx upstream refresh, public smoke checks, and truthful failure reporting.
---

# Miscord Safe Deploy

Treat validation as part of the requested Miscord change. Never report a deployment as complete until every acceptance check passes.

## Fixed production context

- Repository branch: `new-4`
- Production checkout: `/home/pc/Miscord-source`
- Compose project: `miscord-source`
- Public URL: `https://miscord.ru`
- Data services: `postgres`, `redis`, attachment/S3 data

Never print credentials, `.env`, tokens, signed URLs, request bodies, or WebSocket query strings.

## Required workflow

1. Inspect the changed files and identify affected services: `backend`, `frontend`, `nginx`, migrations, or infrastructure.
2. Run narrow local static checks for changed code before committing. At minimum, catch undefined names/imports and type/build errors relevant to the change.
3. Commit and push only the intended files to `new-4`.
4. Pull with `git pull --ff-only origin new-4` on production.
5. Run `bash .agents/skills/miscord-safe-deploy/scripts/safe_deploy.sh <services...>` from the production checkout.
6. If schema files changed, run the project's idempotent migration before service replacement. Never guess a migration command and never drop production data.
7. If any check fails, collect bounded service logs, fix the cause, create a new commit, and rerun the workflow. Do not call the site healthy based only on `docker compose up` output.

## Deployment rules

- Build new images while old containers remain available.
- For backend changes, import `main` in a disposable container before replacing the live backend.
- Let the frontend production build perform its TypeScript/Next.js checks before replacement.
- Recreate only affected application services. Never run an unscoped `docker compose up -d --force-recreate`.
- Never recreate `postgres`, `redis`, `clamav`, or storage services unless explicitly required.
- Restart Nginx after recreating backend or frontend. Nginx caches Docker DNS upstream addresses and otherwise may return `502` for healthy replacement containers.
- Require each replaced service to remain `running` and, when configured, `healthy`.
- Require internal TCP readiness for backend port `8000` and frontend port `3000`.
- Require the public root to return `2xx/3xx` and `/api/health` to return anything below `500`.

## Failure handling

- On `502`, inspect `docker compose -p miscord ps -a`, bounded application logs, and Nginx upstream errors first.
- Distinguish a crashed service from stale Nginx upstream DNS. Fix the service before restarting Nginx when both are broken.
- Keep previous live containers running until image build and disposable preflight finish.
- Do not use destructive Git commands, delete volumes, or erase uploaded media as a recovery shortcut.
- State the exact failed check and do not hide availability or data-integrity warnings.

## Script

Run on production after the fast-forward pull:

```bash
bash .agents/skills/miscord-safe-deploy/scripts/safe_deploy.sh backend frontend
```

Pass only changed application services. The script builds, preflights, replaces, waits, refreshes Nginx, and performs public smoke checks.
