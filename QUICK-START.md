# 🚀 Быстрый старт Miscord

## ⚡ Самый простой способ запуска

### Windows (PowerShell)

```powershell
# 1. Запуск всего приложения одной командой
.\start-local-dev.ps1

# 2. Остановка приложения
.\stop-local-dev.ps1
```

### Linux/macOS (Bash)

```bash
# 1. Запуск всего приложения одной командой
./start-local-dev.sh

# 2. Остановка приложения
./stop-local-dev.sh
```

## 🌐 Что будет доступно после запуска

- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:8000
- **API Documentation**: http://localhost:8000/docs
- **Health Check**: http://localhost:8000/health

## 📋 Предварительные требования

- **Python 3.11+**
- **Node.js 18+**
- **Docker & Docker Compose**
- **Git**

## 🔧 Ручная настройка (если скрипты не работают)

### 1. Запуск базы данных
```bash
docker-compose up -d postgres redis
```

### 2. Backend
```bash
cd backend
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### 3. Frontend
```bash
cd frontend
npm install
npm run dev
```

## 📝 Файлы окружения

Скрипты автоматически создадут необходимые файлы:

**backend/.env:**
```env
DATABASE_URL=postgresql://miscord_user:miscord_password@localhost:5432/miscord
REDIS_URL=redis://localhost:6379
SECRET_KEY=your-secret-key-for-development-change-in-production
CORS_ORIGINS=["http://localhost:3000"]
```

**frontend/.env.local:**
```env
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_WS_URL=ws://localhost:8000
```

## 🐛 Решение проблем

### Проблема: Порты заняты
```bash
# Windows
netstat -ano | findstr :3000
netstat -ano | findstr :8000

# Linux/macOS
lsof -i :3000
lsof -i :8000
```

### Проблема: Docker не запускается
```bash
# Перезапуск Docker Desktop
# Или проверка статуса
docker --version
docker-compose --version
```

### Проблема: Зависимости не устанавливаются
```bash
# Очистка кеша
npm cache clean --force
pip cache purge

# Переустановка
rm -rf node_modules package-lock.json
npm install
```

## 🎯 Готово!

После успешного запуска откройте http://localhost:3000 и начинайте разработку!

Для подробной документации см. [LOCAL-DEVELOPMENT.md](LOCAL-DEVELOPMENT.md)

