FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
COPY frontend/package.json frontend/package-lock.json* ./frontend/
RUN npm install --omit=dev \
  && npm install --prefix frontend

COPY . .
RUN npm --prefix frontend run build \
  && mkdir -p database uploads logs sessions \
  && chown -R node:node /app

USER node
ENV NODE_ENV=production
ENV PORT=9454
EXPOSE 9454

HEALTHCHECK --interval=30s --timeout=8s --start-period=20s --retries=3 \
  CMD node scripts/healthcheck.js

CMD ["node", "backend/src/index.js"]
