# Miscord incoming webhooks

Вебхуки привязаны к текстовым каналам и публикуют сообщения по секретному URL без пользовательской сессии. Токен URL является паролем: его нельзя помещать в логи, issue, скриншоты или клиентские bundle.

## Возможности

- `content` до 2000 символов.
- До 10 Miscord-совместимых embeds и 6000 текстовых символов суммарно.
- Снимок `username` и `avatar_url` в каждом сообщении.
- Безопасные по умолчанию `allowed_mentions`.
- Флаги `SUPPRESS_EMBEDS` и `SUPPRESS_NOTIFICATIONS`.
- До 10 файлов по 10 МиБ, до 100 МиБ суммарно, обязательная проверка ClamAV.
- `wait=true`, получение, редактирование и удаление сообщений своим вебхуком.
- Мгновенная доставка по существующему Redis/WebSocket каналу.

## Обязательные секреты

Сгенерируйте независимые ключи и передайте их backend-контейнеру:

```powershell
python -c "import base64,secrets; print(base64.urlsafe_b64encode(secrets.token_bytes(32)).decode())"
python -c "import base64,secrets; print(base64.urlsafe_b64encode(secrets.token_bytes(32)).decode())"
```

Первое значение задайте как `WEBHOOK_TOKEN_ENCRYPTION_KEY`, второе как `ATTACHMENT_SIGNING_KEY`. Production-backend не запускается с включенными вебхуками без ключа шифрования. Ротация ключа шифрования требует отдельной миграции ciphertext существующих токенов; простая замена сделает ранее созданные URL недоступными для повторного копирования.

## Развертывание

1. Сделайте резервную копию PostgreSQL.
2. Примените `python backend/migrate_webhooks.py` до обновления backend.
3. Создайте volumes `attachment_data`, `attachment_quarantine`, `clamav_db` и запустите ClamAV до приема файлов.
4. Разверните Nginx и backend с `WEBHOOKS_ENABLED=false` и `WEBHOOK_FILES_ENABLED=false`.
5. Проверьте `/api/health`: PostgreSQL и Redis должны быть доступны, ClamAV может временно иметь состояние degraded во время загрузки сигнатур.
6. Выполните smoke/load-тесты и включите `WEBHOOKS_ENABLED=true`.
7. После готовности ClamAV включите `WEBHOOK_FILES_ENABLED=true`.
8. Разверните frontend.

Быстрый rollback: отключите оба feature flag. Таблицы и сообщения при откате не удаляются.

## Выполнение

JSON:

```bash
curl -X POST "$WEBHOOK_URL?wait=true" \
  -H "Content-Type: application/json" \
  -d '{"content":"Сборка завершена","allowed_mentions":{"parse":[]}}'
```

Embed:

```bash
curl -X POST "$WEBHOOK_URL?wait=true" \
  -H "Content-Type: application/json" \
  -d '{"embeds":[{"title":"Deploy","description":"Production обновлен","color":5763719}],"flags":4096}'
```

Multipart:

```bash
curl -X POST "$WEBHOOK_URL?wait=true" \
  -F 'payload_json={"content":"Отчет","attachments":[{"id":0,"filename":"report.txt","description":"Лог сборки"}]}' \
  -F 'files[0]=@report.txt'
```

`wait=false` по умолчанию возвращает `204` только после commit. `wait=true` возвращает сообщение. Клиент должен читать `X-RateLimit-*` и `Retry-After`, а не зашивать значения лимитов.

## Лимиты по умолчанию

| Область | Лимит |
|---|---:|
| IP до проверки токена | 300 запросов/мин |
| Один вебхук | 5 execute/2 сек |
| Один канал | 30 сообщений/сек |
| Multipart одного вебхука | 2 запроса/мин |
| Multipart одного сервера | 10 запросов/мин |

Redis проверяет buckets атомарным Lua-скриптом. При его недоступности backend использует локальный ограниченный fallback; в multi-worker режиме fallback не является глобальным, поэтому Redis остается обязательным production-компонентом.

## Файлы

- Backend принимает upload потоково в quarantine и не держит тело целиком в RAM.
- Соединение с PostgreSQL не удерживается во время сканирования.
- Любой результат кроме `OK` отклоняет весь набор файлов.
- Активные и неизвестные типы всегда скачиваются как attachment; inline разрешен только magic-byte-проверенным изображениям, аудио и видео.
- Подписанный URL действует 24 часа. После проверки FastAPI передает выдачу Nginx через `X-Accel-Redirect`.
- ClamAV недоступен: JSON продолжает работать, multipart получает `503`.
- Рекомендуемый минимум для ClamAV: 3-4 ГиБ RAM и 5 ГиБ диска плюс объем сигнатур и quarantine.

Ежедневная очистка:

```bash
python backend/cleanup_webhook_attachments.py --older-than-hours 24
```

Сначала запускайте команду с `--dry-run`. Мониторьте свободное место в attachment/quarantine volumes и сохраняйте резерв из `ATTACHMENT_DISK_RESERVE_BYTES`.

## Безопасность и наблюдаемость

- Список вебхуков не содержит токенов. Полный URL возвращают только создание, явное копирование и reset.
- Reset немедленно инвалидирует старый URL.
- Неверный ID, удаленный вебхук и неверный токен имеют одинаковый `404`.
- Access log отключен для `/api/webhooks/`; application filter редактирует token-path.
- Не логируйте payload, embeds, filenames, токены или execution URL.
- Допустимые метрики: webhook/channel ID, статус, latency, bytes, scan latency, rate-limit scope, размер bounded notification queue.
- Сообщение и broadcast не зависят от очереди персональных уведомлений; при переполнении очередь отбрасывает работу.

## Проверки перед включением

```bash
pytest backend/tests/test_webhook_validation.py backend/tests/test_webhook_security.py
WEBHOOK_CLAMAV_INTEGRATION=1 pytest backend/tests/test_clamav_integration.py
```

Дополнительно выполните E2E управления вебхуками, проверку WebSocket-события, multipart 10 x 10 МиБ и нагрузочный тест JSON execute. Нагрузочная цель: p95 до 250 мс и прирост RSS не более 32 МиБ при 100-МиБ multipart.
