# Автоматическое развертывание Miscord на Ubuntu 22.04

## 🚀 Полностью автоматическое развертывание

Этот набор скриптов позволяет полностью автоматически развернуть Miscord на Ubuntu 22.04 с доменом `stream-cash.ru`.

## 📋 Предварительные требования

1. **Ubuntu 22.04 LTS** (свежая установка)
2. **Доступ root/sudo** на сервере
3. **Домен stream-cash.ru** настроен на IP сервера
4. **Email** для SSL сертификата Let's Encrypt

## 🔧 Быстрый старт (1 команда)

```bash
# Клонируем проект
git clone <your-repo-url> /opt/miscord
cd /opt/miscord

# Делаем скрипты исполняемыми
chmod +x ubuntu-setup.sh auto-deploy.sh deploy.sh init-letsencrypt.sh

# Запускаем автоматическую установку системы
./ubuntu-setup.sh
```

После перезагрузки системы:

```bash
cd /opt/miscord

# Запускаем автоматическое развертывание
./auto-deploy.sh
```

## 📖 Подробная инструкция

### Шаг 1: Подготовка системы

Скрипт `ubuntu-setup.sh` автоматически:
- ✅ Обновляет систему
- ✅ Устанавливает Docker и Docker Compose
- ✅ Настраивает брандмауэр (UFW)
- ✅ Настраивает Fail2ban для защиты SSH
- ✅ Настраивает автообновления безопасности
- ✅ Увеличивает системные лимиты
- ✅ Оптимизирует Docker daemon

```bash
chmod +x ubuntu-setup.sh
./ubuntu-setup.sh
```

**Система автоматически перезагрузится!**

### Шаг 2: Развертывание приложения

После перезагрузки запустите:

```bash
cd /opt/miscord
./auto-deploy.sh
```

Скрипт `auto-deploy.sh` автоматически:
- ✅ Проверяет Docker и DNS
- ✅ Создает необходимые директории
- ✅ Создает .env файл с настройками по умолчанию
- ✅ Запускает все контейнеры поэтапно
- ✅ Получает SSL сертификат Let's Encrypt
- ✅ Настраивает автообновление сертификатов
- ✅ Проверяет доступность всех сервисов

### Шаг 3: Проверка результата

После завершения скрипта:

```bash
# Проверяем статус
docker-compose ps

# Проверяем логи
docker-compose logs -f

# Тестируем сайт
curl -I https://stream-cash.ru
```

## ⚙️ Настройка после развертывания

### 1. Смена SECRET_KEY

**ОБЯЗАТЕЛЬНО** смените SECRET_KEY в файле `.env`:

```bash
nano .env
```

Замените:
```
SECRET_KEY=your-secret-key-here-change-in-production
```

На:
```
SECRET_KEY=your-very-secure-random-secret-key-here
```

Перезапустите backend:
```bash
docker-compose restart backend
```

### 2. Настройка email для SSL

Отредактируйте email в `init-letsencrypt.sh`:

```bash
nano init-letsencrypt.sh
```

Замените:
```bash
email="admin@stream-cash.ru"
```

На ваш реальный email.

### 3. Настройка DNS

Убедитесь, что DNS записи настроены:
- `stream-cash.ru` → IP сервера
- `www.stream-cash.ru` → IP сервера

Проверка:
```bash
nslookup stream-cash.ru
nslookup www.stream-cash.ru
```

## 🔄 Управление сервисом

### Основные команды

```bash
# Статус всех контейнеров
docker-compose ps

# Логи в реальном времени
docker-compose logs -f

# Логи конкретного сервиса
docker-compose logs -f backend
docker-compose logs -f frontend
docker-compose logs -f nginx

# Перезапуск сервиса
docker-compose restart backend
docker-compose restart frontend

# Перезапуск всех сервисов
docker-compose restart

# Остановка всех сервисов
docker-compose down

# Запуск всех сервисов
docker-compose up -d
```

### Обновление приложения

```bash
# Остановка
docker-compose down

# Обновление кода
git pull

# Пересборка и запуск
docker-compose up -d --build
```

### Мониторинг ресурсов

```bash
# Использование ресурсов контейнерами
docker stats

# Использование диска
df -h

# Использование памяти
free -h

# Загрузка системы
htop
```

## 🛠️ Устранение проблем

### Проблема с Docker

```bash
# Проверка статуса Docker
sudo systemctl status docker

# Перезапуск Docker
sudo systemctl restart docker

# Проверка прав пользователя
sudo usermod -aG docker $USER
```

### Проблема с SSL сертификатом

```bash
# Проверка сертификата
docker-compose exec nginx ls -la /etc/letsencrypt/live/

# Пересоздание сертификата
./init-letsencrypt.sh

# Проверка срока действия
docker-compose exec nginx openssl x509 -in /etc/letsencrypt/live/stream-cash.ru-0001/fullchain.pem -text -noout | grep "Not After"
```

### Проблема с DNS

```bash
# Проверка DNS
nslookup stream-cash.ru
dig stream-cash.ru

# Проверка доступности портов
sudo netstat -tlnp | grep :80
sudo netstat -tlnp | grep :443
```

### Проблема с базой данных

```bash
# Проверка подключения к PostgreSQL
docker-compose exec postgres psql -U miscord_user -d miscord -c "SELECT version();"

# Сброс базы данных (ОСТОРОЖНО!)
docker-compose down
docker volume rm miscord_postgres_data
docker-compose up -d
```

## 📊 Мониторинг и логи

### Настройка логирования

Логи автоматически ротируются Docker:
- Максимальный размер: 10MB
- Количество файлов: 3

### Мониторинг системы

```bash
# Установка дополнительных инструментов мониторинга
sudo apt install -y htop iotop nethogs

# Мониторинг в реальном времени
htop          # CPU и память
iotop         # Дисковая активность
nethogs       # Сетевая активность
```

## 🔒 Безопасность

### Настройки безопасности (уже применены)

- ✅ UFW брандмауэр настроен
- ✅ Fail2ban защищает SSH
- ✅ Автообновления безопасности включены
- ✅ Docker настроен с ограничениями ресурсов

### Дополнительные рекомендации

1. **Смените пароли по умолчанию**
2. **Настройте SSH ключи вместо паролей**
3. **Регулярно обновляйте систему**
4. **Настройте бэкапы базы данных**

## 📞 Поддержка

### Полезные команды для диагностики

```bash
# Общая информация о системе
uname -a
lsb_release -a
docker --version
docker-compose --version

# Статус сервисов
systemctl status docker
systemctl status fail2ban
ufw status

# Сетевые подключения
ss -tlnp
```

### Логи для анализа проблем

```bash
# Системные логи
sudo journalctl -f

# Логи Docker
sudo journalctl -u docker.service -f

# Логи nginx
docker-compose logs -f nginx

# Логи SSL
docker-compose logs -f certbot
```

## 🎉 Готово!

После выполнения всех шагов ваш сайт будет доступен по адресу:

**https://stream-cash.ru**

Все сервисы будут автоматически перезапускаться при сбоях, SSL сертификат будет обновляться автоматически, а система будет защищена базовыми настройками безопасности.
