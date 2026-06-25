"""Pydantic v2 schemas — the API contract.

These mirror MASTER_SPEC §4 exactly and are kept in lock-step with:
  * the engine model      (`engine/model.py`)
  * the frontend types     (`frontend/src/api/types.ts`)
  * the PostgreSQL schema  (`infra/db/schema.sql`)

Field names MUST match across all four. `extra="forbid"` is deliberate
(security hardening — see security/hardening-guide.md §4: reject unknown fields).
"""
from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum

from pydantic import BaseModel, ConfigDict, Field


def _now() -> datetime:
    return datetime.now(timezone.utc)


class _Base(BaseModel):
    model_config = ConfigDict(extra="forbid", use_enum_values=True)


# --- enumerations (identical to schema.sql ENUMs) ---------------------------
class NodeKind(str, Enum):
    router = "router"
    switch = "switch"
    host = "host"
    ap = "ap"
    olt = "olt"
    firewall = "firewall"
    server = "server"
    # Bridge to the real world — a GNS3-style "cloud" node bound to a host
    # ethernet adapter so the topology can reach the LAN / internet. The chosen
    # adapter + bridge mode live in ``Node.intent["uplink"]``
    # (see app/services/netbridge.py and app/api/system.py).
    cloud = "cloud"


class Nos(str, Enum):
    forgeos = "forgeos"
    ios = "ios"
    iosxr = "iosxr"
    nxos = "nxos"
    junos = "junos"
    eos = "eos"
    routeros = "routeros"
    vyos = "vyos"
    sros = "sros"
    frr = "frr"
    vrp = "vrp"


class NodeMode(str, Enum):
    sim = "sim"
    emul = "emul"


class NodeStatus(str, Enum):
    stopped = "stopped"
    booting = "booting"
    running = "running"
    degraded = "degraded"
    error = "error"


class IfaceType(str, Enum):
    eth = "eth"
    sfp = "sfp"
    sfp28 = "sfp28"
    qsfp = "qsfp"
    gpon = "gpon"
    wifi = "wifi"


class LinkType(str, Enum):
    copper = "copper"
    fiber = "fiber"
    wireless = "wireless"
    virtual = "virtual"


class ConfigFormat(str, Enum):
    cli = "cli"
    netconf = "netconf"
    yaml = "yaml"


# --- core resources ---------------------------------------------------------
class Interface(_Base):
    id: str
    node_id: str
    name: str
    type: IfaceType = IfaceType.eth
    ip: list[str] = Field(default_factory=list)
    mac: str | None = None
    speed: int = 1000          # Mbps
    mtu: int = 1500
    peer_link_id: str | None = None


class Node(_Base):
    id: str
    project_id: str
    name: str
    kind: NodeKind = NodeKind.router
    nos: Nos = Nos.forgeos
    mode: NodeMode = NodeMode.sim
    x: float = 0.0
    y: float = 0.0
    interfaces: list[Interface] = Field(default_factory=list)
    config_ref: str | None = None
    status: NodeStatus = NodeStatus.stopped
    # extension fields used by the ForgeOS compiler (see protocols/NEEDS.md)
    intent: dict | None = None


class NodeCreate(_Base):
    project_id: str
    name: str
    kind: NodeKind = NodeKind.router
    nos: Nos = Nos.forgeos
    mode: NodeMode = NodeMode.sim
    x: float = 0.0
    y: float = 0.0
    interfaces: list[Interface] = Field(default_factory=list)
    intent: dict | None = None


class NodeUpdate(_Base):
    name: str | None = None
    nos: Nos | None = None
    mode: NodeMode | None = None
    x: float | None = None
    y: float | None = None
    status: NodeStatus | None = None
    interfaces: list[Interface] | None = None
    intent: dict | None = None


class Link(_Base):
    id: str
    project_id: str
    a_iface: str
    b_iface: str
    type: LinkType = LinkType.virtual
    bandwidth: int = 1000      # Mbps
    delay: float = 0.0         # ms one-way
    loss: float = 0.0          # 0..1 drop probability
    mtu: int = 1500


class LinkCreate(_Base):
    project_id: str
    a_iface: str
    b_iface: str
    type: LinkType = LinkType.virtual
    bandwidth: int = 1000
    delay: float = 0.0
    loss: float = 0.0
    mtu: int = 1500


class LinkUpdate(_Base):
    bandwidth: int | None = None
    delay: float | None = None
    loss: float | None = None
    mtu: int | None = None


class Project(_Base):
    id: str
    name: str
    description: str = ""
    version: int = 1
    created_at: datetime = Field(default_factory=_now)


class ProjectCreate(_Base):
    name: str
    description: str = ""


class Topology(_Base):
    project: Project
    nodes: list[Node] = Field(default_factory=list)
    links: list[Link] = Field(default_factory=list)


class ScenarioStep(_Base):
    order: int
    action: str
    params: dict = Field(default_factory=dict)


class Scenario(_Base):
    id: str
    project_id: str
    name: str
    steps: list[ScenarioStep] = Field(default_factory=list)
    expected_outcomes: list[str] = Field(default_factory=list)


class ConfigArtifact(_Base):
    id: str
    node_id: str
    vendor: str
    format: ConfigFormat = ConfigFormat.cli
    content: str
    generated_at: datetime = Field(default_factory=_now)


class GenerateConfigRequest(_Base):
    node_id: str
    vendor: str | None = None     # default: derive from node.nos


class SimulateRequest(_Base):
    project_id: str
    seed: int = 0
    horizon: float | None = None
    realtime: bool = False
