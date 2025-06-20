FROM node:18-alpine

WORKDIR /app

# Копируем package.json и package-lock.json (если есть)
COPY package*.json ./

# Очищаем кеш и устанавливаем зависимости
RUN npm cache clean --force && \
    npm install --legacy-peer-deps

# Копируем остальные файлы
COPY . .

EXPOSE 3000

# Переменные окружения
ENV CI=false
ENV WDS_SOCKET_PORT=0
ENV CHOKIDAR_USEPOLLING=true
ENV NODE_ENV=development
ENV GENERATE_SOURCEMAP=false
ENV BROWSER=none

CMD ["npm", "start"]