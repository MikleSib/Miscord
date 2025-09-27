# Развертывание Miscord на домене stream-cash.ru

## Подготовка к развертыванию

### 1. Настройка DNS
Убедитесь, что домен `stream-cash.ru` и `www.stream-cash.ru` указывают на ваш сервер:
```bash
# Проверка DNS
nslookup stream-cash.ru
nslookup www.stream-cash.ru
```

### 2. Переменные окружения
Создайте файл `.env` в корне проекта:
```bash
# Database
DATABASE_URL=postgresql://miscord_user:miscord_password@postgres:5432/miscord

# Redis
REDIS_URL=redis://redis:6379

# Security (ОБЯЗАТЕЛЬНО СМЕНИТЕ!)
SECRET_KEY=your-very-secure-secret-key-here
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=10080

# CORS
CORS_ORIGINS=["https://stream-cash.ru", "https://www.stream-cash.ru"]

# Server
SERVER_HOST=https://stream-cash.ru

# Frontend URLs
NEXT_PUBLIC_API_URL=https://stream-cash.ru
NEXT_PUBLIC_WS_URL=wss://stream-cash.ru

# Environment
NODE_ENV=production
```

### 3. Обновление email в SSL скрипте
Отредактируйте файл `init-letsencrypt.sh` и замените email:
```bash
email="your-email@example.com" # Замените на ваш реальный email
```

## Развертывание

### Автоматическое развертывание
```bash
# Делаем скрипты исполняемыми
chmod +x deploy.sh init-letsencrypt.sh

# Запускаем развертывание
./deploy.sh
```

### Ручное развертывание (если нужно)
```bash
# 1. Остановка существующих контейнеров
docker-compose down

# 2. Копирование начальной конфигурации
cp nginx/nginx-initial.conf nginx/nginx.conf

# 3. Запуск базовых сервисов
docker-compose up -d postgres redis backend frontend

# 4. Ожидание запуска
sleep 30

# 5. Запуск Nginx
docker-compose up -d nginx

# 6. Получение SSL сертификата
./init-letsencrypt.sh

# 7. Перезагрузка Nginx
docker-compose exec nginx nginx -s reload

# 8. Запуск автообновления сертификатов
docker-compose up -d certbot
```

## Проверка развертывания

### 1. Проверка контейнеров
```bash
docker-compose ps
```

### 2. Проверка логов
```bash
# Все логи
docker-compose logs -f

# Логи конкретного сервиса
docker-compose logs -f nginx
docker-compose logs -f backend
docker-compose logs -f frontend
```

### 3. Проверка сайта
```bash
# HTTP редирект
curl -I http://stream-cash.ru

# HTTPS доступ
curl -I https://stream-cash.ru

# WebSocket
curl -I https://stream-cash.ru/ws/
```

## После развертывания

Сайт будет доступен по адресу: **https://stream-cash.ru**

### Особенности:
- ✅ HTTP автоматически перенаправляется на HTTPS
- ✅ SSL сертификат обновляется автоматически
- ✅ WebSocket соединения работают через wss://stream-cash.ru
- ✅ Все API запросы идут через https://stream-cash.ru/api/
- ✅ Статические файлы кешируются на 1 год

## Устранение проблем

### Проблема с SSL сертификатом
```bash
# Проверка сертификата
docker-compose exec nginx ls -la /etc/letsencrypt/live/

# Пересоздание сертификата
docker-compose run --rm certbot certonly --webroot -w /var/www/certbot -d stream-cash.ru -d www.stream-cash.ru
```

### Проблема с CORS
Проверьте, что в `backend/app/core/config.py` правильно указаны CORS_ORIGINS:
```python
CORS_ORIGINS: List[str] = ["https://stream-cash.ru", "https://www.stream-cash.ru"]
```

### Проблема с WebSocket
Проверьте, что в `frontend/src/services/voiceService.ts` правильно указан WS_URL:
```typescript
const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'wss://stream-cash.ru';
```

## Мониторинг

### Проверка статуса
```bash
# Статус всех сервисов
docker-compose ps

# Использование ресурсов
docker stats

# Логи в реальном времени
docker-compose logs -f
```

### Обновление
```bash
# Остановка
docker-compose down

# Обновление образов
docker-compose pull

# Запуск
docker-compose up -d
```

## Безопасность

### Обязательно смените:
1. **SECRET_KEY** в `.env` файле
2. **Пароли базы данных** в docker-compose.yml
3. **Email** в init-letsencrypt.sh

### Рекомендации:
- Используйте сильные пароли
- Регулярно обновляйте зависимости
- Мониторьте логи на предмет подозрительной активности
- Настройте бэкапы базы данных
