# Исправление проблемы Mixed Content

## Проблема
```
Mixed Content: The page at 'https://miscord.ru/login' was loaded over HTTPS, 
but requested an insecure XMLHttpRequest endpoint 'http://195.19.93.203:8000/api/auth/login'. 
This request has been blocked; the content must be served over HTTPS.
```

## Причина
Фронтенд использует старые fallback URL с HTTP вместо HTTPS домена.

## Исправления

### ✅ 1. Обновлены fallback URL в сервисах:
- `frontend/src/services/api.ts`: `http://195.19.93.203:8000` → `https://miscord.ru`
- `frontend/src/services/websocketService.ts`: `ws://195.19.93.203:8000` → `wss://miscord.ru`
- `frontend/src/services/voiceService.ts`: `ws://195.19.93.203:8000` → `wss://miscord.ru`

### ✅ 2. Обновлен Next.js конфиг:
- `frontend/next.config.js`: исправлен rewrite для API

### ✅ 3. Обновлен Dockerfile:
- Добавлены build-time переменные окружения
- Переменные `NEXT_PUBLIC_*` теперь доступны во время сборки

### ✅ 4. Обновлен docker-compose.yml:
- Добавлены build args для передачи переменных во время сборки

## Команды для применения исправлений на сервере:

### Вариант 1: Автоматическое обновление
```bash
cd /path/to/Miscord
git pull
chmod +x update-frontend.sh
./update-frontend.sh
```

### Вариант 2: Ручное обновление
```bash
cd /path/to/Miscord
git pull

# Остановка и удаление старого фронтенда
docker-compose stop frontend
docker-compose rm -f frontend
docker rmi miscord-frontend 2>/dev/null || true

# Пересборка с новыми переменными
docker-compose build --no-cache frontend

# Запуск обновленного фронтенда
docker-compose up -d frontend

# Проверка
docker-compose logs -f frontend
```

## Проверка исправления:

1. **Откройте https://miscord.ru**
2. **Откройте Developer Tools (F12)**
3. **Попробуйте войти в систему**
4. **В консоли не должно быть ошибок Mixed Content**

## Дополнительная проверка:

```bash
# Проверка переменных окружения в контейнере
docker-compose exec frontend env | grep NEXT_PUBLIC

# Должно показать:
# NEXT_PUBLIC_API_URL=https://miscord.ru
# NEXT_PUBLIC_WS_URL=wss://miscord.ru
```

## Если проблема сохраняется:

1. **Очистите кэш браузера** (Ctrl+Shift+R)
2. **Проверьте что переменные окружения применились:**
   ```bash
   docker-compose logs frontend | grep -i "api_url\|ws_url"
   ```
3. **Пересоберите полностью:**
   ```bash
   docker-compose down
   docker system prune -f
   docker-compose up -d --build
   ```

## Структура URL после исправления:

- **Фронтенд**: https://miscord.ru
- **API**: https://miscord.ru/api/*
- **WebSocket**: wss://miscord.ru/ws/*
- **Все соединения используют HTTPS/WSS** ✅ 