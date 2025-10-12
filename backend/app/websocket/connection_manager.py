from typing import Dict, List, Set
from fastapi import WebSocket
import json
import redis.asyncio as redis
import asyncio

class ConnectionManager:
    def __init__(self):
        # Активные WebSocket соединения по user_id
        self.active_connections: Dict[int, List[WebSocket]] = {}
        # Соединения по каналам {channel_id: {user_id: websocket}}
        self.channel_connections: Dict[int, Dict[int, WebSocket]] = {}
        self.redis_client = None
        self.pubsub_task = None

    async def init_redis(self):
        """Инициализация Redis и запуск слушателя pub/sub."""
        try:
            self.redis_client = redis.from_url("redis://redis:6379")
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
                await pubsub.psubscribe("user:*", "channel:*", "broadcast")
                print("Subscribed to user:*, channel:* patterns and broadcast channel in Redis")
                
                while True:
                    message = await pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
                    if not message:
                        await asyncio.sleep(0.01)
                        continue

                    # Обрабатываем разные типы сообщений
                    if message.get("type") == "pmessage":
                        raw_channel = message['channel'].decode('utf-8')
                        data = message['data'].decode('utf-8')

                        if raw_channel.startswith("user:"):
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
                    
                    elif message.get("type") == "message" and message.get("channel") == b"broadcast":
                        # Broadcast сообщение - отправляем всем подключенным пользователям
                        data = message['data'].decode('utf-8')
                        print(f"Redis: Broadcasting message to all users: {data}")
                        all_users = list(self.active_connections.keys())
                        for user_id in all_users:
                            await self._send_to_user_str(user_id, data)
            
            except Exception as e:
                print(f"Error in Redis listener: {e}. Reconnecting in 5 seconds...")
                await asyncio.sleep(5)


    async def connect(self, websocket: WebSocket, user_id: int, channel_id: int = None):
        """Подключение WebSocket."""
        await websocket.accept()
        
        if user_id not in self.active_connections:
            self.active_connections[user_id] = []
        self.active_connections[user_id].append(websocket)
        
        if channel_id:
            if channel_id not in self.channel_connections:
                self.channel_connections[channel_id] = {}
            self.channel_connections[channel_id][user_id] = websocket

    async def disconnect(self, websocket: WebSocket, user_id: int, channel_id: int = None):
        """Отключение WebSocket."""
        if user_id in self.active_connections:
            if websocket in self.active_connections[user_id]:
                self.active_connections[user_id].remove(websocket)
            if not self.active_connections[user_id]:
                del self.active_connections[user_id]
        
        if channel_id and channel_id in self.channel_connections:
            if user_id in self.channel_connections[channel_id]:
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
        if self.redis_client:
            channel = f"channel:{channel_id}"
            await self.redis_client.publish(channel, json.dumps(message))
        else:
            # Fallback для локальной разработки без Redis
            await self._send_to_channel_str(channel_id, json.dumps(message))

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
        if channel_id in self.channel_connections:
            disconnected_users = []
            for user_id, websocket in self.channel_connections[channel_id].items():
                try:
                    await websocket.send_text(message_str)
                except Exception:
                    disconnected_users.append(user_id)

            for user_id in disconnected_users:
                del self.channel_connections[channel_id][user_id]

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
