"""Host system endpoints — expose the machine's real network so a cloud node
can attach the simulation to a detected ethernet adapter / the internet.

GET /api/system/interfaces  — host network adapters (name, IPs, link, speed).
GET /api/system/internet    — internet reachability + outbound source IP.

Read-only; safe to leave open. The chosen adapter is stored on a cloud node at
``Node.intent["uplink"]`` by the frontend.
"""
from __future__ import annotations

from fastapi import APIRouter

from app.services import netbridge

router = APIRouter(tags=["system"])


@router.get("/system/interfaces")
async def system_interfaces() -> dict:
    return {"interfaces": netbridge.list_interfaces()}


@router.get("/system/internet")
async def system_internet() -> dict:
    return netbridge.internet_status()
