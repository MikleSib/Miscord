from typing import Dict, List, Set
from fastapi import WebSocket
import json
import redis.asyncio as redis
import asyncio

from app.core.config import settings

class ConnectionManager:
    def __init__(self):
        # Активные WebSocket соединения по user_id
        self.active_connections: Dict[int, List[WebSocket]] = {}
        # Соединения по каналам {channel_id: {user_id: websocket}}
        self.channel_connections: Dict[int, Dict[int, WebSocket]] = {}
        self.voice_channel_connections: Dict[int, Dict[int, WebSocket]] = {}
        self.redis_client = None
        self.pubsub_task = None

    async def init_redis(self):
        """Инициализация Redis и запуск слушателя pub/sub."""
        try:
            self.redis_client = redis.from_url(settings.REDIS_URL)
            await self.redis_client.ping()
            print("Redis connected successfully")
            # Запускаем слушателя в фоне
            self.pubsub_task = asyncio.create_task(self.redis_listener())
        except Exception as e:
            print(f"Redis connection failed: {e}")
            self.redis_client = None

    async def redis_listener(self):
        """Слушает каналы Redis и пересылает сообщения локальным клиентам."""
        if not self.redis_client:
            return

        while True:
            try:
                pubsub = self.redis_client.pubsub()
                # Подписываемся на личные сообщения, сообщения каналов и broadcast
                await pubsub.psubscribe("user:*", "channel:*", "voice:*", "broadcast")
                print("Subscribed to user:*, channel:* patterns and broadcast channel in Redis")
                
                while True:
                    message = await pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
                    if not message:
                        await asyncio.sleep(0.01)
                        continue

                    # psubscribe всегда отдаёт type=pmessage (не message!)
                    if message.get("type") == "pmessage":
                        raw_channel = message['channel'].decode('utf-8')
                        data = message['data'].decode('utf-8')

                        if raw_channel == "broadcast":
                            # Создание каналов, статус онлайн, смена аватара и т.п.
                            print(f"Redis: Broadcasting message to all users: {data[:200]}")
                            all_users = list(self.active_connections.keys())
                            for user_id in all_users:
                                await self._send_to_user_str(user_id, data)

                        elif raw_channel.startswith("user:"):
                            user_id = int(raw_channel.split(':', 1)[1])
                            if user_id in self.active_connections:
                                print(f"Redis: Forwarding personal message to user {user_id}: {data}")
                                await self._send_to_user_str(user_id, data)
                            else:
                                print(f"Redis: User {user_id} not connected locally, message dropped: {data}")
                        
                        elif raw_channel.startswith("channel:"):
                            channel_id = int(raw_channel.split(':', 1)[1])
                            if channel_id in self.channel_connections:
                                print(f"Redis: Forwarding message to channel {channel_id}")
                                await self._send_to_channel_str(channel_id, data)

                        elif raw_channel.startswith("voice:"):
                            channel_id = int(raw_channel.split(':', 1)[1])
                            if channel_id in self.voice_channel_connections:
                                await self._send_to_voice_channel_str(channel_id, data)
            
            except Exception as e:
                print(f"Error in Redis listener: {e}. Reconnecting in 5 seconds...")
                await asyncio.sleep(5)


    async def connect(self, websocket: WebSocket, user_id: int, channel_id: int = None):
        """Подключение WebSocket."""
        await websocket.accept()
        
        if user_id not in self.active_connections:
            self.active_connections[user_id] = []
        if websocket not in self.active_connections[user_id]:
            self.active_connections[user_id].append(websocket)
        
        if channel_id:
            if channel_id not in self.channel_connections:
                self.channel_connections[channel_id] = {}
            self.channel_connections[channel_id][user_id] = websocket

    async def register_channel(self, websocket: WebSocket, user_id: int, channel_id: int):
        """Привязывает уже принятый WebSocket к каналу, не трогая общую сессию."""
        if channel_id not in self.channel_connections:
            self.channel_connections[channel_id] = {}
        self.channel_connections[channel_id][user_id] = websocket

    async def unregister_channel(self, websocket: WebSocket, user_id: int, channel_id: int):
        """Снимает привязку к каналу, не удаляя WebSocket из active_connections."""
        channel_users = self.channel_connections.get(channel_id)
        if not channel_users:
            return
        if channel_users.get(user_id) is websocket:
            del channel_users[user_id]
        if not channel_users:
            del self.channel_connections[channel_id]

    async def register_voice(self, websocket: WebSocket, user_id: int, channel_id: int):
        if channel_id not in self.voice_channel_connections:
            self.voice_channel_connections[channel_id] = {}
        self.voice_channel_connections[channel_id][user_id] = websocket

    async def unregister_voice(self, websocket: WebSocket, user_id: int, channel_id: int):
        channel_users = self.voice_channel_connections.get(channel_id)
        if not channel_users:
            return
        if channel_users.get(user_id) is websocket:
            del channel_users[user_id]
        if not channel_users:
            del self.voice_channel_connections[channel_id]

    async def disconnect(self, websocket: WebSocket, user_id: int, channel_id: int = None):
        """Отключение WebSocket."""
        if user_id in self.active_connections:
            if websocket in self.active_connections[user_id]:
                self.active_connections[user_id].remove(websocket)
            if not self.active_connections[user_id]:
                del self.active_connections[user_id]
        
        if channel_id and channel_id in self.channel_connections:
            if self.channel_connections[channel_id].get(user_id) is websocket:
                del self.channel_connections[channel_id][user_id]
            if not self.channel_connections[channel_id]:
                del self.channel_connections[channel_id]

    async def send_personal_message(self, message: dict, user_id: int):
        """Отправка личного сообщения через Redis."""
        print(f"[WS] Отправка личного сообщения пользователю {user_id}: {message}")
        if self.redis_client:
            channel = f"user:{user_id}"
            await self.redis_client.publish(channel, json.dumps(message))
            print(f"[WS] Сообщение опубликовано в Redis канал {channel}")
        else:
            # Fallback для локальной разработки без Redis
            print(f"[WS] Redis недоступен, отправка локально пользователю {user_id}")
            await self.send_to_user(user_id, message)

    async def send_to_channel(self, channel_id: int, message: dict):
        """Отправка сообщения в канал через Redis."""
        print(f"[ConnectionManager] send_to_channel вызван для канала {channel_id}, тип сообщения: {message.get('type')}")
        if self.redis_client:
            channel = f"channel:{channel_id}"
            print(f"[ConnectionManager] Публикуем в Redis канал: {channel}")
            await self.redis_client.publish(channel, json.dumps(message))
        else:
            # Fallback для локальной разработки без Redis
            print(f"[ConnectionManager] Redis недоступен, отправка локально")
            await self._send_to_channel_str(channel_id, json.dumps(message))

    async def send_to_voice_channel(self, channel_id: int, message: dict):
        if self.redis_client:
            await self.redis_client.publish(f"voice:{channel_id}", json.dumps(message))
        else:
            await self._send_to_voice_channel_str(channel_id, json.dumps(message))

    async def send_to_user(self, user_id: int, message: dict):
        """Отправка сообщения-словаря конкретному пользователю (локально)."""
        await self._send_to_user_str(user_id, json.dumps(message))

    async def _send_to_user_str(self, user_id: int, message_str: str):
        """Отправляет строковое сообщение всем сессиям пользователя на этом инстансе."""
        if user_id in self.active_connections:
            disconnected_websockets = []
            for websocket in self.active_connections[user_id]:
                try:
                    await websocket.send_text(message_str)
                except Exception:
                    disconnected_websockets.append(websocket)
            
            for websocket in disconnected_websockets:
                self.active_connections[user_id].remove(websocket)

    async def _send_to_channel_str(self, channel_id: int, message_str: str):
        """Отправляет строковое сообщение всем участникам канала на этом инстансе."""
        print(f"[ConnectionManager] _send_to_channel_str вызван для канала {channel_id}")
        print(f"[ConnectionManager] Участники канала: {list(self.channel_connections.get(channel_id, {}).keys())}")
        
        if channel_id in self.channel_connections:
            disconnected_users = []
            sent_count = 0
            for user_id, websocket in self.channel_connections[channel_id].items():
                try:
                    await websocket.send_text(message_str)
                    sent_count += 1
                    print(f"[ConnectionManager] Сообщение отправлено пользователю {user_id} в канале {channel_id}")
                except Exception as e:
                    print(f"[ConnectionManager] Ошибка отправки пользователю {user_id}: {e}")
                    disconnected_users.append(user_id)

            for user_id in disconnected_users:
                del self.channel_connections[channel_id][user_id]
            
            print(f"[ConnectionManager] Отправлено {sent_count} сообщений в канал {channel_id}")
        else:
            print(f"[ConnectionManager] Канал {channel_id} не найден в channel_connections!")

    async def _send_to_voice_channel_str(self, channel_id: int, message_str: str):
        channel = self.voice_channel_connections.get(channel_id, {})
        disconnected_users = []
        for user_id, websocket in list(channel.items()):
            try:
                await websocket.send_text(message_str)
            except Exception:
                disconnected_users.append(user_id)
        for user_id in disconnected_users:
            channel.pop(user_id, None)
        if not channel and channel_id in self.voice_channel_connections:
            del self.voice_channel_connections[channel_id]

    async def broadcast(self, message: dict):
        """Рассылка всем пользователям на всех инстансах (если есть Redis)."""
        message_str = json.dumps(message)
        
        if self.redis_client:
            # Публикуем в специальный broadcast канал Redis
            await self.redis_client.publish("broadcast", message_str)
            print(f"[WS] Broadcast сообщение опубликовано в Redis: {message.get('type')}")
        else:
            # Локальная рассылка (fallback без Redis)
            print(f"[WS] Broadcast локально: {message.get('type')}")
            all_users = list(self.active_connections.keys())
            for user_id in all_users:
                await self._send_to_user_str(user_id, message_str)

    def is_user_connected(self, user_id: int) -> bool:
        """Проверяет, подключен ли пользователь к этому инстансу."""
        return user_id in self.active_connections and len(self.active_connections[user_id]) > 0

# Глобальный экземпляр менеджера
manager = ConnectionManager()
