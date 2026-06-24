"""Standard API response envelope helpers (shared contract with storagehub)."""
from __future__ import annotations

from typing import Any


def success(data: Any = None, message: str = "OK") -> dict:
    return {"success": True, "data": data, "message": message}


def error(code: str, message: str) -> dict:
    return {"success": False, "error": {"code": code, "message": message}}


def paginated(items: list, page: int, limit: int, total: int) -> dict:
    total_pages = (total + limit - 1) // limit if limit else 0
    return {
        "items": items,
        "page": page,
        "limit": limit,
        "total": total,
        "total_pages": total_pages,
    }
