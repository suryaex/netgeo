"""ID helpers.

NetForge entities use string UUIDs (MASTER_SPEC §4 ``id`` fields are opaque),
which suits a graph/JSON-serializable topology that may be authored client-side
and synced. ``new_id`` centralises generation so it can be swapped (e.g. for
ULIDs) without touching call sites.
"""
from __future__ import annotations

import uuid


def new_id() -> str:
    """Return a fresh random UUID4 string."""
    return str(uuid.uuid4())
