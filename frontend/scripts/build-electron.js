const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🚀 Начинаем сборку Electron приложения...');

try {
  // Устанавливаем переменную окружения для Electron
  process.env.ELECTRON = 'true';
  
  // Собираем Next.js приложение для статического экспорта
  console.log('📦 Собираем Next.js приложение...');
  execSync('npm run build', { stdio: 'inherit' });
  
  // Проверяем, что папка out создалась
  const outDir = path.join(__dirname, '../out');
  if (!fs.existsSync(outDir)) {
    throw new Error('Папка out не найдена. Проверьте настройки Next.js.');
  }
  
  console.log('✅ Next.js приложение собрано успешно!');
  console.log('🎯 Готово для запуска Electron!');
  
} catch (error) {
  console.error('❌ Ошибка при сборке:', error.message);
  process.exit(1);
}
