"""Config import → twin base tests (NG-TW-01)."""
from __future__ import annotations

from app.services.configimport import infer_links, parse_ios, parse_routeros

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


_IOS_DYNAMIC = """
hostname CORE-1
interface Loopback0
 ip address 1.1.1.1 255.255.255.255
interface GigabitEthernet0/0
 ip address 10.0.0.1 255.255.255.0
router ospf 1
 router-id 1.1.1.1
 network 10.0.0.0 0.0.0.255 area 0
router bgp 65001
 bgp router-id 1.1.1.1
 neighbor 10.0.0.2 remote-as 65002
 network 1.1.1.0 mask 255.255.255.0
"""


def test_parse_ios_ospf_and_bgp():
    p = parse_ios(_IOS_DYNAMIC)
    assert p["ospf"]["areas"] == {"GigabitEthernet0/0": "0"}
    assert p["ospf"]["router_id"] == "1.1.1.1"
    assert p["bgp"]["asn"] == 65001
    assert {"ip": "10.0.0.2", "asn": 65002} in p["bgp"]["neighbors"]
    assert "1.1.1.0/24" in p["bgp"]["networks"]


_ROS = """
/system identity
set name=MTK-1
/ip address
add address=10.0.0.2/24 interface=ether1
add address=172.16.5.2/30 interface=ether2
/ip route
add dst-address=0.0.0.0/0 gateway=10.0.0.1
"""


def test_parse_routeros_shape():
    p = parse_routeros(_ROS)
    assert p["hostname"] == "MTK-1"
    names = {i["name"] for i in p["interfaces"]}
    assert names == {"ether1", "ether2"}
    e1 = next(i for i in p["interfaces"] if i["name"] == "ether1")
    assert e1["ip"] == ["10.0.0.2/24"]
    assert {"prefix": "0.0.0.0/0", "next_hop": "10.0.0.1"} in p["static_routes"]


def test_infer_links_pairs_shared_subnet_skips_loopback_and_same_node():
    entries = [
        ("a", "n1", "10.0.0.1/24"),
        ("b", "n2", "10.0.0.2/24"),
        ("c", "n1", "1.1.1.1/32"),   # loopback — no peer
        ("d", "n2", "172.16.5.2/30"),  # lone subnet — no peer
        ("e", "n1", "10.0.0.9/24"),   # same node as anchor — not self-linked
    ]
    pairs = {frozenset(p) for p in infer_links(entries)}
    assert frozenset(("a", "b")) in pairs
    assert frozenset(("a", "e")) not in pairs  # same node
    assert len(pairs) == 1


async def test_infer_links_endpoint_wires_imported_nodes(client):
    pid = (await client.post("/api/projects", json={"name": "twin"})).json()["id"]
    await client.post(f"/api/projects/{pid}/import-config",
                      json={"vendor": "ios", "text": _IOS_DYNAMIC})
    await client.post(f"/api/projects/{pid}/import-config",
                      json={"vendor": "routeros", "text": _ROS})
    links = (await client.post(f"/api/projects/{pid}/infer-links")).json()
    assert len(links) == 1  # 10.0.0.0/24 joins CORE-1 ↔ MTK-1
    # idempotent — a second run adds nothing.
    assert (await client.post(f"/api/projects/{pid}/infer-links")).json() == []


# --- NG-TW-02 reachability: a small mixed (IOS + RouterOS) set --------------
_R1 = """
hostname R1
interface GigabitEthernet0/0
 ip address 10.0.0.1 255.255.255.0
interface GigabitEthernet0/1
 ip address 172.16.0.1 255.255.255.252
"""
_R2 = """
/system identity
set name=R2
/ip address
add address=10.0.0.2/24 interface=ether1
/ip route
add dst-address=0.0.0.0/0 gateway=10.0.0.1
"""
_R3 = """
hostname R3
interface GigabitEthernet0/0
 ip address 172.16.0.2 255.255.255.252
ip route 10.0.0.0 255.255.255.0 172.16.0.1
"""


async def test_reachability_answers_with_evidence(client):
    pid = (await client.post("/api/projects", json={"name": "twin"})).json()["id"]
    for vendor, text in (("ios", _R1), ("routeros", _R2), ("ios", _R3)):
        await client.post(f"/api/projects/{pid}/import-config",
                          json={"vendor": vendor, "text": text})
    assert len((await client.post(f"/api/projects/{pid}/infer-links")).json()) == 2

    resp = await client.post(f"/api/projects/{pid}/reachability",
                             json={"src": "R2", "dst": "172.16.0.2"})
    assert resp.status_code == 200, resp.text
    ans = resp.json()
    assert ans["reachable"] is True
    assert ans["path"]                      # traceroute produced a hop path
    assert ans["route"]["next_hop"] == "10.0.0.1"  # R2's RIB decision = default via R1


def test_parse_tolerates_junk():
    # Untrusted input must never raise — honest partial parse.
    p = parse_ios("\x00 random ;; not a config !!!\nnetwork boom")
    assert p == {"hostname": "imported", "interfaces": [], "static_routes": []}
    assert parse_routeros("garbage\n/ip address\nadd nope")["interfaces"] == []


async def test_import_rejects_bad_mask_and_oversized(client):
    pid = (await client.post("/api/projects", json={"name": "t"})).json()["id"]
    # A mask that matches the regex but isn't a valid netmask → 422, not 500.
    bad = "interface eth0\n ip address 10.0.0.1 999.0.0.0\n"
    assert (await client.post(f"/api/projects/{pid}/import-config",
            json={"vendor": "ios", "text": bad})).status_code == 422
    # Oversized paste is rejected at the trust boundary.
    assert (await client.post(f"/api/projects/{pid}/import-config",
            json={"vendor": "ios", "text": "x" * (512 * 1024 + 1)})).status_code == 422


async def test_reachability_unknown_source_422(client):
    pid = (await client.post("/api/projects", json={"name": "t"})).json()["id"]
    await client.post(f"/api/projects/{pid}/import-config",
                      json={"vendor": "ios", "text": _R1})
    resp = await client.post(f"/api/projects/{pid}/reachability",
                             json={"src": "ghost", "dst": "10.0.0.1"})
    assert resp.status_code == 422
