#!/bin/bash

echo "🔄 Обновление фронтенда с новыми URL"

# Остановка фронтенда
echo "🛑 Остановка фронтенда..."
docker-compose stop frontend

# Удаление старого образа
echo "🗑️ Удаление старого образа фронтенда..."
docker-compose rm -f frontend
docker rmi miscord-frontend 2>/dev/null || true

# Очистка кэша Next.js (если запускаем локально)
if [ -d "frontend/.next" ]; then
    echo "🧹 Очистка кэша Next.js..."
    rm -rf frontend/.next
fi

if [ -d "frontend/node_modules/.cache" ]; then
    echo "🧹 Очистка кэша node_modules..."
    rm -rf frontend/node_modules/.cache
fi

# Пересборка фронтенда
echo "🔨 Пересборка фронтенда..."
docker-compose build --no-cache frontend

# Запуск фронтенда
echo "🚀 Запуск фронтенда..."
docker-compose up -d frontend

# Проверка статуса
echo "📊 Проверка статуса..."
sleep 10
docker-compose ps frontend

# Проверка логов
echo "📋 Последние логи фронтенда:"
docker-compose logs --tail=20 frontend

echo "✅ Обновление фронтенда завершено!"
echo "🌐 Проверьте работу сайта: https://miscord.ru" 