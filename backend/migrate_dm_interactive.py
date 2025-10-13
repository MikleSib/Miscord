"""
Миграция для добавления интерактивных функций в DirectMessage

Выполняет:
1. Добавляет поле reply_to_id в таблицу direct_messages
2. Добавляет поле dm_message_id в таблицу reactions
3. Делает поле message_id nullable в таблице reactions  
4. Добавляет constraint для проверки message_id или dm_message_id
"""
import asyncio
from sqlalchemy import text
from app.db.database import engine

async def migrate():
    async with engine.begin() as conn:
        print("Начало миграции для интерактивных DM...")
        
        # 1. Добавляем reply_to_id в direct_messages
        print("1. Проверяем поле reply_to_id в direct_messages...")
        result = await conn.execute(text("""
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name='direct_messages' AND column_name='reply_to_id'
        """))
        
        if not result.fetchone():
            print("   Добавляем reply_to_id...")
            await conn.execute(text("""
                ALTER TABLE direct_messages 
                ADD COLUMN reply_to_id INTEGER REFERENCES direct_messages(id) ON DELETE SET NULL
            """))
            print("   ✓ Поле reply_to_id добавлено")
        else:
            print("   ✓ Поле reply_to_id уже существует")
        
        # 2. Добавляем dm_message_id в reactions
        print("2. Проверяем поле dm_message_id в reactions...")
        result = await conn.execute(text("""
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name='reactions' AND column_name='dm_message_id'
        """))
        
        if not result.fetchone():
            print("   Добавляем dm_message_id...")
            await conn.execute(text("""
                ALTER TABLE reactions 
                ADD COLUMN dm_message_id INTEGER REFERENCES direct_messages(id) ON DELETE CASCADE
            """))
            print("   ✓ Поле dm_message_id добавлено")
        else:
            print("   ✓ Поле dm_message_id уже существует")
        
        # 3. Делаем message_id nullable
        print("3. Делаем message_id nullable в reactions...")
        await conn.execute(text("""
            ALTER TABLE reactions 
            ALTER COLUMN message_id DROP NOT NULL
        """))
        print("   ✓ message_id теперь nullable")
        
        # 4. Добавляем constraint
        print("4. Добавляем constraint для message_id/dm_message_id...")
        try:
            await conn.execute(text("""
                ALTER TABLE reactions 
                ADD CONSTRAINT check_message_or_dm 
                CHECK (
                    (message_id IS NOT NULL AND dm_message_id IS NULL) OR 
                    (message_id IS NULL AND dm_message_id IS NOT NULL)
                )
            """))
            print("   ✓ Constraint добавлен")
        except Exception as e:
            if "already exists" in str(e):
                print("   ✓ Constraint уже существует")
            else:
                raise
        
        # 5. Добавляем unique constraint для dm_message_id
        print("5. Добавляем unique constraint для DM реакций...")
        try:
            await conn.execute(text("""
                ALTER TABLE reactions 
                ADD CONSTRAINT unique_user_dm_message_emoji 
                UNIQUE (user_id, dm_message_id, emoji)
            """))
            print("   ✓ Unique constraint добавлен")
        except Exception as e:
            if "already exists" in str(e):
                print("   ✓ Unique constraint уже существует")
            else:
                raise
        
        print("\n✅ Миграция завершена успешно!")
        print("\nТеперь доступны:")
        print("  - Ответы на DM сообщения (reply_to)")
        print("  - Реакции на DM сообщения")
        print("  - Удаление DM сообщений (в течение 5 минут)")

if __name__ == "__main__":
    asyncio.run(migrate())

