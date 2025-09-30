#!/bin/bash

# Bash скрипт для запуска Electron в режиме разработки
echo "🚀 Запуск Miscord Desktop App в режиме разработки..."

# Переходим в папку frontend
cd frontend

# Проверяем, установлены ли зависимости
if [ ! -d "node_modules" ]; then
    echo "📦 Устанавливаем зависимости..."
    npm install
fi

# Запускаем в режиме разработки
echo "🎯 Запускаем Electron приложение..."
npm run electron-dev





