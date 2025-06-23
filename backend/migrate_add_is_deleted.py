#!/usr/bin/env python3

import asyncio
import asyncpg
import os
from app.core.config import settings

async def migrate():
    """Добавление поля is_deleted в таблицу messages"""
    
    # Парсим DATABASE_URL
    db_url = settings.DATABASE_URL
    if db_url.startswith("postgresql://"):
        db_url = db_url.replace("postgresql://", "")
    elif db_url.startswith("postgresql+asyncpg://"):
        db_url = db_url.replace("postgresql+asyncpg://", "")
    
    # Извлекаем компоненты URL
    user_pass, host_db = db_url.split("@")
    user, password = user_pass.split(":")
    host_port, database = host_db.split("/")
    host, port = host_port.split(":") if ":" in host_port else (host_port, "5432")
    
    try:
        # Подключаемся к базе данных
        conn = await asyncpg.connect(
            user=user,
            password=password,
            database=database,
            host=host,
            port=int(port)
        )
        
        print("Подключение к базе данных установлено")
        
        # Проверяем, существует ли уже поле is_deleted
        check_query = """
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'messages' AND column_name = 'is_deleted'
        """
        
        result = await conn.fetch(check_query)
        
        if result:
            print("Поле is_deleted уже существует в таблице messages")
        else:
            print("Добавляем поле is_deleted...")
            
            # Добавляем поле is_deleted
            await conn.execute("""
                ALTER TABLE messages ADD COLUMN is_deleted BOOLEAN DEFAULT FALSE
            """)
            
            # Обновляем все существующие записи
            await conn.execute("""
                UPDATE messages SET is_deleted = FALSE WHERE is_deleted IS NULL
            """)
            
            print("Поле is_deleted успешно добавлено!")
        
        # Проверяем результат
        verify_query = """
        SELECT column_name, data_type, column_default
        FROM information_schema.columns 
        WHERE table_name = 'messages' AND column_name = 'is_deleted'
        """
        
        result = await conn.fetch(verify_query)
        if result:
            row = result[0]
            print(f"Поле создано: {row['column_name']} {row['data_type']} DEFAULT {row['column_default']}")
        
        await conn.close()
        print("Миграция завершена успешно")
        
    except Exception as e:
        print(f"Ошибка при выполнении миграции: {e}")
        raise

if __name__ == "__main__":
    asyncio.run(migrate()) 