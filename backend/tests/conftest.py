"""Fixtures bersama untuk test backend NetGeo.

Catatan desain:
- ``app.store.get_repo`` adalah singleton ber-``lru_cache`` (state hidup selama
  proses). Fixture ``client`` membersihkan repo singleton sebelum tiap test
  sehingga test saling terisolasi tanpa menyentuh kontrak API.
- Memakai ``httpx.AsyncClient`` + ``ASGITransport`` agar request menabrak app
  ASGI langsung (tanpa soket TCP) — cepat & deterministik.
"""
from __future__ import annotations

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.store import get_repo


@pytest.fixture(autouse=True)
def _reset_repo():
    """Kosongkan repo in-memory singleton sebelum setiap test."""
    repo = get_repo()
    repo._projects.clear()
    repo._nodes.clear()
    repo._links.clear()
    repo._scenarios.clear()
    repo._configs.clear()
    repo._configs_by_node.clear()
    yield


@pytest_asyncio.fixture
async def client():
    """AsyncClient yang berbicara langsung ke aplikasi ASGI."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
