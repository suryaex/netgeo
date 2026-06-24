"""NetForge backend entrypoint.

FastAPI app assembling the §4 REST surface, the WebSocket endpoints, the shared
error envelope, and CORS — mirroring the secureops/storagehub app factory style.

Run:  uvicorn app.main:app --reload --port 8000
Smoke: python -c "from app.main import app; print('netforge backend imports OK')"
"""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import api_router
from app.api.ws import router as ws_router
from app.core.config import get_settings
from app.core.errors import register_exception_handlers
from app.core.logging import configure_logging

settings = get_settings()


@asynccontextmanager
async def lifespan(_: FastAPI):
    configure_logging()
    yield


def create_app() -> FastAPI:
    app = FastAPI(
        title=settings.APP_NAME,
        version=settings.APP_VERSION,
        description="NetForge — open-source large-scale network simulation platform.",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    register_exception_handlers(app)
    app.include_router(api_router)   # /api/*
    app.include_router(ws_router)    # /ws/*

    @app.get("/api/health", tags=["meta"])
    async def health() -> dict:
        return {"status": "ok", "app": settings.APP_NAME, "version": settings.APP_VERSION}

    return app


app = create_app()
