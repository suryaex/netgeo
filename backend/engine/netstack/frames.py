"""Layered protocol data units (PDUs).

Every frame that moves through the netstack is an :class:`EthernetFrame`
carrying one of the L3+ payloads defined here. Sizes are modelled on real
wire formats so serialization delay, MTU checks and queueing behave like the
real thing. Frames are plain dataclasses — cheap to construct, easy to
inspect, and each knows how to summarise itself for packet capture.
"""
from __future__ import annotations

import itertools
from dataclasses import dataclass, field, replace
from ipaddress import IPv4Address
from typing import Any, Union

from engine.netstack.addr import BROADCAST_MAC, MacAddr

_frame_ids = itertools.count(1)

# EtherTypes
ETH_IPV4 = 0x0800
ETH_ARP = 0x0806
ETH_VLAN = 0x8100

# IP protocol numbers
PROTO_ICMP = 1
PROTO_TCP = 6
PROTO_UDP = 17
PROTO_OSPF = 89

_PROTO_NAMES = {PROTO_ICMP: "icmp", PROTO_TCP: "tcp", PROTO_UDP: "udp", PROTO_OSPF: "ospf"}


# ---------------------------------------------------------------------------
# L4 / application payloads
# ---------------------------------------------------------------------------

@dataclass(slots=True)
class IcmpMessage:
    """ICMP. type 8/0 = echo request/reply, 11 = time exceeded,
    3 = destination unreachable (code 0 net, 1 host, 3 port, 4 frag needed)."""

    type: int = 8
    code: int = 0
    ident: int = 0
    seq: int = 0
    data_len: int = 56
    # For error messages (type 3/11): identifying bits of the offending packet,
    # so traceroute/ping sessions can correlate errors to their probes.
    original: tuple[str, str] | None = None   # (src_ip, dst_ip)
    orig_ident: int = 0
    orig_seq: int = 0

    @property
    def wire_size(self) -> int:
        return 8 + self.data_len

    def summary(self) -> str:
        names = {8: "echo-request", 0: "echo-reply", 11: "time-exceeded", 3: "unreachable"}
        base = names.get(self.type, f"type{self.type}")
        if self.type in (8, 0):
            return f"ICMP {base} id={self.ident} seq={self.seq}"
        return f"ICMP {base} code={self.code}"


@dataclass(slots=True)
class UdpSegment:
    src_port: int = 0
    dst_port: int = 0
    payload: Any = None
    payload_len: int = 0

    @property
    def wire_size(self) -> int:
        inner = getattr(self.payload, "wire_size", None)
        return 8 + (inner if inner is not None else self.payload_len)

    def summary(self) -> str:
        inner = getattr(self.payload, "summary", None)
        tail = f" {inner()}" if callable(inner) else ""
        return f"UDP {self.src_port}->{self.dst_port}{tail}"


@dataclass(slots=True)
class TcpSegment:
    """Minimal TCP model: flags + ports, enough for session-style protocols
    (BGP) and stateful firewall rules. No sequence-number machinery — the DES
    delivers segments reliably in order; loss is modelled at the link layer."""

    src_port: int = 0
    dst_port: int = 0
    flags: str = "PSH"          # SYN | SYN-ACK | ACK | PSH | FIN | RST
    payload: Any = None
    payload_len: int = 0

    @property
    def wire_size(self) -> int:
        inner = getattr(self.payload, "wire_size", None)
        return 20 + (inner if inner is not None else self.payload_len)

    def summary(self) -> str:
        inner = getattr(self.payload, "summary", None)
        tail = f" {inner()}" if callable(inner) else ""
        return f"TCP {self.src_port}->{self.dst_port} [{self.flags}]{tail}"


@dataclass(slots=True)
class DhcpMessage:
    """DHCP over UDP 67/68. op: discover|offer|request|ack|nak."""

    op: str = "discover"
    client_mac: str = ""
    your_ip: str | None = None
    server_ip: str | None = None
    subnet_mask: str | None = None
    gateway: str | None = None
    dns: str | None = None
    lease_s: int = 86400
    xid: int = 0

    @property
    def wire_size(self) -> int:
        return 300  # typical DHCP message size

    def summary(self) -> str:
        return f"DHCP {self.op} {self.your_ip or ''}".strip()


@dataclass(slots=True)
class DnsMessage:
    """DNS over UDP 53."""

    op: str = "query"           # query | response
    qname: str = ""
    answer: str | None = None   # A record (IPv4 string) or None = NXDOMAIN
    xid: int = 0

    @property
    def wire_size(self) -> int:
        return 12 + len(self.qname) + (16 if self.answer else 0)

    def summary(self) -> str:
        if self.op == "query":
            return f"DNS query {self.qname}"
        return f"DNS response {self.qname} -> {self.answer or 'NXDOMAIN'}"


# ---------------------------------------------------------------------------
# L3
# ---------------------------------------------------------------------------

