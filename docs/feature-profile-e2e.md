# Feature-profile E2E

Miscord has separate browser contracts for the minimal and full feature sets.
Recreate the backend between profiles so Docker applies the changed flags.

## Minimal profile

```powershell
docker compose -f docker-compose.yml -f docker-compose.local.yml -f docker-compose.features-minimal.yml up -d --build --force-recreate backend frontend nginx
Set-Location frontend
npm run test:e2e:minimal
```

## Full profile

```powershell
Set-Location ..
docker compose -f docker-compose.yml -f docker-compose.local.yml -f docker-compose.features-full.yml up -d --build --force-recreate backend frontend nginx
Set-Location frontend
npm run test:e2e:full
```
