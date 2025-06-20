FROM node:18-alpine

WORKDIR /app

# Копируем package.json и package-lock.json
COPY package*.json ./

# Очищаем npm кеш и устанавливаем зависимости
RUN npm cache clean --force && \
    npm install --legacy-peer-deps --force

# Копируем остальные файлы
COPY . .

EXPOSE 3000

# Устанавливаем переменную окружения для React
ENV CI=false
ENV WDS_SOCKET_PORT=0

CMD ["npm", "start"]