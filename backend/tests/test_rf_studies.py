"""RF study persistence tests (R4 cross-cutting) — save/list/get/delete.

Save-on-demand snapshot: the stored ``result`` must round-trip byte-identical
regardless of what a live recompute would return later (this is what makes a
PtP study, whose budget depends on a live elevation fetch, "re-open
identically").
"""
from __future__ import annotations


async def _project(client) -> str:
    return (await client.post("/api/projects", json={"name": "rf-persist"})).json()["id"]


async def test_rf_study_save_list_get_roundtrip(client):
    pid = await _project(client)
    body = {
        "project_id": pid,
        "kind": "ptp",
        "name": "tower-a to tower-b",
        "request": {"a_lat": 0.0, "a_lon": 0.0, "b_lat": 0.0, "b_lon": 0.09, "freq_mhz": 5000},
        "result": {"model_id": "fspl", "distance_m": 10000.0, "rssi_dbm": -96.43, "link_ok": True},
    }
    created = await client.post("/api/rf/studies", json=body)
    assert created.status_code == 201, created.text
    sid = created.json()["id"]
    assert created.json()["created_at"]

    listed = await client.get(f"/api/rf/studies?project_id={pid}")
    assert listed.status_code == 200
    assert listed.json()[0]["id"] == sid

    fetched = await client.get(f"/api/rf/studies/{sid}")
    assert fetched.status_code == 200
    # Snapshot re-opens identically: same request+result as saved, verbatim.
    assert fetched.json()["request"] == body["request"]
    assert fetched.json()["result"] == body["result"]
    assert fetched.json()["kind"] == "ptp"


async def test_rf_study_not_found_404(client):
    assert (await client.get("/api/rf/studies/ghost")).status_code == 404
    assert (await client.delete("/api/rf/studies/ghost")).status_code == 404


async def test_rf_study_delete(client):
    pid = await _project(client)
    created = await client.post(
        "/api/rf/studies",
        json={"project_id": pid, "kind": "coverage", "request": {}, "result": {}},
    )
    sid = created.json()["id"]

    deleted = await client.delete(f"/api/rf/studies/{sid}")
    assert deleted.status_code == 200
    assert deleted.json() == {"deleted": sid}

    assert (await client.get(f"/api/rf/studies/{sid}")).status_code == 404
