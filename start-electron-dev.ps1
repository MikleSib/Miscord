# PowerShell скрипт для запуска Electron в режиме разработки
Write-Host "🚀 Запуск Miscord Desktop App в режиме разработки..." -ForegroundColor Green

# Переходим в папку frontend
Set-Location "frontend"

# Проверяем, установлены ли зависимости
if (!(Test-Path "node_modules")) {
    Write-Host "📦 Устанавливаем зависимости..." -ForegroundColor Yellow
    npm install
}

# Запускаем в режиме разработки
Write-Host "🎯 Запускаем Electron приложение..." -ForegroundColor Cyan
npm run electron-dev





