#!/bin/bash

echo "🚀 Развертывание Miscord с доменом stream-cash.ru"

# Проверяем, что мы на сервере
if [ ! -f "/etc/hostname" ]; then
    echo "❌ Этот скрипт должен запускаться на сервере"
    exit 1
fi

# Останавливаем все контейнеры
echo "🛑 Остановка существующих контейнеров..."
docker-compose down

# Используем начальную конфигурацию Nginx
echo "📋 Копирование начальной конфигурации Nginx..."
cp nginx/nginx-initial.conf nginx/nginx.conf

# Запускаем контейнеры без SSL
echo "🐳 Запуск контейнеров..."
docker-compose up -d postgres redis backend frontend

# Ждем пока сервисы запустятся
echo "⏳ Ожидание запуска сервисов..."
sleep 30

# Запускаем Nginx
echo "🌐 Запуск Nginx..."
docker-compose up -d nginx

# Ждем немного
sleep 10

# Делаем скрипт исполняемым
chmod +x init-letsencrypt.sh

# Получаем SSL сертификат
echo "🔒 Получение SSL сертификата..."
./init-letsencrypt.sh

# Заменяем конфигурацию Nginx на полную с SSL
echo "🔧 Обновление конфигурации Nginx с SSL..."
cp nginx/nginx.conf.ssl nginx/nginx.conf 2>/dev/null || echo "Файл nginx.conf.ssl не найден, используем текущий"

# Перезагружаем Nginx
echo "🔄 Перезагрузка Nginx..."
docker-compose exec nginx nginx -s reload

# Запускаем автообновление сертификатов
echo "🔄 Запуск автообновления сертификатов..."
docker-compose up -d certbot

echo "✅ Развертывание завершено!"
echo "🌐 Сайт доступен по адресу: https://stream-cash.ru"
echo "📊 Проверить статус: docker-compose ps"
echo "📋 Логи: docker-compose logs -f" 