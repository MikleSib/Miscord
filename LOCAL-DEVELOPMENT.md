# 🚀 Локальная разработка Miscord

## 📋 Обзор проекта

**Miscord** - это Discord-подобное приложение для чата с поддержкой:
- 🔐 Регистрация и авторизация
- 🏢 Серверы и каналы
- 💬 Текстовые каналы
- 🎤 Голосовые каналы (WebRTC)
- 🔔 Real-time уведомления

### Технологии:
- **Backend**: Python 3.11 + FastAPI + PostgreSQL + Redis
- **Frontend**: Next.js 14 + TypeScript + Tailwind CSS
- **WebSocket**: Для real-time чата и уведомлений
- **WebRTC**: Для голосовой связи

## 🛠 Подготовка к запуску

### Предварительные требования:

1. **Python 3.11+**
2. **Node.js 18+** 
3. **PostgreSQL 16+**
4. **Redis 7+**
5. **Git**

## 🚀 Варианты запуска

### Вариант 1: Полный локальный запуск (рекомендуется для разработки)

#### 1. Установка зависимостей

```bash
# Клонирование репозитория
git clone <repository-url>
cd Miscord
```

#### 2. Настройка базы данных

```bash
# Установка PostgreSQL (Ubuntu/Debian)
sudo apt update
sudo apt install postgresql postgresql-contrib

# Создание базы данных
sudo -u postgres psql
CREATE DATABASE miscord;
CREATE USER miscord_user WITH PASSWORD 'miscord_password';
GRANT ALL PRIVILEGES ON DATABASE miscord TO miscord_user;
\q
```

```bash
# Установка Redis (Ubuntu/Debian)
sudo apt install redis-server
sudo systemctl start redis-server
sudo systemctl enable redis-server
```

#### 3. Настройка Backend

```bash
cd backend

# Создание виртуального окружения
python -m venv venv

# Активация (Windows)
venv\Scripts\activate

# Активация (Linux/macOS)
source venv/bin/activate

# Установка зависимостей
pip install -r requirements.txt
```

#### 4. Создание файла окружения для Backend

Создайте файл `backend/.env`:

```env
DATABASE_URL=postgresql://miscord_user:miscord_password@localhost:5432/miscord
REDIS_URL=redis://localhost:6379
SECRET_KEY=your-secret-key-for-development
CORS_ORIGINS=["http://localhost:3000"]
```

#### 5. Запуск Backend

```bash
cd backend
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Backend будет доступен по адресу: http://localhost:8000
API документация: http://localhost:8000/docs

#### 6. Настройка Frontend

```bash
cd frontend

# Установка зависимостей
npm install
```

#### 7. Создание файла окружения для Frontend

Создайте файл `frontend/.env.local`:

```env
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_WS_URL=ws://localhost:8000
```

#### 8. Запуск Frontend

```bash
cd frontend
npm run dev
```

Frontend будет доступен по адресу: http://localhost:3000

### Вариант 2: Docker Compose (быстрый старт)

Если у вас установлен Docker и Docker Compose:

```bash
# Запуск всех сервисов
docker-compose up -d

# Или только база данных и Redis
docker-compose up -d postgres redis

# Затем запускайте backend и frontend локально
```

### Вариант 3: Гибридный подход

```bash
# Запуск только базы данных и Redis в Docker
docker-compose up -d postgres redis

# Backend локально
cd backend
python -m venv venv
source venv/bin/activate  # или venv\Scripts\activate на Windows
pip install -r requirements.txt
uvicorn main:app --reload --host 0.0.0.0 --port 8000

# Frontend локально
cd frontend
npm install
npm run dev
```

## 🔧 Конфигурация

### Переменные окружения Backend (.env):

```env
DATABASE_URL=postgresql://miscord_user:miscord_password@localhost:5432/miscord
REDIS_URL=redis://localhost:6379
SECRET_KEY=your-secret-key-for-development
CORS_ORIGINS=["http://localhost:3000"]
ACCESS_TOKEN_EXPIRE_MINUTES=10080
```

### Переменные окружения Frontend (.env.local):

```env
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_WS_URL=ws://localhost:8000
```

## 🎯 Проверка работоспособности

### 1. Проверка Backend:
```bash
curl http://localhost:8000/health
# Должен вернуть: {"status": "healthy"}

curl http://localhost:8000/
# Должен вернуть информацию об API
```

### 2. Проверка Frontend:
Откройте http://localhost:3000 в браузере

### 3. Проверка базы данных:
```bash
# Подключение к PostgreSQL
psql -h localhost -U miscord_user -d miscord

# Проверка таблиц
\dt
```

### 4. Проверка Redis:
```bash
redis-cli ping
# Должен вернуть: PONG
```

## 🐛 Решение проблем

### Проблема: Backend не может подключиться к PostgreSQL

**Решение:**
```bash
# Проверить статус PostgreSQL
sudo systemctl status postgresql

# Запустить если не запущен
sudo systemctl start postgresql

# Проверить подключение
psql -h localhost -U miscord_user -d miscord
```

### Проблема: Frontend не может подключиться к Backend

**Решение:**
1. Убедитесь, что Backend запущен на порту 8000
2. Проверьте файл `frontend/.env.local`
3. Проверьте CORS настройки в Backend

### Проблема: WebSocket соединения не работают

**Решение:**
1. Проверьте, что Redis запущен
2. Убедитесь, что Backend может подключиться к Redis
3. Проверьте настройки WebSocket в браузере (DevTools -> Network)

### Проблема: Ошибки при установке зависимостей

**Решение:**
```bash
# Обновить pip
pip install --upgrade pip

# Очистить кеш npm
npm cache clean --force

# Удалить node_modules и переустановить
rm -rf node_modules package-lock.json
npm install
```

## 📁 Структура проекта

```
Miscord/
├── backend/                 # Python FastAPI backend
│   ├── app/
│   │   ├── api/            # API endpoints
│   │   ├── core/           # Конфигурация
│   │   ├── db/             # База данных
│   │   ├── models/         # SQLAlchemy модели
│   │   ├── schemas/        # Pydantic схемы
│   │   ├── services/       # Бизнес-логика
│   │   └── websocket/      # WebSocket handlers
│   ├── main.py             # Точка входа
│   └── requirements.txt    # Python зависимости
├── frontend/               # Next.js frontend
│   ├── src/
│   │   ├── app/           # App Router страницы
│   │   ├── components/    # React компоненты
│   │   ├── services/      # API сервисы
│   │   ├── store/         # Zustand store
│   │   └── types/         # TypeScript типы
│   └── package.json       # Node.js зависимости
└── docker-compose.yml     # Docker конфигурация
```

## 🚀 Готовые команды для быстрого старта

### Полный локальный запуск одной командой:

```bash
# 1. Запуск базы данных
docker-compose up -d postgres redis

# 2. Backend (в отдельном терминале)
cd backend && python -m venv venv && source venv/bin/activate && pip install -r requirements.txt && uvicorn main:app --reload --host 0.0.0.0 --port 8000

# 3. Frontend (в отдельном терминале)
cd frontend && npm install && npm run dev
```

## 📝 Полезные команды

```bash
# Просмотр логов Docker
docker-compose logs -f

# Остановка всех сервисов
docker-compose down

# Пересборка образов
docker-compose build --no-cache

# Очистка неиспользуемых образов
docker system prune -a
```

## 🎉 Готово!

После выполнения всех шагов у вас будет работающее приложение:

- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:8000
- **API Docs**: http://localhost:8000/docs
- **Health Check**: http://localhost:8000/health

Можете начинать разработку! 🚀
