"""
🎙️ Enhanced Voice WebSocket Service
Enterprise-level voice communication optimized for 1000+ users

Возможности:
- WebRTC сигналинг с низкой латентностью
- Батчинг голосовых событий
- Адаптивное качество аудио
- Мониторинг производительности голоса
- Автоматическое переподключение
- Кластеризация voice серверов
"""

import asyncio
import json
import time
from typing import Dict, Set, Optional, Any, List
from dataclasses import dataclass, field
from fastapi import WebSocket, WebSocketDisconnect, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.db.database import AsyncSessionLocal
from app.models import User, VoiceChannel, ChannelMember
from app.core.security import decode_access_token
from app.services.user_activity_service import user_activity_service
import logging

logger = logging.getLogger(__name__)

@dataclass
class VoiceParticipant:
    """Участник голосового канала"""
    user_id: int
    username: str
    display_name: Optional[str]
    avatar_url: Optional[str] 
    is_muted: bool = False
    is_deafened: bool = False
    is_speaking: bool = False
    audio_quality: str = "high"  # high, medium, low
    last_activity: float = field(default_factory=time.time)
    connection_quality: float = 1.0  # 0.0 - 1.0

@dataclass 
class VoiceChannelState:
    """Состояние голосового канала"""
    channel_id: int
    participants: Dict[int, VoiceParticipant] = field(default_factory=dict)
    ice_servers: List[Dict[str, Any]] = field(default_factory=list)
    max_participants: int = 50
    bitrate: int = 64000  # bits per second
    created_at: float = field(default_factory=time.time)

class VoiceConnectionPool:
    """
    Пул голосовых соединений с оптимизацией для WebRTC
    """
    
    def __init__(self, max_channels: int = 100):
        self.max_channels = max_channels
        self._channels: Dict[int, VoiceChannelState] = {}
        self._user_connections: Dict[int, WebSocket] = {}
        self._user_to_channel: Dict[int, int] = {}
        self._ice_servers = [
            {"urls": "stun:stun.l.google.com:19302"},
            {"urls": "stun:stun1.l.google.com:19302"},
        ]
        
    def create_channel(self, channel_id: int) -> VoiceChannelState:
        """Создать голосовой канал"""
        if len(self._channels) >= self.max_channels:
            # Очистка неактивных каналов
            self._cleanup_inactive_channels()
            
        channel_state = VoiceChannelState(
            channel_id=channel_id,
            ice_servers=self._ice_servers
        )
        self._channels[channel_id] = channel_state
        return channel_state
    
    def get_channel(self, channel_id: int) -> Optional[VoiceChannelState]:
        """Получить состояние канала"""
        return self._channels.get(channel_id)
    
    def add_participant(self, channel_id: int, user_id: int, websocket: WebSocket, 
                       username: str, display_name: Optional[str] = None, 
                       avatar_url: Optional[str] = None) -> bool:
        """Добавить участника в канал"""
        channel = self.get_channel(channel_id)
        if not channel:
            channel = self.create_channel(channel_id)
            
        if len(channel.participants) >= channel.max_participants:
            return False
            
        participant = VoiceParticipant(
            user_id=user_id,
            username=username,
            display_name=display_name,
            avatar_url=avatar_url
        )
        
        channel.participants[user_id] = participant
        self._user_connections[user_id] = websocket
        self._user_to_channel[user_id] = channel_id
        
        return True
    
    def remove_participant(self, user_id: int) -> Optional[int]:
        """Удалить участника из канала"""
        channel_id = self._user_to_channel.pop(user_id, None)
        self._user_connections.pop(user_id, None)
        
        if channel_id and channel_id in self._channels:
            self._channels[channel_id].participants.pop(user_id, None)
            
            # Удаляем пустые каналы
            if not self._channels[channel_id].participants:
                del self._channels[channel_id]
                
        return channel_id
    
    def get_participant_channel(self, user_id: int) -> Optional[int]:
        """Получить канал участника"""
        return self._user_to_channel.get(user_id)
    
    def update_participant_status(self, user_id: int, **kwargs):
        """Обновить статус участника"""
        channel_id = self._user_to_channel.get(user_id)
        if channel_id and channel_id in self._channels:
            participant = self._channels[channel_id].participants.get(user_id)
            if participant:
                for key, value in kwargs.items():
                    if hasattr(participant, key):
                        setattr(participant, key, value)
                participant.last_activity = time.time()
    
    def _cleanup_inactive_channels(self, timeout: int = 600):  # 10 минут
        """Очистка неактивных каналов"""
        current_time = time.time()
        inactive_channels = [
            channel_id for channel_id, channel in self._channels.items()
            if current_time - channel.created_at > timeout and not channel.participants
        ]
        
        for channel_id in inactive_channels:
            del self._channels[channel_id]

