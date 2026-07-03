"""NetLab service — live packet-level labs built from stored topologies.

The :class:`LabManager` keeps at most one built :class:`engine.netstack.Network`
per project, fingerprinted against the topology, so consoles, ping/traceroute
and capture inspection all operate on the *same* living lab. Any topology
change (node/link/intent edit) invalidates the lab; the next request rebuilds
and re-converges it.

Node ``intent`` fields understood by the builder (all optional):

    gateway: "192.168.1.1"                 # hosts: default gateway
    dns: "192.168.1.1"                     # hosts: resolver address
    vlans: {"<iface-name>": {"mode": "access"|"trunk", "vlan": 10}}
    static_routes: [{"prefix": "0.0.0.0/0", "next_hop": "10.0.0.1"}]
    ospf: {"enabled": true, "router_id": "1.1.1.1", "hello": 10}
    bgp: {"asn": 65001, "router_id": "1.1.1.1",
          "neighbors": [{"ip": "10.0.0.2", "asn": 65002}],
          "networks": ["198.51.100.0/24"]}
    dhcp_server: {"pools": [{"network": "192.168.88.0/24",
                             "gateway": "192.168.88.1", "dns": "..."}]}
    dns_zone: {"nas.lab": "192.168.1.40"}
    nat: {"inside": ["eth0"], "outside": "eth1"}
    acl: {"<iface-name>": {"in": [{"action": "deny", "proto": "icmp",
                                   "src": "10.0.0.0/8", "dst": null,
                                   "dst_port": null}], "out": [...]}}
"""
from __future__ import annotations

import hashlib
import json
import logging
from dataclasses import dataclass, field
from functools import lru_cache
from ipaddress import IPv4Address, IPv4Network

from app.models import Topology
from engine.netstack import Network
from engine.netstack.cli import CliSession
from engine.netstack.device import Device, Host
from engine.netstack.routing import AclRule, DhcpPool, Firewall, Router
from engine.netstack.switching import Switch
from engine.netstack.protocols.bgp import BgpProcess
from engine.netstack.protocols.ospf import OspfProcess

logger = logging.getLogger("netgeo.netlab")

_MBPS = 1_000_000

# Node kinds that behave as an L2 bridge in the lab.
_L2_KINDS = {"switch", "ap", "olt", "cloud"}
_HOST_KINDS = {"host", "server"}


def _fingerprint(topo: Topology) -> str:
    blob = topo.model_dump_json()
    return hashlib.sha256(blob.encode()).hexdigest()


# ---------------------------------------------------------------------------
# Builder
# ---------------------------------------------------------------------------

def build_network(topo: Topology, seed: int = 0) -> Network:
    """Construct a runnable lab from a stored topology."""
    net = Network(seed=seed)
    iface_owner: dict[str, tuple[str, str]] = {}  # iface id -> (node id, iface name)

    for n in topo.nodes:
        kind = str(n.kind)
        if kind in _L2_KINDS:
            dev: Device = Switch(n.name, node_id=n.id, nos=str(n.nos))
        elif kind == "firewall":
            dev = Firewall(n.name, node_id=n.id, nos=str(n.nos))
        elif kind in _HOST_KINDS:
            dev = Host(n.name, node_id=n.id, nos=str(n.nos))
        else:  # router and anything router-like
            dev = Router(n.name, node_id=n.id, nos=str(n.nos))
        net.add_device(dev)

        intent = n.intent or {}
        vlans = intent.get("vlans") or {}
        for i in n.interfaces:
            iface = net.add_iface(dev, i.name, list(i.ip))
            if i.mac:
                try:
                    from engine.netstack.addr import MacAddr

                    iface.mac = MacAddr(i.mac)
                except ValueError:
                    pass
            vcfg = vlans.get(i.name)
            if isinstance(vcfg, dict):
                iface.vlan_mode = str(vcfg.get("mode", "access"))
                if "vlan" in vcfg:
                    iface.access_vlan = int(vcfg["vlan"])
                if isinstance(vcfg.get("allowed"), list):
                    iface.trunk_vlans = {int(v) for v in vcfg["allowed"]}
            iface_owner[i.id] = (n.id, i.name)

        _apply_intent(net, dev, intent)

    for l in topo.links:
        a = _resolve_iface(net, iface_owner, l.a_iface)
        b = _resolve_iface(net, iface_owner, l.b_iface)
        if a is None or b is None:
            logger.warning("link %s references unresolvable endpoint(s); skipped", l.id)
            continue
        net.connect(
            l.id,
            a,
            b,
            bandwidth_bps=float(l.bandwidth) * _MBPS,
            delay=l.delay / 1000.0,
            loss=l.loss,
            mtu=l.mtu,
            up=str(l.status) == "up",
            kind=str(l.type),
        )
    return net


