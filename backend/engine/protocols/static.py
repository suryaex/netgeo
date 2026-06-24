"""Static routing runtime — a worked example of a protocol behaviour.

Demonstrates the extension pattern: subclass :class:`NodeRuntime`, populate the
RIB up front (here from operator-supplied static routes), and let the base
forwarding logic do the rest. Dynamic protocols instead populate the RIB in
response to ``TIMER`` / ``PACKET_RX`` events carrying routing updates.
"""
from __future__ import annotations

from engine.model import NetworkModel, NodeModel
from engine.runtime import NodeRuntime


class StaticRoutingRuntime(NodeRuntime):
    """A node whose RIB is fixed at construction time."""

    def __init__(
        self,
        node: NodeModel,
        model: NetworkModel,
        routes: dict[str, str] | None = None,
    ) -> None:
        super().__init__(node, model)
        # dst node id -> next-hop node id
        if routes:
            self.rib.update(routes)
