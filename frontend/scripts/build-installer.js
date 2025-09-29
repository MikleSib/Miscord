const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🚀 Создаем установочный файл для Miscord...');

try {
  // 1. Устанавливаем переменные окружения
  process.env.ELECTRON = 'true';
  process.env.NODE_ENV = 'production';
  
  // 2. Собираем Next.js приложение (хотя оно не нужно для веб-версии)
  console.log('📦 Подготавливаем файлы...');
  
  // 3. Создаем папку для сборки
  const buildDir = path.join(__dirname, '../dist');
  if (fs.existsSync(buildDir)) {
    fs.rmSync(buildDir, { recursive: true });
  }
  
  // 4. Копируем необходимые файлы
  console.log('📁 Копируем Electron файлы...');
  fs.mkdirSync(path.join(buildDir, 'electron'), { recursive: true });
  
  // Копируем main.js и preload.js
  fs.copyFileSync(
    path.join(__dirname, '../electron/main.js'),
    path.join(buildDir, 'electron/main.js')
  );
  fs.copyFileSync(
    path.join(__dirname, '../electron/preload.js'),
    path.join(buildDir, 'electron/preload.js')
  );
  
  // Копируем package.json
  const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  // Убираем dev зависимости для установщика
  delete packageJson.devDependencies;
  packageJson.main = 'electron/main.js';
  fs.writeFileSync(
    path.join(buildDir, 'package.json'),
    JSON.stringify(packageJson, null, 2)
  );
  
  // 5. Собираем установщик
  console.log('🔨 Собираем установщик...');
  // Явно отключаем код-подпись на Windows, чтобы избежать ошибок winCodeSign
  // Полностью вычищаем переменные окружения, связанные с подписью
  delete process.env.CSC_LINK;
  delete process.env.WIN_CSC_LINK;
  delete process.env.CSC_KEY_PASSWORD;
  delete process.env.CSC_NAME;
  delete process.env.CSC_FOR_PULL_REQUEST;
  const buildEnv = { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false', DISABLE_CODE_SIGNING: 'true' };

  // На Windows дополнительно очищаем переменные в самом командном окружении
  const isWindows = process.platform === 'win32';
  const cmd = isWindows
    ? 'set "WIN_CSC_LINK=" & set "CSC_LINK=" & set "CSC_KEY_PASSWORD=" & npx electron-builder --publish=never'
    : 'npx electron-builder --publish=never';

  execSync(cmd, {
    stdio: 'inherit',
    env: buildEnv
  });
  
  console.log('✅ Установщик создан успешно!');
  console.log('📁 Проверьте папку dist/ для готовых файлов');
  
} catch (error) {
  console.error('❌ Ошибка при создании установщика:', error.message);
  process.exit(1);
}
