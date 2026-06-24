"""Shared API dependencies + store-error translation."""
from __future__ import annotations

from app.exceptions.base import NotFound as ApiNotFound
from app.store import MemoryRepository, get_repo
from app.store import NotFound as StoreNotFound


def repo() -> MemoryRepository:
    return get_repo()


def translate_not_found(exc: StoreNotFound) -> ApiNotFound:
    """Map the storage-layer KeyError to the HTTP 404 envelope."""
    return ApiNotFound(f"resource '{exc.args[0] if exc.args else '?'}' not found")
