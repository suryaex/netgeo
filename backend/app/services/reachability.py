"""Reachability question engine (NG-TW-02).

Answers "can A reach B?" over the imported/twin model *with evidence*. Builds an
isolated lab (same pattern as :mod:`app.services.grading` — never perturbs the
live :class:`LabManager` cache), settles it so routing converges, then pings and
traceroutes A→B and reads A's RIB decision for the destination. The verdict is
the ping result; the path + the matched route are the "why".
"""
from __future__ import annotations

from ipaddress import ip_address

from app.models import Topology
from app.services import netlab
from engine.netstack.routing import Router


def _resolve_dst(net, ref: str) -> str:
    """A destination may be a literal IP or a node ref (first address wins)."""
    try:
        ip_address(ref)
        return ref
    except ValueError:
        pass
    dev = net.find_device(ref)
    if dev is not None:
        ips = dev.all_ips() or dev.all_ips6()
        if ips:
            return str(ips[0].ip)
    raise ValueError(f"cannot resolve destination '{ref}' to an IP address")


def answer(topo: Topology, src: str, dst: str, count: int = 3) -> dict:
    """Return ``{reachable, path, route, ...}`` for the question A→B."""
    net = netlab.build_network(topo, seed=0)
    net.start()
    net.run(until=net.now + netlab._settle_time(net))

    src_dev = net.find_device(src)
    if src_dev is None:
        raise ValueError(f"unknown source device '{src}'")
    dst_ip = _resolve_dst(net, dst)

    ping = net.ping(src, dst_ip, count=count)
    tr = net.traceroute(src, dst_ip)

    route = None
    if isinstance(src_dev, Router) and ip_address(dst_ip).version == 4:
        match = src_dev.lookup(ip_address(dst_ip))
        route = match.as_dict() if match else None

    rtts = ping.rtts_ms
    return {
        "src": src,
        "dst": dst,
        "dst_ip": dst_ip,
        "reachable": ping.received > 0,
        "loss_pct": ping.loss_pct,
        "rtt_avg_ms": round(sum(rtts) / len(rtts), 3) if rtts else None,
        "path": [h["address"] for h in tr.as_dict()["hops"] if h["address"]],
        "route": route,
    }