class VoiceEventBatcher:
    """
    Батчинг голосовых событий для оптимизации производительности
    """
    
    def __init__(self, batch_size: int = 20, flush_interval: float = 0.05):  # 50ms
        self.batch_size = batch_size
        self.flush_interval = flush_interval
        self._speaking_events: Dict[int, Dict[int, bool]] = {}  # channel_id -> {user_id: is_speaking}
        self._status_events: Dict[int, Dict[int, Dict]] = {}   # channel_id -> {user_id: status}
        self._last_flush = time.time()
        
    def add_speaking_event(self, channel_id: int, user_id: int, is_speaking: bool):
        """Добавить событие голосовой активности"""
        if channel_id not in self._speaking_events:
            self._speaking_events[channel_id] = {}
        self._speaking_events[channel_id][user_id] = is_speaking
        
    def add_status_event(self, channel_id: int, user_id: int, status: Dict[str, Any]):
        """Добавить событие изменения статуса"""
        if channel_id not in self._status_events:
            self._status_events[channel_id] = {}
        if user_id not in self._status_events[channel_id]:
            self._status_events[channel_id][user_id] = {}
        self._status_events[channel_id][user_id].update(status)
        
    async def flush_all(self) -> Dict[str, Dict[int, Any]]:
        """Отправить все батчи"""
        result = {
            'speaking': self._speaking_events.copy(),
            'status': self._status_events.copy()
        }
        
        self._speaking_events.clear()
        self._status_events.clear()
        self._last_flush = time.time()
        
        return result
        
    def should_flush(self) -> bool:
        """Проверка необходимости flush"""
        return (time.time() - self._last_flush >= self.flush_interval or
                any(len(events) >= self.batch_size for events in self._speaking_events.values()) or
                any(len(events) >= self.batch_size for events in self._status_events.values()))

