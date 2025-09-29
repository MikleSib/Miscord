const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('🚀 Создаем Electron приложение вручную...');

try {
  // 1. Собираем Next.js приложение
  console.log('📦 Собираем Next.js приложение...');
  process.env.ELECTRON = 'true';
  process.env.NEXT_PUBLIC_API_URL = 'https://stream-cash.ru';
  execSync('npm run build', { stdio: 'inherit', env: { ...process.env } });
  
  // 2. Создаем папку для приложения
  const appDir = path.join(__dirname, '../MiscordApp');
  if (fs.existsSync(appDir)) {
    fs.rmSync(appDir, { recursive: true });
  }
  fs.mkdirSync(appDir, { recursive: true });
  
  // 3. Копируем Next.js сборку
  console.log('📁 Копируем Next.js сборку...');
  execSync(`xcopy "out" "${appDir}\\out" /E /I /H /Y`, { stdio: 'inherit' });
  
  // 4. Копируем Electron файлы
  console.log('⚡ Копируем Electron файлы...');
  execSync(`xcopy "electron" "${appDir}\\electron" /E /I /H /Y`, { stdio: 'inherit' });
  
  // 5. Копируем package.json
  fs.copyFileSync('package.json', path.join(appDir, 'package.json'));
  
  // 6. Создаем батник для запуска
  console.log('🎯 Создаем launcher...');
  const launcherContent = `@echo off
echo Запуск Miscord...
npx electron .
pause`;
  fs.writeFileSync(path.join(appDir, 'start.bat'), launcherContent);
  
  // 7. Создаем README
  const readmeContent = `# Miscord Desktop App

## Запуск
1. Установите Node.js (если не установлен)
2. Запустите start.bat
3. Или выполните: npm install && npx electron .

## Требования
- Node.js 16+
- Windows 10+

## Структура
- out/ - Собранное Next.js приложение
- electron/ - Electron файлы
- package.json - Зависимости
- start.bat - Быстрый запуск
`;
  fs.writeFileSync(path.join(appDir, 'README.txt'), readmeContent);
  
  console.log('✅ Приложение создано в папке MiscordApp/');
  console.log('📁 Запустите MiscordApp/start.bat для тестирования');
  
} catch (error) {
  console.error('❌ Ошибка:', error.message);
  process.exit(1);
}
