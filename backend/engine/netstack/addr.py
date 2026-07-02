"""Address primitives — MAC and IPv4 helpers.

Pure stdlib (``ipaddress``): portable across OSes and CPU architectures.
IPv4 addresses are handled as :class:`ipaddress.IPv4Address` /
:class:`ipaddress.IPv4Interface` throughout the stack; this module adds the
small pieces the stdlib lacks (MAC addresses, deterministic MAC allocation).
"""
from __future__ import annotations

from ipaddress import IPv4Address, IPv4Interface, IPv4Network

BROADCAST_MAC = "ff:ff:ff:ff:ff:ff"
STP_MULTICAST_MAC = "01:80:c2:00:00:00"

# NetGeo's locally-administered OUI for auto-generated MACs.
_OUI = 0x02_50_47  # "P G" — locally administered bit set


class MacAddr(str):
    """A MAC address as a normalized lowercase ``aa:bb:cc:dd:ee:ff`` string.

    Subclassing ``str`` keeps it hashable, JSON-friendly and zero-cost on the
    hot path while giving a place for validation and formatting.
    """

    __slots__ = ()

    def __new__(cls, value: str) -> "MacAddr":
        v = value.strip().lower().replace("-", ":")
        parts = v.split(":")
        if len(parts) != 6 or not all(len(p) == 2 and _is_hex(p) for p in parts):
            raise ValueError(f"invalid MAC address: {value!r}")
        return super().__new__(cls, v)

    @property
    def is_broadcast(self) -> bool:
        return self == BROADCAST_MAC

    @property
    def is_multicast(self) -> bool:
        return bool(int(self[:2], 16) & 0x01)


def _is_hex(s: str) -> bool:
    try:
        int(s, 16)
        return True
    except ValueError:
        return False


def mac_from_int(n: int) -> MacAddr:
    """Deterministic MAC from a counter — same topology => same MACs.

    Uses NetGeo's locally-administered OUI so generated MACs can never clash
    with real hardware.
    """
    low = n & 0xFFFFFF
    raw = (_OUI << 24) | low
    return MacAddr(":".join(f"{(raw >> (8 * i)) & 0xFF:02x}" for i in range(5, -1, -1)))


def parse_ip_interface(value: str) -> IPv4Interface:
    """``"10.0.0.1/24"`` -> IPv4Interface. Bare addresses get /32."""
    if "/" not in value:
        value = f"{value}/32"
    return IPv4Interface(value)


def same_subnet(a: IPv4Interface, b: IPv4Address) -> bool:
    """Is ``b`` inside ``a``'s connected network?"""
    return b in a.network


__all__ = [
    "BROADCAST_MAC",
    "STP_MULTICAST_MAC",
    "IPv4Address",
    "IPv4Interface",
    "IPv4Network",
    "MacAddr",
    "mac_from_int",
    "parse_ip_interface",
    "same_subnet",
]
