"""StorageHub backup connector tests (C-2).

Covers the two behaviours that matter: disabled-by-default returns a clean
503 without touching the network, and the happy path (StorageHub reachable)
round-trips the archive through a monkeypatched httpx.AsyncClient.
"""
from __future__ import annotations

from app.core.config import settings
from app.services import storagehub_client


async def test_backup_disabled_returns_503(client):
    """Default config (no URL/API key) -> 503, no network call attempted."""
    pid = (await client.post("/api/projects", json={"name": "p"})).json()["id"]

    resp = await client.post(f"/api/projects/{pid}/backup-to-storagehub")

    assert resp.status_code == 503
    assert resp.json()["success"] is False


async def test_backup_enabled_success(client, monkeypatch):
    """StorageHub configured + reachable -> archive is gzip-posted and the
    ingest response is passed back through."""
    monkeypatch.setattr(settings, "NETGEO_STORAGEHUB_URL", "https://storagehub.local")
    monkeypatch.setattr(settings, "NETGEO_STORAGEHUB_API_KEY", "test-key")

    pid = (await client.post("/api/projects", json={"name": "p"})).json()["id"]

    captured = {}

    class _FakeResponse:
        status_code = 200

        def json(self):
            return {
                "success": True,
                "data": {"path": "netgeo/p.json.gz", "size": 123},
                "message": "stored",
            }

    class _FakeAsyncClient:
        def __init__(self, *a, **kw):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, url, *, headers, files, data):
            captured["url"] = url
            captured["headers"] = headers
            captured["source"] = data["source"]
            captured["filename"] = files["file"][0]
            return _FakeResponse()

    monkeypatch.setattr(storagehub_client.httpx, "AsyncClient", _FakeAsyncClient)

    resp = await client.post(f"/api/projects/{pid}/backup-to-storagehub")

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["success"] is True
    assert body["data"]["path"] == "netgeo/p.json.gz"
    assert captured["url"] == "https://storagehub.local/api/v1/ingest/logs"
    assert captured["headers"]["X-API-Key"] == "test-key"
    assert captured["source"] == f"netgeo-{pid}"
    assert captured["filename"] == f"{pid}.netgeo-archive.json.gz"
