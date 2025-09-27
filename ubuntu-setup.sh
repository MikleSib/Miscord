#!/bin/bash

# Автоматическая установка и настройка для Ubuntu 22.04
# Скрипт для подготовки системы к развертыванию Miscord

set -e  # Остановка при любой ошибке

echo "🚀 Автоматическая настройка Ubuntu 22.04 для Miscord"
echo "=================================================="

# Проверяем, что мы на Ubuntu
if ! grep -q "Ubuntu" /etc/os-release; then
    echo "❌ Этот скрипт предназначен для Ubuntu 22.04"
    exit 1
fi

# Проверяем версию Ubuntu
UBUNTU_VERSION=$(grep VERSION_ID /etc/os-release | cut -d'"' -f2)
if [[ "$UBUNTU_VERSION" != "22.04" ]]; then
    echo "⚠️  Внимание: Скрипт протестирован на Ubuntu 22.04, у вас версия $UBUNTU_VERSION"
    read -p "Продолжить? (y/N): " continue_setup
    if [[ "$continue_setup" != "y" && "$continue_setup" != "Y" ]]; then
        exit 1
    fi
fi

echo "📋 Обновление системы..."
sudo apt update && sudo apt upgrade -y

echo "🔧 Установка необходимых пакетов..."
sudo apt install -y \
    curl \
    wget \
    git \
    unzip \
    software-properties-common \
    apt-transport-https \
    ca-certificates \
    gnupg \
    lsb-release \
    ufw \
    fail2ban

echo "🐳 Установка Docker..."
# Удаляем старые версии
sudo apt remove -y docker docker-engine docker.io containerd runc 2>/dev/null || true

# Добавляем официальный GPG ключ Docker
sudo mkdir -p /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg

# Добавляем репозиторий Docker
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# Устанавливаем Docker
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

echo "🐳 Установка Docker Compose (standalone)..."
# Устанавливаем Docker Compose как отдельный бинарный файл
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# Добавляем пользователя в группу docker
sudo usermod -aG docker $USER

echo "🔒 Настройка брандмауэра (UFW)..."
# Настраиваем UFW для разрешения необходимых портов
sudo ufw --force reset
sudo ufw default deny incoming
sudo ufw default allow outgoing

# Разрешаем SSH (важно!)
sudo ufw allow ssh
sudo ufw allow 22/tcp

# Разрешаем HTTP и HTTPS
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# Включаем UFW
sudo ufw --force enable

echo "🛡️  Настройка Fail2ban..."
# Создаем конфигурацию для SSH
sudo tee /etc/fail2ban/jail.local > /dev/null <<EOF
[DEFAULT]
bantime = 3600
findtime = 600
maxretry = 3

[sshd]
enabled = true
port = ssh
filter = sshd
logpath = /var/log/auth.log
maxretry = 3
bantime = 3600
EOF

sudo systemctl enable fail2ban
sudo systemctl restart fail2ban

echo "📁 Создание директорий для проекта..."
# Создаем директорию для проектов
sudo mkdir -p /opt/miscord
sudo chown $USER:$USER /opt/miscord

echo "🔄 Настройка автообновлений..."
# Настраиваем автоматические обновления безопасности
sudo tee /etc/apt/apt.conf.d/50unattended-upgrades > /dev/null <<EOF
Unattended-Upgrade::Allowed-Origins {
    "\${distro_id}:\${distro_codename}-security";
    "\${distro_id}ESMApps:\${distro_codename}-apps-security";
    "\${distro_id}ESM:\${distro_codename}-infra-security";
};

Unattended-Upgrade::AutoFixInterruptedDpkg "true";
Unattended-Upgrade::MinimalSteps "true";
Unattended-Upgrade::Remove-Unused-Dependencies "true";
Unattended-Upgrade::Automatic-Reboot "false";
EOF

sudo systemctl enable unattended-upgrades
sudo systemctl start unattended-upgrades

echo "📊 Установка системного мониторинга..."
# Устанавливаем htop для мониторинга
sudo apt install -y htop

echo "🌐 Настройка системных лимитов..."
# Увеличиваем лимиты для Docker
sudo tee -a /etc/security/limits.conf > /dev/null <<EOF
* soft nofile 65536
* hard nofile 65536
* soft nproc 65536
* hard nproc 65536
EOF

echo "⚙️  Настройка Docker daemon..."
# Создаем конфигурацию Docker daemon
sudo mkdir -p /etc/docker
sudo tee /etc/docker/daemon.json > /dev/null <<EOF
{
    "log-driver": "json-file",
    "log-opts": {
        "max-size": "10m",
        "max-file": "3"
    },
    "storage-driver": "overlay2"
}
EOF

sudo systemctl restart docker

echo "🔄 Перезапуск системы через 10 секунд..."
echo "⚠️  ВНИМАНИЕ: Система будет перезагружена через 10 секунд!"
echo "   Это необходимо для применения изменений в группах пользователей."
echo "   После перезагрузки запустите скрипт auto-deploy.sh"
echo ""

for i in {10..1}; do
    echo -n "Перезагрузка через $i секунд... "
    echo -e "\r\033[K"
    sleep 1
done

echo "🔄 Перезагрузка системы..."
sudo reboot
