from datetime import datetime, timezone, timedelta
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
from app.models.user import User
from app.websocket.connection_manager import manager
import asyncio
from typing import Dict, Set

class UserActivityService:
    def __init__(self):
        # Хранилище активных пользователей (user_id -> последняя активность)
        self.active_users: Dict[int, datetime] = {}
        # Таймаут для определения оффлайн статуса (1 минута)
        self.offline_timeout = timedelta(minutes=1)
        # Флаг для остановки фонового процесса
        self._running = False
        self._cleanup_task = None

    async def update_user_activity(self, user_id: int, db: AsyncSession):
        """Обновляет активность пользователя"""
        current_time = datetime.now(timezone.utc)
        
        # Обновляем в памяти
        self.active_users[user_id] = current_time
        
        # Обновляем в базе данных
        await db.execute(
            update(User)
            .where(User.id == user_id)
            .values(
                is_online=True,
                last_activity=current_time
            )
        )
        await db.commit()
        
        # Уведомляем о том, что пользователь онлайн
        await self._notify_user_status_change(user_id, True, db)

    async def set_user_offline(self, user_id: int, db: AsyncSession):
        """Устанавливает пользователя как оффлайн"""
        # Удаляем из активных пользователей
        self.active_users.pop(user_id, None)
        
        # Обновляем в базе данных
        await db.execute(
            update(User)
            .where(User.id == user_id)
            .values(is_online=False)
        )
        await db.commit()
        
        # Уведомляем о том, что пользователь оффлайн
        await self._notify_user_status_change(user_id, False, db)

    async def _notify_user_status_change(self, user_id: int, is_online: bool, db: AsyncSession):
        """Уведомляет о изменении статуса пользователя"""
        # Получаем информацию о пользователе
        user_result = await db.execute(
            select(User).where(User.id == user_id)
        )
        user = user_result.scalar_one_or_none()
        
        if not user:
            return
        
        # Отправляем уведомление всем подключенным пользователям
        await manager.broadcast({
            "type": "user_status_changed",
            "data": {
                "user_id": user.id,
                "username": user.display_name or user.username,
                "is_online": is_online
            }
        })

    async def start_cleanup_task(self, db_session_factory):
        """Запускает фоновую задачу для очистки неактивных пользователей"""
        if self._running:
            return
        
        self._running = True
        self._cleanup_task = asyncio.create_task(self._cleanup_inactive_users(db_session_factory))

    async def stop_cleanup_task(self):
        """Останавливает фоновую задачу"""
        self._running = False
        if self._cleanup_task:
            self._cleanup_task.cancel()
            try:
                await self._cleanup_task
            except asyncio.CancelledError:
                pass

    async def _cleanup_inactive_users(self, db_session_factory):
        """Фоновая задача для проверки и обновления статуса неактивных пользователей"""
        while self._running:
            try:
                current_time = datetime.now(timezone.utc)
                offline_users = []
                
                # Проверяем активных пользователей в памяти
                for user_id, last_activity in list(self.active_users.items()):
                    if current_time - last_activity > self.offline_timeout:
                        offline_users.append(user_id)
                
                # Обрабатываем оффлайн пользователей
                if offline_users:
                    async with db_session_factory() as db:
                        for user_id in offline_users:
                            await self.set_user_offline(user_id, db)
                
                # Также проверяем базу данных на случай пропущенных пользователей
                await self._cleanup_database_inactive_users(db_session_factory, current_time)
                
                # Спим 30 секунд перед следующей проверкой
                await asyncio.sleep(30)
                
            except asyncio.CancelledError:
                break
            except Exception as e:
                print(f"[UserActivityService] Ошибка в cleanup задаче: {e}")
                await asyncio.sleep(5)

    async def _cleanup_database_inactive_users(self, db_session_factory, current_time: datetime):
        """Проверяет базу данных на неактивных пользователей"""
        async with db_session_factory() as db:
            # Находим пользователей, которые онлайн в БД, но неактивны больше таймаута
            cutoff_time = current_time - self.offline_timeout
            
            result = await db.execute(
                select(User.id)
                .where(
                    User.is_online == True,
                    User.last_activity < cutoff_time
                )
            )
            inactive_user_ids = [row[0] for row in result.fetchall()]
            
            # Устанавливаем их как оффлайн
            if inactive_user_ids:
                await db.execute(
                    update(User)
                    .where(User.id.in_(inactive_user_ids))
                    .values(is_online=False)
                )
                await db.commit()
                
                # Уведомляем об изменении статуса
                for user_id in inactive_user_ids:
                    # Удаляем из активных пользователей
                    self.active_users.pop(user_id, None)
                    # Уведомляем
                    await self._notify_user_status_change(user_id, False, db)

    async def get_online_users(self, db: AsyncSession) -> list:
        """Получает список онлайн пользователей"""
        result = await db.execute(
            select(User)
            .where(User.is_online == True)
            .order_by(User.username)
        )
        return result.scalars().all()

    async def heartbeat_user(self, user_id: int, db: AsyncSession):
        """Heartbeat для поддержания активности пользователя"""
        await self.update_user_activity(user_id, db)

# Глобальный экземпляр сервиса
user_activity_service = UserActivityService() 