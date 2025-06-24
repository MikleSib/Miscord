#!/usr/bin/env python3

import sys
import os
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

import asyncio
import asyncpg
from app.core.config import settings

async def add_channel_features():
    """Добавляет новые поля для функций каналов"""
    
    # Подключаемся к базе данных напрямую
    conn = await asyncpg.connect(settings.DATABASE_URL)
    
    try:
        # Добавляем поле is_hidden для скрытия текстовых каналов
        try:
            await conn.execute("""
                ALTER TABLE text_channels 
                ADD COLUMN is_hidden BOOLEAN DEFAULT FALSE
            """)
            print("✅ Добавлено поле is_hidden в text_channels")
        except Exception as e:
            if "already exists" in str(e).lower() or "duplicate column name" in str(e).lower():
                print("⚠️ Поле is_hidden уже существует")
            else:
                print(f"❌ Ошибка добавления is_hidden: {e}")
        
        # Добавляем поле slow_mode_seconds для медленного режима
        try:
            await conn.execute("""
                ALTER TABLE text_channels 
                ADD COLUMN slow_mode_seconds INTEGER DEFAULT 0
            """)
            print("✅ Добавлено поле slow_mode_seconds в text_channels")
        except Exception as e:
            if "already exists" in str(e).lower() or "duplicate column name" in str(e).lower():
                print("⚠️ Поле slow_mode_seconds уже существует")
            else:
                print(f"❌ Ошибка добавления slow_mode_seconds: {e}")
                
    finally:
        await conn.close()

if __name__ == "__main__":
    asyncio.run(add_channel_features()) 