#!/bin/bash

echo "🔧 Исправление пути к SSL сертификату"

# Проверяем где находится сертификат
echo "📋 Проверка расположения сертификата..."
docker-compose exec nginx ls -la /etc/letsencrypt/live/

# Копируем исправленную SSL конфигурацию
echo "📝 Применение исправленной SSL конфигурации..."
cp nginx/nginx.conf.ssl nginx/nginx.conf

# Проверяем конфигурацию Nginx
echo "✅ Проверка конфигурации Nginx..."
docker-compose exec nginx nginx -t

if [ $? -eq 0 ]; then
    echo "✅ Конфигурация корректна!"
    
    # Перезагружаем Nginx
    echo "🔄 Перезагрузка Nginx..."
    docker-compose exec nginx nginx -s reload
    
    # Проверяем статус
    echo "📊 Статус контейнеров:"
    docker-compose ps
    
    echo ""
    echo "✅ SSL исправлен! Сайт должен работать по адресу: https://miscord.ru"
    
else
    echo "❌ Ошибка в конфигурации Nginx!"
    echo "📋 Проверьте логи: docker-compose logs nginx"
fi 