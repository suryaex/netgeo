"""Protocol behaviours for sim-mode nodes.

Each protocol (OSPF, BGP, IS-IS, ...) is implemented as a :class:`NodeRuntime`
subclass that installs routes into the node RIB and reacts to timer/packet
events. This package starts with a static-routing baseline; richer protocols
are layered in without touching the DES kernel — they only subscribe to events
and mutate the RIB.

Cross-area dependency: the *spec* for which protocols to support and example
scenarios is owned by the ``network-engineer`` agent under
``network/protocols/`` (see backend/NEEDS.md).
"""
from __future__ import annotations

from engine.protocols.static import StaticRoutingRuntime

__all__ = ["StaticRoutingRuntime"]
