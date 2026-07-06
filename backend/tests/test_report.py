"""Project report + BOM tests (NG-CFG-02 / NG-FI-04)."""
from __future__ import annotations


async def _rich_project(client) -> str:
    pid = (await client.post("/api/projects", json={"name": "ISP-demo"})).json()["id"]
    # two devices + a link
    for name, iface, ip in [("r1", "r1-e0", "10.0.0.1/24"), ("sw1", "sw1-e0", "10.0.0.2/24")]:
        kind = "router" if name == "r1" else "switch"
        await client.post("/api/nodes", json={
            "project_id": pid, "name": name, "kind": kind,
            "interfaces": [{"id": iface, "node_id": "", "name": "eth0", "ip": [ip]}],
        })
    link = await client.post("/api/links", json={
        "project_id": pid, "a_iface": "r1-e0", "b_iface": "sw1-e0", "type": "copper"})
    lid = link.json()["id"]
    # a site + rack with sw1 placed
    site = (await client.post("/api/sites", json={"project_id": pid, "name": "HQ"})).json()
    rack = (await client.post("/api/racks", json={"project_id": pid, "site_id": site["id"], "name": "R1"})).json()
    sw1 = next(n for n in (await client.get(f"/api/projects/{pid}/topology")).json()["nodes"] if n["name"] == "sw1")
    await client.patch(f"/api/nodes/{sw1['id']}", json={"rack_id": rack["id"], "ru_start": 1, "ru_span": 1})
    # a cable + a fiber path
    await client.post("/api/cables", json={"project_id": pid, "link_id": lid, "media": "cat6", "length_m": 30.0})
    await client.post("/api/fiber-paths", json={
        "project_id": pid, "name": "feeder", "gpon_class": "c_plus",
        "elements": [{"kind": "fiber", "length_m": 2000, "atten_db_km": 0.22},
                     {"kind": "splitter", "split_ratio": 32}]})
    return pid


async def test_bom_tallies(client):
    pid = await _rich_project(client)
    bom = (await client.get(f"/api/projects/{pid}/bom")).json()
    by = {(i["category"], i["item"]): i for i in bom}
    assert by[("Devices", "router")]["qty"] == 1
    assert by[("Devices", "switch")]["qty"] == 1
    assert by[("Cabling", "cat6")]["qty"] == 1
    assert "30.0 m" in by[("Cabling", "cat6")]["notes"]
    assert by[("Fiber plant", "1:32 splitter")]["qty"] == 1
    assert by[("Fiber plant", "Fiber")]["qty"] == 2000
    # deterministic order
    assert bom == (await client.get(f"/api/projects/{pid}/bom")).json()


async def test_report_html_sections(client):
    pid = await _rich_project(client)
    resp = await client.get(f"/api/projects/{pid}/report")
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/html")
    html = resp.text
    assert "ISP-demo" in html
    for heading in ["Device inventory", "Rack sheets", "Fiber loss budgets", "Bill of materials"]:
        assert heading in html
    assert "17.54 dB" in html   # 2 km @0.22 (0.44) + 1:32 (17.1)
    assert "PASS" in html
    assert "1:32 splitter" in html


async def test_report_empty_fiber_still_renders(client):
    pid = (await client.post("/api/projects", json={"name": "bare"})).json()["id"]
    resp = await client.get(f"/api/projects/{pid}/report")
    assert resp.status_code == 200
    assert "Fiber loss budgets" in resp.text
    assert "none" in resp.text


async def test_report_and_bom_404(client):
    assert (await client.get("/api/projects/ghost/bom")).status_code == 404
    assert (await client.get("/api/projects/ghost/report")).status_code == 404
