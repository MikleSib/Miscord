#!/bin/bash

# Быстрый старт для Ubuntu 22.04
# Этот скрипт запускает весь процесс автоматически

echo "🚀 Быстрый старт Miscord на Ubuntu 22.04"
echo "========================================"

# Проверяем права root
if [ "$EUID" -eq 0 ]; then
    echo "❌ Не запускайте этот скрипт от root. Используйте обычного пользователя с sudo правами."
    exit 1
fi

# Проверяем Ubuntu
if ! grep -q "Ubuntu" /etc/os-release; then
    echo "❌ Этот скрипт предназначен для Ubuntu 22.04"
    exit 1
fi

echo "📋 Выберите действие:"
echo "1) Полная установка (система + приложение) - РЕКОМЕНДУЕТСЯ"
echo "2) Только установка системы (ubuntu-setup.sh)"
echo "3) Только развертывание приложения (auto-deploy.sh)"
echo "4) Выход"

read -p "Ваш выбор (1-4): " choice

case $choice in
    1)
        echo "🚀 Запуск полной установки..."
        
        # Делаем скрипты исполняемыми
        chmod +x ubuntu-setup.sh auto-deploy.sh deploy.sh init-letsencrypt.sh
        
        echo "📋 Начинаем с установки системы..."
        ./ubuntu-setup.sh
        
        echo ""
        echo "🔄 Система будет перезагружена."
        echo "После перезагрузки запустите:"
        echo "  cd /opt/miscord && ./auto-deploy.sh"
        ;;
    2)
        echo "🔧 Установка только системы..."
        chmod +x ubuntu-setup.sh
        ./ubuntu-setup.sh
        ;;
    3)
        echo "🐳 Развертывание только приложения..."
        chmod +x auto-deploy.sh deploy.sh init-letsencrypt.sh
        ./auto-deploy.sh
        ;;
    4)
        echo "👋 До свидания!"
        exit 0
        ;;
    *)
        echo "❌ Неверный выбор"
        exit 1
        ;;
esac
