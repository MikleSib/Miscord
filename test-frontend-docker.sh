#!/bin/bash

echo "🚀 Тестирование Next.js фронтенда в Docker для Ubuntu 22..."

# Проверка наличия Docker
if ! command -v docker &> /dev/null; then
    echo "❌ Docker не установлен!"
    echo "Установите Docker: curl -fsSL https://get.docker.com | sh"
    exit 1
fi

echo "✅ Docker найден"

# Переход в директорию фронтенда
cd frontend

# Создание package-lock.json если его нет
if [ ! -f "package-lock.json" ]; then
    echo "📦 Создание package-lock.json..."
    npm install --package-lock-only
fi

# Сборка Docker образа
echo "🏗️  Сборка Docker образа..."
docker build -t miscord-frontend:test .

if [ $? -eq 0 ]; then
    echo "✅ Docker образ успешно собран!"
    
    # Запуск контейнера
    echo "🚀 Запуск контейнера..."
    docker run -d --name miscord-frontend-test -p 3000:3000 \
        -e NEXT_PUBLIC_API_URL=http://localhost:8000 \
        -e NEXT_PUBLIC_WS_URL=ws://localhost:8000 \
        miscord-frontend:test
    
    echo "⏳ Ожидание запуска приложения..."
    sleep 10
    
    # Проверка статуса
    if docker ps | grep -q miscord-frontend-test; then
        echo "✅ Контейнер запущен!"
        echo "📱 Приложение доступно по адресу: http://localhost:3000"
        echo ""
        echo "🔍 Логи контейнера:"
        docker logs miscord-frontend-test
        echo ""
        echo "💡 Команды для управления:"
        echo "  - Посмотреть логи: docker logs -f miscord-frontend-test"
        echo "  - Остановить: docker stop miscord-frontend-test"
        echo "  - Удалить: docker rm miscord-frontend-test"
    else
        echo "❌ Ошибка запуска контейнера!"
        docker logs miscord-frontend-test
    fi
else
    echo "❌ Ошибка сборки Docker образа!"
fi