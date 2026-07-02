"""OSPFv2 — single-area link-state routing (simplified but event-faithful).

What is modelled:
- periodic Hellos to 224.0.0.5 per enabled interface (multicast L2);
- adjacency forms when both routers see each other in Hellos (2-way -> Full,
  skipping the DBD/LSR database exchange — LSAs are flooded instead);
- router LSAs with sequence numbers, flooded hop-by-hop with re-flood on
  newer sequence;
- Dijkstra SPF over the LSDB, cost = ref_bandwidth / interface bandwidth;
- dead-interval neighbor expiry, LSA re-origination and route withdrawal.

Not modelled (documented): areas beyond 0, DR/BDR election on multi-access
segments (adjacency is formed with every neighbor), NSSA/stub areas, LSA
aging/refresh, authentication.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from ipaddress import IPv4Address, IPv4Network
from typing import TYPE_CHECKING

from engine.events import EventType, SimEvent
from engine.netstack.frames import ETH_IPV4, PROTO_OSPF, EthernetFrame, Ipv4Packet
from engine.netstack.iface import Interface
from engine.netstack.routing import Route, Router

if TYPE_CHECKING:  # pragma: no cover
    from engine.netstack.network import Network

logger = logging.getLogger(__name__)

OSPF_MCAST_IP = IPv4Address("224.0.0.5")
OSPF_MCAST_MAC = "01:00:5e:00:00:05"
REF_BANDWIDTH = 100_000_000.0  # 100 Mbps reference, Cisco default


# --- OSPF PDUs (payload of Ipv4Packet proto 89) ------------------------------

@dataclass(slots=True)
class OspfHello:
    router_id: str
    neighbors_seen: list[str] = field(default_factory=list)
    hello_interval: float = 10.0
    dead_interval: float = 40.0

    @property
    def wire_size(self) -> int:
        return 44 + 4 * len(self.neighbors_seen)

    def summary(self) -> str:
        return f"OSPF Hello rid={self.router_id} seen={len(self.neighbors_seen)}"


@dataclass(slots=True)
class RouterLsa:
    router_id: str
    seq: int
    # ("ptp", neighbor_router_id, cost) | ("stub", "prefix/len", cost)
    links: list[tuple[str, str, int]] = field(default_factory=list)

    @property
    def wire_size(self) -> int:
        return 24 + 12 * len(self.links)


@dataclass(slots=True)
class OspfLsu:
    lsas: list[RouterLsa] = field(default_factory=list)

    @property
    def wire_size(self) -> int:
        return 28 + sum(l.wire_size for l in self.lsas)

    def summary(self) -> str:
        return f"OSPF LSU {len(self.lsas)} LSA(s)"


@dataclass(slots=True)
class _Neighbor:
    router_id: str
    ip: IPv4Address
    iface_name: str
    state: str = "init"          # init | full
    last_seen: float = 0.0


class OspfProcess:
    """One OSPF instance attached to a Router."""

    proto = "ospf"

    def __init__(
        self,
        router: Router,
        router_id: str | None = None,
        hello_interval: float = 10.0,
        dead_interval: float | None = None,
        ifaces: list[str] | None = None,
    ) -> None:
        self.router = router
        self.router_id = router_id or self._pick_router_id()
        self.hello_interval = hello_interval
        self.dead_interval = dead_interval if dead_interval is not None else hello_interval * 4
        self.iface_names = ifaces  # None = all L3 interfaces
        self.neighbors: dict[str, _Neighbor] = {}       # router_id -> neighbor
        self.lsdb: dict[str, RouterLsa] = {}
        self._seq = 0
        self._started = False
        self._spf_pending = False
        router.processes.append(self)

    def _pick_router_id(self) -> str:
        ips = self.router.all_ips()
        return str(max(i.ip for i in ips)) if ips else self.router.name

    def _enabled_ifaces(self) -> list[Interface]:
        out = []
        for name, iface in self.router.interfaces.items():
            if self.iface_names is not None and name not in self.iface_names:
                continue
            if iface.ips:
                out.append(iface)
        return out

    # ----- lifecycle ---------------------------------------------------------
    def start(self, net: "Network") -> None:
        if self._started:
            return
        self._started = True
        self._originate_lsa(net, flood=False)
        self._tick(net)

    def _tick(self, net: "Network") -> None:
        if not self.router.powered_on:
            return
        self._expire_neighbors(net)
        self._send_hellos(net)
        net.scheduler.schedule_after(
            self.hello_interval,
            SimEvent(
                time=0.0,
                type=EventType.TIMER,
                handler=lambda _c, _e: self._tick(net),
                node_id=self.router.node_id,
            ),
        )

    # ----- hello protocol -------------------------------------------------------
    def _send_hellos(self, net: "Network") -> None:
        seen = [n.router_id for n in self.neighbors.values()]
        for iface in self._enabled_ifaces():
            if not iface.is_up or not iface.ip:
                continue
            iface.transmit(
                net,
                EthernetFrame(
                    src_mac=iface.mac,
                    dst_mac=OSPF_MCAST_MAC,
                    ethertype=ETH_IPV4,
                    payload=Ipv4Packet(
                        src=iface.ip.ip,
                        dst=OSPF_MCAST_IP,
                        proto=PROTO_OSPF,
                        ttl=1,
                        dscp=48,
                        payload=OspfHello(
                            router_id=self.router_id,
                            neighbors_seen=list(seen),
                            hello_interval=self.hello_interval,
                            dead_interval=self.dead_interval,
                        ),
                    ),
                ),
            )

    def on_packet(self, net: "Network", iface: Interface, pkt: Ipv4Packet) -> None:
        payload = pkt.payload
        if isinstance(payload, OspfHello):
            self._on_hello(net, iface, pkt.src, payload)
        elif isinstance(payload, OspfLsu):
            self._on_lsu(net, iface, pkt.src, payload)

    def _on_hello(
        self, net: "Network", iface: Interface, src: IPv4Address, hello: OspfHello
    ) -> None:
        if hello.router_id == self.router_id:
            return
        nbr = self.neighbors.get(hello.router_id)
        if nbr is None:
            nbr = _Neighbor(
                router_id=hello.router_id, ip=src, iface_name=iface.name, state="init"
            )
            self.neighbors[hello.router_id] = nbr
        nbr.ip = src
        nbr.iface_name = iface.name
        nbr.last_seen = net.now

        if self.router_id in hello.neighbors_seen and nbr.state != "full":
            nbr.state = "full"
            logger.debug("%s: adjacency FULL with %s", self.router_id, nbr.router_id)
            self._originate_lsa(net)
            # Database sync: give the new neighbor our entire LSDB.
            self._send_lsu(net, nbr, list(self.lsdb.values()))

    def _expire_neighbors(self, net: "Network") -> None:
        dead = [
            rid
            for rid, n in self.neighbors.items()
            if n.last_seen and net.now - n.last_seen > self.dead_interval
        ]
        for rid in dead:
            del self.neighbors[rid]
        if dead:
            logger.debug("%s: neighbors dead: %s", self.router_id, dead)
            self._originate_lsa(net)
            self._schedule_spf(net)

    # ----- LSA origination / flooding -----------------------------------------------
    def _iface_cost(self, iface: Interface) -> int:
        att = iface.attachment
        bw = att.bandwidth_bps if att else 1e9
        return max(1, int(REF_BANDWIDTH / max(bw, 1.0)))

    def _originate_lsa(self, net: "Network", flood: bool = True) -> None:
        self._seq += 1
        links: list[tuple[str, str, int]] = []
        for iface in self._enabled_ifaces():
            cost = self._iface_cost(iface)
            for ip in iface.ips:
                links.append(("stub", str(ip.network), cost))
            for nbr in self.neighbors.values():
                if nbr.iface_name == iface.name and nbr.state == "full":
                    links.append(("ptp", nbr.router_id, cost))
        lsa = RouterLsa(router_id=self.router_id, seq=self._seq, links=links)
        self.lsdb[self.router_id] = lsa
        if flood:
            self._flood(net, lsa, exclude_rid=None)
        self._schedule_spf(net)

    def _flood(self, net: "Network", lsa: RouterLsa, exclude_rid: str | None) -> None:
        for nbr in self.neighbors.values():
            if nbr.state != "full" or nbr.router_id == exclude_rid:
                continue
            self._send_lsu(net, nbr, [lsa])

    def _send_lsu(self, net: "Network", nbr: _Neighbor, lsas: list[RouterLsa]) -> None:
        if not lsas:
            return
        iface = self.router.interfaces.get(nbr.iface_name)
        if iface is None or not iface.ip:
            return
        self.router.send_ip(
            net,
            Ipv4Packet(
                src=iface.ip.ip,
                dst=nbr.ip,
                proto=PROTO_OSPF,
                ttl=1,
                dscp=48,
                payload=OspfLsu(lsas=[RouterLsa(l.router_id, l.seq, list(l.links)) for l in lsas]),
            ),
        )

    def _on_lsu(
        self, net: "Network", iface: Interface, src: IPv4Address, lsu: OspfLsu
    ) -> None:
        changed = False
        sender_rid = next(
            (rid for rid, n in self.neighbors.items() if n.ip == src), None
        )
        for lsa in lsu.lsas:
            current = self.lsdb.get(lsa.router_id)
            if current is None or lsa.seq > current.seq:
                self.lsdb[lsa.router_id] = lsa
                self._flood(net, lsa, exclude_rid=sender_rid)
                changed = True
        if changed:
            self._schedule_spf(net)

    # ----- SPF ------------------------------------------------------------------------
    def _schedule_spf(self, net: "Network") -> None:
        """Debounce SPF: one run per burst of LSDB changes."""
        if self._spf_pending:
            return
        self._spf_pending = True
        net.scheduler.schedule_after(
            0.05,
            SimEvent(
                time=0.0,
                type=EventType.TIMER,
                handler=lambda _c, _e: self._run_spf(net),
                node_id=self.router.node_id,
            ),
        )

    def _run_spf(self, net: "Network") -> None:
        self._spf_pending = False
        # Build the graph from the LSDB with a bidirectional check.
        adj: dict[str, list[tuple[str, int]]] = {}
        for rid, lsa in self.lsdb.items():
            for kind, target, cost in lsa.links:
                if kind != "ptp":
                    continue
                peer = self.lsdb.get(target)
                if peer is None:
                    continue
                if not any(k == "ptp" and t == rid for k, t, _ in peer.links):
                    continue  # not bidirectional -> not usable
                adj.setdefault(rid, []).append((target, cost))

        # Dijkstra from self.
        import heapq

        dist: dict[str, int] = {self.router_id: 0}
        first_hop: dict[str, str] = {}
        heap: list[tuple[int, str, str | None]] = [(0, self.router_id, None)]
        visited: set[str] = set()
        while heap:
            d, rid, fh = heapq.heappop(heap)
            if rid in visited:
                continue
            visited.add(rid)
            if fh is not None:
                first_hop[rid] = fh
            for nxt, cost in adj.get(rid, ()):
                nd = d + cost
                if nxt not in dist or nd < dist[nxt]:
                    dist[nxt] = nd
                    heapq.heappush(
                        heap, (nd, nxt, fh if fh is not None else nxt)
                    )

        # Install routes for remote stub prefixes.
        local_prefixes = {ip.network for ip in self.router.all_ips()}
        desired: dict[IPv4Network, tuple[IPv4Address, str, int]] = {}
        for rid, lsa in self.lsdb.items():
            if rid == self.router_id or rid not in dist:
                continue
            fh_rid = first_hop.get(rid)
            nbr = self.neighbors.get(fh_rid or "")
            if nbr is None:
                continue
            for kind, target, cost in lsa.links:
                if kind != "stub":
                    continue
                prefix = IPv4Network(target)
                if prefix in local_prefixes:
                    continue
                total = dist[rid] + cost
                cur = desired.get(prefix)
                if cur is None or total < cur[2]:
                    desired[prefix] = (nbr.ip, nbr.iface_name, total)

        self.router.withdraw_routes("ospf")
        for prefix, (nh, iface_name, metric) in desired.items():
            self.router.install_route(
                Route(
                    prefix=prefix,
                    next_hop=nh,
                    iface_name=iface_name,
                    source="ospf",
                    metric=metric,
                )
            )

    # ----- introspection ------------------------------------------------------------------
    def neighbor_rows(self) -> list[dict]:
        return [
            {
                "router_id": n.router_id,
                "ip": str(n.ip),
                "iface": n.iface_name,
                "state": n.state,
            }
            for n in self.neighbors.values()
        ]
