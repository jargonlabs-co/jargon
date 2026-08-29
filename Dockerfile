FROM node:22-bookworm-slim

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src

ENV JARGON_API_HOST=0.0.0.0
ENV PORT=8787
ENV JARGON_DB_PATH=/data/jargon-db.json
EXPOSE 8787
# Persist /data with a Railway Volume (Docker VOLUME is not supported on Railway)
CMD ["npx", "tsx", "src/server/standalone.ts"]
