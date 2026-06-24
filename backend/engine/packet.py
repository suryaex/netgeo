"""Packet primitive for the data-plane model.

NetForge's DES kernel works at a configurable granularity. By default it does
*flow-aware packet-level* modelling: real ``Packet`` objects traverse links so
latency/loss/MTU behave realistically, but the engine is free to coarsen to
flow-level accounting for very large topologies (see engine/README.md →
"Scalability"). Either way this small immutable-ish record is the unit that
moves through the queue.
"""
from __future__ import annotations

import itertools
from dataclasses import dataclass, field
from typing import Any

_packet_ids = itertools.count(1)


@dataclass(slots=True)
class Packet:
    """A unit of traffic moving through the simulated network.

    Attributes:
        src:        source node id.
        dst:        destination node id (final), for routing decisions.
        size_bytes: L2 frame size; drives serialization delay and MTU checks.
        proto:      transport hint ("icmp", "tcp", "udp", "bgp", ...).
        ttl:        hop budget; decremented per node, dropped at 0.
        created_at: simulation time the packet was born (for latency stats).
        payload:    opaque protocol data (e.g. routing update contents).
        path:       node ids visited so far, appended as it is forwarded.
    """

    src: str
    dst: str
    size_bytes: int = 64
    proto: str = "icmp"
    ttl: int = 64
    created_at: float = 0.0
    payload: Any = None
    id: int = field(default_factory=lambda: next(_packet_ids))
    path: list[str] = field(default_factory=list)

    def hop(self, node_id: str) -> bool:
        """Record a hop and decrement TTL. Returns False if the packet must drop."""
        self.path.append(node_id)
        self.ttl -= 1
        return self.ttl > 0
