FROM node:16-alpine

WORKDIR /app

# Копируем package.json
COPY package.json ./

# Устанавливаем зависимости через yarn
RUN yarn install --frozen-lockfile

# Копируем остальные файлы
COPY . .

EXPOSE 3000

# Переменные окружения
ENV CI=false
ENV WDS_SOCKET_PORT=0
ENV CHOKIDAR_USEPOLLING=true

CMD ["yarn", "start"]