FROM node:22-bookworm-slim

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json openapi.json ./
COPY src ./src

ENV JARGON_API_HOST=0.0.0.0
ENV PORT=8787
ENV NODE_ENV=production
EXPOSE 8787
# App state lives in Postgres (DATABASE_URL); the API refuses to boot without it.
CMD ["npx", "tsx", "src/server/standalone.ts"]
