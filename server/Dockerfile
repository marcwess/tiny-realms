FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/package.json
COPY server/package.json server/package.json
COPY client/package.json client/package.json
COPY bots/package.json bots/package.json
RUN npm ci --omit=dev -w @tiny-realms/server --include-workspace-root
COPY shared shared
COPY server server
ENV NODE_ENV=production
ENV DATA_DIR=/data
RUN mkdir -p /data
EXPOSE 8787
CMD ["node", "--import", "tsx", "server/src/index.ts"]
