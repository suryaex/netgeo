"""Config regeneration diff tests (NG-CFG-03)."""
from __future__ import annotations


async def _node(client) -> tuple[str, str]:
    pid = (await client.post("/api/projects", json={"name": "d"})).json()["id"]
    n = await client.post("/api/nodes", json={
        "project_id": pid, "name": "r1", "kind": "router", "nos": "ios",
        "interfaces": [{"id": "r1-e0", "node_id": "", "name": "eth0", "ip": ["10.0.0.1/24"]}],
    })
    return pid, n.json()["id"]


async def test_no_stored_config_shows_full_add(client):
    _, nid = await _node(client)
    d = (await client.get(f"/api/nodes/{nid}/config/diff")).json()
    assert d["had_stored"] is False
    assert d["changed"] is True   # nothing → something


async def test_unchanged_after_generate_is_empty_diff(client):
    _, nid = await _node(client)
    await client.post("/api/configs/generate", json={"node_id": nid})
    d = (await client.get(f"/api/nodes/{nid}/config/diff")).json()
    assert d["had_stored"] is True
    assert d["changed"] is False
    assert d["diff"] == ""


async def test_edit_shows_unified_diff(client):
    _, nid = await _node(client)
    await client.post("/api/configs/generate", json={"node_id": nid})
    # change the interface IP → regenerated config differs
    await client.patch(f"/api/nodes/{nid}", json={
        "interfaces": [{"id": "r1-e0", "node_id": nid, "name": "eth0", "ip": ["10.9.9.9/24"]}]})
    d = (await client.get(f"/api/nodes/{nid}/config/diff")).json()
    assert d["changed"] is True
    assert "10.9.9.9" in d["diff"]
    assert d["diff"].startswith("---")


async def test_diff_unknown_node_404_and_bad_vendor_422(client):
    _, nid = await _node(client)
    assert (await client.get("/api/nodes/ghost/config/diff")).status_code == 404
    assert (await client.get(f"/api/nodes/{nid}/config/diff?vendor=nope")).status_code == 422
