#!/bin/bash

# 🛑 Скрипт для остановки Miscord в режиме локальной разработки

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

echo "🛑 Остановка Miscord в режиме локальной разработки..."
echo "=================================================="

# Остановка Backend
if [ -f "backend.pid" ]; then
    BACKEND_PID=$(cat backend.pid)
    print_status "Остановка Backend (PID: $BACKEND_PID)..."
    
    if kill -0 $BACKEND_PID 2>/dev/null; then
        kill $BACKEND_PID
        sleep 2
        
        # Принудительная остановка если процесс еще работает
        if kill -0 $BACKEND_PID 2>/dev/null; then
            print_warning "Принудительная остановка Backend..."
            kill -9 $BACKEND_PID
        fi
        
        print_success "Backend остановлен"
    else
        print_warning "Backend процесс не найден"
    fi
    
    rm -f backend.pid
else
    print_warning "PID файл Backend не найден"
fi

# Остановка Frontend
if [ -f "frontend.pid" ]; then
    FRONTEND_PID=$(cat frontend.pid)
    print_status "Остановка Frontend (PID: $FRONTEND_PID)..."
    
    if kill -0 $FRONTEND_PID 2>/dev/null; then
        kill $FRONTEND_PID
        sleep 2
        
        # Принудительная остановка если процесс еще работает
        if kill -0 $FRONTEND_PID 2>/dev/null; then
            print_warning "Принудительная остановка Frontend..."
            kill -9 $FRONTEND_PID
        fi
        
        print_success "Frontend остановлен"
    else
        print_warning "Frontend процесс не найден"
    fi
    
    rm -f frontend.pid
else
    print_warning "PID файл Frontend не найден"
fi

# Остановка Docker контейнеров
print_status "Остановка Docker контейнеров..."
if docker-compose ps | grep -q "Up"; then
    docker-compose down
    print_success "Docker контейнеры остановлены"
else
    print_warning "Docker контейнеры уже остановлены"
fi

# Удаление лог файлов
if [ -f "backend.log" ]; then
    rm -f backend.log
    print_status "Удален backend.log"
fi

if [ -f "frontend.log" ]; then
    rm -f frontend.log
    print_status "Удален frontend.log"
fi

# Поиск и остановка процессов по портам (резервный метод)
print_status "Проверка процессов на портах 3000 и 8000..."

# Остановка процессов на порту 8000 (Backend)
BACKEND_PROCESS=$(lsof -ti:8000 2>/dev/null || true)
if [ ! -z "$BACKEND_PROCESS" ]; then
    print_warning "Найден процесс на порту 8000, останавливаем..."
    kill -9 $BACKEND_PROCESS
    print_success "Процесс на порту 8000 остановлен"
fi

# Остановка процессов на порту 3000 (Frontend)
FRONTEND_PROCESS=$(lsof -ti:3000 2>/dev/null || true)
if [ ! -z "$FRONTEND_PROCESS" ]; then
    print_warning "Найден процесс на порту 3000, останавливаем..."
    kill -9 $FRONTEND_PROCESS
    print_success "Процесс на порту 3000 остановлен"
fi

echo ""
print_success "🎉 Все сервисы Miscord остановлены!"
echo ""
echo "📝 Для повторного запуска выполните: ./start-local-dev.sh"
echo "🐳 Для запуска через Docker: docker-compose up -d"
echo ""
