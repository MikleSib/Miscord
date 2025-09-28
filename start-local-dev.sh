#!/bin/bash

# 🚀 Скрипт для быстрого запуска Miscord в режиме локальной разработки

set -e  # Остановка при ошибке

echo "🚀 Запуск Miscord в режиме локальной разработки..."

# Цвета для вывода
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Функция для вывода цветного текста
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Проверка зависимостей
check_dependencies() {
    print_status "Проверка зависимостей..."
    
    if ! command -v python3 &> /dev/null; then
        print_error "Python 3 не найден. Установите Python 3.11+"
        exit 1
    fi
    
    if ! command -v node &> /dev/null; then
        print_error "Node.js не найден. Установите Node.js 18+"
        exit 1
    fi
    
    if ! command -v docker &> /dev/null; then
        print_error "Docker не найден. Установите Docker"
        exit 1
    fi
    
    if ! command -v docker-compose &> /dev/null; then
        print_error "Docker Compose не найден. Установите Docker Compose"
        exit 1
    fi
    
    print_success "Все зависимости найдены"
}

# Создание файлов окружения
create_env_files() {
    print_status "Создание файлов окружения..."
    
    # Backend .env
    if [ ! -f "backend/.env" ]; then
        cat > backend/.env << EOF
DATABASE_URL=postgresql://miscord_user:miscord_password@localhost:5432/miscord
REDIS_URL=redis://localhost:6379
SECRET_KEY=your-secret-key-for-development-change-in-production
CORS_ORIGINS=["http://localhost:3000"]
ACCESS_TOKEN_EXPIRE_MINUTES=10080
EOF
        print_success "Создан backend/.env"
    else
        print_warning "backend/.env уже существует"
    fi
    
    # Frontend .env.local
    if [ ! -f "frontend/.env.local" ]; then
        cat > frontend/.env.local << EOF
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_WS_URL=ws://localhost:8000
EOF
        print_success "Создан frontend/.env.local"
    else
        print_warning "frontend/.env.local уже существует"
    fi
}

# Запуск базы данных и Redis
start_infrastructure() {
    print_status "Запуск PostgreSQL и Redis..."
    
    # Запуск только базы данных и Redis
    docker-compose up -d postgres redis
    
    # Ожидание запуска
    print_status "Ожидание запуска PostgreSQL..."
    sleep 10
    
    # Проверка подключения к PostgreSQL
    if docker-compose exec postgres pg_isready -U miscord_user -d miscord; then
        print_success "PostgreSQL запущен и готов"
    else
        print_error "PostgreSQL не запустился"
        exit 1
    fi
    
    # Проверка подключения к Redis
    if docker-compose exec redis redis-cli ping | grep -q "PONG"; then
        print_success "Redis запущен и готов"
    else
        print_error "Redis не запустился"
        exit 1
    fi
}

# Настройка Backend
setup_backend() {
    print_status "Настройка Backend..."
    
    cd backend
    
    # Создание виртуального окружения
    if [ ! -d "venv" ]; then
        print_status "Создание виртуального окружения..."
        python3 -m venv venv
    fi
    
    # Активация виртуального окружения
    print_status "Активация виртуального окружения..."
    source venv/bin/activate
    
    # Установка зависимостей
    print_status "Установка Python зависимостей..."
    pip install --upgrade pip
    pip install -r requirements.txt
    
    cd ..
    print_success "Backend настроен"
}

# Настройка Frontend
setup_frontend() {
    print_status "Настройка Frontend..."
    
    cd frontend
    
    # Установка зависимостей
    if [ ! -d "node_modules" ]; then
        print_status "Установка Node.js зависимостей..."
        npm install
    else
        print_warning "node_modules уже существует, пропускаем установку"
    fi
    
    cd ..
    print_success "Frontend настроен"
}

# Запуск Backend
start_backend() {
    print_status "Запуск Backend сервера..."
    
    cd backend
    source venv/bin/activate
    
    # Запуск в фоновом режиме
    nohup uvicorn main:app --reload --host 0.0.0.0 --port 8000 > ../backend.log 2>&1 &
    BACKEND_PID=$!
    echo $BACKEND_PID > ../backend.pid
    
    cd ..
    
    # Ожидание запуска
    sleep 5
    
    # Проверка здоровья
    if curl -s http://localhost:8000/health | grep -q "healthy"; then
        print_success "Backend запущен на http://localhost:8000"
    else
        print_error "Backend не запустился"
        exit 1
    fi
}

# Запуск Frontend
start_frontend() {
    print_status "Запуск Frontend сервера..."
    
    cd frontend
    
    # Запуск в фоновом режиме
    nohup npm run dev > ../frontend.log 2>&1 &
    FRONTEND_PID=$!
    echo $FRONTEND_PID > ../frontend.pid
    
    cd ..
    
    # Ожидание запуска
    sleep 10
    
    # Проверка доступности
    if curl -s http://localhost:3000 > /dev/null; then
        print_success "Frontend запущен на http://localhost:3000"
    else
        print_warning "Frontend может быть еще не готов, проверьте http://localhost:3000"
    fi
}

# Показ информации о запуске
show_info() {
    echo ""
    echo "🎉 Miscord успешно запущен в режиме локальной разработки!"
    echo ""
    echo "📱 Доступные сервисы:"
    echo "   • Frontend: http://localhost:3000"
    echo "   • Backend API: http://localhost:8000"
    echo "   • API Documentation: http://localhost:8000/docs"
    echo "   • Health Check: http://localhost:8000/health"
    echo ""
    echo "📝 Логи:"
    echo "   • Backend: tail -f backend.log"
    echo "   • Frontend: tail -f frontend.log"
    echo ""
    echo "🛑 Для остановки выполните: ./stop-local-dev.sh"
    echo ""
}

# Основная функция
main() {
    echo "🚀 Miscord Local Development Setup"
    echo "=================================="
    
    check_dependencies
    create_env_files
    start_infrastructure
    setup_backend
    setup_frontend
    start_backend
    start_frontend
    show_info
}

# Обработка сигналов для корректного завершения
trap 'echo ""; print_warning "Получен сигнал завершения..."; ./stop-local-dev.sh; exit 0' INT TERM

# Запуск
main

