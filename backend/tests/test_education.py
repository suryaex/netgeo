"""Education mode tests (NG-EDU-01 activity model + NG-EDU-02 auto-grading).

Covers the AC: grading the answer network against itself is 100%; a missing
VLAN drops exactly its weighted item with a human-readable reason. Plus ping
pass/fail, 404s, and activity CRUD round-trips.
"""
from __future__ import annotations


async def _build_project(client, *, with_vlan: bool = True) -> str:
    """A small teachable network: r1<->r2 over 10.0.0.0/24 with OSPF area 0,
    and sw1 with (optionally) VLAN 20 on an access port. Returns project id."""
    pid = (await client.post("/api/projects", json={"name": "lab"})).json()["id"]

    routers = [
        ("r1", "r1-e0", "10.0.0.1/24", "1.1.1.1"),
        ("r2", "r2-e0", "10.0.0.2/24", "2.2.2.2"),
    ]
    for name, iface, ip, rid in routers:
        resp = await client.post(
            "/api/nodes",
            json={
                "project_id": pid,
                "name": name,
                "kind": "router",
                "interfaces": [{"id": iface, "node_id": "", "name": "eth0", "ip": [ip]}],
                "intent": {"ospf": {"enabled": True, "router_id": rid, "areas": {"eth0": 0}}},
            },
        )
        assert resp.status_code == 201, resp.text

    link = await client.post(
        "/api/links",
        json={"project_id": pid, "a_iface": "r1-e0", "b_iface": "r2-e0", "type": "copper"},
    )
    assert link.status_code == 201, link.text

    sw_intent = {"vlans": {"eth0": {"mode": "access", "vlan": 20}}} if with_vlan else {}
    sw = await client.post(
        "/api/nodes",
        json={
            "project_id": pid,
            "name": "sw1",
            "kind": "switch",
            "interfaces": [{"id": "sw1-e0", "node_id": "", "name": "eth0"}],
            "intent": sw_intent,
        },
    )
    assert sw.status_code == 201, sw.text
    return pid


def _checks() -> list[dict]:
    """Weighted grading tree (total weight 7); vlan_present carries weight 2."""
    return [
        {"kind": "node_exists", "node": "r1", "weight": 1},
        {"kind": "node_exists", "node": "r2", "weight": 1},
        {"kind": "iface_ip", "node": "r1", "iface": "eth0", "cidr": "10.0.0.1/24", "weight": 1},
        {"kind": "vlan_present", "node": "sw1", "vlan": 20, "weight": 2},
        {"kind": "ospf_neighbor", "node": "r1", "peer": "r2", "weight": 1},
        {"kind": "ping", "node": "r1", "dst": "10.0.0.2", "weight": 1},
    ]


async def _make_activity(client, checks: list[dict], *, answer: dict | None = None) -> str:
    body = {"name": "connect the branch", "instructions": "# Task\nWire it up.", "checks": checks}
    if answer is not None:
        body["answer"] = answer
    resp = await client.post("/api/activities", json=body)
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


async def test_answer_against_itself_is_100pct(client):
    pid = await _build_project(client, with_vlan=True)
    answer = (await client.get(f"/api/projects/{pid}/archive")).json()
    aid = await _make_activity(client, _checks(), answer=answer)

    report = (await client.post(f"/api/activities/{aid}/grade", json={"project_id": pid})).json()

    assert report["score_pct"] == 100.0, report
    assert all(item["passed"] for item in report["items"]), report
    assert report["earned_weight"] == report["total_weight"] == 7.0
    # Every item has a non-empty human-readable reason.
    assert all(item["reason"] for item in report["items"])


async def test_missing_vlan_drops_exactly_its_weighted_item(client):
    pid = await _build_project(client, with_vlan=False)  # sw1 has no VLAN 20
    aid = await _make_activity(client, _checks())

    report = (await client.post(f"/api/activities/{aid}/grade", json={"project_id": pid})).json()

    vlan_item = next(i for i in report["items"] if "VLAN 20" in i["label"])
    assert vlan_item["passed"] is False
    assert vlan_item["weight"] == 2
    # Reason is a non-empty string naming the VLAN and the node.
    assert "20" in vlan_item["reason"] and "sw1" in vlan_item["reason"]

    # Every OTHER item still passes...
    others = [i for i in report["items"] if i is not vlan_item]
    assert all(i["passed"] for i in others), others
    # ...and the score dropped by exactly the vlan item's weight fraction (2/7).
    assert report["total_weight"] == 7.0
    assert report["earned_weight"] == 5.0
    assert report["score_pct"] == round(100.0 * 5 / 7, 6)


async def test_ping_pass_and_fail(client):
    pid = await _build_project(client, with_vlan=True)
    checks = [
        {"kind": "ping", "node": "r1", "dst": "10.0.0.2", "weight": 1, "label": "reachable"},
        {"kind": "ping", "node": "r1", "dst": "192.0.2.99", "weight": 1, "label": "unreachable"},
    ]
    aid = await _make_activity(client, checks)

    report = (await client.post(f"/api/activities/{aid}/grade", json={"project_id": pid})).json()
    items = {i["label"]: i for i in report["items"]}

    assert items["reachable"]["passed"] is True
    assert "succeeded" in items["reachable"]["reason"]
    assert items["unreachable"]["passed"] is False
    assert "failed" in items["unreachable"]["reason"]
    assert report["score_pct"] == 50.0


async def test_grade_unknown_project_and_activity_404(client):
    pid = await _build_project(client)
    aid = await _make_activity(client, _checks())

    # unknown project
    r1 = await client.post(f"/api/activities/{aid}/grade", json={"project_id": "nope"})
    assert r1.status_code == 404, r1.text
    # unknown activity
    r2 = await client.post("/api/activities/deadbeef/grade", json={"project_id": pid})
    assert r2.status_code == 404, r2.text


async def test_activity_crud_round_trip(client):
    checks = [{"kind": "node_exists", "node": "r1", "weight": 1}]
    created = (
        await client.post(
            "/api/activities",
            json={"name": "act", "instructions": "hi", "locked_ui": ["toolbar.delete"], "checks": checks},
        )
    ).json()
    aid = created["id"]
    assert created["locked_ui"] == ["toolbar.delete"]
    assert created["checks"][0]["kind"] == "node_exists"

    got = await client.get(f"/api/activities/{aid}")
    assert got.status_code == 200 and got.json()["id"] == aid

    listing = (await client.get("/api/activities")).json()
    assert any(a["id"] == aid for a in listing)

    deleted = await client.delete(f"/api/activities/{aid}")
    assert deleted.status_code == 200 and deleted.json() == {"deleted": aid}
    assert (await client.get(f"/api/activities/{aid}")).status_code == 404


async def test_instantiate_activity_creates_project(client):
    pid = await _build_project(client, with_vlan=True)
    initial = (await client.get(f"/api/projects/{pid}/archive")).json()
    aid = (
        await client.post("/api/activities", json={"name": "starter", "initial": initial, "checks": []})
    ).json()["id"]

    resp = await client.post(f"/api/activities/{aid}/instantiate")
    assert resp.status_code == 201, resp.text
    new_pid = resp.json()["id"]
    assert new_pid != pid
    dst = (await client.get(f"/api/projects/{new_pid}/topology")).json()
    assert {n["name"] for n in dst["nodes"]} == {"r1", "r2", "sw1"}
