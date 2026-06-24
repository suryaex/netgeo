"""Test API end-to-end via httpx (ASGI) — alur penuh §4.

Skenario: buat project -> dua node + interface -> link -> generate config ->
jalankan simulasi. Membuktikan request HTTP nyata mengalir ke service -> store
-> engine / config-gen, memakai store in-memory (tanpa Postgres).
"""
from __future__ import annotations


async def _make_project(client, name="campus") -> str:
    resp = await client.post("/api/projects", json={"name": name, "description": "t"})
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


async def _make_node(client, project_id, name, iface_id, ip) -> dict:
    body = {
        "project_id": project_id,
        "name": name,
        "kind": "router",
        "nos": "ios",
        "interfaces": [
            {"id": iface_id, "node_id": "", "name": "eth0", "ip": [ip]}
        ],
    }
    resp = await client.post("/api/nodes", json=body)
    assert resp.status_code == 201, resp.text
    return resp.json()


async def test_health(client):
    resp = await client.get("/api/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


async def test_create_project_and_topology(client):
    pid = await _make_project(client)
    resp = await client.get(f"/api/projects/{pid}/topology")
    assert resp.status_code == 200
    topo = resp.json()
    assert topo["project"]["id"] == pid
    assert topo["nodes"] == []
    assert topo["links"] == []


async def test_missing_project_returns_404_envelope(client):
    resp = await client.get("/api/projects/does-not-exist")
    assert resp.status_code == 404
    body = resp.json()
    assert body["success"] is False
    assert body["error"]["code"] == "NOT_FOUND"


async def test_full_flow_node_link_config_simulate(client):
    pid = await _make_project(client, "spine-leaf")

    n1 = await _make_node(client, pid, "r1", "r1-e0", "10.0.0.1/24")
    n2 = await _make_node(client, pid, "r2", "r2-e0", "10.0.0.2/24")

    # link kedua interface
    link_resp = await client.post(
        "/api/links",
        json={
            "project_id": pid,
            "a_iface": "r1-e0",
            "b_iface": "r2-e0",
            "type": "fiber",
            "bandwidth": 10000,
            "delay": 1.0,
        },
    )
    assert link_resp.status_code == 201, link_resp.text

    # topology kini punya 2 node + 1 link
    topo = (await client.get(f"/api/projects/{pid}/topology")).json()
    assert len(topo["nodes"]) == 2
    assert len(topo["links"]) == 1

    # generate config untuk r1 (vendor diturunkan dari nos=ios)
    cfg_resp = await client.post("/api/configs/generate", json={"node_id": n1["id"]})
    assert cfg_resp.status_code == 201, cfg_resp.text
    artifact = cfg_resp.json()
    assert artifact["vendor"] == "ios"
    assert "r1" in artifact["content"]

    # config muncul di riwayat node
    listed = await client.get("/api/configs", params={"node_id": n1["id"]})
    assert listed.status_code == 200
    assert len(listed.json()) == 1

    # jalankan simulasi -> kernel memproses topology
    sim_resp = await client.post("/api/simulate", json={"project_id": pid, "seed": 7})
    assert sim_resp.status_code == 200, sim_resp.text
    sim = sim_resp.json()
    assert sim["state"] == "completed"
    assert sim["result"]["topology"]["nodes"] == 2
    assert sim["result"]["topology"]["links"] == 1


async def test_config_generate_multi_vendor_via_api(client):
    """Satu node, beberapa permintaan vendor berbeda -> beberapa artifact."""
    pid = await _make_project(client, "multi")
    node = await _make_node(client, pid, "pe1", "pe1-e0", "10.1.1.1/24")

    for vendor in ("ios", "junos", "frr"):
        resp = await client.post(
            "/api/configs/generate",
            json={"node_id": node["id"], "vendor": vendor},
        )
        assert resp.status_code == 201, resp.text
        assert resp.json()["vendor"] == vendor

    history = (await client.get("/api/configs", params={"node_id": node["id"]})).json()
    assert len(history) == 3


async def test_simulate_unknown_project_404(client):
    resp = await client.post("/api/simulate", json={"project_id": "nope", "seed": 0})
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "NOT_FOUND"
