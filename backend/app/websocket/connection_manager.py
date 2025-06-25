from typing import Dict, List, Set
from fastapi import WebSocket
import json
import redis.asyncio as redis
from app.core.config import settings
from sqlalchemy.ext.asyncio import AsyncSession

class ConnectionManager:
    def __init__(self):
        # Активные WebSocket соединения по user_id
        self.active_connections: Dict[int, List[WebSocket]] = {}
        # Соединения по каналам
        self.channel_connections: Dict[int, Dict[int, WebSocket]] = {}
        self.redis_client = None
    
    async def init_redis(self):
        """Инициализация Redis для pub/sub"""
        try:
            self.redis_client = redis.from_url("redis://redis:6379")
            await self.redis_client.ping()
            print("Redis connected successfully")
        except Exception as e:
            print(f"Redis connection failed: {e}")
            self.redis_client = None
    
    async def connect(self, websocket: WebSocket, user_id: int, channel_id: int = None):
        """Подключение WebSocket"""
        print(f"[ConnectionManager] 🔌 Подключение WebSocket для пользователя {user_id}, канал: {channel_id}")
        await websocket.accept()
        
        # Добавляем соединение для пользователя
        if user_id not in self.active_connections:
            self.active_connections[user_id] = []
            print(f"[ConnectionManager] 🆕 Создан новый список соединений для пользователя {user_id}")
        
        self.active_connections[user_id].append(websocket)
        print(f"[ConnectionManager] ✅ Добавлено соединение для пользователя {user_id} (всего: {len(self.active_connections[user_id])})")
        
        # Если указан канал, добавляем в канальные соединения
        if channel_id:
            if channel_id not in self.channel_connections:
                self.channel_connections[channel_id] = {}
                print(f"[ConnectionManager] 🆕 Создано хранилище соединений для канала {channel_id}")
            self.channel_connections[channel_id][user_id] = websocket
            print(f"[ConnectionManager] ✅ Пользователь {user_id} добавлен в канал {channel_id}")
        
        print(f"[ConnectionManager] 📊 Текущее состояние: {len(self.active_connections)} пользователей, {len(self.channel_connections)} каналов")
    
    async def disconnect(self, websocket: WebSocket, user_id: int, channel_id: int = None):
        """Отключение WebSocket"""
        print(f"[ConnectionManager] 🔌 Отключение WebSocket для пользователя {user_id}, канал: {channel_id}")
        
        # Удаляем из пользовательских соединений
        if user_id in self.active_connections:
            if websocket in self.active_connections[user_id]:
                self.active_connections[user_id].remove(websocket)
                print(f"[ConnectionManager] 🗑️ Удалено соединение для пользователя {user_id} (осталось: {len(self.active_connections[user_id])})")
            
            if not self.active_connections[user_id]:
                del self.active_connections[user_id]
                print(f"[ConnectionManager] 🗑️ Удален пользователь {user_id} - нет активных соединений")
        else:
            print(f"[ConnectionManager] ⚠️ Пользователь {user_id} не найден в активных соединениях")
        
        # Удаляем из канальных соединений
        if channel_id and channel_id in self.channel_connections:
            if user_id in self.channel_connections[channel_id]:
                del self.channel_connections[channel_id][user_id]
                print(f"[ConnectionManager] 🗑️ Пользователь {user_id} удален из канала {channel_id}")
            if not self.channel_connections[channel_id]:
                del self.channel_connections[channel_id]
                print(f"[ConnectionManager] 🗑️ Канал {channel_id} удален - нет активных пользователей")
        
        print(f"[ConnectionManager] 📊 Состояние после отключения: {len(self.active_connections)} пользователей, {len(self.channel_connections)} каналов")
    
    async def send_personal_message(self, message: str, websocket: WebSocket):
        """Отправка личного сообщения"""
        await websocket.send_text(message)
    
    async def send_to_channel(self, channel_id: int, message: dict):
        """Отправка сообщения всем участникам канала"""
        if channel_id in self.channel_connections:
            message_str = json.dumps(message)
            disconnected = []
            
            for user_id, websocket in self.channel_connections[channel_id].items():
                try:
                    await websocket.send_text(message_str)
                except:
                    disconnected.append(user_id)
            
            # Удаляем отключенные соединения
            for user_id in disconnected:
                if user_id in self.channel_connections[channel_id]:
                    del self.channel_connections[channel_id][user_id]
    
    async def send_to_user(self, user_id: int, message: dict):
        """Отправка сообщения конкретному пользователю"""
        if user_id in self.active_connections:
            message_str = json.dumps(message)
            disconnected = []
            
            for websocket in self.active_connections[user_id]:
                try:
                    await websocket.send_text(message_str)
                except:
                    disconnected.append(websocket)
            
            # Удаляем отключенные соединения
            for websocket in disconnected:
                if websocket in self.active_connections[user_id]:
                    self.active_connections[user_id].remove(websocket)
    
    async def broadcast_to_all(self, message: dict):
        """Отправка сообщения всем подключенным пользователям"""
        message_str = json.dumps(message)
        disconnected_users = []
        
        for user_id, connections in self.active_connections.items():
            disconnected_connections = []
            
            for websocket in connections:
                try:
                    await websocket.send_text(message_str)
                except:
                    disconnected_connections.append(websocket)
            
            # Удаляем отключенные соединения
            for websocket in disconnected_connections:
                connections.remove(websocket)
            
            # Если у пользователя не осталось соединений, помечаем для удаления
            if not connections:
                disconnected_users.append(user_id)
        
        # Удаляем пользователей без соединений
        for user_id in disconnected_users:
            del self.active_connections[user_id]

    async def broadcast(self, message: dict):
        """Алиас для broadcast_to_all"""
        await self.broadcast_to_all(message)

    def get_connected_users(self) -> Set[int]:
        """Получает список ID подключенных пользователей"""
        return set(self.active_connections.keys())

    def is_user_connected(self, user_id: int) -> bool:
        """Проверяет, подключен ли пользователь"""
        return user_id in self.active_connections and len(self.active_connections[user_id]) > 0
    
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