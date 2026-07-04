"""Live-lab endpoints: packet-level diagnostics over the netstack engine.

Every endpoint operates on the project's living lab (built and cached by
:mod:`app.services.netlab`), so a ping here traverses the same simulated
network the device consoles are attached to. Engine work is CPU-bound and
synchronous — it is offloaded to a worker thread to keep the event loop live.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, ConfigDict

from app.api.deps import repo, translate_not_found
from app.exceptions.base import NotFound, SimulationError
from app.services import netlab
from app.services import notify
from app.store import MemoryRepository
from app.store import NotFound as StoreNotFound

router = APIRouter(prefix="/lab", tags=["lab"])


class _Body(BaseModel):
    model_config = ConfigDict(extra="forbid")


class PingRequest(_Body):
    src: str                    # node id or name
    dst: str                    # IPv4 address, or node id/name (first IP used)
    count: int = 4


class TracerouteRequest(_Body):
    src: str
    dst: str
    max_hops: int = 16


class CliRequest(_Body):
    node: str                   # node id or name
    command: str


async def _topo(r: MemoryRepository, project_id: str):
    try:
        return await r.topology(project_id)
    except StoreNotFound as exc:
        raise translate_not_found(exc) from exc


def _lab_for(topo):
    return netlab.get_lab_manager().get(topo)


def _resolve_dst(lab: netlab.Lab, ref: str) -> str:
    """Accept a literal IPv4 or a node reference (use its first address)."""
    import ipaddress

    try:
        ipaddress.IPv4Address(ref)
        return ref
    except ValueError:
        pass
    dev = lab.net.find_device(ref)
    if dev is not None:
        ips = dev.all_ips()
        if ips:
            return str(ips[0].ip)
    raise NotFound(f"cannot resolve destination '{ref}' to an IPv4 address")


@router.post("/{project_id}/ping")
async def lab_ping(project_id: str, body: PingRequest, r: MemoryRepository = Depends(repo)):
    topo = await _topo(r, project_id)

    def work():
        lab = _lab_for(topo)
        dst = _resolve_dst(lab, body.dst)
        report = lab.net.ping(body.src, dst, count=min(body.count, 50))
        return report.as_dict()

    try:
        return await run_in_threadpool(work)
    except NotFound:
        raise
    except ValueError as exc:
        raise SimulationError(str(exc)) from exc


@router.post("/{project_id}/traceroute")
async def lab_traceroute(
    project_id: str, body: TracerouteRequest, r: MemoryRepository = Depends(repo)
):
    topo = await _topo(r, project_id)

    def work():
        lab = _lab_for(topo)
        dst = _resolve_dst(lab, body.dst)
        report = lab.net.traceroute(body.src, dst, max_hops=min(body.max_hops, 32))
        return report.as_dict()

    try:
        return await run_in_threadpool(work)
    except NotFound:
        raise
    except ValueError as exc:
        raise SimulationError(str(exc)) from exc


@router.post("/{project_id}/cli")
async def lab_cli(project_id: str, body: CliRequest, r: MemoryRepository = Depends(repo)):
    topo = await _topo(r, project_id)

    def work():
        lab = _lab_for(topo)
        session = lab.session_for(body.node)
        if session is None:
            raise NotFound(f"node '{body.node}' not found in lab")
        output = session.execute(body.command)
        return {"node": body.node, "output": output, "prompt": session.prompt}

    try:
        return await run_in_threadpool(work)
    except NotFound:
        raise
    except ValueError as exc:
        raise SimulationError(str(exc)) from exc


@router.get("/{project_id}/ledger")
async def lab_ledger(
    project_id: str,
    from_seq: int = 0,
    limit: int = 500,
    type_prefix: str | None = None,
    node: str | None = None,
    r: MemoryRepository = Depends(repo),
):
    """Event ledger of the living lab (NG-SIM-01): replay hash + recent records."""
    topo = await _topo(r, project_id)

    def work():
        lab = _lab_for(topo)
        led = lab.net.ledger
        return {
            "hash": led.hash(),
            "total": led.seq,
            "records": led.tail(from_seq, min(limit, 2000), type_prefix, node),
        }

    return await run_in_threadpool(work)


@router.get("/{project_id}/captures")
async def lab_captures(
    project_id: str,
    link_id: str | None = None,
    limit: int = 100,
    r: MemoryRepository = Depends(repo),
):
    topo = await _topo(r, project_id)

    def work():
        lab = _lab_for(topo)
        records = lab.net.capture.records(link_id=link_id, limit=min(limit, 1000))
        return {
            "project_id": project_id,
            "link_id": link_id,
            "count": len(records),
            "records": [rec.as_dict() for rec in records],
        }

    return await run_in_threadpool(work)


@router.get("/{project_id}/tables/{node_ref}")
async def lab_tables(project_id: str, node_ref: str, r: MemoryRepository = Depends(repo)):
    """Live control-plane state of one device: RIB, ARP, MAC, protocols, NAT."""
    topo = await _topo(r, project_id)

    def work():
        lab = _lab_for(topo)
        dev = lab.net.find_device(node_ref)
        if dev is None:
            raise NotFound(f"node '{node_ref}' not found in lab")
        out: dict = {"node": dev.name, "kind": dev.kind, "interfaces": [
            i.brief() for i in dev.interfaces.values()
        ]}
        arp = getattr(dev, "arp_table", None)
        if arp is not None:
            out["arp"] = [
                {"ip": str(ip), "mac": str(mac), "iface": ifname}
                for ip, (mac, ifname) in sorted(arp.items())
            ]
        if hasattr(dev, "route_table_rows"):
            out["routes"] = dev.route_table_rows()
            out["nat"] = dev.nat_rows()
        if hasattr(dev, "mac_table_rows"):
            out["mac_table"] = dev.mac_table_rows()
        for proc in getattr(dev, "processes", []):
            proto = getattr(proc, "proto", "")
            if proto == "ospf":
                out["ospf_neighbors"] = proc.neighbor_rows()
            elif proto == "bgp":
                out["bgp_peers"] = proc.summary_rows()
        return out

    return await run_in_threadpool(work)


@router.get("/{project_id}/status")
async def lab_status(project_id: str, r: MemoryRepository = Depends(repo)):
    topo = await _topo(r, project_id)

    def work():
        lab = _lab_for(topo)
        return {
            "project_id": project_id,
            "stats": lab.net.stats(),
            "events": lab.net.events_log[-50:],
        }

    return await run_in_threadpool(work)


@router.post("/{project_id}/rebuild")
async def lab_rebuild(project_id: str, r: MemoryRepository = Depends(repo)):
    """Force a fresh lab (drops live CLI state and captures)."""
    topo = await _topo(r, project_id)
    netlab.get_lab_manager().invalidate(project_id)

    def work():
        lab = _lab_for(topo)
        return {"project_id": project_id, "stats": lab.net.stats()}

    return await run_in_threadpool(work)


@router.post("/{project_id}/auto-address")
async def lab_auto_address(project_id: str, r: MemoryRepository = Depends(repo)):
    """Auto-assign IPv4 addressing to the whole topology and persist it.

    /30s for router-to-router links, /24s per switch broadcast domain, host
    default gateways pointed at the first router in their domain.
    """
    topo = await _topo(r, project_id)
    plan = netlab.plan_auto_addressing(topo)

    changed = 0
    for node in topo.nodes:
        node_assign = plan["assignments"].get(node.id) or {}
        gateway = plan["gateways"].get(node.id)
        if not node_assign and not gateway:
            continue
        interfaces = []
        for iface in node.interfaces:
            cidr = node_assign.get(iface.id)
            interfaces.append(
                iface.model_copy(update={"ip": [cidr]}) if cidr else iface
            )
        patch: dict = {"interfaces": interfaces}
        if gateway:
            intent = dict(node.intent or {})
            intent["gateway"] = gateway
            patch["intent"] = intent
        updated = await r.update_node(node.id, patch)
        await notify.node_changed(r, updated)
        changed += 1

    netlab.get_lab_manager().invalidate(project_id)
    return {
        "project_id": project_id,
        "nodes_updated": changed,
        "plan": plan,
    }
