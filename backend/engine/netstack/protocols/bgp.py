"""BGP-4 — path-vector routing between autonomous systems (simplified).

What is modelled:
- explicit neighbor configuration (eBGP and iBGP by ASN comparison);
- session establishment over the simulated TCP port 179 (OPEN/KEEPALIVE
  exchange — real packets across the topology, so a broken data path means
  no session);
- UPDATE messages carrying the full Adj-RIB-Out snapshot (implicit withdraw:
  a prefix missing from the latest update is removed);
- AS-path loop prevention, next-hop-self on every advertisement;
- best-path selection: highest local-pref, shortest AS-path, lowest peer IP;
- hold-timer expiry drops the session and withdraws its routes;
- iBGP split-horizon (iBGP-learned routes are not re-advertised to iBGP).

Not modelled: MED, route reflectors, confederations, communities, MP-BGP.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from ipaddress import IPv4Address, IPv4Network
from typing import TYPE_CHECKING

from engine.events import EventType, SimEvent
from engine.netstack.frames import PROTO_TCP, Ipv4Packet, TcpSegment
from engine.netstack.iface import Interface
from engine.netstack.routing import Route, Router

if TYPE_CHECKING:  # pragma: no cover
    from engine.netstack.network import Network

logger = logging.getLogger(__name__)


# --- BGP messages (payload of TcpSegment port 179) ----------------------------

@dataclass(slots=True)
class BgpOpen:
    asn: int
    router_id: str
    hold_time: float = 90.0

    @property
    def wire_size(self) -> int:
        return 29

    def summary(self) -> str:
        return f"BGP OPEN as={self.asn} rid={self.router_id}"


@dataclass(slots=True)
class BgpKeepalive:
    @property
    def wire_size(self) -> int:
        return 19

    def summary(self) -> str:
        return "BGP KEEPALIVE"


@dataclass(slots=True)
class BgpUpdate:
    """Full Adj-RIB-Out snapshot: prefix -> (as_path, next_hop, local_pref)."""

    routes: dict[str, tuple[tuple[int, ...], str, int]] = field(default_factory=dict)

    @property
    def wire_size(self) -> int:
        return 23 + sum(9 + 2 * len(p[0]) for p in self.routes.values())

    def summary(self) -> str:
        return f"BGP UPDATE {len(self.routes)} route(s)"


@dataclass(slots=True)
class _Peer:
    ip: IPv4Address
    remote_asn: int
    state: str = "idle"                  # idle | open-sent | established
    hold_time: float = 90.0
    last_keepalive: float = 0.0
    # prefix -> (as_path, next_hop, local_pref)
    rib_in: dict[IPv4Network, tuple[tuple[int, ...], IPv4Address, int]] = field(
        default_factory=dict
    )


class BgpProcess:
    """One BGP speaker attached to a Router."""

    proto = "bgp"

    def __init__(
        self,
        router: Router,
        asn: int,
        router_id: str | None = None,
        keepalive_interval: float = 30.0,
        hold_time: float = 90.0,
    ) -> None:
        self.router = router
        self.asn = asn
        self.router_id = router_id or (
            str(max((i.ip for i in router.all_ips()), default="0.0.0.0"))
        )
        self.keepalive_interval = keepalive_interval
        self.hold_time = hold_time
        self.peers: dict[IPv4Address, _Peer] = {}
        self.networks: list[IPv4Network] = []
        self._started = False
        router.processes.append(self)

    # ----- configuration -----------------------------------------------------
    def add_neighbor(self, peer_ip: str | IPv4Address, remote_asn: int) -> None:
        ip = IPv4Address(peer_ip)
        self.peers[ip] = _Peer(ip=ip, remote_asn=remote_asn, hold_time=self.hold_time)

    def advertise_network(self, prefix: str | IPv4Network) -> None:
        net_ = IPv4Network(prefix)
        if net_ not in self.networks:
            self.networks.append(net_)

    # ----- lifecycle ------------------------------------------------------------
    def start(self, net: "Network") -> None:
        if self._started:
            return
        self._started = True
        for peer in self.peers.values():
            self._try_open(net, peer)
        self._tick(net)

    def _tick(self, net: "Network") -> None:
        if not self.router.powered_on:
            return
        for peer in self.peers.values():
            if peer.state == "established":
                if net.now - peer.last_keepalive > peer.hold_time:
                    self._session_down(net, peer)
                else:
                    self._send(net, peer, BgpKeepalive())
            elif peer.state == "idle":
                self._try_open(net, peer)   # automatic retry
        net.scheduler.schedule_after(
            self.keepalive_interval,
            SimEvent(
                time=0.0,
                type=EventType.TIMER,
                handler=lambda _c, _e: self._tick(net),
                node_id=self.router.node_id,
            ),
        )

    def _try_open(self, net: "Network", peer: _Peer) -> None:
        peer.state = "open-sent"
        self._send(
            net,
            peer,
            BgpOpen(asn=self.asn, router_id=self.router_id, hold_time=self.hold_time),
            flags="SYN",
        )

    def _session_down(self, net: "Network", peer: _Peer) -> None:
        logger.debug("%s: BGP session to %s down", self.router_id, peer.ip)
        peer.state = "idle"
        peer.rib_in.clear()
        self._decide_and_install(net)
        self._advertise_all(net)

    # ----- transport ---------------------------------------------------------------
    def _send(self, net: "Network", peer: _Peer, msg, flags: str = "PSH") -> None:
        route = self.router.egress_for(peer.ip)
        src_ip = route[0].ip.ip if route and route[0].ip else None
        if src_ip is None:
            return
        self.router.send_ip(
            net,
            Ipv4Packet(
                src=src_ip,
                dst=peer.ip,
                proto=PROTO_TCP,
                ttl=64 if peer.remote_asn == self.asn else 2,  # eBGP is 1-hop-ish
                dscp=48,
                payload=TcpSegment(
                    src_port=179, dst_port=179, flags=flags, payload=msg
                ),
            ),
        )

    # ----- message handling ------------------------------------------------------------
    def on_packet(self, net: "Network", iface: Interface, pkt: Ipv4Packet) -> None:
        seg = pkt.payload
        if not isinstance(seg, TcpSegment):
            return
        peer = self.peers.get(pkt.src)
        if peer is None:
            return
        msg = seg.payload
        if isinstance(msg, BgpOpen):
            if msg.asn != peer.remote_asn:
                logger.debug("%s: OPEN from %s wrong ASN %s", self.router_id, pkt.src, msg.asn)
                return
            peer.hold_time = min(self.hold_time, msg.hold_time)
            if peer.state != "established":
                if peer.state == "idle":
                    # Passive side: answer with our own OPEN.
                    self._try_open(net, peer)
                self._send(net, peer, BgpKeepalive())
        elif isinstance(msg, BgpKeepalive):
            peer.last_keepalive = net.now
            if peer.state != "established":
                peer.state = "established"
                logger.debug("%s: BGP ESTABLISHED with %s", self.router_id, peer.ip)
                self._send(net, peer, BgpKeepalive())
                self._advertise(net, peer)
        elif isinstance(msg, BgpUpdate):
            peer.last_keepalive = net.now
            self._on_update(net, peer, msg)

    def _on_update(self, net: "Network", peer: _Peer, update: BgpUpdate) -> None:
        rib: dict[IPv4Network, tuple[tuple[int, ...], IPv4Address, int]] = {}
        for prefix_s, (as_path, next_hop, local_pref) in update.routes.items():
            path = tuple(as_path)
            if self.asn in path:
                continue  # loop prevention
            rib[IPv4Network(prefix_s)] = (path, IPv4Address(next_hop), local_pref)
        peer.rib_in = rib
        self._decide_and_install(net)
        self._advertise_all(net)

    # ----- decision process ----------------------------------------------------------------
    def best_paths(
        self,
    ) -> dict[IPv4Network, tuple[tuple[int, ...], IPv4Address, int, IPv4Address]]:
        """prefix -> (as_path, next_hop, local_pref, learned_from_peer_ip)."""
        best: dict[IPv4Network, tuple[tuple[int, ...], IPv4Address, int, IPv4Address]] = {}
        for peer in self.peers.values():
            if peer.state != "established":
                continue
            for prefix, (path, nh, lp) in peer.rib_in.items():
                cur = best.get(prefix)
                if cur is None or self._better(path, nh, lp, peer.ip, cur):
                    best[prefix] = (path, nh, lp, peer.ip)
        return best

    @staticmethod
    def _better(
        path: tuple[int, ...],
        nh: IPv4Address,
        lp: int,
        peer_ip: IPv4Address,
        cur: tuple[tuple[int, ...], IPv4Address, int, IPv4Address],
    ) -> bool:
        cur_path, _cur_nh, cur_lp, cur_peer = cur
        if lp != cur_lp:
            return lp > cur_lp
        if len(path) != len(cur_path):
            return len(path) < len(cur_path)
        return peer_ip < cur_peer

    def _decide_and_install(self, net: "Network") -> None:
        local = {ip.network for ip in self.router.all_ips()}
        self.router.withdraw_routes("ebgp")
        self.router.withdraw_routes("ibgp")
        for prefix, (path, nh, _lp, peer_ip) in self.best_paths().items():
            if prefix in local or prefix in self.networks:
                continue
            peer = self.peers[peer_ip]
            source = "ibgp" if peer.remote_asn == self.asn else "ebgp"
            self.router.install_route(
                Route(
                    prefix=prefix,
                    next_hop=nh,
                    iface_name=None,
                    source=source,
                    metric=len(path),
                )
            )

    # ----- advertisement ----------------------------------------------------------------------
    def _advertise_all(self, net: "Network") -> None:
        for peer in self.peers.values():
            if peer.state == "established":
                self._advertise(net, peer)

    def _advertise(self, net: "Network", peer: _Peer) -> None:
        route = self.router.egress_for(peer.ip)
        my_nh = route[0].ip.ip if route and route[0].ip else None
        if my_nh is None:
            return
        is_ibgp_peer = peer.remote_asn == self.asn
        out: dict[str, tuple[tuple[int, ...], str, int]] = {}

        # Locally-originated networks.
        for prefix in self.networks:
            path = () if is_ibgp_peer else (self.asn,)
            out[str(prefix)] = (path, str(my_nh), 100)

        # Best learned routes (respecting iBGP split-horizon).
        for prefix, (path, _nh, lp, learned_from) in self.best_paths().items():
            src_peer = self.peers[learned_from]
            learned_ibgp = src_peer.remote_asn == self.asn
            if learned_ibgp and is_ibgp_peer:
                continue  # iBGP -> iBGP is not re-advertised
            if learned_from == peer.ip:
                continue  # don't echo a peer's routes back to it
            new_path = path if is_ibgp_peer else (self.asn, *path)
            out[str(prefix)] = (new_path, str(my_nh), lp if is_ibgp_peer else 100)

        self._send(net, peer, BgpUpdate(routes=out))

    # ----- introspection -------------------------------------------------------------------------
    def summary_rows(self) -> list[dict]:
        return [
            {
                "neighbor": str(p.ip),
                "remote_as": p.remote_asn,
                "state": p.state,
                "prefixes_received": len(p.rib_in),
            }
            for p in self.peers.values()
        ]
