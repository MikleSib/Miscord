#!/usr/bin/env python3

import asyncio
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text
from app.core.config import settings

async def migrate():
    """Добавление поля last_activity в таблицу users"""
    
    # Создаем движок базы данных
    engine = create_async_engine(settings.DATABASE_URL.replace("postgresql://", "postgresql+asyncpg://"))
    
    try:
        async with engine.begin() as conn:
            print("Подключение к базе данных установлено")
            
            # Проверяем, существует ли уже поле last_activity
            check_query = text("""
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name = 'users' AND column_name = 'last_activity'
            """)
            
            result = await conn.execute(check_query)
            rows = result.fetchall()
            
            if rows:
                print("Поле last_activity уже существует в таблице users")
            else:
                print("Добавляем поле last_activity...")
                
                # Добавляем поле last_activity
                await conn.execute(text("""
                    ALTER TABLE users ADD COLUMN last_activity TIMESTAMP WITH TIME ZONE DEFAULT NOW()
                """))
                
                # Обновляем все существующие записи
                await conn.execute(text("""
                    UPDATE users SET last_activity = NOW() WHERE last_activity IS NULL
                """))
                
                print("Поле last_activity успешно добавлено!")
            
            # Проверяем результат
            verify_query = text("""
                SELECT column_name, data_type, column_default
                FROM information_schema.columns 
                WHERE table_name = 'users' AND column_name = 'last_activity'
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