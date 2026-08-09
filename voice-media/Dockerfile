FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build \
    && npm prune --omit=dev \
    && npm cache clean --force

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system miscord && useradd --system --gid miscord --home-dir /app miscord
COPY package.json package-lock.json ./
COPY --from=build --chown=miscord:miscord /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
USER miscord
EXPOSE 3001 20000-20015/tcp 20000-20015/udp 20100-20103/udp
CMD ["node", "dist/server.js"]