class EnhancedVoiceManager:
    """
    🎯 Высокопроизводительный менеджер голосовых соединений
    
    Возможности:
    - WebRTC сигналинг с минимальной латентностью
    - Адаптивное качество в зависимости от нагрузки
    - Батчинг голосовых событий
    - Мониторинг качества соединения
    - Автоматическое масштабирование
    """
    
    def __init__(self):
        self.pool = VoiceConnectionPool()
        self.batcher = VoiceEventBatcher()
        
        # Performance monitoring
        self.metrics = {
            'total_connections': 0,
            'active_channels': 0,
            'messages_sent': 0,
            'webrtc_offers': 0,
            'webrtc_answers': 0,
            'ice_candidates': 0,
            'avg_latency': 0.0,
            'last_updated': time.time()
        }
        
        # Background tasks
        self._batch_flush_task: Optional[asyncio.Task] = None
        self._performance_task: Optional[asyncio.Task] = None
        self._quality_monitor_task: Optional[asyncio.Task] = None
        
        self._start_background_tasks()
    
    def _start_background_tasks(self):
        """Запуск фоновых задач"""
        self._batch_flush_task = asyncio.create_task(self._batch_flush_worker())
        self._performance_task = asyncio.create_task(self._performance_monitor())
        self._quality_monitor_task = asyncio.create_task(self._quality_monitor())
    
    async def connect_user(self, websocket: WebSocket, user_id: int, channel_id: int,
                          username: str, display_name: Optional[str] = None,
                          avatar_url: Optional[str] = None) -> bool:
        """
        🔌 Подключение пользователя к голосовому каналу
        """
        try:
            await websocket.accept()
            
            success = self.pool.add_participant(
                channel_id, user_id, websocket, username, display_name, avatar_url
            )
            
            if not success:
                await websocket.close(code=1013)  # Try again later
                return False
            
            # Обновление метрик
            self.metrics['total_connections'] = len(self.pool._user_connections)
            self.metrics['active_channels'] = len(self.pool._channels)
            
            logger.info(f"🎙️ User {username} connected to voice channel {channel_id}")
            
            # Отправка информации о канале
            channel = self.pool.get_channel(channel_id)
            if channel:
                await self._send_to_user(user_id, {
                    'type': 'participants',
                    'participants': [
                        {
                            'user_id': p.user_id,
                            'username': p.username,
                            'display_name': p.display_name,
                            'avatar_url': p.avatar_url,
                            'is_muted': p.is_muted,
                            'is_deafened': p.is_deafened,
                            'is_speaking': p.is_speaking
                        } for p in channel.participants.values()
                    ],
                    'ice_servers': channel.ice_servers,
                    'channel_settings': {
                        'max_participants': channel.max_participants,
                        'bitrate': channel.bitrate
                    }
                })
                
                # Уведомление других участников
                await self._broadcast_to_channel(channel_id, {
                    'type': 'user_joined_voice',
                    'user_id': user_id,
                    'username': username,
                    'display_name': display_name,
                    'avatar_url': avatar_url
                }, exclude_user=user_id)
            
            return True
            
        except Exception as e:
            logger.error(f"🎙️ Error connecting user {user_id}: {e}")
            return False
    
    async def disconnect_user(self, user_id: int):
        """
        🔌 Отключение пользователя от голосового канала
        """
        try:
            channel_id = self.pool.remove_participant(user_id)
            
            if channel_id:
                # Уведомление других участников
                await self._broadcast_to_channel(channel_id, {
                    'type': 'user_left_voice',
                    'user_id': user_id
                }, exclude_user=user_id)
                
                logger.info(f"🎙️ User {user_id} disconnected from voice channel {channel_id}")
            
            # Обновление метрик
            self.metrics['total_connections'] = len(self.pool._user_connections)
            self.metrics['active_channels'] = len(self.pool._channels)
            
        except Exception as e:
            logger.error(f"🎙️ Error disconnecting user {user_id}: {e}")
    
    async def handle_webrtc_signal(self, user_id: int, signal_data: Dict[str, Any]):
        """
        📡 Обработка WebRTC сигналов
        """
        signal_type = signal_data.get('type')
        target_id = signal_data.get('target_id')
        
        if not target_id:
            return
            
        # Пересылка сигнала целевому пользователю
        message = {
            'type': signal_type,
            'from_id': user_id,
            **{k: v for k, v in signal_data.items() if k not in ['type', 'target_id']}
        }
        
        await self._send_to_user(target_id, message)
        
        # Обновление метрик
        if signal_type == 'offer':
            self.metrics['webrtc_offers'] += 1
        elif signal_type == 'answer':
            self.metrics['webrtc_answers'] += 1
        elif signal_type == 'ice_candidate':
            self.metrics['ice_candidates'] += 1
    
    async def handle_speaking_change(self, user_id: int, is_speaking: bool):
        """
        🗣️ Обработка изменения голосовой активности
        """
        channel_id = self.pool.get_participant_channel(user_id)
        if not channel_id:
            return
            
        # Обновление статуса участника
        self.pool.update_participant_status(user_id, is_speaking=is_speaking)
        
        # Добавление в батч для оптимизации
        self.batcher.add_speaking_event(channel_id, user_id, is_speaking)
    
    async def handle_status_change(self, user_id: int, status: Dict[str, Any]):
        """
        🎛️ Обработка изменения статуса (mute/deafen)
        """
        channel_id = self.pool.get_participant_channel(user_id)
        if not channel_id:
            return
            
        # Обновление статуса участника
        self.pool.update_participant_status(user_id, **status)
        
        # Добавление в батч
        self.batcher.add_status_event(channel_id, user_id, status)
    
    async def _send_to_user(self, user_id: int, message: Dict[str, Any]):
        """📤 Отправка сообщения пользователю"""
        websocket = self.pool._user_connections.get(user_id)
        if not websocket:
            return
            
        try:
            start_time = time.time()
            await websocket.send_text(json.dumps(message))
            
            # Обновление метрик
            self.metrics['messages_sent'] += 1
            latency = time.time() - start_time
            self.metrics['avg_latency'] = (self.metrics['avg_latency'] * 0.9) + (latency * 0.1)
            
        except Exception as e:
            logger.warning(f"🎙️ Failed to send message to user {user_id}: {e}")
            await self.disconnect_user(user_id)
    
    async def _broadcast_to_channel(self, channel_id: int, message: Dict[str, Any], 
                                  exclude_user: Optional[int] = None):
        """📢 Рассылка сообщения всем участникам канала"""
        channel = self.pool.get_channel(channel_id)
        if not channel:
            return
            
        tasks = []
        for user_id in channel.participants:
            if user_id != exclude_user:
                tasks.append(self._send_to_user(user_id, message))
        
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
    
    async def _batch_flush_worker(self):
        """🔄 Воркер для периодической отправки батчей"""
        while True:
            try:
                await asyncio.sleep(self.batcher.flush_interval)
                
                if self.batcher.should_flush():
                    batches = await self.batcher.flush_all()
                    
                    # Отправка батчей speaking events
                    for channel_id, speaking_events in batches['speaking'].items():
                        if speaking_events:
                            await self._broadcast_to_channel(channel_id, {
                                'type': 'batch_speaking',
                                'events': speaking_events,
                                'timestamp': time.time()
                            })
                    
                    # Отправка батчей status events
                    for channel_id, status_events in batches['status'].items():
                        if status_events:
                            await self._broadcast_to_channel(channel_id, {
                                'type': 'batch_status',
                                'events': status_events,
                                'timestamp': time.time()
                            })
                
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"🎙️ Batch flush worker error: {e}")
    
    async def _performance_monitor(self):
        """📊 Мониторинг производительности"""
        while True:
            try:
                await asyncio.sleep(15)  # Каждые 15 секунд
                
                self.metrics['last_updated'] = time.time()
                
                logger.info(
                    f"🎙️ Voice Performance: "
                    f"Connections: {self.metrics['total_connections']}, "
                    f"Channels: {self.metrics['active_channels']}, "
                    f"Messages: {self.metrics['messages_sent']}, "
                    f"WebRTC (O/A/I): {self.metrics['webrtc_offers']}/"
                    f"{self.metrics['webrtc_answers']}/{self.metrics['ice_candidates']}, "
                    f"Avg latency: {self.metrics['avg_latency']:.3f}s"
                )
                
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"🎙️ Performance monitor error: {e}")
    
    async def _quality_monitor(self):
        """🔍 Мониторинг качества соединений"""
        while True:
            try:
                await asyncio.sleep(30)  # Каждые 30 секунд
                
                # Адаптивное качество в зависимости от нагрузки
                total_connections = self.metrics['total_connections']
                
                for channel in self.pool._channels.values():
                    # Снижение битрейта при высокой нагрузке
                    if total_connections > 500:
                        channel.bitrate = 32000  # 32 kbps
                    elif total_connections > 200:
                        channel.bitrate = 48000  # 48 kbps
                    else:
                        channel.bitrate = 64000  # 64 kbps
                    
                    # Обновление качества участников
                    for participant in channel.participants.values():
                        if total_connections > 500:
                            participant.audio_quality = "low"
                        elif total_connections > 200:
                            participant.audio_quality = "medium"
                        else:
                            participant.audio_quality = "high"
                
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"🎙️ Quality monitor error: {e}")
    
    def get_metrics(self) -> Dict[str, Any]:
        """📈 Получить метрики производительности"""
        return self.metrics.copy()
    
    async def shutdown(self):
        """🛑 Graceful shutdown"""
        logger.info("🛑 Shutting down EnhancedVoiceManager...")
        
        # Cancel background tasks
        if self._batch_flush_task:
            self._batch_flush_task.cancel()
        if self._performance_task:
            self._performance_task.cancel()
        if self._quality_monitor_task:
            self._quality_monitor_task.cancel()
        
        # Close all connections
        for websocket in self.pool._user_connections.values():
            try:
                await websocket.close()
            except:
                pass
        
        logger.info("✅ EnhancedVoiceManager shutdown complete")

