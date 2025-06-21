#!/bin/bash

echo "🔧 Коммит исправлений Mixed Content"

# Добавляем все файлы
echo "📝 Добавление файлов в git..."
git add .

# Коммитим изменения
echo "💾 Коммит исправлений..."
git commit -m "fix: исправлена проблема Mixed Content для HTTPS

- Обновлены fallback URL в сервисах фронтенда с HTTP на HTTPS
- Исправлен next.config.js для правильного rewrite API
- Добавлены build-time переменные окружения в Dockerfile
- Обновлен docker-compose.yml с build args
- Добавлен скрипт update-frontend.sh для обновления
- Создана инструкция FIX-MIXED-CONTENT.md

Теперь все запросы используют HTTPS/WSS протоколы:
- API: https://miscord.ru/api/*
- WebSocket: wss://miscord.ru/ws/*"

# Пушим в репозиторий
echo "🌐 Отправка в репозиторий..."
git push

echo "✅ Исправления закоммичены и отправлены!"
echo ""
echo "📋 Следующие шаги для применения на сервере:"
echo "1. Подключитесь к серверу: ssh user@195.19.93.203"
echo "2. Перейдите в директорию проекта: cd /path/to/Miscord"
echo "3. Получите обновления: git pull"
echo "4. Запустите обновление фронтенда: chmod +x update-frontend.sh && ./update-frontend.sh"
echo ""
echo "🌐 После обновления проверьте: https://miscord.ru"
echo "📋 Mixed Content ошибки должны исчезнуть!" 