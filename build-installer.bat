@echo off
echo 🚀 Создание установочного файла Miscord...
echo.

cd frontend
echo 📦 Устанавливаем зависимости...
npm install

echo.
echo 🔨 Собираем установщик...
npm run build-installer

echo.
echo ✅ Готово! Проверьте папку frontend/dist/
echo 📁 Там будет файл Miscord Setup.exe
echo.

pause
