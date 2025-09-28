#!/bin/bash

# Скрипт для перезапуска всех сервисов с TURN сервером
# Использование: ./restart-with-turn.sh

set -e  # Остановить выполнение при ошибке

echo "🚀 Перезапускаем все сервисы с TURN сервером..."

# Проверяем, что мы в правильной директории
if [ ! -f "docker-compose.yml" ]; then
    echo "❌ Ошибка: docker-compose.yml не найден. Запустите скрипт из корневой директории проекта."
    exit 1
fi

# Останавливаем все сервисы
echo "🛑 Останавливаем все сервисы..."
docker-compose down

# Запускаем TURN сервер
echo "🔄 Запускаем TURN сервер..."
docker-compose up -d coturn

# Ждем запуска TURN сервера
echo "⏳ Ждем запуска TURN сервера..."
sleep 5

# Проверяем, что TURN сервер запущен
if docker-compose ps coturn | grep -q "Up"; then
    echo "✅ TURN сервер запущен успешно!"
else
    echo "❌ Ошибка: TURN сервер не запустился"
    echo "📋 Логи TURN сервера:"
    docker-compose logs coturn
    exit 1
fi

# Запускаем остальные сервисы
echo "🚀 Запускаем остальные сервисы..."
docker-compose up -d

# Ждем запуска всех сервисов
echo "⏳ Ждем запуска всех сервисов..."
sleep 10

# Проверяем статус всех контейнеров
echo "📊 Статус всех контейнеров:"
docker-compose ps

# Проверяем, что все сервисы запущены
services=("postgres" "redis" "backend" "frontend" "nginx" "coturn")
all_running=true

for service in "${services[@]}"; do
    if docker-compose ps $service | grep -q "Up"; then
        echo "✅ $service: запущен"
    else
        echo "❌ $service: НЕ запущен"
        all_running=false
    fi
done

if [ "$all_running" = true ]; then
    echo "🎉 Все сервисы запущены успешно!"
    echo "🔊 TURN сервер готов для голосового чата"
    echo "📋 Проверьте логи если что-то не работает:"
    echo "   docker-compose logs [service_name]"
else
    echo "❌ Некоторые сервисы не запустились"
    echo "📋 Логи проблемных сервисов:"
    for service in "${services[@]}"; do
        if ! docker-compose ps $service | grep -q "Up"; then
            echo "--- Логи $service ---"
            docker-compose logs $service
        fi
    done
    exit 1
fi
