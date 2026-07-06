"""Config import → twin base tests (NG-TW-01)."""
from __future__ import annotations

from app.services.configimport import parse_ios

_IOS = """
hostname EDGE-1
!
interface GigabitEthernet0/0
 ip address 10.0.0.1 255.255.255.0
!
interface GigabitEthernet0/1
 ip address 172.16.5.1 255.255.255.252
!
ip route 0.0.0.0 0.0.0.0 10.0.0.254
ip route 192.168.9.0 255.255.255.0 172.16.5.2
"""


def test_parse_ios_extracts_shape():
    p = parse_ios(_IOS)
    assert p["hostname"] == "EDGE-1"
    names = {i["name"] for i in p["interfaces"]}
    assert names == {"GigabitEthernet0/0", "GigabitEthernet0/1"}
    g0 = next(i for i in p["interfaces"] if i["name"] == "GigabitEthernet0/0")
    assert g0["ip"] == ["10.0.0.1/24"]
    g1 = next(i for i in p["interfaces"] if i["name"] == "GigabitEthernet0/1")
    assert g1["ip"] == ["172.16.5.1/30"]
    assert {"prefix": "0.0.0.0/0", "next_hop": "10.0.0.254"} in p["static_routes"]
    assert {"prefix": "192.168.9.0/24", "next_hop": "172.16.5.2"} in p["static_routes"]


async def test_import_config_creates_node(client):
    pid = (await client.post("/api/projects", json={"name": "twin"})).json()["id"]
    resp = await client.post(
        f"/api/projects/{pid}/import-config", json={"vendor": "ios", "text": _IOS}
    )
    assert resp.status_code == 201, resp.text
    node = resp.json()
    assert node["name"] == "EDGE-1"
    assert len(node["interfaces"]) == 2
    assert node["intent"]["imported"] is True
    assert len(node["intent"]["static_routes"]) == 2
    # the imported node shows up in the project topology
    topo = (await client.get(f"/api/projects/{pid}/topology")).json()
    assert any(n["name"] == "EDGE-1" for n in topo["nodes"])


async def test_import_unknown_vendor_422_and_project_404(client):
    pid = (await client.post("/api/projects", json={"name": "t"})).json()["id"]
    assert (await client.post(f"/api/projects/{pid}/import-config",
            json={"vendor": "brand-x", "text": "hostname X"})).status_code == 422
    assert (await client.post("/api/projects/ghost/import-config",
            json={"vendor": "ios", "text": "hostname X"})).status_code == 404
