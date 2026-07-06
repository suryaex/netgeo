"""Whole-project vendor export tests (NG-CFG-01)."""
from __future__ import annotations


async def _project_two_routers(client) -> str:
    pid = (await client.post("/api/projects", json={"name": "core"})).json()["id"]
    for name, iface, ip in [("r1", "r1-e0", "10.0.0.1/24"), ("r2", "r2-e0", "10.0.0.2/24")]:
        await client.post("/api/nodes", json={
            "project_id": pid, "name": name, "kind": "router", "nos": "ios",
            "interfaces": [{"id": iface, "node_id": "", "name": "eth0", "ip": [ip]}],
            "intent": {"ospf": {"process_id": 1, "areas": [{"id": 0, "networks": ["10.0.0.0/24"]}]}},
        })
    return pid


async def test_export_all_nodes_to_vendor(client):
    pid = await _project_two_routers(client)
    resp = await client.get(f"/api/projects/{pid}/configs/export?vendor=ios")
    assert resp.status_code == 200
    body = resp.json()
    assert body["vendor"] == "ios"
    assert set(body["configs"]) == {"r1", "r2"}
    assert all(cfg.strip() for cfg in body["configs"].values())


async def test_export_native_when_vendor_omitted(client):
    pid = await _project_two_routers(client)
    body = (await client.get(f"/api/projects/{pid}/configs/export")).json()
    assert body["vendor"] == "native"
    assert set(body["configs"]) == {"r1", "r2"}


async def test_export_unknown_vendor_422(client):
    pid = await _project_two_routers(client)
    assert (await client.get(f"/api/projects/{pid}/configs/export?vendor=nope")).status_code == 422


async def test_export_unknown_project_404(client):
    assert (await client.get("/api/projects/ghost/configs/export")).status_code == 404
