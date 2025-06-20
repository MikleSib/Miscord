from typing import Dict, List, Set
from fastapi import WebSocket
import json
import redis.asyncio as redis
from app.core.config import settings

class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[int, Dict[int, WebSocket]] = {}  # channel_id -> {user_id -> websocket}
        self.user_channels: Dict[int, Set[int]] = {}  # user_id -> set of channel_ids
        self.redis_client = None
    
    async def init_redis(self):
        """Инициализация Redis клиента"""
        self.redis_client = await redis.from_url(settings.REDIS_URL, decode_responses=True)
        self.pubsub = self.redis_client.pubsub()
    
    async def connect(self, websocket: WebSocket, user_id: int, channel_id: int):
        """Подключение пользователя к каналу"""
        await websocket.accept()
        
        # Добавление в активные соединения
        if channel_id not in self.active_connections:
            self.active_connections[channel_id] = {}
        self.active_connections[channel_id][user_id] = websocket
        
        # Добавление в список каналов пользователя
        if user_id not in self.user_channels:
            self.user_channels[user_id] = set()
        self.user_channels[user_id].add(channel_id)
        
        # Подписка на канал в Redis
        await self.pubsub.subscribe(f"channel:{channel_id}")
        
        # Уведомление о подключении
        await self.broadcast_to_channel(
            channel_id,
            {
                "type": "user_joined",
                "user_id": user_id,
                "channel_id": channel_id
            }
        )
    
    async def disconnect(self, user_id: int, channel_id: int):
        """Отключение пользователя от канала"""
        # Удаление из активных соединений
        if channel_id in self.active_connections:
            if user_id in self.active_connections[channel_id]:
                del self.active_connections[channel_id][user_id]
            if not self.active_connections[channel_id]:
                del self.active_connections[channel_id]
        
        # Удаление из списка каналов пользователя
        if user_id in self.user_channels:
            self.user_channels[user_id].discard(channel_id)
            if not self.user_channels[user_id]:
                del self.user_channels[user_id]
        
        # Отписка от канала в Redis
        await self.pubsub.unsubscribe(f"channel:{channel_id}")
        
        # Уведомление об отключении
        await self.broadcast_to_channel(
            channel_id,
            {
                "type": "user_left",
                "user_id": user_id,
                "channel_id": channel_id
            }
        )
    
    async def send_personal_message(self, message: dict, websocket: WebSocket):
        """Отправка личного сообщения"""
        await websocket.send_json(message)
    
    async def broadcast_to_channel(self, channel_id: int, message: dict):
        """Рассылка сообщения всем пользователям в канале"""
        if channel_id in self.active_connections:
            # Локальная рассылка
            disconnected = []
            for user_id, connection in self.active_connections[channel_id].items():
                try:
                    await connection.send_json(message)
                except:
                    disconnected.append(user_id)
            
            # Удаление отключенных пользователей
            for user_id in disconnected:
                await self.disconnect(user_id, channel_id)
        
        # Публикация в Redis для других серверов
        if self.redis_client:
            await self.redis_client.publish(
                f"channel:{channel_id}",
                json.dumps(message)
            )
    
    async def broadcast_to_text_channel(self, text_channel_id: int, message: dict):
        """Рассылка сообщения в текстовый канал"""
        # Получаем channel_id из text_channel_id (нужно будет передавать отдельно)
        # Для упрощения сейчас используем channel_id напрямую
        await self.redis_client.publish(
            f"text_channel:{text_channel_id}",
            json.dumps(message)
        )
    
    async def handle_redis_message(self, message):
        """Обработка сообщений из Redis"""
        if message["type"] == "message":
            channel = message["channel"].decode()
            data = json.loads(message["data"])
            
            # Извлечение channel_id из названия канала
            if channel.startswith("channel:"):
                channel_id = int(channel.split(":")[1])
                # Рассылка локальным подключениям
                if channel_id in self.active_connections:
                    for user_id, connection in self.active_connections[channel_id].items():
                        try:
                            await connection.send_json(data)
                        except:
                            pass

# Глобальный экземпляр менеджера
manager = ConnectionManager()