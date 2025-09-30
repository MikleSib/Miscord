const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('🚀 Создаем portable установщик для Miscord...');

try {
  // 1. Создаем папку для установщика
  const installerDir = path.join(__dirname, '../MiscordInstaller');
  if (fs.existsSync(installerDir)) {
    fs.rmSync(installerDir, { recursive: true });
  }
  fs.mkdirSync(installerDir, { recursive: true });
  
  // 2. Копируем Electron файлы
  console.log('📁 Копируем Electron файлы...');
  fs.mkdirSync(path.join(installerDir, 'electron'), { recursive: true });
  fs.copyFileSync(
    path.join(__dirname, '../electron/main.js'),
    path.join(installerDir, 'electron/main.js')
  );
  fs.copyFileSync(
    path.join(__dirname, '../electron/preload.js'),
    path.join(installerDir, 'electron/preload.js')
  );
  
  // 3. Создаем упрощенный package.json
  const packageJson = {
    "name": "miscord-desktop",
    "version": "1.0.0",
    "description": "Miscord Desktop App",
    "main": "electron/main.js",
    "scripts": {
      "start": "electron ."
    },
    "dependencies": {
      "electron": "^27.3.11"
    }
  };
  
  fs.writeFileSync(
    path.join(installerDir, 'package.json'),
    JSON.stringify(packageJson, null, 2)
  );
  
  // 4. Создаем установочный скрипт
  console.log('📝 Создаем установочный скрипт...');
  const installScript = `@echo off
title Miscord Installer
echo ========================================
echo    Miscord Desktop App Installer
echo ========================================
echo.
echo Этот установщик установит Miscord на ваш компьютер
echo.
pause

echo.
echo Проверяем наличие Node.js...
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo ОШИБКА: Node.js не установлен!
    echo.
    echo Miscord требует Node.js для работы.
    echo Скачайте и установите Node.js с https://nodejs.org/
    echo После установки запустите этот установщик снова.
    echo.
    pause
    exit /b 1
)

echo Node.js найден!
echo.
echo Устанавливаем зависимости...
npm install --silent

echo.
echo Создаем ярлык на рабочем столе...
set "desktop=%USERPROFILE%\\Desktop"
set "shortcut=%desktop%\\Miscord.lnk"

powershell -Command "$WshShell = New-Object -comObject WScript.Shell; $Shortcut = $WshShell.CreateShortcut('%shortcut%'); $Shortcut.TargetPath = 'cmd.exe'; $Shortcut.Arguments = '/c \"cd /d \"%CD%\" && npm start\"'; $Shortcut.WorkingDirectory = '%CD%'; $Shortcut.Description = 'Miscord Desktop App'; $Shortcut.Save()"

echo.
echo Создаем ярлык в меню Пуск...
set "startMenu=%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs"
set "startShortcut=%startMenu%\\Miscord.lnk"

powershell -Command "$WshShell = New-Object -comObject WScript.Shell; $Shortcut = $WshShell.CreateShortcut('%startShortcut%'); $Shortcut.TargetPath = 'cmd.exe'; $Shortcut.Arguments = '/c \"cd /d \"%CD%\" && npm start\"'; $Shortcut.WorkingDirectory = '%CD%'; $Shortcut.Description = 'Miscord Desktop App'; $Shortcut.Save()"

echo.
echo ========================================
echo    Установка завершена успешно!
echo ========================================
echo.
echo Miscord установлен и готов к использованию.
echo Ярлыки созданы на рабочем столе и в меню Пуск.
echo.
echo Для запуска используйте ярлык или выполните:
echo npm start
echo.
pause
`;

  fs.writeFileSync(path.join(installerDir, 'install.bat'), installScript);
  
  // 5. Создаем README
  const readme = `# Miscord Desktop App

## Что это?
Десктопное приложение для Miscord, которое открывает stream-cash.ru в отдельном окне.

## Установка
1. Запустите install.bat от имени администратора
2. Следуйте инструкциям установщика

## Запуск
- Используйте ярлык на рабочем столе
- Или ярлык в меню Пуск
- Или выполните: npm start

## Требования
- Windows 10+
- Node.js 16+
- Интернет соединение

## Возможности
- Открывает stream-cash.ru в отдельном окне
- Внешние ссылки открываются в браузере
- Кастомная панель заголовка
- Управление окном

## Удаление
Просто удалите папку с приложением и ярлыки.
`;

  fs.writeFileSync(path.join(installerDir, 'README.txt'), readme);
  
  // 6. Создаем ZIP архив
  console.log('📦 Создаем архив...');
  const zipPath = path.join(__dirname, '../MiscordInstaller.zip');
  if (fs.existsSync(zipPath)) {
    fs.unlinkSync(zipPath);
  }
  
  // Используем PowerShell для создания ZIP
  const zipCommand = `powershell -Command "Compress-Archive -Path '${installerDir}\\*' -DestinationPath '${zipPath}'"`;
  execSync(zipCommand, { stdio: 'inherit' });
  
  console.log('✅ Portable установщик создан успешно!');
  console.log(`📁 Файл: ${zipPath}`);
  console.log('📋 Распакуйте архив и запустите install.bat для установки');
  
} catch (error) {
  console.error('❌ Ошибка:', error.message);
  process.exit(1);
}




