#!/usr/bin/env python3

import asyncio
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text
from app.core.config import settings

async def migrate():
    """Добавление поля is_deleted в таблицу messages"""
    
    # Создаем движок базы данных
    engine = create_async_engine(settings.DATABASE_URL.replace("postgresql://", "postgresql+asyncpg://"))
    
    try:
        async with engine.begin() as conn:
            print("Подключение к базе данных установлено")
            
            # Проверяем, существует ли уже поле is_deleted
            check_query = text("""
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name = 'messages' AND column_name = 'is_deleted'
            """)
            
            result = await conn.execute(check_query)
            rows = result.fetchall()
            
            if rows:
                print("Поле is_deleted уже существует в таблице messages")
            else:
                print("Добавляем поле is_deleted...")
                
                # Добавляем поле is_deleted
                await conn.execute(text("""
                    ALTER TABLE messages ADD COLUMN is_deleted BOOLEAN DEFAULT FALSE
                """))
                
                # Обновляем все существующие записи
                await conn.execute(text("""
                    UPDATE messages SET is_deleted = FALSE WHERE is_deleted IS NULL
                """))
                
                print("Поле is_deleted успешно добавлено!")
            
            # Проверяем результат
            verify_query = text("""
                SELECT column_name, data_type, column_default
                FROM information_schema.columns 
                WHERE table_name = 'messages' AND column_name = 'is_deleted'
            """)
            
            result = await conn.execute(verify_query)
            rows = result.fetchall()
            if rows:
                row = rows[0]
                print(f"Поле создано: {row[0]} {row[1]} DEFAULT {row[2]}")
        
        await engine.dispose()
        print("Миграция завершена успешно")
        
    except Exception as e:
        print(f"Ошибка при выполнении миграции: {e}")
        raise

if __name__ == "__main__":
    asyncio.run(migrate()) 