def _resolve_iface(net: Network, owner: dict, ref: str):
    """A link endpoint may be an interface id or (frontend fallback) a node
    id/name — in that case auto-provision the next ethN port."""
    hit = owner.get(ref)
    if hit is not None:
        node_id, iface_name = hit
        dev = net.devices_by_id.get(node_id)
        return dev.interfaces.get(iface_name) if dev else None
    dev = net.find_device(ref)
    if dev is None:
        return None
    n = 0
    while f"eth{n}" in dev.interfaces:
        n += 1
    return net.add_iface(dev, f"eth{n}")


def _apply_intent(net: Network, dev: Device, intent: dict) -> None:
    if isinstance(dev, Host):
        gw = intent.get("gateway")
        if gw:
            dev.default_gateway = IPv4Address(gw)
        dns = intent.get("dns")
        if dns:
            dev.dns_server = IPv4Address(dns)
        return

    if not isinstance(dev, Router):
        return

    for sr in intent.get("static_routes") or []:
        try:
            dev.add_static_route(sr["prefix"], sr["next_hop"])
        except (KeyError, ValueError) as exc:
            logger.warning("%s: bad static route %r: %s", dev.name, sr, exc)

    ospf_cfg = intent.get("ospf") or {}
    if ospf_cfg.get("enabled"):
        OspfProcess(
            dev,
            router_id=ospf_cfg.get("router_id"),
            hello_interval=float(ospf_cfg.get("hello", 10.0)),
        )

    bgp_cfg = intent.get("bgp") or {}
    if bgp_cfg.get("asn"):
        proc = BgpProcess(
            dev,
            asn=int(bgp_cfg["asn"]),
            router_id=bgp_cfg.get("router_id"),
            keepalive_interval=float(bgp_cfg.get("keepalive", 30.0)),
        )
        for nb in bgp_cfg.get("neighbors") or []:
            try:
                proc.add_neighbor(nb["ip"], int(nb["asn"]))
            except (KeyError, ValueError) as exc:
                logger.warning("%s: bad bgp neighbor %r: %s", dev.name, nb, exc)
        for prefix in bgp_cfg.get("networks") or []:
            proc.advertise_network(prefix)

    dhcp_cfg = intent.get("dhcp_server") or {}
    for pool in dhcp_cfg.get("pools") or []:
        try:
            dev.add_dhcp_pool(
                DhcpPool(
                    network=IPv4Network(pool["network"]),
                    gateway=IPv4Address(pool["gateway"]),
                    dns=IPv4Address(pool["dns"]) if pool.get("dns") else None,
                )
            )
        except (KeyError, ValueError) as exc:
            logger.warning("%s: bad dhcp pool %r: %s", dev.name, pool, exc)

    for qname, addr in (intent.get("dns_zone") or {}).items():
        try:
            dev.dns_zone[str(qname).lower()] = IPv4Address(addr)
        except ValueError:
            pass

    nat_cfg = intent.get("nat") or {}
    if nat_cfg.get("outside"):
        dev.enable_nat(list(nat_cfg.get("inside") or []), str(nat_cfg["outside"]))

    for iface_name, directions in (intent.get("acl") or {}).items():
        for direction in ("in", "out"):
            rules = []
            for r in (directions or {}).get(direction) or []:
                rules.append(
                    AclRule(
                        action=str(r.get("action", "permit")),
                        proto=r.get("proto"),
                        src=IPv4Network(r["src"]) if r.get("src") else None,
                        dst=IPv4Network(r["dst"]) if r.get("dst") else None,
                        dst_port=int(r["dst_port"]) if r.get("dst_port") else None,
                    )
                )
            if rules:
                target = dev.acl_in if direction == "in" else dev.acl_out
                target[iface_name] = rules


def _settle_time(net: Network) -> float:
    """Sim-seconds to run at build so protocols converge before first use."""
    has_bgp = has_ospf = False
    for dev in net.devices.values():
        for proc in getattr(dev, "processes", []):
            has_bgp |= getattr(proc, "proto", "") == "bgp"
            has_ospf |= getattr(proc, "proto", "") == "ospf"
    if has_bgp or has_ospf:
        return 65.0
    if any(isinstance(d, Switch) for d in net.devices.values()):
        return 12.0
    return 1.0


# ---------------------------------------------------------------------------
# Lab manager
# ---------------------------------------------------------------------------

@dataclass
class Lab:
    project_id: str
    fingerprint: str
    net: Network
    sessions: dict[str, CliSession] = field(default_factory=dict)

    def session_for(self, node_ref: str) -> CliSession | None:
        dev = self.net.find_device(node_ref)
        if dev is None:
            return None
        sess = self.sessions.get(dev.node_id)
        if sess is None:
            sess = CliSession(self.net, dev)
            self.sessions[dev.node_id] = sess
        return sess