@dataclass(slots=True)
class Ipv4Packet:
    src: IPv4Address
    dst: IPv4Address
    proto: int = PROTO_ICMP
    ttl: int = 64
    dscp: int = 0               # QoS marking (0 = best effort, 46 = EF)
    dont_fragment: bool = True
    payload: Union[IcmpMessage, UdpSegment, TcpSegment, Any] = None
    payload_len: int = 0        # used when payload has no wire_size

    @property
    def wire_size(self) -> int:
        inner = getattr(self.payload, "wire_size", None)
        return 20 + (inner if inner is not None else self.payload_len)

    @property
    def proto_name(self) -> str:
        return _PROTO_NAMES.get(self.proto, str(self.proto))

    def summary(self) -> str:
        inner = getattr(self.payload, "summary", None)
        tail = f" {inner()}" if callable(inner) else f" proto={self.proto_name}"
        return f"IPv4 {self.src} -> {self.dst} ttl={self.ttl}{tail}"


# ---------------------------------------------------------------------------
# L2 control
# ---------------------------------------------------------------------------

@dataclass(slots=True)
class ArpPacket:
    op: str                      # "request" | "reply"
    sender_mac: str
    sender_ip: IPv4Address
    target_mac: str
    target_ip: IPv4Address

    @property
    def wire_size(self) -> int:
        return 28

    def summary(self) -> str:
        if self.op == "request":
            return f"ARP who-has {self.target_ip} tell {self.sender_ip}"
        return f"ARP {self.sender_ip} is-at {self.sender_mac}"


@dataclass(slots=True)
class BpduFrame:
    """802.1D configuration BPDU (simplified)."""

    root_id: str                 # bridge id of the claimed root ("prio.mac")
    root_cost: int
    bridge_id: str               # sender bridge id
    port_id: int

    @property
    def wire_size(self) -> int:
        return 35

    def summary(self) -> str:
        return f"STP BPDU root={self.root_id} cost={self.root_cost} from={self.bridge_id}"


# ---------------------------------------------------------------------------
# L2 frame
# ---------------------------------------------------------------------------

@dataclass(slots=True)
class EthernetFrame:
    """The unit that traverses links.

    ``vlan`` is the 802.1Q tag (None = untagged). ``size_bytes`` is derived
    from the payload plus L2 overhead unless explicitly overridden (traffic
    generators may want fixed-size frames).
    """

    src_mac: str
    dst_mac: str
    ethertype: int = ETH_IPV4
    vlan: int | None = None
    payload: Union[Ipv4Packet, ArpPacket, BpduFrame, Any] = None
    explicit_size: int | None = None
    id: int = field(default_factory=lambda: next(_frame_ids))

    L2_OVERHEAD = 18             # dst+src+type+FCS
    VLAN_OVERHEAD = 4

    @property
    def size_bytes(self) -> int:
        if self.explicit_size is not None:
            return self.explicit_size
        inner = getattr(self.payload, "wire_size", 46)
        overhead = self.L2_OVERHEAD + (self.VLAN_OVERHEAD if self.vlan is not None else 0)
        return max(64, inner + overhead)

    @property
    def is_broadcast(self) -> bool:
        return self.dst_mac == BROADCAST_MAC

    def clone(self) -> "EthernetFrame":
        """Copy for flooding — each egress port gets its own frame instance
        (fresh id) *and its own payload*, so two receivers can independently
        mutate TTL / NAT fields without corrupting each other."""
        import copy

        return replace(self, id=next(_frame_ids), payload=copy.deepcopy(self.payload))

    def summary(self) -> str:
        inner = getattr(self.payload, "summary", None)
        tail = inner() if callable(inner) else f"ethertype=0x{self.ethertype:04x}"
        tag = f" vlan={self.vlan}" if self.vlan is not None else ""
        return f"{self.src_mac} > {self.dst_mac}{tag} | {tail}"

    def layers(self) -> dict:
        """Structured dict for the capture inspector UI."""
        out: dict[str, Any] = {
            "eth": {
                "src": self.src_mac,
                "dst": self.dst_mac,
                "vlan": self.vlan,
                "size": self.size_bytes,
            }
        }
        p = self.payload
        if isinstance(p, ArpPacket):
            out["arp"] = {
                "op": p.op,
                "sender_ip": str(p.sender_ip),
                "target_ip": str(p.target_ip),
            }
        elif isinstance(p, BpduFrame):
            out["stp"] = {"root": p.root_id, "cost": p.root_cost, "bridge": p.bridge_id}
        elif isinstance(p, Ipv4Packet):
            out["ipv4"] = {
                "src": str(p.src),
                "dst": str(p.dst),
                "ttl": p.ttl,
                "proto": p.proto_name,
                "dscp": p.dscp,
            }
            l4 = p.payload
            if isinstance(l4, IcmpMessage):
                out["icmp"] = {"type": l4.type, "code": l4.code, "seq": l4.seq}
            elif isinstance(l4, (UdpSegment, TcpSegment)):
                key = "udp" if isinstance(l4, UdpSegment) else "tcp"
                out[key] = {"src_port": l4.src_port, "dst_port": l4.dst_port}
                app = l4.payload
                if isinstance(app, DhcpMessage):
                    out["dhcp"] = {"op": app.op, "your_ip": app.your_ip}
                elif isinstance(app, DnsMessage):
                    out["dns"] = {"op": app.op, "qname": app.qname, "answer": app.answer}
                elif app is not None and hasattr(app, "summary"):
                    out["app"] = {"info": app.summary()}
        return out
