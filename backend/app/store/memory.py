"""In-memory repository (v0.1 default).

A process-local store so the backend is **runnable and importable without a live
PostgreSQL** — matching the secureops/storagehub "imports OK" smoke-test style.
The async PostgreSQL repository (``infra/db/schema.sql``) is the production
target; both implement the same :class:`Repository` surface so the API layer is
storage-agnostic. Swap via ``app.store.get_repo``.

Thread-safety: guarded by a single ``asyncio.Lock`` — adequate for the single
-worker dev server. Production uses Postgres row-level guarantees instead.
"""
from __future__ import annotations

import asyncio
import re
from collections import defaultdict

from app.models import (
    ConfigArtifact,
    Link,
    Node,
    Project,
    Scenario,
    Topology,
)
from app.utils.ids import new_id


class NotFound(KeyError):
    """Raised when a resource id does not resolve. Mapped to HTTP 404."""


_TRAILING_DIGITS = re.compile(r"^(.*?)(\d+)$")


def _unique_node_name(proposed: str, taken: set[str]) -> str:
    """Return ``proposed`` if free, else the next non-colliding name for its base.

    The base is ``proposed`` with any trailing digits stripped (so ``EdgeRouter1``
    -> base ``EdgeRouter``). We then pick ``base`` + one above the highest existing
    suffix for that base, scanning *all* current names rather than trusting a
    counter — this keeps auto-generated defaults unique even when several clients
    create nodes concurrently or the client suggests a stale number.

    Manually chosen names are unaffected: this only rewrites a name that already
    collides with an existing node in the same project.
    """
    if proposed not in taken:
        return proposed
    m = _TRAILING_DIGITS.match(proposed)
    base = m.group(1) if m else proposed
    suffix_re = re.compile(rf"^{re.escape(base)}(\d+)$")
    highest = 0
    for name in taken:
        sm = suffix_re.match(name)
        if sm:
            highest = max(highest, int(sm.group(1)))
    n = highest + 1
    candidate = f"{base}{n}"
    while candidate in taken:
        n += 1
        candidate = f"{base}{n}"
    return candidate


class MemoryRepository:
    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._projects: dict[str, Project] = {}
        self._nodes: dict[str, Node] = {}
        self._links: dict[str, Link] = {}
        self._scenarios: dict[str, Scenario] = {}
        self._configs: dict[str, ConfigArtifact] = {}
        self._configs_by_node: dict[str, list[str]] = defaultdict(list)

    # --- projects -----------------------------------------------------------
    async def list_projects(self) -> list[Project]:
        return list(self._projects.values())

    async def get_project(self, pid: str) -> Project:
        try:
            return self._projects[pid]
        except KeyError as exc:
            raise NotFound(pid) from exc

    async def create_project(self, name: str, description: str = "") -> Project:
        async with self._lock:
            proj = Project(id=new_id(), name=name, description=description)
            self._projects[proj.id] = proj
            return proj

    async def topology(self, pid: str) -> Topology:
        proj = await self.get_project(pid)
        nodes = [n for n in self._nodes.values() if n.project_id == pid]
        links = [l for l in self._links.values() if l.project_id == pid]
        return Topology(project=proj, nodes=nodes, links=links)

    # --- nodes --------------------------------------------------------------
    async def get_node(self, nid: str) -> Node:
        try:
            return self._nodes[nid]
        except KeyError as exc:
            raise NotFound(nid) from exc

    async def add_node(self, node: Node) -> Node:
        async with self._lock:
            # Enforce unique node names within a project. The store is the
            # authority so uniqueness holds even with multiple clients; the
            # final (possibly rewritten) name is returned to the caller.
            taken = {
                n.name for n in self._nodes.values() if n.project_id == node.project_id
            }
            unique = _unique_node_name(node.name, taken)
            if unique != node.name:
                node = node.model_copy(update={"name": unique})
            self._nodes[node.id] = node
            return node

    # Node fields whose value may legitimately be None (i.e. "clear this field"),
    # as opposed to fields where None simply means "not provided in this PATCH".
    _NULLABLE_NODE_FIELDS: frozenset[str] = frozenset(
        {"lat", "lon", "radio", "intent", "config_ref"}
    )

    async def update_node(self, nid: str, patch: dict) -> Node:
        async with self._lock:
            node = await self.get_node(nid)
            # Allow None only for genuinely nullable fields (clearing a geo position,
            # removing a radio, etc.).  For non-nullable fields (name, nos, mode, …)
            # a None value from a partial PATCH body means "not provided", so skip it.
            filtered = {
                k: v
                for k, v in patch.items()
                if v is not None or k in self._NULLABLE_NODE_FIELDS
            }
            updated = node.model_copy(update=filtered)
            self._nodes[nid] = updated
            return updated

    async def delete_node(self, nid: str) -> None:
        async with self._lock:
            node = await self.get_node(nid)
            iface_ids = {i.id for i in node.interfaces}
            # cascade: drop links touching this node's interfaces
            dead = [lid for lid, l in self._links.items()
                    if l.a_iface in iface_ids or l.b_iface in iface_ids]
            for lid in dead:
                del self._links[lid]
            del self._nodes[nid]

    # --- links --------------------------------------------------------------
    async def add_link(self, link: Link) -> Link:
        async with self._lock:
            self._links[link.id] = link
            return link

    async def get_link(self, lid: str) -> Link:
        try:
            return self._links[lid]
        except KeyError as exc:
            raise NotFound(lid) from exc

    async def update_link(self, lid: str, patch: dict) -> Link:
        async with self._lock:
            link = await self.get_link(lid)
            updated = link.model_copy(update={k: v for k, v in patch.items() if v is not None})
            self._links[lid] = updated
            return updated

    async def delete_link(self, lid: str) -> None:
        async with self._lock:
            await self.get_link(lid)
            del self._links[lid]

    # --- scenarios ----------------------------------------------------------
    async def list_scenarios(self, pid: str) -> list[Scenario]:
        return [s for s in self._scenarios.values() if s.project_id == pid]

    async def add_scenario(self, scenario: Scenario) -> Scenario:
        async with self._lock:
            self._scenarios[scenario.id] = scenario
            return scenario

    # --- config artifacts (append-only history) -----------------------------
    async def add_config(self, artifact: ConfigArtifact) -> ConfigArtifact:
        async with self._lock:
            self._configs[artifact.id] = artifact
            self._configs_by_node[artifact.node_id].append(artifact.id)
            return artifact

    async def configs_for_node(self, nid: str) -> list[ConfigArtifact]:
        return [self._configs[i] for i in self._configs_by_node.get(nid, [])]
