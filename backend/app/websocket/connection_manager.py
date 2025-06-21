from typing import Dict, List, Set
from fastapi import WebSocket
import json
import redis.asyncio as redis
from app.core.config import settings

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
        await websocket.accept()
        
        # Добавляем соединение для пользователя
        if user_id not in self.active_connections:
            self.active_connections[user_id] = []
        self.active_connections[user_id].append(websocket)
        
        # Если указан канал, добавляем в канальные соединения
        if channel_id:
            if channel_id not in self.channel_connections:
                self.channel_connections[channel_id] = {}
            self.channel_connections[channel_id][user_id] = websocket
    
    async def disconnect(self, websocket: WebSocket, user_id: int, channel_id: int = None):
        """Отключение WebSocket"""
        # Удаляем из пользовательских соединений
        if user_id in self.active_connections:
            if websocket in self.active_connections[user_id]:
                self.active_connections[user_id].remove(websocket)
            if not self.active_connections[user_id]:
                del self.active_connections[user_id]
        
        # Удаляем из канальных соединений
        if channel_id and channel_id in self.channel_connections:
            if user_id in self.channel_connections[channel_id]:
                del self.channel_connections[channel_id][user_id]
            if not self.channel_connections[channel_id]:
                del self.channel_connections[channel_id]
    
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