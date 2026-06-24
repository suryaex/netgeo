"""Base application exception mapped to the standard error envelope.

Same shape as storagehub's ``AppException`` so the error-envelope contract is
identical across the author's projects. Adds ``SimulationError`` for the engine.
"""
from __future__ import annotations


class AppException(Exception):
    status_code: int = 400
    code: str = "BAD_REQUEST"

    def __init__(
        self,
        message: str | None = None,
        *,
        code: str | None = None,
        status_code: int | None = None,
    ):
        self.message = message or self.code
        if code:
            self.code = code
        if status_code:
            self.status_code = status_code
        super().__init__(self.message)


class ValidationError(AppException):
    status_code = 422
    code = "VALIDATION_ERROR"


class Unauthorized(AppException):
    status_code = 401
    code = "UNAUTHORIZED"


class Forbidden(AppException):
    status_code = 403
    code = "FORBIDDEN"


class NotFound(AppException):
    status_code = 404
    code = "NOT_FOUND"


class Conflict(AppException):
    status_code = 409
    code = "CONFLICT"


class SimulationError(AppException):
    status_code = 422
    code = "SIMULATION_ERROR"
