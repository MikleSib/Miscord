from __future__ import annotations

import os

import httpx
from dotenv import load_dotenv


COMMANDS = [
    {
        "name": "play",
        "type": 1,
        "description": "Добавить музыку в очередь",
        "options": [
            {
                "type": 3,
                "name": "url",
                "description": "Ссылка YouTube",
                "required": True,
                "min_length": 8,
                "max_length": 2000,
            }
        ],
        "dm_permission": False,
    },
    {
        "name": "skip",
        "type": 1,
        "description": "Пропустить текущий трек",
        "dm_permission": False,
    },
    {
        "name": "stop",
        "type": 1,
        "description": "Остановить музыку и отключить бота",
        "dm_permission": False,
    },
    {
        "name": "queue",
        "type": 1,
        "description": "Показать состояние очереди",
        "dm_permission": False,
    },
]


def application_id_from_token(token: str) -> str:
    prefix = token.split(".", 1)[0]
    return prefix.removeprefix("mcb_")


def main() -> None:
    load_dotenv()
    token = os.environ["MISCORD_BOT_TOKEN"].strip()
    application_id = os.getenv("MISCORD_APPLICATION_ID", "").strip() or application_id_from_token(token)
    guild_id = os.getenv("MISCORD_GUILD_ID", "").strip()
    api_base = os.getenv("MISCORD_API_BASE", "https://miscord.ru/api/v10").rstrip("/")
    headers = {"Authorization": f"Bot {token}", "Content-Type": "application/json"}
    scope = f"/guilds/{guild_id}" if guild_id else ""

    with httpx.Client(timeout=20) as client:
        for command in COMMANDS:
            response = client.post(
                f"{api_base}/applications/{application_id}{scope}/commands",
                headers=headers,
                json=command,
            )
            response.raise_for_status()
            payload = response.json()
            print(f"registered /{payload['name']} ({payload['id']})")


if __name__ == "__main__":
    main()
