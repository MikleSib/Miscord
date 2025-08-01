#!/bin/bash

echo "🚀 Коммит изменений и подготовка к развертыванию"

# Добавляем все файлы
echo "📝 Добавление файлов в git..."
git add .

# Коммитим изменения
echo "💾 Коммит изменений..."
git commit -m "feat: добавлена поддержка домена miscord.ru с SSL

- Настроен Nginx с SSL сертификатами от Let's Encrypt
- Добавлено автоматическое перенаправление HTTP -> HTTPS
- Настроена проксификация API и WebSocket через домен
- Обновлены CORS настройки для работы с доменом
- Добавлены скрипты автоматического развертывания
- Настроено автообновление SSL сертификатов"

# Пушим в репозиторий
echo "🌐 Отправка в репозиторий..."
git push

echo "✅ Изменения закоммичены и отправлены!"
echo ""
echo "📋 Следующие шаги для развертывания на сервере:"
echo "1. Подключитесь к серверу: ssh user@195.19.93.203"
echo "2. Перейдите в директорию проекта: cd /path/to/Miscord"
echo "3. Получите обновления: git pull"
echo "4. Запустите развертывание: chmod +x deploy.sh && ./deploy.sh"
echo ""
echo "🌐 После развертывания сайт будет доступен: https://miscord.ru" 