# Обновление: Поддержка фото в Direct Messages

## Что изменилось

### Frontend
- ✅ Добавлена кнопка загрузки изображений (до 3 файлов)
- ✅ Превью выбранных файлов перед отправкой
- ✅ Отображение изображений в сообщениях DM
- ✅ Оптимистичная отправка с поддержкой вложений
- ✅ Возможность удалять файлы до отправки

### Backend
- ✅ Обновлена модель `DirectMessage` - content теперь nullable
- ✅ Обновлена модель `Attachment` - добавлено поле `dm_message_id`
- ✅ Обновлен сервис `direct_message_service` - поддержка attachments
- ✅ Обновлен WebSocket обработчик `handle_dm_message` - обработка вложений
- ✅ Обновлена схема `DirectMessageSchema` - добавлены attachments

## Запуск миграции базы данных

**ВАЖНО**: Перед запуском приложения выполните миграцию!

```bash
cd backend
python migrate_add_dm_attachments.py
```

Миграция выполняет:
1. Добавляет колонку `dm_message_id` в таблицу `attachments`
2. Делает `message_id` nullable в таблице `attachments`
3. Делает `content` nullable в таблице `direct_messages`

## Использование

### Отправка фото в DM:
1. Откройте чат с другом
2. Нажмите кнопку "+" слева от поля ввода
3. Выберите до 3 изображений
4. Добавьте текст (опционально)
5. Нажмите кнопку отправки

### Возможности:
- Отправка только фото (без текста)
- Отправка текста с фото
- Удаление выбранных файлов до отправки (кнопка X на превью)
- Просмотр изображений в полном размере (клик по изображению)

## Технические детали

### Структура сообщения с вложениями:
```json
{
  "type": "dm_message",
  "recipient_id": 2,
  "content": "Текст сообщения (опционально)",
  "attachments": [
    "https://miscord.ru/uploads/image1.jpg",
    "https://miscord.ru/uploads/image2.jpg"
  ]
}
```

### Ответ от сервера:
```json
{
  "type": "dm",
  "data": {
    "id": 15,
    "content": "Текст",
    "timestamp": "2025-10-13T03:35:36.934570",
    "sender_id": 1,
    "recipient_id": 2,
    "author": { ... },
    "attachments": [
      {
        "id": 1,
        "file_url": "https://miscord.ru/uploads/image1.jpg",
        "message_id": 15
      }
    ],
    "reactions": []
  }
}
```

## Измененные файлы

### Frontend:
- `frontend/src/types/index.ts` - обновлен тип DirectMessage
- `frontend/src/components/DirectMessageArea.tsx` - добавлена поддержка загрузки и отображения
- `frontend/src/services/uploadService.ts` - использован для загрузки файлов

### Backend:
- `backend/app/models/direct_message.py` - добавлены attachments
- `backend/app/models/attachment.py` - добавлено поле dm_message_id
- `backend/app/services/direct_message_service.py` - поддержка attachments
- `backend/app/websocket/unified.py` - обработка attachments в DM
- `backend/app/schemas/message.py` - обновлена DirectMessageSchema
- `backend/migrate_add_dm_attachments.py` - скрипт миграции (НОВЫЙ)

