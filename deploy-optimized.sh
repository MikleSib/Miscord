#!/bin/bash

echo "🚀 Деплой оптимизированной версии Miscord"
echo "=========================================="

# Проверяем, что мы в правильной директории
if [ ! -f "docker-compose.yml" ]; then
    echo "❌ Файл docker-compose.yml не найден. Убедитесь, что вы в корневой директории проекта."
    exit 1
fi

echo "📦 Останавливаем текущие контейнеры..."
docker-compose down

echo "🏗️ Пересобираем образы..."
docker-compose build --no-cache

echo "🚀 Запускаем обновленные контейнеры..."
docker-compose up -d

echo "⏳ Ждем запуска сервисов (30 секунд)..."
sleep 30

echo "✅ Проверяем статус контейнеров:"
docker-compose ps

echo ""
echo "📊 Мониторинг WebSocket соединений:"
echo "=================================="
echo ""
echo "🔍 Для мониторинга в реальном времени используйте:"
echo ""
echo "# Все WebSocket логи:"
echo "docker-compose logs -f backend | grep -E '\\[VOICE_WS\\]|\\[ConnectionManager\\]|\\[WS_CHAT\\]'"
echo ""
echo "# Только голосовые соединения:"
echo "docker-compose logs -f backend | grep '\\[VOICE_WS\\]'"
echo ""
echo "# Только управление соединениями:"
echo "docker-compose logs -f backend | grep '\\[ConnectionManager\\]'"
echo ""

echo "🌐 Проверка доступности:"
echo "========================"
echo "Frontend: https://miscord.ru"
echo "Backend API: https://miscord.ru/api/health"
echo ""

echo "📋 Для отладки в браузере выполните в консоли:"
echo "=============================================="
echo "// Проверка состояния чата:"
echo "chatService.getConnectionState()"
echo ""
echo "// Количество audio/video элементов:"
echo "console.log('Audio elements:', document.querySelectorAll('audio[id^=\"remote-audio-\"]').length)"
echo "console.log('Video elements:', document.querySelectorAll('video[id^=\"remote-video-\"]').length)"
echo ""

echo "✅ Деплой завершен! Проверьте работу WebSocket соединений."
echo ""
echo "📖 Подробная документация по оптимизации: WEBSOCKET_OPTIMIZATION.md"
echo ""

# Показываем последние 50 строк логов для быстрой проверки
echo "📜 Последние логи backend (последние 50 строк):"
echo "=============================================="
docker-compose logs --tail=50 backend

echo ""
echo "🔄 Для продолжения мониторинга в реальном времени выполните:"
echo "docker-compose logs -f backend | grep -E '\\[VOICE_WS\\]|\\[ConnectionManager\\]|\\[WS_CHAT\\]'"