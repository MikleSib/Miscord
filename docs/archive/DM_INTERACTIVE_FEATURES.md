# Интерактивные функции для Direct Messages

## Что добавлено

### Frontend
✅ **При наведении на сообщение:**
- Обводка сообщения (фон `bg-[#2c2d32]`)
- Панель действий с кнопками:
  - 😊 Добавить реакцию
  - ↩️ Ответить
  - 🗑️ Удалить (если прошло менее 5 минут)

✅ **Реакции:**
- Выбор из 8 популярных эмодзи: ❤️ 👍 😂 😮 😢 🙏 👏 🔥
- Отображение количества реакций
- Подсветка реакций текущего пользователя
- Всплывающая подсказка с именами пользователей

✅ **Ответы на сообщения:**
- Превью сообщения, на которое отвечаете
- Возможность отменить ответ
- Отображение цепочки ответов (TODO: в будущем)

✅ **Удаление сообщений:**
- Только свои сообщения
- В течение 5 минут после отправки
- Pending сообщения можно удалить всегда

### Backend

#### Модели
✅ **DirectMessage** (`backend/app/models/direct_message.py`):
```python
reply_to_id: Mapped[Optional[int]]  # Ссылка на сообщение-ответ
reactions: Mapped[List["Reaction"]]  # Связь с реакциями
reply_to: Mapped[Optional["DirectMessage"]]  # Связь для ответов
```

✅ **Reaction** (`backend/app/models/reaction.py`):
```python
dm_message_id: Mapped[Optional[int]]  # Для реакций на DM
dm_message: Mapped[Optional["DirectMessage"]]  # Связь с DM
```

#### API Endpoints

✅ **DELETE /api/dms/{message_id}**
- Удаление DM сообщения
- Проверка авторства
- Ограничение: 5 минут
- WebSocket уведомление: `dm_deleted`

✅ **POST /api/dms/{message_id}/reactions**
- Добавление/удаление реакции на DM
- Toggle механика (повторный клик удаляет)
- WebSocket уведомление: `dm_reaction_updated`

#### WebSocket
✅ **handle_dm_message** обновлен для поддержки:
- `reply_to_id` - ID сообщения, на которое отвечаем
- Загрузка связанных данных (attachments, reactions, reply_to)

✅ **Новые события:**
- `dm_deleted` - сообщение удалено
- `dm_reaction_updated` - реакция добавлена/удалена

## Миграция базы данных

**ВАЖНО**: Перед запуском выполните миграцию!

```bash
cd backend
python migrate_dm_interactive.py
```

Миграция добавляет:
1. `reply_to_id` в `direct_messages`
2. `dm_message_id` в `reactions`
3. Делает `message_id` nullable в `reactions`
4. Добавляет constraints для валидации

## Использование

### Добавить реакцию
1. Наведите на любое DM сообщение
2. Нажмите 😊
3. Выберите эмодзи из списка
4. Повторный клик на реакцию удалит её

### Ответить на сообщение
1. Наведите на сообщение
2. Нажмите ↩️
3. Напишите ответ
4. Можно отменить кнопкой X

### Удалить сообщение
1. Наведите на своё сообщение
2. Если прошло менее 5 минут, появится 🗑️
3. Нажмите для удаления
4. Pending сообщения удаляются сразу

## Технические детали

### Frontend State
```typescript
const [replyingTo, setReplyingTo] = useState<DirectMessage | null>(null)
const [hoveredMessageId, setHoveredMessageId] = useState<number | string | null>(null)
const [showEmojiPicker, setShowEmojiPicker] = useState<number | string | null>(null)
```

### API Запросы
```typescript
// Удаление
await api.delete(`/api/dms/${messageId}`)

// Реакция
await api.post(`/api/dms/${messageId}/reactions`, { emoji: '❤️' })
```

### WebSocket События

**Отправка с reply:**
```json
{
  "type": "dm_message",
  "recipient_id": 2,
  "content": "Ответ",
  "reply_to_id": 123
}
```

**Получение удаления:**
```json
{
  "type": "dm_deleted",
  "data": {
    "message_id": 123,
    "sender_id": 1,
    "recipient_id": 2
  }
}
```

**Получение реакции:**
```json
{
  "type": "dm_reaction_updated",
  "data": {
    "message_id": 123,
    "emoji": "❤️",
    "reaction": {
      "id": 1,
      "emoji": "❤️",
      "count": 2,
      "users": [...],
      "current_user_reacted": true
    },
    "was_removed": false
  }
}
```

## Дизайн

### Цвета
- Фон при наведении: `#2c2d32`
- Панель действий: `#1e1f22` с border `#3f4147`
- Реакции активные: `bg-blue-600/20 border-blue-600`
- Реакции неактивные: `bg-[#2c2d32] border-[#3f4147]`

### Иконки (Lucide React)
- Smile - реакции
- Reply - ответы
- Trash2 - удаление
- Clock - pending статус

## TODO (будущее)
- [ ] Отображение цепочки ответов в UI
- [ ] Расширенный выбор эмодзи (emoji picker)
- [ ] Редактирование DM сообщений
- [ ] Пересылка сообщений
- [ ] Закрепление сообщений

## Измененные файлы

### Frontend:
- `frontend/src/components/DirectMessageArea.tsx` - основной UI
- `frontend/src/types/index.ts` - типы (уже обновлены ранее)

### Backend:
- `backend/app/models/direct_message.py` - модель DM
- `backend/app/models/reaction.py` - модель реакций
- `backend/app/api/direct_messages.py` - API эндпоинты
- `backend/app/services/direct_message_service.py` - сервис
- `backend/app/websocket/unified.py` - WebSocket обработчик
- `backend/migrate_dm_interactive.py` - миграция (НОВЫЙ)

