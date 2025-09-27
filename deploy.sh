#!/bin/bash

# Автоматическое развертывание Miscord на Ubuntu 22.04
# Улучшенный скрипт с проверками и автоматизацией

set -e  # Остановка при любой ошибке

echo "🚀 Развертывание Miscord с доменом stream-cash.ru"
echo "================================================="

# Цвета для вывода
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log() {
    echo -e "${GREEN}[$(date +'%H:%M:%S')]${NC} $1"
}

warn() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Проверяем, что мы на сервере
if [ ! -f "/etc/hostname" ]; then
    error "Этот скрипт должен запускаться на сервере"
    exit 1
fi

# Проверяем Docker
if ! docker info > /dev/null 2>&1; then
    error "Docker не запущен. Запустите: sudo systemctl start docker"
    exit 1
fi

# Проверяем docker-compose
if ! command -v docker-compose > /dev/null 2>&1; then
    error "docker-compose не установлен"
    exit 1
fi

# Проверяем DNS
log "Проверяем DNS для stream-cash.ru..."
if nslookup stream-cash.ru > /dev/null 2>&1; then
    log "✅ DNS настроен"
else
    warn "⚠️  DNS может быть не настроен. Продолжаем..."
fi

# Создаем .env если его нет
if [ ! -f ".env" ]; then
    log "📝 Создание файла .env..."
    cat > .env << 'EOF'
# Production Environment Variables for stream-cash.ru
DATABASE_URL=postgresql://miscord_user:miscord_password@postgres:5432/miscord
REDIS_URL=redis://redis:6379
SECRET_KEY=your-secret-key-here-change-in-production
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=10080
CORS_ORIGINS=["https://stream-cash.ru", "https://www.stream-cash.ru"]
SERVER_HOST=https://stream-cash.ru
NEXT_PUBLIC_API_URL=https://stream-cash.ru
NEXT_PUBLIC_WS_URL=wss://stream-cash.ru
NODE_ENV=production
EOF
    warn "⚠️  Создан .env с настройками по умолчанию. ОБЯЗАТЕЛЬНО смените SECRET_KEY!"
fi

# Останавливаем все контейнеры
log "🛑 Остановка существующих контейнеров..."
docker-compose down 2>/dev/null || true

# Создаем директории
log "📁 Создание необходимых директорий..."
mkdir -p certbot/conf certbot/www backend/static

# Используем продакшн конфигурацию если доступна
if [ -f "docker-compose.prod.yml" ]; then
    log "🔧 Использование продакшн конфигурации..."
    COMPOSE_FILE="docker-compose.prod.yml"
else
    log "🔧 Использование стандартной конфигурации..."
    COMPOSE_FILE="docker-compose.yml"
fi

# Создаем начальную конфигурацию nginx если нужно
if [ ! -f "nginx/nginx-initial.conf" ]; then
    log "📋 Создание начальной конфигурации nginx..."
    mkdir -p nginx
    cat > nginx/nginx-initial.conf << 'EOF'
events {
    worker_connections 1024;
}

http {
    include       /etc/nginx/mime.types;
    default_type  application/octet-stream;
    
    upstream backend {
        server backend:8000;
    }
    
    upstream frontend {
        server frontend:3000;
    }
    
    server {
        listen 80;
        server_name stream-cash.ru www.stream-cash.ru;
        
        location /.well-known/acme-challenge/ {
            root /var/www/certbot;
        }
        
        location / {
            return 301 https://$server_name$request_uri;
        }
    }
}
EOF
fi

# Копируем начальную конфигурацию Nginx
log "📋 Копирование начальной конфигурации Nginx..."
cp nginx/nginx-initial.conf nginx/nginx.conf

# Запускаем контейнеры поэтапно
log "🐳 Запуск базовых сервисов (PostgreSQL, Redis)..."
docker-compose -f $COMPOSE_FILE up -d postgres redis

# Ждем запуска PostgreSQL
log "⏳ Ожидание запуска PostgreSQL..."
sleep 15

log "🔧 Запуск backend..."
docker-compose -f $COMPOSE_FILE up -d backend

# Ждем запуска backend
log "⏳ Ожидание запуска backend..."
sleep 15

log "🎨 Запуск frontend..."
docker-compose -f $COMPOSE_FILE up -d frontend

# Ждем запуска frontend
log "⏳ Ожидание запуска frontend..."
sleep 15

log "🌐 Запуск Nginx..."
docker-compose -f $COMPOSE_FILE up -d nginx

# Ждем запуска nginx
log "⏳ Ожидание запуска nginx..."
sleep 10

# Делаем скрипт SSL исполняемым
chmod +x init-letsencrypt.sh

# Получаем SSL сертификат
log "🔒 Получение SSL сертификата..."
if ./init-letsencrypt.sh; then
    log "✅ SSL сертификат получен"
else
    warn "⚠️  Ошибка получения SSL сертификата"
    log "Попробуйте запустить ./init-letsencrypt.sh вручную"
fi

# Перезагружаем Nginx
log "🔄 Перезагрузка Nginx..."
docker-compose -f $COMPOSE_FILE exec nginx nginx -s reload 2>/dev/null || true

# Запускаем автообновление сертификатов
log "🔄 Запуск автообновления сертификатов..."
docker-compose -f $COMPOSE_FILE up -d certbot

# Финальная проверка
log "🔍 Проверка статуса сервисов..."
docker-compose -f $COMPOSE_FILE ps

# Проверяем доступность
log "🔍 Проверка доступности сайта..."
sleep 10
if curl -s -I "https://stream-cash.ru" > /dev/null 2>&1; then
    log "✅ Сайт доступен по HTTPS"
else
    warn "⚠️  Сайт может быть недоступен (проверьте DNS и SSL)"
fi

echo ""
echo "🎉 РАЗВЕРТЫВАНИЕ ЗАВЕРШЕНО!"
echo "=========================="
echo "🌐 Сайт: https://stream-cash.ru"
echo "📊 Статус: docker-compose ps"
echo "📋 Логи: docker-compose logs -f"
echo "🔄 Перезапуск: docker-compose restart"
echo "🛑 Остановка: docker-compose down"
echo ""
echo "⚠️  ВАЖНО:"
echo "   1. Смените SECRET_KEY в файле .env"
echo "   2. Проверьте настройки DNS"
echo "   3. Убедитесь, что SSL сертификат получен"
echo "" 