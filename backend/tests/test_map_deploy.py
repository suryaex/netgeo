"""Test: map-deploy slice — CPE node kind (A1).

Verifies NodeKind.cpe is accepted by POST /nodes and that the created node
carries the correct geo fields back to the caller.
"""
from __future__ import annotations


async def test_create_cpe_node_returns_200(client):
    """POST /nodes with kind=cpe and lat/lon → 201 with matching payload."""
    proj = (await client.post("/api/projects", json={"name": "map-deploy-test"})).json()
    pid = proj["id"]

    resp = await client.post(
        "/api/nodes",
        json={
            "project_id": pid,
            "name": "CPE-1",
            "kind": "cpe",
            "lat": -6.2088,
            "lon": 106.8456,
            "x": 0,
            "y": 0,
        },
    )
    assert resp.status_code == 201, resp.text
    node = resp.json()
    assert node["kind"] == "cpe"
    assert node["lat"] == -6.2088
    assert node["lon"] == 106.8456
    assert node["name"] == "CPE-1"
