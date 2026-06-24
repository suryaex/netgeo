"""WebSocket endpoints: live topology/telemetry and per-node console.

For v0.1 these are in-process broadcasters. Production fans out via Redis
pub/sub (infra/redis-design.md) so multiple API workers share one event bus.

Security note (security/threat-model.md): ``node_id`` on the console socket
MUST be re-authorized server-side once auth lands — never trust the path param
alone for access to a device console.
"""
from __future__ import annotations

import asyncio
import contextlib

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.store import get_repo

router = APIRouter()


@router.websocket("/ws/topology")
async def ws_topology(ws: WebSocket):
    """Push periodic topology/stat snapshots. Clients may also send pings."""
    await ws.accept()
    repo = get_repo()
    try:
        while True:
            projects = await repo.list_projects()
            await ws.send_json(
                {"type": "topology.tick", "projects": [p.id for p in projects]}
            )
            with contextlib.suppress(asyncio.TimeoutError):
                # allow client messages (e.g. subscribe) without blocking the tick
                msg = await asyncio.wait_for(ws.receive_text(), timeout=2.0)
                if msg == "ping":
                    await ws.send_json({"type": "pong"})
    except WebSocketDisconnect:
        return


@router.websocket("/ws/console/{node_id}")
async def ws_console(ws: WebSocket, node_id: str):
    """A simulated device console. Echoes a banner then relays line input to a
    (stub) command handler. Real emul-mode attaches this to the container PTY."""
    await ws.accept()
    repo = get_repo()
    try:
        node = await repo.get_node(node_id)
        await ws.send_json({"type": "banner", "text": f"{node.name} ({node.nos}) console — NetForge\n{node.name}> "})
    except Exception:
        await ws.send_json({"type": "error", "text": "node not found"})
        await ws.close()
        return

    try:
        while True:
            line = await ws.receive_text()
            await ws.send_json({"type": "output", "text": _handle_console(line)})
    except WebSocketDisconnect:
        return


def _handle_console(line: str) -> str:
    line = line.strip()
    if line in ("?", "help"):
        return "available (stub): show version | show interfaces | ping <node>\n"
    if line.startswith("show version"):
        return "NetForge ForgeOS, Version 0.1 — sim mode\n"
    if line.startswith("show interfaces"):
        return "(interfaces rendered from node model in a future build)\n"
    return f"% Unknown command: {line}\n"
