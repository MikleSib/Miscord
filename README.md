# Miscord

Miscord — платформа для текстовых и голосовых сообществ с собственной системой приложений и ботов.

## Голосовая архитектура

- Серверные голосовые каналы работают через `voice-media` и mediasoup SFU.
- Клиент создаёт один send transport и один receive transport.
- Микрофон, видео экрана и звук экрана публикуются отдельными producers.
- Боты передают Opus 48 кГц через RTP и зашифрованный UDP.
- Mesh, старый bot-WebRTC и личные P2P-звонки удалены.
- DAVE пока не включён; Voice Gateway v1 сообщает `dave_protocol_version: 0`.

## Протокол v1

- REST API: `/api/v1`
- Main Gateway: `/gateway?v=1&encoding=json`
- Voice Gateway ботов: `/ws/voice-gateway?v=1`
- Media WebSocket клиентов: `/ws/media`

Версии Main Gateway без `v=1`, Voice Gateway без `v=1`, а также старые `v8`, `v10` и `/api/v10` не поддерживаются.

## Локальный запуск

Требуются Docker и Docker Compose.

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml build
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d
```

После запуска Miscord доступен на `http://127.0.0.1:3011`.

Проверка состояния:

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml ps
curl http://127.0.0.1:3011/api/v1/health
```

Локальный Compose использует отдельное имя проекта, отдельные volumes PostgreSQL/Redis и только тестовые секреты.

## Структура

- `backend/` — FastAPI, REST v1, Main Gateway и выдача одноразовых media tickets.
- `frontend/` — Next.js-клиент и единый `GroupVoiceController`.
- `voice-media/` — Node.js 22, mediasoup SFU, Voice Gateway и UDP edge ботов.
- `examples/music-bot/` — локальный музыкальный бот без aiortc.
- `docs/` — документация API, webhook и bot voice v1.
- `nginx/` — локальный HTTP/WebSocket reverse proxy.

## Тесты

```bash
cd backend && pytest -q
cd frontend && npm run build && npm run test:voice
cd voice-media && npm run build && npm test
```

Production-развёртывание выполняется только после отдельного разрешения и обязательных локальных проверок.
