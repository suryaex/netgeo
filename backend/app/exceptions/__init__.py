"""Application exception hierarchy."""
from __future__ import annotations

from app.exceptions.base import (
    AppException,
    Conflict,
    Forbidden,
    NotFound,
    SimulationError,
    Unauthorized,
    ValidationError,
)

__all__ = [
    "AppException",
    "Conflict",
    "Forbidden",
    "NotFound",
    "SimulationError",
    "Unauthorized",
    "ValidationError",
]
