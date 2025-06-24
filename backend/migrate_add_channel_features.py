#!/usr/bin/env python3

import asyncio
from sqlalchemy.ext.asyncio import AsyncSession
from app.db.database import async_engine, get_db
from sqlalchemy import text

async def add_channel_features():
    """Добавляет новые поля для функций каналов"""
    
    async with async_engine.begin() as conn:
        # Добавляем поле is_hidden для скрытия текстовых каналов
        try:
            await conn.execute(text("""
                ALTER TABLE text_channels 
                ADD COLUMN is_hidden BOOLEAN DEFAULT FALSE
            """))
            print("✅ Добавлено поле is_hidden в text_channels")
        except Exception as e:
            if "already exists" in str(e).lower() or "duplicate column name" in str(e).lower():
                print("⚠️ Поле is_hidden уже существует")
            else:
                print(f"❌ Ошибка добавления is_hidden: {e}")
        
        # Добавляем поле slow_mode_seconds для медленного режима
        try:
            await conn.execute(text("""
                ALTER TABLE text_channels 
                ADD COLUMN slow_mode_seconds INTEGER DEFAULT 0
            """))
            print("✅ Добавлено поле slow_mode_seconds в text_channels")
        except Exception as e:
            if "already exists" in str(e).lower() or "duplicate column name" in str(e).lower():
                print("⚠️ Поле slow_mode_seconds уже существует")
            else:
                print(f"❌ Ошибка добавления slow_mode_seconds: {e}")

if __name__ == "__main__":
    asyncio.run(add_channel_features()) 