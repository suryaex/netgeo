"""Config import → digital-twin base (NG-TW-01).

Baseline parser: turns an IOS-like device config into a node shape (hostname,
interfaces + IPs, static routes) the platform can instantiate and reason over.
Regex + stdlib only. RouterOS and richer stanzas (OSPF/BGP/ACL) are follow-ups —
this establishes the import seam and the round-trip with ``configgen``.
"""
from __future__ import annotations

import ipaddress
import re

_HOSTNAME = re.compile(r"^\s*hostname\s+(\S+)", re.M)
_INTERFACE = re.compile(r"^\s*interface\s+(\S+)", re.I)
_IP_ADDR = re.compile(r"^\s*ip\s+address\s+(\d+\.\d+\.\d+\.\d+)\s+(\d+\.\d+\.\d+\.\d+)", re.I)
_IP_ROUTE = re.compile(
    r"^\s*ip\s+route\s+(\d+\.\d+\.\d+\.\d+)\s+(\d+\.\d+\.\d+\.\d+)\s+(\S+)", re.I | re.M
)


def _mask_to_prefix(mask: str) -> int:
    return ipaddress.IPv4Network(f"0.0.0.0/{mask}").prefixlen


def parse_ios(text: str) -> dict:
    """Parse an IOS-like config into ``{hostname, interfaces, static_routes}``.

    Each interface is ``{name, ip: ["a.b.c.d/len", ...]}``; static routes are
    ``{prefix, next_hop}``. Unknown lines are ignored (honest partial parse).
    """
    hostname_m = _HOSTNAME.search(text)
    interfaces: list[dict] = []
    current: dict | None = None
    for line in text.splitlines():
        iface_m = _INTERFACE.match(line)
        if iface_m:
            current = {"name": iface_m.group(1), "ip": []}
            interfaces.append(current)
            continue
        if current is not None:
            ip_m = _IP_ADDR.match(line)
            if ip_m:
                current["ip"].append(f"{ip_m.group(1)}/{_mask_to_prefix(ip_m.group(2))}")
    static_routes = [
        {"prefix": f"{net}/{_mask_to_prefix(mask)}", "next_hop": nh}
        for net, mask, nh in _IP_ROUTE.findall(text)
    ]
    return {
        "hostname": hostname_m.group(1) if hostname_m else "imported",
        "interfaces": interfaces,
        "static_routes": static_routes,
    }


PARSERS = {"ios": parse_ios, "iosxr": parse_ios, "nxos": parse_ios}


def parse(vendor: str, text: str) -> dict:
    parser = PARSERS.get(vendor.lower())
    if parser is None:
        raise ValueError(f"no import parser for vendor '{vendor}'")
    return parser(text)
