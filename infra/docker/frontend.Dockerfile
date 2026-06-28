# =============================================================================
# NetGeo frontend image — React 18 + Vite, di-serve via nginx (prod)
# Multi-arch (linux/amd64, linux/arm64). Build context = ../frontend.
# =============================================================================

# ---- Stage 1: build statis Vite --------------------------------------------
FROM node:20-alpine AS builder

WORKDIR /app
# Cache layer: copy manifest dulu agar npm ci tak rerun saat source berubah.
COPY package.json package-lock.json* ./
RUN npm ci || npm install

COPY . .
# VITE_BACKEND_ORIGIN dipakai vite.config.ts; di prod request via nginx proxy.
RUN npm run build

# ---- Stage 2: nginx serve + proxy /api & /ws -------------------------------
FROM nginx:1.27-alpine AS runtime

# Hanya copy hasil build statis. Konfigurasi nginx (SPA fallback + reverse
# proxy /api & /ws ke backend) di-mount dari infra/docker/nginx.conf lewat
# docker-compose.prod.yml — supaya file config tetap berada di area infra/.
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=5 \
    CMD wget -qO- http://localhost:80/ >/dev/null 2>&1 || exit 1

CMD ["nginx", "-g", "daemon off;"]
