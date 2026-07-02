"""L3 routing: the Router (and Firewall) device.

Implements the real forwarding pipeline:

    ingress ACL -> local-delivery check -> TTL decrement (ICMP time-exceeded)
    -> NAT (in->out source translation / out->in destination restore)
    -> longest-prefix-match route lookup (ICMP unreachable when none)
    -> egress ACL -> ARP resolution -> transmit

plus the service plane: DHCP server pools, an authoritative DNS zone, and
attachment points for dynamic routing processes (OSPF/BGP) which install
routes with their administrative distance.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from ipaddress import IPv4Address, IPv4Interface, IPv4Network
from typing import TYPE_CHECKING, Optional

from engine.netstack.addr import BROADCAST_MAC, MacAddr
from engine.netstack.device import L3Device
from engine.netstack.frames import (
    ETH_IPV4,
    PROTO_ICMP,
    PROTO_OSPF,
    PROTO_TCP,
    PROTO_UDP,
    ArpPacket,
    DhcpMessage,
    DnsMessage,
    EthernetFrame,
    IcmpMessage,
    Ipv4Packet,
    TcpSegment,
    UdpSegment,
)
from engine.netstack.iface import Interface

if TYPE_CHECKING:  # pragma: no cover
    from engine.netstack.network import Network

# Administrative distances (Cisco-style).
AD = {"connected": 0, "static": 1, "ebgp": 20, "ospf": 110, "rip": 120, "ibgp": 200}


@dataclass(slots=True)
class Route:
    prefix: IPv4Network
    next_hop: IPv4Address | None      # None = directly connected
    iface_name: str | None            # egress interface (resolved if None)
    source: str = "static"            # connected|static|ospf|ebgp|ibgp|rip
    metric: int = 0

    @property
    def ad(self) -> int:
        return AD.get(self.source, 255)

    def as_dict(self) -> dict:
        return {
            "prefix": str(self.prefix),
            "next_hop": str(self.next_hop) if self.next_hop else None,
            "iface": self.iface_name,
            "source": self.source,
            "metric": self.metric,
            "ad": self.ad,
        }


@dataclass(slots=True)
class AclRule:
    """A stateless access-list entry. ``None`` fields match anything."""

    action: str = "permit"                     # permit | deny
    proto: str | None = None                   # icmp|tcp|udp|ospf
    src: IPv4Network | None = None
    dst: IPv4Network | None = None
    dst_port: int | None = None

    def matches(self, pkt: Ipv4Packet) -> bool:
        if self.proto is not None and pkt.proto_name != self.proto:
            return False
        if self.src is not None and pkt.src not in self.src:
            return False
        if self.dst is not None and pkt.dst not in self.dst:
            return False
        if self.dst_port is not None:
            l4 = pkt.payload
            port = getattr(l4, "dst_port", None)
            if port != self.dst_port:
                return False
        return True

    def as_dict(self) -> dict:
        return {
            "action": self.action,
            "proto": self.proto,
            "src": str(self.src) if self.src else "any",
            "dst": str(self.dst) if self.dst else "any",
            "dst_port": self.dst_port,
        }


@dataclass(slots=True)
class NatBinding:
    inside_ip: IPv4Address
    inside_key: int              # src port (tcp/udp) or icmp ident
    outside_ip: IPv4Address
    outside_key: int
    proto: str


@dataclass(slots=True)
class DhcpPool:
    network: IPv4Network
    gateway: IPv4Address
    dns: IPv4Address | None = None
    range_start: int = 10        # host number of the first lease
    range_end: int = 250
    lease_s: int = 86400
    leases: dict[str, IPv4Address] = field(default_factory=dict)  # mac -> ip

    def allocate(self, mac: str) -> IPv4Address | None:
        if mac in self.leases:
            return self.leases[mac]
        taken = set(self.leases.values())
        base = int(self.network.network_address)
        for host_no in range(self.range_start, self.range_end + 1):
            candidate = IPv4Address(base + host_no)
            if candidate not in taken and candidate != self.gateway:
                self.leases[mac] = candidate
                return candidate
        return None


class Router(L3Device):
    """A router: LPM forwarding, ICMP errors, NAT44, ACLs, DHCP/DNS server."""

    kind = "router"

    def __init__(self, name: str, node_id: str | None = None, nos: str = "forgeos") -> None:
        super().__init__(name, node_id, nos)
        self.routes: list[Route] = []
        self.acl_in: dict[str, list[AclRule]] = {}    # iface name -> rules
        self.acl_out: dict[str, list[AclRule]] = {}
        # NAT
        self.nat_inside: set[str] = set()             # iface names
        self.nat_outside: str | None = None
        self._nat_bindings: list[NatBinding] = []
        self._nat_next_key = 20000
        # Services
        self.dhcp_pools: list[DhcpPool] = []
        self.dns_zone: dict[str, IPv4Address] = {}
        # Dynamic routing processes (duck-typed: .on_packet(net, iface, pkt),
        # .start(net), .on_iface_change(net))
        self.processes: list = []
        self.forwarded = 0

    # ----- route table management -------------------------------------------------
    def sync_connected_routes(self) -> None:
        """(Re)derive connected routes from interface addressing."""
        self.routes = [r for r in self.routes if r.source != "connected"]
        for iface in self.interfaces.values():
            for ip in iface.ips:
                self.routes.append(
                    Route(
                        prefix=ip.network,
                        next_hop=None,
                        iface_name=iface.name,
                        source="connected",
                    )
                )

    def add_static_route(
        self, prefix: str | IPv4Network, next_hop: str | IPv4Address
    ) -> Route:
        route = Route(
            prefix=IPv4Network(prefix),
            next_hop=IPv4Address(next_hop),
            iface_name=None,
            source="static",
            metric=0,
        )
        self.routes.append(route)
        return route

    def install_route(self, route: Route) -> None:
        """Install/replace a dynamic route (same prefix + source)."""
        self.routes = [
            r
            for r in self.routes
            if not (r.prefix == route.prefix and r.source == route.source)
        ]
        self.routes.append(route)

    def withdraw_routes(self, source: str, prefixes: set[IPv4Network] | None = None) -> None:
        self.routes = [
            r
            for r in self.routes
            if not (r.source == source and (prefixes is None or r.prefix in prefixes))
        ]

    def lookup(self, dst: IPv4Address) -> Route | None:
        """Longest-prefix match; ties broken by admin distance then metric."""
        best: Route | None = None
        for r in self.routes:
            if dst not in r.prefix:
                continue
            if (
                best is None
                or r.prefix.prefixlen > best.prefix.prefixlen
                or (
                    r.prefix.prefixlen == best.prefix.prefixlen
                    and (r.ad, r.metric) < (best.ad, best.metric)
                )
            ):
                best = r
        return best

    def egress_for(self, dst: IPv4Address) -> tuple[Interface, IPv4Address] | None:
        route = self.lookup(dst)
        if route is None:
            return None
        next_hop = route.next_hop if route.next_hop is not None else dst
        iface = self.interfaces.get(route.iface_name) if route.iface_name else None
        if iface is None:
            # Recursive resolution: find the connected iface for the next hop.
            for cand in self.interfaces.values():
                for ip in cand.ips:
                    if next_hop in ip.network:
                        return cand, next_hop
            return None
        return iface, next_hop

    # ----- ingress -----------------------------------------------------------------
    def on_frame(self, net: "Network", iface: Interface, frame: EthernetFrame) -> None:
        if not self.powered_on:
            return
        if frame.dst_mac not in (iface.mac, BROADCAST_MAC) and not MacAddr(
            frame.dst_mac
        ).is_multicast:
            return

        payload = frame.payload
        if isinstance(payload, ArpPacket):
            self._handle_arp(net, iface, payload)
            return
        if not isinstance(payload, Ipv4Packet):
            return
        pkt = payload

        # Ingress ACL.
        if not self._acl_permits(self.acl_in.get(iface.name), pkt):
            net.record_drop("acl_deny_in")
            self._send_icmp_error(net, pkt, icmp_type=3, code=13)  # admin prohibited
            return

        # NAT precedes local delivery: traffic arriving on the outside iface
        # addressed to the NAT address may belong to an inside binding.
        if (
            self.nat_outside
            and iface.name == self.nat_outside
            and iface.has_ip(pkt.dst)
            and self._nat_inbound(net, pkt)
        ):
            self._forward(net, iface, pkt)
            return

        broadcastish = str(pkt.dst) == "255.255.255.255" or (
            iface.ip and pkt.dst == iface.ip.network.broadcast_address
        )
        if self.owns_ip(pkt.dst) or broadcastish or pkt.dst.is_multicast:
            self._local_deliver(net, iface, pkt)
            return

        self._forward(net, iface, pkt)

    # ----- forwarding pipeline --------------------------------------------------------
    def _forward(self, net: "Network", in_iface: Interface, pkt: Ipv4Packet) -> None:
        if pkt.ttl <= 1:
            net.record_drop("ttl_expired")
            self._send_icmp_error(net, pkt, icmp_type=11, code=0)
            return
        pkt.ttl -= 1

        route = self.lookup(pkt.dst)
        if route is None:
            net.record_drop("no_route")
            self._send_icmp_error(net, pkt, icmp_type=3, code=0)
            return
        next_hop = route.next_hop if route.next_hop is not None else pkt.dst
        out = self.interfaces.get(route.iface_name) if route.iface_name else None
        if out is None:
            resolved = self.egress_for(pkt.dst)
            if resolved is None:
                net.record_drop("no_route")
                self._send_icmp_error(net, pkt, icmp_type=3, code=0)
                return
            out, next_hop = resolved

        # NAT: source-translate inside -> outside, restore outside -> inside.
        if self.nat_outside:
            if in_iface.name in self.nat_inside and out.name == self.nat_outside:
                if not self._nat_outbound(net, out, pkt):
                    return
            elif in_iface.name == self.nat_outside:
                self._nat_inbound(net, pkt)
                # Destination may have changed; re-route.
                resolved = self.egress_for(pkt.dst)
                if resolved is None:
                    net.record_drop("no_route")
                    return
                out, next_hop = resolved

        if not self._acl_permits(self.acl_out.get(out.name), pkt):
            net.record_drop("acl_deny_out")
            self._send_icmp_error(net, pkt, icmp_type=3, code=13)
            return

        self.forwarded += 1
        self._resolve_and_send(net, out, next_hop, pkt)

    def _acl_permits(self, rules: list[AclRule] | None, pkt: Ipv4Packet) -> bool:
        if not rules:
            return True
        for rule in rules:
            if rule.matches(pkt):
                return rule.action == "permit"
        return False  # implicit deny at the end of a configured ACL

    # ----- local delivery ------------------------------------------------------------
    def _local_deliver(self, net: "Network", iface: Interface, pkt: Ipv4Packet) -> None:
        if pkt.proto == PROTO_ICMP:
            icmp = pkt.payload
            if isinstance(icmp, IcmpMessage) and icmp.type == 0:
                net.ping_reply_received(self, pkt, icmp)
                return
            if isinstance(icmp, IcmpMessage) and icmp.type in (3, 11):
                net.on_icmp(self, pkt, icmp)
                return
            self._handle_icmp_to_self(net, pkt)
            return
        if pkt.proto == PROTO_OSPF:
            for proc in self.processes:
                if getattr(proc, "proto", "") == "ospf":
                    proc.on_packet(net, iface, pkt)
            return
        if pkt.proto == PROTO_TCP and isinstance(pkt.payload, TcpSegment):
            seg = pkt.payload
            if seg.dst_port == 179 or seg.src_port == 179:
                for proc in self.processes:
                    if getattr(proc, "proto", "") == "bgp":
                        proc.on_packet(net, iface, pkt)
                return
        if pkt.proto == PROTO_UDP and isinstance(pkt.payload, UdpSegment):
            udp = pkt.payload
            app = udp.payload
            if isinstance(app, DhcpMessage) and udp.dst_port == 67:
                self._dhcp_serve(net, iface, app)
                return
            if isinstance(app, DnsMessage) and udp.dst_port == 53 and app.op == "query":
                self._dns_serve(net, iface, pkt, udp, app)
                return

    # ----- ICMP error generation ----------------------------------------------------
    def _send_icmp_error(
        self, net: "Network", offending: Ipv4Packet, icmp_type: int, code: int
    ) -> None:
        # Never generate errors about errors (RFC 1122).
        inner = offending.payload
        if isinstance(inner, IcmpMessage) and inner.type in (3, 11):
            return
        route = self.egress_for(offending.src)
        if route is None:
            return
        src_ip = route[0].ip.ip if route[0].ip else None
        if src_ip is None:
            return
        orig_ident = getattr(inner, "ident", 0) if isinstance(inner, IcmpMessage) else 0
        orig_seq = getattr(inner, "seq", 0) if isinstance(inner, IcmpMessage) else 0
        self.send_ip(
            net,
            Ipv4Packet(
                src=src_ip,
                dst=offending.src,
                proto=PROTO_ICMP,
                ttl=64,
                payload=IcmpMessage(
                    type=icmp_type,
                    code=code,
                    data_len=28,
                    original=(str(offending.src), str(offending.dst)),
                    orig_ident=orig_ident,
                    orig_seq=orig_seq,
                ),
            ),
        )

    def on_mtu_drop(self, net: "Network", iface: Interface, frame: EthernetFrame) -> None:
        pkt = frame.payload
        if isinstance(pkt, Ipv4Packet):
            self._send_icmp_error(net, pkt, icmp_type=3, code=4)  # frag needed

    # ----- NAT44 (PAT) ------------------------------------------------------------------
    def enable_nat(self, inside: list[str], outside: str) -> None:
        self.nat_inside = set(inside)
        self.nat_outside = outside

    def _nat_key(self, pkt: Ipv4Packet) -> int | None:
        l4 = pkt.payload
        if isinstance(l4, IcmpMessage):
            return l4.ident
        if isinstance(l4, (UdpSegment, TcpSegment)):
            return l4.src_port
        return None

    def _nat_outbound(self, net: "Network", out: Interface, pkt: Ipv4Packet) -> bool:
        outside_ip = out.ip.ip if out.ip else None
        if outside_ip is None:
            net.record_drop("nat_no_outside_ip")
            return False
        key = self._nat_key(pkt)
        if key is None:
            net.record_drop("nat_unsupported_proto")
            return False
        binding = next(
            (
                b
                for b in self._nat_bindings
                if b.inside_ip == pkt.src and b.inside_key == key and b.proto == pkt.proto_name
            ),
            None,
        )
        if binding is None:
            self._nat_next_key += 1
            binding = NatBinding(
                inside_ip=pkt.src,
                inside_key=key,
                outside_ip=outside_ip,
                outside_key=self._nat_next_key,
                proto=pkt.proto_name,
            )
            self._nat_bindings.append(binding)
        pkt.src = binding.outside_ip
        l4 = pkt.payload
        if isinstance(l4, IcmpMessage):
            l4.ident = binding.outside_key
        elif isinstance(l4, (UdpSegment, TcpSegment)):
            l4.src_port = binding.outside_key
        return True

    def _nat_inbound(self, net: "Network", pkt: Ipv4Packet) -> bool:
        """Restore the inside destination for a reply. True if translated."""
        l4 = pkt.payload
        key: int | None = None
        if isinstance(l4, IcmpMessage):
            key = l4.ident
        elif isinstance(l4, (UdpSegment, TcpSegment)):
            key = l4.dst_port
        if key is None:
            return False
        binding = next(
            (
                b
                for b in self._nat_bindings
                if b.outside_key == key and b.proto == pkt.proto_name
            ),
            None,
        )
        if binding is None:
            return False
        pkt.dst = binding.inside_ip
        if isinstance(l4, IcmpMessage):
            l4.ident = binding.inside_key
        elif isinstance(l4, (UdpSegment, TcpSegment)):
            l4.dst_port = binding.inside_key
        return True

    # ----- DHCP server --------------------------------------------------------------------
    def add_dhcp_pool(self, pool: DhcpPool) -> None:
        self.dhcp_pools.append(pool)

    def _pool_for_iface(self, iface: Interface) -> DhcpPool | None:
        for ip in iface.ips:
            for pool in self.dhcp_pools:
                if pool.network == ip.network:
                    return pool
        return None

    def _dhcp_serve(self, net: "Network", iface: Interface, msg: DhcpMessage) -> None:
        pool = self._pool_for_iface(iface)
        if pool is None:
            return
        if msg.op == "discover":
            offer_ip = pool.allocate(msg.client_mac)
            if offer_ip is None:
                return
            self._dhcp_send(net, iface, msg.client_mac, DhcpMessage(
                op="offer",
                client_mac=msg.client_mac,
                your_ip=str(offer_ip),
                server_ip=str(iface.ip.ip) if iface.ip else None,
                subnet_mask=str(pool.network.prefixlen),
                gateway=str(pool.gateway),
                dns=str(pool.dns) if pool.dns else None,
                lease_s=pool.lease_s,
                xid=msg.xid,
            ))
        elif msg.op == "request" and msg.your_ip:
            leased = pool.leases.get(msg.client_mac)
            if leased is None or str(leased) != msg.your_ip:
                return
            self._dhcp_send(net, iface, msg.client_mac, DhcpMessage(
                op="ack",
                client_mac=msg.client_mac,
                your_ip=msg.your_ip,
                server_ip=str(iface.ip.ip) if iface.ip else None,
                subnet_mask=str(pool.network.prefixlen),
                gateway=str(pool.gateway),
                dns=str(pool.dns) if pool.dns else None,
                lease_s=pool.lease_s,
                xid=msg.xid,
            ))

    def _dhcp_send(
        self, net: "Network", iface: Interface, client_mac: str, msg: DhcpMessage
    ) -> None:
        iface.transmit(
            net,
            EthernetFrame(
                src_mac=iface.mac,
                dst_mac=client_mac,   # unicast L2 to the requesting NIC
                ethertype=ETH_IPV4,
                payload=Ipv4Packet(
                    src=iface.ip.ip if iface.ip else IPv4Address("0.0.0.0"),
                    dst=IPv4Address("255.255.255.255"),
                    proto=PROTO_UDP,
                    ttl=64,
                    payload=UdpSegment(src_port=67, dst_port=68, payload=msg),
                ),
            ),
        )

    # ----- DNS server -----------------------------------------------------------------------
    def _dns_serve(
        self,
        net: "Network",
        iface: Interface,
        pkt: Ipv4Packet,
        udp: UdpSegment,
        query: DnsMessage,
    ) -> None:
        answer = self.dns_zone.get(query.qname.lower())
        self.send_ip(
            net,
            Ipv4Packet(
                src=pkt.dst,
                dst=pkt.src,
                proto=PROTO_UDP,
                ttl=64,
                payload=UdpSegment(
                    src_port=53,
                    dst_port=udp.src_port,
                    payload=DnsMessage(
                        op="response",
                        qname=query.qname,
                        answer=str(answer) if answer else None,
                        xid=query.xid,
                    ),
                ),
            ),
        )

    # ----- introspection ---------------------------------------------------------------------
    def route_table_rows(self) -> list[dict]:
        return [r.as_dict() for r in sorted(
            self.routes, key=lambda r: (r.prefix.network_address, r.prefix.prefixlen, r.ad)
        )]

    def nat_rows(self) -> list[dict]:
        return [
            {
                "proto": b.proto,
                "inside": f"{b.inside_ip}:{b.inside_key}",
                "outside": f"{b.outside_ip}:{b.outside_key}",
            }
            for b in self._nat_bindings
        ]


class Firewall(Router):
    """A router whose forwarding defaults to deny unless ACLs permit.

    Same pipeline as :class:`Router`; the distinction is the default posture:
    interfaces without an explicit ingress ACL use ``default_policy``.
    """

    kind = "firewall"

    def __init__(self, name: str, node_id: str | None = None, nos: str = "forgeos") -> None:
        super().__init__(name, node_id, nos)
        self.default_policy = "permit"   # operators flip to "deny" for strictness

    def _acl_permits(self, rules: list[AclRule] | None, pkt: Ipv4Packet) -> bool:
        if not rules:
            return self.default_policy == "permit"
        return super()._acl_permits(rules, pkt)
