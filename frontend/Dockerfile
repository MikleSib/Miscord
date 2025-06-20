FROM node:16-alpine

WORKDIR /app

# Копируем package.json
COPY package.json ./

# Очищаем кеш и устанавливаем зависимости с агрессивными флагами
RUN npm cache clean --force && \
    npm install --legacy-peer-deps --force --no-optional --production=false && \
    npm audit fix --force

# Копируем остальные файлы
COPY . .

EXPOSE 3000

# Переменные окружения
ENV CI=false
ENV WDS_SOCKET_PORT=0
ENV CHOKIDAR_USEPOLLING=true
ENV NODE_ENV=development
ENV GENERATE_SOURCEMAP=false

CMD ["npm", "start"]