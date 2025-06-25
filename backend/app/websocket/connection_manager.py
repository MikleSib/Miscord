from typing import Dict, List, Set
from fastapi import WebSocket
import json
import redis.asyncio as redis
import asyncio
import logging
from app.core.config import settings

# Настройка логирования
logger = logging.getLogger(__name__)

class ConnectionManager:
    def __init__(self):
        # Активные WebSocket соединения по user_id
        self.active_connections: Dict[int, List[WebSocket]] = {}
        # Соединения по каналам
        self.channel_connections: Dict[int, Dict[int, WebSocket]] = {}
        self.redis_client = None
        
        # Новые структуры для лучшего отслеживания
        self.connection_metadata: Dict[WebSocket, Dict] = {}
        self.user_channels: Dict[int, Set[int]] = {}  # user_id -> set of channel_ids
        
    async def init_redis(self):
        """Инициализация Redis для pub/sub"""
        try:
            self.redis_client = redis.from_url("redis://redis:6379")
            await self.redis_client.ping()
            logger.info("✅ Redis подключен успешно")
            print("✅ Redis connected successfully")
        except Exception as e:
            logger.error(f"❌ Ошибка подключения Redis: {e}")
            print(f"❌ Redis connection failed: {e}")
            self.redis_client = None
    
    async def connect(self, websocket: WebSocket, user_id: int, channel_id: int = None):
        """Подключение WebSocket с улучшенным отслеживанием"""
        await websocket.accept()
        
        # Сохраняем метаданные соединения
        self.connection_metadata[websocket] = {
            'user_id': user_id,
            'channel_id': channel_id,
            'connected_at': asyncio.get_event_loop().time(),
            'type': 'voice' if channel_id else 'notifications'
        }
        
        # Добавляем соединение для пользователя
        if user_id not in self.active_connections:
            self.active_connections[user_id] = []
        self.active_connections[user_id].append(websocket)
        
        # Если указан канал, добавляем в канальные соединения
        if channel_id:
            if channel_id not in self.channel_connections:
                self.channel_connections[channel_id] = {}
            self.channel_connections[channel_id][user_id] = websocket
            
            # Отслеживаем каналы пользователя
            if user_id not in self.user_channels:
                self.user_channels[user_id] = set()
            self.user_channels[user_id].add(channel_id)
        
        logger.info(f"🔗 WebSocket подключен: user_id={user_id}, channel_id={channel_id}, "
                   f"тип={'голосовой' if channel_id else 'уведомления'}")
        
        # Логируем статистику
        self._log_connection_stats()
    
    async def disconnect(self, websocket: WebSocket, user_id: int = None, channel_id: int = None):
        """Отключение WebSocket с автоматическим определением параметров"""
        
        # Получаем метаданные из сохраненной информации если параметры не переданы
        metadata = self.connection_metadata.get(websocket, {})
        if user_id is None:
            user_id = metadata.get('user_id')
        if channel_id is None:
            channel_id = metadata.get('channel_id')
            
        if user_id is None:
            logger.warning("⚠️ Не удалось определить user_id для отключения WebSocket")
            return
            
        logger.info(f"🔌 Отключение WebSocket: user_id={user_id}, channel_id={channel_id}")
        
        # Удаляем из пользовательских соединений
        if user_id in self.active_connections:
            if websocket in self.active_connections[user_id]:
                self.active_connections[user_id].remove(websocket)
                logger.debug(f"🔌 Удалено соединение пользователя {user_id}")
            if not self.active_connections[user_id]:
                del self.active_connections[user_id]
                logger.debug(f"🔌 Удален пользователь {user_id} из активных соединений")
        
        # Удаляем из канальных соединений
        if channel_id and channel_id in self.channel_connections:
            if user_id in self.channel_connections[channel_id]:
                del self.channel_connections[channel_id][user_id]
                logger.debug(f"🔌 Удален пользователь {user_id} из канала {channel_id}")
            if not self.channel_connections[channel_id]:
                del self.channel_connections[channel_id]
                logger.debug(f"🔌 Удален пустой канал {channel_id}")
                
        # Удаляем из отслеживания каналов пользователя
        if user_id in self.user_channels and channel_id:
            self.user_channels[user_id].discard(channel_id)
            if not self.user_channels[user_id]:
                del self.user_channels[user_id]
                
        # Удаляем метаданные
        if websocket in self.connection_metadata:
            del self.connection_metadata[websocket]
            
        # Логируем статистику
        self._log_connection_stats()
    
    async def send_personal_message(self, message: str, websocket: WebSocket):
        """Отправка личного сообщения"""
        try:
            await websocket.send_text(message)
            logger.debug(f"📤 Отправлено личное сообщение")
        except Exception as e:
            logger.error(f"❌ Ошибка отправки личного сообщения: {e}")
            await self._handle_broken_connection(websocket)
    
    async def send_to_channel(self, channel_id: int, message: dict):
        """Отправка сообщения всем участникам канала"""
        if channel_id not in self.channel_connections:
            logger.debug(f"📤 Канал {channel_id} не найден для отправки сообщения")
            return
            
        message_str = json.dumps(message)
        disconnected = []
        sent_count = 0
        
        for user_id, websocket in self.channel_connections[channel_id].items():
            try:
                await websocket.send_text(message_str)
                sent_count += 1
                logger.debug(f"📤 Сообщение отправлено пользователю {user_id} в канале {channel_id}")
            except Exception as e:
                logger.warning(f"⚠️ Ошибка отправки сообщения пользователю {user_id}: {e}")
                disconnected.append(user_id)
        
        # Удаляем отключенные соединения
        for user_id in disconnected:
            if user_id in self.channel_connections[channel_id]:
                broken_ws = self.channel_connections[channel_id][user_id]
                del self.channel_connections[channel_id][user_id]
                await self._handle_broken_connection(broken_ws)
                
        logger.info(f"📤 Сообщение отправлено {sent_count} пользователям в канале {channel_id}, "
                   f"отключено: {len(disconnected)}")
    
    async def send_to_user(self, user_id: int, message: dict):
        """Отправка сообщения конкретному пользователю"""
        if user_id not in self.active_connections:
            logger.debug(f"📤 Пользователь {user_id} не найден для отправки сообщения")
            return
            
        message_str = json.dumps(message)
        disconnected = []
        sent_count = 0
        
        for websocket in self.active_connections[user_id]:
            try:
                await websocket.send_text(message_str)
                sent_count += 1
                logger.debug(f"📤 Сообщение отправлено пользователю {user_id}")
            except Exception as e:
                logger.warning(f"⚠️ Ошибка отправки сообщения пользователю {user_id}: {e}")
                disconnected.append(websocket)
        
        # Удаляем отключенные соединения
        for websocket in disconnected:
            if websocket in self.active_connections[user_id]:
                self.active_connections[user_id].remove(websocket)
                await self._handle_broken_connection(websocket)
                
        logger.info(f"📤 Сообщение отправлено пользователю {user_id} ({sent_count} соединений), "
                   f"отключено: {len(disconnected)}")
    
    async def broadcast_to_all(self, message: dict):
        """Отправка сообщения всем подключенным пользователям"""
        message_str = json.dumps(message)
        disconnected_users = []
        total_sent = 0
        total_disconnected = 0
        
        for user_id, connections in self.active_connections.items():
            disconnected_connections = []
            user_sent = 0
            
            for websocket in connections:
                try:
                    await websocket.send_text(message_str)
                    user_sent += 1
                    total_sent += 1
                except Exception as e:
                    logger.warning(f"⚠️ Ошибка отправки broadcast сообщения пользователю {user_id}: {e}")
                    disconnected_connections.append(websocket)
                    total_disconnected += 1
            
            # Удаляем отключенные соединения
            for websocket in disconnected_connections:
                connections.remove(websocket)
                await self._handle_broken_connection(websocket)
            
            # Если у пользователя не осталось соединений, помечаем для удаления
            if not connections:
                disconnected_users.append(user_id)
        
        # Удаляем пользователей без соединений
        for user_id in disconnected_users:
            del self.active_connections[user_id]
            if user_id in self.user_channels:
                del self.user_channels[user_id]
                
        logger.info(f"📡 Broadcast сообщение отправлено {total_sent} соединениям, "
                   f"отключено: {total_disconnected}, удалено пользователей: {len(disconnected_users)}")
    
    async def broadcast_to_text_channel(self, text_channel_id: int, message: dict):
        """Рассылка сообщения в текстовый канал"""
        if self.redis_client:
            try:
                await self.redis_client.publish(
                    f"text_channel:{text_channel_id}",
                    json.dumps(message)
                )
                logger.debug(f"📡 Сообщение отправлено в Redis канал text_channel:{text_channel_id}")
            except Exception as e:
                logger.error(f"❌ Ошибка отправки в Redis: {e}")
        else:
            logger.warning("⚠️ Redis недоступен для отправки в текстовый канал")
    
    async def handle_redis_message(self, message):
        """Обработка сообщений из Redis"""
        if message["type"] == "message":
            try:
                channel = message["channel"].decode()
                data = json.loads(message["data"])
                
                # Извлечение channel_id из названия канала
                if channel.startswith("channel:"):
                    channel_id = int(channel.split(":")[1])
                    # Рассылка локальным подключениям
                    if channel_id in self.channel_connections:
                        for user_id, connection in self.channel_connections[channel_id].items():
                            try:
                                await connection.send_json(data)
                            except Exception as e:
                                logger.warning(f"⚠️ Ошибка отправки Redis сообщения пользователю {user_id}: {e}")
                                
                logger.debug(f"📨 Обработано Redis сообщение для канала {channel}")
            except Exception as e:
                logger.error(f"❌ Ошибка обработки Redis сообщения: {e}")
                
    async def _handle_broken_connection(self, websocket: WebSocket):
        """Обработка сломанного соединения"""
        logger.debug("🔧 Обработка сломанного соединения")
        
        # Получаем метаданные для правильной очистки
        metadata = self.connection_metadata.get(websocket, {})
        user_id = metadata.get('user_id')
        channel_id = metadata.get('channel_id')
        
        if user_id:
            await self.disconnect(websocket, user_id, channel_id)
        else:
            # Принудительная очистка если метаданные потеряны
            if websocket in self.connection_metadata:
                del self.connection_metadata[websocket]
                
    def _log_connection_stats(self):
        """Логирование статистики соединений"""
        total_connections = sum(len(connections) for connections in self.active_connections.values())
        total_channels = len(self.channel_connections)
        total_users = len(self.active_connections)
        
        logger.info(f"📊 Статистика соединений: пользователей={total_users}, "
                   f"соединений={total_connections}, каналов={total_channels}")
        
        # Детальная статистика для отладки
        if logger.isEnabledFor(logging.DEBUG):
            for user_id, connections in self.active_connections.items():
                connection_types = []
                for ws in connections:
                    metadata = self.connection_metadata.get(ws, {})
                    connection_types.append(metadata.get('type', 'unknown'))
                logger.debug(f"📊 Пользователь {user_id}: {len(connections)} соединений {connection_types}")
    
    def get_connection_stats(self) -> dict:
        """Получение статистики соединений для API"""
        total_connections = sum(len(connections) for connections in self.active_connections.values())
        
        users_by_type = {'voice': 0, 'notifications': 0, 'unknown': 0}
        connections_by_type = {'voice': 0, 'notifications': 0, 'unknown': 0}
        
        for user_id, connections in self.active_connections.items():
            user_types = set()
            for ws in connections:
                metadata = self.connection_metadata.get(ws, {})
                conn_type = metadata.get('type', 'unknown')
                connections_by_type[conn_type] += 1
                user_types.add(conn_type)
            
            # Пользователь может иметь соединения разных типов
            for user_type in user_types:
                users_by_type[user_type] += 1
        
        return {
            'total_users': len(self.active_connections),
            'total_connections': total_connections,
            'active_channels': len(self.channel_connections),
            'users_by_type': users_by_type,
            'connections_by_type': connections_by_type,
            'redis_connected': self.redis_client is not None
        }
    
    async def cleanup_stale_connections(self):
        """Очистка устаревших соединений"""
        logger.info("🧹 Начинаем очистку устаревших соединений")
        
        current_time = asyncio.get_event_loop().time()
        stale_threshold = 300  # 5 минут
        
        stale_connections = []
        
        # Находим устаревшие соединения
        for websocket, metadata in self.connection_metadata.items():
            connected_at = metadata.get('connected_at', current_time)
            if current_time - connected_at > stale_threshold:
                # Проверяем, активно ли соединение
                try:
                    await websocket.ping()
                except Exception:
                    stale_connections.append(websocket)
        
        # Удаляем устаревшие соединения
        for websocket in stale_connections:
            await self._handle_broken_connection(websocket)
            
        if stale_connections:
            logger.info(f"🧹 Удалено {len(stale_connections)} устаревших соединений")
        else:
            logger.debug("🧹 Устаревших соединений не найдено")

# Глобальный экземпляр менеджера
manager = ConnectionManager()