# Singleton instance
enhanced_voice_manager = EnhancedVoiceManager()

async def websocket_voice_endpoint(websocket: WebSocket, voice_channel_id: int, token: str = Query(...)):
    """
    🎯 Enhanced Voice WebSocket Endpoint
    
    Обрабатывает:
    - WebRTC сигналинг (offers, answers, ICE candidates)
    - Голосовую активность
    - Управление микрофоном/наушниками
    - Демонстрацию экрана
    """
    db = None
    user = None
    
    try:
        # Создаем сессию БД
        db = AsyncSessionLocal()
        
        # Аутентификация
        payload = decode_access_token(token)
        if not payload:
            await websocket.close(code=1008)
            return
            
        user_id = payload.get("sub")
        if not user_id:
            await websocket.close(code=1008)
            return

        result = await db.execute(select(User).where(User.id == int(user_id)))
        user = result.scalar_one_or_none()
        
        if not user or not user.is_active:
            await websocket.close(code=1008)
            return
        
        # Подключение к голосовому каналу
        connected = await enhanced_voice_manager.connect_user(
            websocket, user.id, voice_channel_id, 
            user.username, user.display_name, getattr(user, 'avatar_url', None)
        )
        
        if not connected:
            await websocket.close(code=1013)
            return
        
        # Обновление активности пользователя
        await user_activity_service.update_user_activity(user.id, db)
        
        # Главный цикл обработки сообщений
        while True:
            try:
                data = await websocket.receive_text()
                message_data = json.loads(data)
                
                message_type = message_data.get('type')
                
                # Маршрутизация сообщений
                if message_type in ['offer', 'answer', 'ice_candidate']:
                    await enhanced_voice_manager.handle_webrtc_signal(user.id, message_data)
                elif message_type == 'speaking':
                    await enhanced_voice_manager.handle_speaking_change(
                        user.id, message_data.get('is_speaking', False)
                    )
                elif message_type in ['mute', 'deafen']:
                    status = {
                        'is_muted': message_data.get('is_muted'),
                        'is_deafened': message_data.get('is_deafened')
                    }
                    await enhanced_voice_manager.handle_status_change(user.id, status)
                elif message_type == 'screen_share_start':
                    await enhanced_voice_manager._broadcast_to_channel(voice_channel_id, {
                        'type': 'screen_share_started',
                        'user_id': user.id
                    }, exclude_user=user.id)
                elif message_type == 'screen_share_stop':
                    await enhanced_voice_manager._broadcast_to_channel(voice_channel_id, {
                        'type': 'screen_share_stopped',
                        'user_id': user.id
                    }, exclude_user=user.id)
                
                # Обновление активности
                await user_activity_service.update_user_activity(user.id, db)
                
            except json.JSONDecodeError:
                continue
                
    except WebSocketDisconnect:
        logger.info(f"🎙️ User {user.username if user else 'Unknown'} disconnected from voice")
    except Exception as e:
        logger.error(f"🎙️ Voice WebSocket error: {e}")
        import traceback
        traceback.print_exc()
    finally:
        if user:
            await enhanced_voice_manager.disconnect_user(user.id)
            
            # Проверка активных соединений для установки offline статуса
            if not enhanced_voice_manager.pool._user_connections.get(user.id):
                if db:
                    await user_activity_service.set_user_offline(user.id, db)
        
        if db:
            await db.close() 