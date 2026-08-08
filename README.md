# Miscord — платформа для общения

Miscord — самостоятельное веб-приложение для общения с текстовыми и голосовыми каналами.

## Возможности

- 🔐 Система регистрации и входа
- 🏢 Создание серверов (каналов)
- 💬 Текстовые каналы для общения
- 🎤 Голосовые каналы с WebRTC
- 🔔 Уведомления в реальном времени
- 🌙 Фирменная тёмная тема Miscord

## Технологии

### Backend
- **Python 3.11** с **FastAPI**
- **PostgreSQL** для хранения данных
- **Redis** для кеширования и pub/sub
- **SQLAlchemy** ORM
- **WebSocket** для реального времени
- **WebRTC** (aiortc) для голосовой связи

### Frontend
- **React 18** с **TypeScript**
- **Material-UI** для компонентов
- **Redux Toolkit** для управления состоянием
- **WebSocket** для чата
- **WebRTC** для голосовой связи

## Быстрый старт

### Предварительные требования

- Docker и Docker Compose
- Git

### Установка и запуск

1. Клонируйте репозиторий:
```bash
git clone <repository-url>
cd Miscord
```

2. Запустите приложение с помощью Docker Compose:
```bash
docker-compose up -d
```

3. Приложение будет доступно:
   - Frontend: http://localhost:3000
   - Backend API: http://localhost:8000
   - API документация: http://localhost:8000/docs

### Первоначальная настройка

1. Откройте http://localhost:3000
2. Зарегистрируйте новый аккаунт
3. Создайте свой первый сервер
4. Пригласите друзей и начните общение!

## Структура проекта

```
Miscord/
├── backend/               # Backend на FastAPI
│   ├── app/
│   │   ├── api/          # API эндпоинты
│   │   ├── core/         # Конфигурация и безопасность
│   │   ├── db/           # Подключение к БД
│   │   ├── models/       # SQLAlchemy модели
│   │   ├── schemas/      # Pydantic схемы
│   │   ├── services/     # Бизнес-логика
│   │   └── websocket/    # WebSocket обработчики
│   ├── main.py           # Точка входа
│   ├── requirements.txt  # Python зависимости
│   └── Dockerfile
├── frontend/             # Frontend на React
│   ├── src/
│   │   ├── components/   # React компоненты
│   │   ├── pages/        # Страницы приложения
│   │   ├── services/     # API сервисы
│   │   ├── store/        # Redux store
│   │   ├── types/        # TypeScript типы
│   │   └── utils/        # Утилиты
│   ├── package.json      # NPM зависимости
│   └── Dockerfile
└── docker-compose.yml    # Docker конфигурация
```

## API Endpoints

### Аутентификация
- `POST /api/auth/register` - Регистрация
- `POST /api/auth/login` - Вход

### Каналы
- `GET /api/channels` - Список каналов пользователя
- `POST /api/channels` - Создать канал
- `GET /api/channels/{id}` - Информация о канале
- `POST /api/channels/{id}/join` - Присоединиться к каналу

### WebSocket
- `/ws/chat/{channel_id}` - Подключение к чату
- `/ws/voice/{voice_channel_id}` - Подключение к голосовому каналу

## Разработка

### Backend разработка

```bash
cd backend
python -m venv venv
source venv/bin/activate  # На Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload
```

### Frontend разработка

```bash
cd frontend
npm install
npm start
```

## Переменные окружения

### Backend (.env)
```
DATABASE_URL=postgresql://miscord_user:miscord_password@localhost:5432/miscord
REDIS_URL=redis://localhost:6379
SECRET_KEY=your-secret-key-here
CORS_ORIGINS=["http://localhost:3000"]
```

### Frontend (.env)
```
REACT_APP_API_URL=http://localhost:8000
REACT_APP_WS_URL=ws://localhost:8000
```

## Лицензия

MIT License
