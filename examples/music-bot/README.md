# Miscord Music Bot

Рабочий пример голосового бота для Miscord с командами:

- `/play url` — добавить ссылку YouTube в очередь;
- `/skip` — пропустить текущий трек;
- `/stop` — очистить очередь и выйти из голосового канала;
- `/queue` — показать текущий трек и размер очереди.

Бот получает команды через Miscord Gateway, входит в канал через Gateway opcode `4`, подключается к отдельному Miscord Voice Gateway и передаёт Opus-аудио через WebRTC/DTLS-SRTP.

## Требования

- Python 3.11;
- системные библиотеки, необходимые `aiortc`/PyAV;
- новый Bot Token после сброса ранее опубликованного токена;
- у роли бота должны быть права **Просматривать канал**, **Подключаться** и **Говорить**;
- при установке приложения должен быть включён intent **Состояния голосовых каналов**.

Используйте только контент, который разрешено получать и ретранслировать. YouTube и правообладатели могут ограничивать такое использование независимо от технической возможности.

## Установка

### Быстрый запуск на Windows

1. Дважды нажмите `setup.cmd`, вставьте Bot Token и при необходимости ID тестового сервера.
2. После регистрации команд запускайте бота через `start.cmd`.
3. Не закрывайте окно бота во время прослушивания. Для остановки нажмите `Ctrl+C` или запустите `stop.cmd`.

`setup.cmd` создаёт локальные `.venv` и `.env`. Они исключены из Git. Client Secret не требуется.

### Ручная установка

```bash
python -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env
```

На Windows:

```powershell
py -3.11 -m venv .venv
.venv\Scripts\pip.exe install -r requirements.txt
Copy-Item .env.example .env
```

Заполните `.env`. Client Secret для запуска бота не нужен. Не добавляйте `.env` в Git и не отправляйте токен в чат.

Для быстрого тестирования укажите `MISCORD_GUILD_ID`: команды будут созданы только на выбранном сервере. Если оставить поле пустым, команды создаются глобально.

## Регистрация и запуск

```bash
python register_commands.py
python bot.py
```

После запуска войдите в голосовой канал и выполните:

```text
/play url:https://www.youtube.com/watch?v=...
```

## Voice flow

```text
Main Gateway opcode 4
  -> VOICE_STATE_UPDATE
  -> VOICE_SERVER_UPDATE
  -> Voice Gateway Hello / Identify / Ready
  -> Select Protocol: WebRTC
  -> Speaking
  -> SDP/ICE signaling
  -> encrypted Opus audio
```

Управляющие voice opcodes совпадают по назначению с привычным протоколом приложений. Медиатранспорт Miscord использует WebRTC/DTLS-SRTP, чтобы бот сразу работал с текущими клиентами Miscord. Следующий инфраструктурный этап — общий SFU вместо mesh-соединения для каждого слушателя.
