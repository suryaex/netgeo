"""BUG-NEW-01 — guard: satu interface tidak boleh jadi endpoint dua link hidup.

Kasus:
- create link sukses (normal)
- duplikat iface ditolak 409
- dua link beda iface antar node yang sama TETAP boleh (LAG/LACP)
"""
from __future__ import annotations

import pytest


async def _project(client) -> str:
    r = await client.post("/api/projects", json={"name": "guard-test"})
    assert r.status_code == 201
    return r.json()["id"]


async def _node(client, pid: str, name: str) -> dict:
    r = await client.post("/api/nodes", json={"project_id": pid, "name": name, "kind": "switch"})
    assert r.status_code == 201
    return r.json()


@pytest.mark.asyncio
async def test_create_link_ok(client):
    """Normal link creation must succeed."""
    pid = await _project(client)
    a = await _node(client, pid, "sw-a")
    b = await _node(client, pid, "sw-b")
    r = await client.post("/api/links", json={
        "project_id": pid, "a_iface": a["id"], "b_iface": b["id"],
    })
    assert r.status_code == 201


@pytest.mark.asyncio
async def test_duplicate_iface_rejected(client):
    """Re-using the same interface id in a second link must return 409."""
    pid = await _project(client)
    a = await _node(client, pid, "sw-a")
    b = await _node(client, pid, "sw-b")
    c = await _node(client, pid, "sw-c")
    r1 = await client.post("/api/links", json={
        "project_id": pid, "a_iface": a["id"], "b_iface": b["id"],
    })
    assert r1.status_code == 201
    # the a-side interface is now occupied — reuse must be rejected
    # use the real interface id minted by the first create
    a_iface_id = r1.json()["a_iface"]
    r2 = await client.post("/api/links", json={
        "project_id": pid, "a_iface": a_iface_id, "b_iface": c["id"],
    })
    assert r2.status_code == 409


@pytest.mark.asyncio
async def test_multi_link_same_node_pair_allowed(client):
    """Two links between the same pair of nodes are ALLOWED (LAG/LACP) as long
    as each link uses distinct interfaces — the guard is per-interface."""
    pid = await _project(client)
    a = await _node(client, pid, "sw-a")
    b = await _node(client, pid, "sw-b")
    # first link: auto-mints eth0 on both nodes
    r1 = await client.post("/api/links", json={
        "project_id": pid, "a_iface": a["id"], "b_iface": b["id"],
    })
    assert r1.status_code == 201
    # second link: same node ids → backend mints eth1 on both → different ifaces
    r2 = await client.post("/api/links", json={
        "project_id": pid, "a_iface": a["id"], "b_iface": b["id"],
    })
    assert r2.status_code == 201, r2.text
    # the two links must use distinct interface ids
    assert r1.json()["a_iface"] != r2.json()["a_iface"]
    assert r1.json()["b_iface"] != r2.json()["b_iface"]
