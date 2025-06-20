FROM python:3.11-slim

WORKDIR /app

# Установка системных зависимостей для aiortc и других библиотек
RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    libpq-dev \
    libavdevice-dev \
    libavfilter-dev \
    libopus-dev \
    libvpx-dev \
    pkg-config \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]