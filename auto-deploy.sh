#!/bin/bash

# Автоматическое развертывание Miscord на Ubuntu 22.04
# Полностью автоматический скрипт развертывания

set -e  # Остановка при любой ошибке

echo "🚀 Автоматическое развертывание Miscord на stream-cash.ru"
echo "======================================================="

# Цвета для вывода
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Функция для логирования
log() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1"
}

warn() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Проверяем, что Docker запущен
if ! docker info > /dev/null 2>&1; then
    error "Docker не запущен. Запустите: sudo systemctl start docker"
    exit 1
fi

# Проверяем, что мы в правильной директории
if [ ! -f "docker-compose.yml" ]; then
    error "Файл docker-compose.yml не найден. Запустите скрипт из корня проекта."
    exit 1
fi

# Функция для проверки доступности сервиса
check_service() {
    local service_name=$1
    local port=$2
    local max_attempts=30
    local attempt=1
    
    log "Проверяем доступность $service_name на порту $port..."
    
    while [ $attempt -le $max_attempts ]; do
        if curl -s -f "http://localhost:$port" > /dev/null 2>&1; then
            log "✅ $service_name доступен"
            return 0
        fi
        
        echo -n "."
        sleep 2
        ((attempt++))
    done
    
    error "❌ $service_name недоступен после $max_attempts попыток"
    return 1
}

# Функция для ожидания готовности контейнера
wait_for_container() {
    local container_name=$1
    local max_attempts=60
    local attempt=1
    
    log "Ожидаем запуска контейнера $container_name..."
    
    while [ $attempt -le $max_attempts ]; do
        if docker-compose ps | grep -q "$container_name.*Up"; then
            log "✅ Контейнер $container_name запущен"
            return 0
        fi
        
        echo -n "."
        sleep 2
        ((attempt++))
    done
    
    error "❌ Контейнер $container_name не запустился"
    return 1
}

# Функция для проверки DNS
check_dns() {
    local domain=$1
    log "Проверяем DNS для домена $domain..."
    
    if nslookup $domain > /dev/null 2>&1; then
        log "✅ DNS для $domain настроен"
        return 0
    else
        warn "⚠️  DNS для $domain не настроен или недоступен"
        return 1
    fi
}

# Основной процесс развертывания
main() {
    log "Начинаем автоматическое развертывание..."
    
    # Проверяем DNS
    if ! check_dns "stream-cash.ru"; then
        warn "DNS может быть еще не настроен. Продолжаем развертывание..."
    fi
    
    # Останавливаем существующие контейнеры
    log "🛑 Остановка существующих контейнеров..."
    docker-compose down 2>/dev/null || true
    
    # Создаем необходимые директории
    log "📁 Создание директорий..."
    mkdir -p certbot/conf
    mkdir -p certbot/www
    mkdir -p backend/static
    
    # Проверяем наличие начальной конфигурации nginx
    if [ ! -f "nginx/nginx-initial.conf" ]; then
        log "📋 Создание начальной конфигурации nginx..."
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
    
    # Копируем начальную конфигурацию nginx
    log "📋 Копирование начальной конфигурации nginx..."
    cp nginx/nginx-initial.conf nginx/nginx.conf
    
    # Создаем .env файл если его нет
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
        warn "⚠️  Создан файл .env с настройками по умолчанию. ОБЯЗАТЕЛЬНО смените SECRET_KEY!"
    fi
    
    # Запускаем базовые сервисы
    log "🐳 Запуск базовых сервисов (PostgreSQL, Redis)..."
    docker-compose up -d postgres redis
    
    # Ждем запуска PostgreSQL
    wait_for_container "postgres"
    sleep 5
    
    # Запускаем backend
    log "🔧 Запуск backend..."
    docker-compose up -d backend
    
    # Ждем запуска backend
    wait_for_container "backend"
    check_service "backend" 8000
    
    # Запускаем frontend
    log "🎨 Запуск frontend..."
    docker-compose up -d frontend
    
    # Ждем запуска frontend
    wait_for_container "frontend"
    check_service "frontend" 3000
    
    # Запускаем nginx
    log "🌐 Запуск nginx..."
    docker-compose up -d nginx
    
    # Ждем запуска nginx
    wait_for_container "nginx"
    sleep 5
    
    # Делаем скрипт SSL исполняемым
    chmod +x init-letsencrypt.sh
    
    # Получаем SSL сертификат
    log "🔒 Получение SSL сертификата..."
    if ./init-letsencrypt.sh; then
        log "✅ SSL сертификат получен успешно"
    else
        error "❌ Ошибка получения SSL сертификата"
        log "Попробуйте запустить ./init-letsencrypt.sh вручную"
    fi
    
    # Перезагружаем nginx с SSL
    log "🔄 Перезагрузка nginx с SSL..."
    docker-compose exec nginx nginx -s reload 2>/dev/null || true
    
    # Запускаем автообновление сертификатов
    log "🔄 Запуск автообновления сертификатов..."
    docker-compose up -d certbot
    
    # Финальная проверка
    log "🔍 Финальная проверка сервисов..."
    
    # Проверяем все контейнеры
    if docker-compose ps | grep -q "Up"; then
        log "✅ Все контейнеры запущены"
    else
        error "❌ Некоторые контейнеры не запущены"
        docker-compose ps
    fi
    
    # Проверяем доступность сайта
    sleep 10
    if curl -s -I "https://stream-cash.ru" > /dev/null 2>&1; then
        log "✅ Сайт доступен по HTTPS"
    else
        warn "⚠️  Сайт может быть недоступен по HTTPS (проверьте DNS и SSL)"
    fi
    
    # Показываем статус
    log "📊 Статус развертывания:"
    docker-compose ps
    
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
}

# Запуск основного процесса
main "$@"
