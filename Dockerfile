# ═══════════════════════════════════════════════════════════
# Nomade Business — uma imagem, dois processos (CMD no compose)
#   server.js     → API do painel, proposta e pagamento públicos (5002)
#   ai-service.js → porta do painel + escritório (agents, memória) (5004)
# ═══════════════════════════════════════════════════════════

# ── build do painel ──
FROM node:20-alpine AS build
WORKDIR /app
COPY client/admin/package*.json ./client/admin/
RUN cd client/admin && npm ci
COPY client/admin ./client/admin
# Google Drive Picker no kanban (opcional — vazio desliga o botão)
ARG VITE_GOOGLE_CLIENT_ID=""
ARG VITE_GOOGLE_API_KEY=""
ARG VITE_GOOGLE_APP_ID=""
ENV VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID VITE_GOOGLE_API_KEY=$VITE_GOOGLE_API_KEY VITE_GOOGLE_APP_ID=$VITE_GOOGLE_APP_ID
RUN cd client/admin && npm run build

# ── runtime ──
FROM node:20-alpine AS runtime
WORKDIR /app

# Chromium do sistema pro puppeteer-core: a capa dos Projetos é o print do
# site (lib/screenshot.js). ~120MB a mais na imagem.
RUN apk add --no-cache chromium nss freetype harfbuzz ca-certificates ttf-freefont font-noto-emoji
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

COPY package*.json ./
RUN npm ci --omit=dev

COPY server.js ai-service.js ./
COPY lib ./lib
COPY agents ./agents
COPY config ./config
# o CLI é servido como tarball em /cli/nomade-cli.tgz (montado em Node, sem npm)
COPY cli ./cli
COPY --from=build /app/client/admin/dist ./client/admin/dist

EXPOSE 5002 5004
CMD ["node", "server.js"]
