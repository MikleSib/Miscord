# Miscord Music Bot

Локальный пример музыкального бота с командами `/play`, `/skip`, `/stop` и `/queue`.

Бот получает команды через Main Gateway v1, входит в голосовой канал opcode `4`, открывает один Voice WebSocket v1 и один UDP socket. Opus передаётся как RTP через XChaCha20-Poly1305 в общий Miscord SFU. WebRTC, SDP, ICE и mesh в примере отсутствуют.

## Требования

- Python 3.11+;
- новый Bot Token; Client Secret для запуска не нужен;
- права `VIEW_CHANNEL`, `CONNECT`, `SPEAK` и `USE_APPLICATION_COMMANDS`;
- intent `GUILD_VOICE_STATES`;
- используйте только контент, который разрешено получать и ретранслировать.

## Установка

На Windows запустите `setup.cmd`, затем `start.cmd`. Для ручной установки:

```powershell
py -3.11 -m venv .venv
.venv\Scripts\pip.exe install -r requirements.txt
Copy-Item .env.example .env
```

Заполните `.env`, зарегистрируйте команды и запустите бота:

```powershell
.venv\Scripts\python.exe register_commands.py
.venv\Scripts\python.exe bot.py
```

После запуска войдите в голосовой канал и отправьте:

```text
/play url:https://www.youtube.com/watch?v=...
```

## Voice flow

```text
Main Gateway v1 opcode 4
  -> VOICE_STATE_UPDATE + VOICE_SERVER_UPDATE
  -> Voice Gateway v1 Hello / Identify / Ready
  -> 74-byte UDP discovery
  -> Select Protocol: udp + XChaCha20-Poly1305
  -> Session Description
  -> Speaking
  -> encrypted RTP/Opus -> Miscord SFU
```

`/stop` отправляет пять silence frames, закрывает текущий producer через выход из канала и очищает player. Следующий `/play` создаёт чистую медиасессию без старого sender и старых RTP counters.
