"""
Миграция для добавления поддержки вложений в DirectMessage

Выполняет:
1. Добавляет поле dm_message_id в таблицу attachments
2. Делает поле message_id nullable в таблице attachments
3. Делает поле content nullable в таблице direct_messages
"""
import asyncio
from sqlalchemy import text
from app.db.database import async_engine

async def migrate():
    async with async_engine.begin() as conn:
        print("Начало миграции...")
        
        # Проверяем существование колонки dm_message_id
        result = await conn.execute(text("""
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name='attachments' AND column_name='dm_message_id'
        """))
        
        if not result.fetchone():
            print("Добавляем колонку dm_message_id в attachments...")
            await conn.execute(text("""
                ALTER TABLE attachments 
                ADD COLUMN dm_message_id INTEGER REFERENCES direct_messages(id) ON DELETE CASCADE
            """))
            print("✓ Колонка dm_message_id добавлена")
        else:
            print("✓ Колонка dm_message_id уже существует")
        
        # Делаем message_id nullable
        print("Делаем message_id nullable...")
        await conn.execute(text("""
            ALTER TABLE attachments 
            ALTER COLUMN message_id DROP NOT NULL
        """))
        print("✓ message_id теперь nullable")
        
        # Делаем content в direct_messages nullable
        print("Делаем content в direct_messages nullable...")
        await conn.execute(text("""
            ALTER TABLE direct_messages 
            ALTER COLUMN content DROP NOT NULL
        """))
        print("✓ content в direct_messages теперь nullable")
        
        print("Миграция завершена успешно!")

if __name__ == "__main__":
    asyncio.run(migrate())

