#!/bin/bash

# Скрипт для настройки firewall для TURN сервера
# Использование: sudo ./setup-turn-firewall.sh

echo "🔥 Настраиваем firewall для TURN сервера..."

# Проверяем, что скрипт запущен с правами root
if [ "$EUID" -ne 0 ]; then
    echo "❌ Ошибка: Запустите скрипт с правами root (sudo)"
    exit 1
fi

# Открываем порт 3478 для TURN (UDP и TCP)
echo "🔓 Открываем порт 3478 (TURN)..."
ufw allow 3478/udp
ufw allow 3478/tcp

# Открываем диапазон портов для TURN relay (UDP)
echo "🔓 Открываем диапазон портов 49152-49252 (TURN relay)..."
ufw allow 49152:49252/udp

# Проверяем статус firewall
echo "📊 Статус firewall:"
ufw status

echo "✅ Firewall настроен для TURN сервера!"
echo "📋 Открытые порты:"
echo "   - 3478/udp (TURN STUN/TURN)"
echo "   - 3478/tcp (TURN STUN/TURN)"  
echo "   - 49152-49252/udp (TURN relay)"
