"""Storage layer. Default: in-memory (dev). Production: async PostgreSQL.

The whole API depends only on the ``MemoryRepository`` surface, so swapping in a
Postgres-backed repo later requires no API changes (Dependency Inversion).
"""
from __future__ import annotations

from functools import lru_cache

from app.store.memory import MemoryRepository, NotFound

__all__ = ["MemoryRepository", "NotFound", "get_repo"]


@lru_cache(maxsize=1)
def get_repo() -> MemoryRepository:
    """Process-wide singleton repository."""
    return MemoryRepository()
