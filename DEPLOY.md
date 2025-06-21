# Развертывание Miscord с доменом и SSL

## Предварительные требования

1. **Сервер с Ubuntu/Debian**
2. **Docker и Docker Compose установлены**
3. **Домен miscord.ru настроен на IP сервера**
4. **Открыты порты 80 и 443**

## Настройка DNS

Убедитесь, что DNS записи настроены правильно:

```
miscord.ru      A    195.19.93.203
www.miscord.ru  A    195.19.93.203
```

Проверить можно командой:
```bash
nslookup miscord.ru
nslookup www.miscord.ru
```

## Автоматическое развертывание

1. **Клонируйте репозиторий на сервер:**
```bash
git clone <repository_url>
cd Miscord
```

2. **Сделайте скрипты исполняемыми:**
```bash
chmod +x deploy.sh
chmod +x init-letsencrypt.sh
```

3. **Запустите развертывание:**
```bash
./deploy.sh
```

Скрипт автоматически:
- Остановит существующие контейнеры
- Запустит сервисы с HTTP конфигурацией
- Получит SSL сертификат от Let's Encrypt
- Переключит на HTTPS конфигурацию
- Настроит автообновление сертификатов

## Ручное развертывание

### Шаг 1: Подготовка

```bash
# Остановка существующих контейнеров
docker-compose down

# Создание директорий
mkdir -p certbot/conf certbot/www
```

### Шаг 2: Запуск без SSL

```bash
# Копирование начальной конфигурации
cp nginx/nginx-initial.conf nginx/nginx.conf

# Запуск сервисов
docker-compose up -d postgres redis backend frontend nginx
```

### Шаг 3: Получение SSL сертификата

```bash
# Запуск скрипта получения сертификата
./init-letsencrypt.sh
```

### Шаг 4: Переключение на HTTPS

```bash
# Восстановление полной конфигурации с SSL
cp nginx/nginx.conf.ssl nginx/nginx.conf

# Перезагрузка Nginx
docker-compose exec nginx nginx -s reload

# Запуск автообновления сертификатов
docker-compose up -d certbot
```

## Проверка развертывания

### Проверка статуса контейнеров
```bash
docker-compose ps
```

### Проверка логов
```bash
# Все сервисы
docker-compose logs -f

# Конкретный сервис
docker-compose logs -f nginx
docker-compose logs -f backend
docker-compose logs -f frontend
```

### Проверка SSL сертификата
```bash
# Проверка сертификата
openssl s_client -connect miscord.ru:443 -servername miscord.ru

# Или через браузер
curl -I https://miscord.ru
```

### Тестирование функциональности
1. Откройте https://miscord.ru
2. Зарегистрируйтесь или войдите
3. Создайте сервер
4. Проверьте WebSocket соединения (чат, голосовая связь)

## Обновление приложения

```bash
# Получение обновлений
git pull

# Пересборка и перезапуск
docker-compose build
docker-compose up -d
```

## Мониторинг и обслуживание

### Автообновление SSL сертификатов
Certbot настроен на автоматическое обновление каждые 12 часов.

### Резервное копирование
```bash
# Резервная копия базы данных
docker-compose exec postgres pg_dump -U miscord_user miscord > backup_$(date +%Y%m%d_%H%M%S).sql

# Резервная копия SSL сертификатов
tar -czf ssl_backup_$(date +%Y%m%d_%H%M%S).tar.gz certbot/
```

### Логи Nginx
```bash
# Просмотр логов доступа
docker-compose exec nginx tail -f /var/log/nginx/access.log

# Просмотр логов ошибок
docker-compose exec nginx tail -f /var/log/nginx/error.log
```

## Устранение неполадок

### SSL сертификат не получается
1. Проверьте DNS записи
2. Убедитесь что порт 80 открыт
3. Проверьте логи certbot: `docker-compose logs certbot`

### Nginx не запускается
1. Проверьте синтаксис конфигурации: `docker-compose exec nginx nginx -t`
2. Проверьте логи: `docker-compose logs nginx`

### Фронтенд не загружается
1. Проверьте что контейнер запущен: `docker-compose ps frontend`
2. Проверьте логи: `docker-compose logs frontend`
3. Проверьте переменные окружения в docker-compose.yml

### WebSocket соединения не работают
1. Проверьте конфигурацию Nginx для WebSocket
2. Проверьте что бэкенд доступен: `curl http://localhost:8000/api/health`
3. Проверьте логи бэкенда: `docker-compose logs backend`

## Структура проекта

```
Miscord/
├── nginx/
│   ├── nginx.conf          # Полная конфигурация с SSL
│   ├── nginx-initial.conf  # Начальная конфигурация без SSL
│   └── nginx.conf.ssl      # Резервная копия SSL конфигурации
├── certbot/
│   ├── conf/              # SSL сертификаты
│   └── www/               # Challenge файлы
├── deploy.sh              # Скрипт автоматического развертывания
├── init-letsencrypt.sh    # Скрипт получения SSL сертификата
└── docker-compose.yml     # Конфигурация Docker Compose
```

## Полезные команды

```bash
# Перезапуск всех сервисов
docker-compose restart

# Обновление только одного сервиса
docker-compose up -d --no-deps backend

# Просмотр использования ресурсов
docker stats

# Очистка неиспользуемых ресурсов
docker system prune -a

# Принудительное обновление SSL сертификата
docker-compose run --rm certbot renew --force-renewal
``` 