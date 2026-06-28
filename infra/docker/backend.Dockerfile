# =============================================================================
# NetGeo backend image — FastAPI + Uvicorn (MASTER_SPEC §2)
# Multi-arch (linux/amd64, linux/arm64) via base image multi-arch + buildx.
# Build context = ../backend (lihat docker-compose.yml).
# =============================================================================

# ---- Stage 1: builder — pasang dependency ke virtualenv terisolasi ----------
FROM python:3.12-slim AS builder

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

# Toolchain minimal untuk wheel yang butuh kompilasi (asyncpg dll).
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential libpq-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

COPY requirements.txt .
RUN pip install --upgrade pip && pip install -r requirements.txt

# ---- Stage 2: runtime — image ramping, non-root ----------------------------
FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/opt/venv/bin:$PATH"

# libpq untuk runtime asyncpg; curl untuk healthcheck.
RUN apt-get update && apt-get install -y --no-install-recommends \
        libpq5 curl \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd -r netgeo && useradd -r -g netgeo -d /app netgeo

COPY --from=builder /opt/venv /opt/venv

WORKDIR /app
COPY . .
RUN chown -R netgeo:netgeo /app

USER netgeo
EXPOSE 8000

HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=5 \
    CMD curl -fsS http://localhost:8000/api/health || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