class LabManager:
    """At most one live lab per project, invalidated by topology fingerprint."""

    def __init__(self) -> None:
        self._labs: dict[str, Lab] = {}

    def get(self, topo: Topology, seed: int = 0) -> Lab:
        pid = topo.project.id
        fp = _fingerprint(topo)
        lab = self._labs.get(pid)
        if lab is not None and lab.fingerprint == fp:
            return lab
        net = build_network(topo, seed=seed)
        net.start()
        net.run_for(_settle_time(net))
        lab = Lab(project_id=pid, fingerprint=fp, net=net)
        self._labs[pid] = lab
        logger.info(
            "lab built for %s: %s devices, %s links, settled to t=%.1fs",
            pid,
            len(net.devices),
            len(net.attachments),
            net.now,
        )
        return lab

    def invalidate(self, project_id: str) -> None:
        self._labs.pop(project_id, None)

    def peek(self, project_id: str) -> Lab | None:
        return self._labs.get(project_id)


@lru_cache(maxsize=1)
def get_lab_manager() -> LabManager:
    return LabManager()


# ---------------------------------------------------------------------------
# Auto-addressing (UISP-style wizard backend)
# ---------------------------------------------------------------------------

def plan_auto_addressing(topo: Topology) -> dict:
    """Compute an IPv4 plan for every broadcast domain in the topology.

    - Point-to-point links between L3 devices get /30s from 10.255.0.0/16.
    - L2 domains (hosts/routers bridged by switches) get /24s from 10.<n>.0.0.
      Routers get the low addresses (.1, .2, ...), hosts get .10 upward and a
      default gateway pointing at the first router in the domain.

    Returns {node_id: {iface_id: "cidr"}, ...} plus per-host gateway hints —
    the API layer persists it back to the repository.
    """
    node_by_id = {n.id: n for n in topo.nodes}
    iface_node: dict[str, str] = {}
    for n in topo.nodes:
        for i in n.interfaces:
            iface_node[i.id] = n.id

    def node_of(ref: str) -> str | None:
        if ref in iface_node:
            return iface_node[ref]
        return ref if ref in node_by_id else None

    def is_l2(nid: str) -> bool:
        return str(node_by_id[nid].kind) in _L2_KINDS

    def is_l3(nid: str) -> bool:
        return not is_l2(nid)

    # Union endpoints into broadcast domains: links whose both ends are L3
    # devices are their own p2p domain; anything touching a switch merges into
    # that switch's domain.
    parent: dict[str, str] = {}

    def find(x: str) -> str:
        parent.setdefault(x, x)
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a: str, b: str) -> None:
        parent[find(a)] = find(b)

    p2p: list[tuple[str, str, str, str]] = []  # (link id, a_iface, b_iface, kind)
    for l in topo.links:
        na, nb = node_of(l.a_iface), node_of(l.b_iface)
        if na is None or nb is None:
            continue
        if is_l3(na) and is_l3(nb):
            p2p.append((l.id, l.a_iface, l.b_iface, "p2p"))
        else:
            union(f"n:{na}", f"n:{nb}")

    assignments: dict[str, dict[str, str]] = {}
    gateways: dict[str, str] = {}

    def assign(node_id: str, iface_ref: str, cidr: str) -> None:
        assignments.setdefault(node_id, {})[iface_ref] = cidr

    # 1) Point-to-point /30s.
    p2p_pool = 0
    for link_id, a_ref, b_ref, _ in p2p:
        na, nb = node_of(a_ref), node_of(b_ref)
        base = IPv4Address("10.255.0.0") + p2p_pool * 4
        p2p_pool += 1
        assign(na, a_ref, f"{base + 1}/30")
        assign(nb, b_ref, f"{base + 2}/30")

    # 2) LAN /24s per switch domain.
    domains: dict[str, list[tuple[str, str]]] = {}  # root -> [(node id, iface ref)]
    for l in topo.links:
        na, nb = node_of(l.a_iface), node_of(l.b_iface)
        if na is None or nb is None or (is_l3(na) and is_l3(nb)):
            continue
        for nid, ref in ((na, l.a_iface), (nb, l.b_iface)):
            if is_l3(nid):
                domains.setdefault(find(f"n:{nid}"), []).append((nid, ref))

    lan_index = 0
    for members in domains.values():
        lan_index += 1
        base = IPv4Address("10.0.0.0") + lan_index * 65536  # 10.<n>.0.0/24
        routers = [m for m in members if str(node_by_id[m[0]].kind) in ("router", "firewall")]
        hosts = [m for m in members if m not in routers]
        addr = 0
        gw_ip: str | None = None
        for nid, ref in routers:
            addr += 1
            ip = f"{base + addr}/24"
            assign(nid, ref, ip)
            if gw_ip is None:
                gw_ip = str(base + addr)
        addr = max(addr, 9)
        for nid, ref in hosts:
            addr += 1
            assign(nid, ref, f"{base + addr}/24")
            if gw_ip is not None:
                gateways[nid] = gw_ip

    return {"assignments": assignments, "gateways": gateways}
