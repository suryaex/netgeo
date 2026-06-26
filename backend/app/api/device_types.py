"""Device-type registry endpoints.

Provides a catalog of known device types (AP, CPE, Tower, Switch, Router, …)
that the frontend map-mode uses to populate node-creation palettes and set
sensible defaults. Built-in types are read-only; operators may extend the
registry with custom entries at runtime.

Endpoints
---------
GET  /api/device-types          — list all device types (built-in + custom)
POST /api/device-types          — add a custom device type
DELETE /api/device-types/{id}   — remove a custom device type (built-ins protected)
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from app.utils.ids import new_id

router = APIRouter(tags=["device-types"])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class DeviceType(BaseModel):
    id: str
    name: str
    category: str = Field(
        default="custom",
        description="Logical group: wireless, wired, infrastructure, custom, …",
    )
    icon: str | None = Field(
        default=None,
        description="Icon identifier used by the frontend (e.g. 'ap', 'tower')",
    )
    description: str = ""
    builtin: bool = Field(default=False, description="True for read-only built-in types")


class DeviceTypeCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=80)
    category: str = "custom"
    icon: str | None = None
    description: str = ""


# ---------------------------------------------------------------------------
# Built-in catalog  (immutable; returned in every GET response)
# ---------------------------------------------------------------------------

_BUILTIN: list[DeviceType] = [
    DeviceType(id="builtin-ap",      name="Access Point",   category="wireless",        icon="ap",      description="802.11 wireless access point",                builtin=True),
    DeviceType(id="builtin-cpe",     name="CPE",            category="wireless",        icon="cpe",     description="Customer-premises equipment (wireless)",       builtin=True),
    DeviceType(id="builtin-tower",   name="Tower",          category="wireless",        icon="tower",   description="Cellular / backhaul tower",                   builtin=True),
    DeviceType(id="builtin-switch",  name="Switch",         category="wired",           icon="switch",  description="Layer-2 Ethernet switch",                     builtin=True),
    DeviceType(id="builtin-router",  name="Router",         category="wired",           icon="router",  description="Layer-3 IP router",                           builtin=True),
    DeviceType(id="builtin-olt",     name="OLT",            category="fiber",           icon="olt",     description="Optical Line Terminal (PON/GPON headend)",    builtin=True),
    DeviceType(id="builtin-onu",     name="ONU/ONT",        category="fiber",           icon="onu",     description="Optical Network Unit / Terminal (subscriber)", builtin=True),
    DeviceType(id="builtin-fw",      name="Firewall",       category="security",        icon="fw",      description="Stateful packet-filter / NGFW",               builtin=True),
    DeviceType(id="builtin-server",  name="Server",         category="infrastructure",  icon="server",  description="Physical or virtual server",                  builtin=True),
    DeviceType(id="builtin-cloud",   name="Cloud / Internet", category="infrastructure", icon="cloud",  description="Internet gateway / cloud-uplink node",        builtin=True),
]

# Runtime-mutable store for operator-added custom types
_custom: dict[str, DeviceType] = {}


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/device-types", response_model=list[DeviceType])
async def list_device_types() -> list[DeviceType]:
    """Return all device types: built-ins first, then custom entries."""
    return _BUILTIN + list(_custom.values())


@router.post("/device-types", response_model=DeviceType, status_code=status.HTTP_201_CREATED)
async def create_device_type(body: DeviceTypeCreate) -> DeviceType:
    """Register a new custom device type.

    The name must be unique across built-ins and existing custom types.
    """
    all_names = {dt.name.lower() for dt in _BUILTIN} | {dt.name.lower() for dt in _custom.values()}
    if body.name.lower() in all_names:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"A device type named '{body.name}' already exists.",
        )
    dt = DeviceType(
        id=new_id(),
        name=body.name,
        category=body.category,
        icon=body.icon,
        description=body.description,
        builtin=False,
    )
    _custom[dt.id] = dt
    return dt


@router.delete("/device-types/{device_type_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_device_type(device_type_id: str) -> None:
    """Delete a custom device type.

    Built-in types cannot be deleted (returns 403).
    Non-existent IDs return 404.
    """
    # Check built-ins first
    if any(dt.id == device_type_id for dt in _BUILTIN):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Built-in device types cannot be deleted.",
        )
    if device_type_id not in _custom:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Device type '{device_type_id}' not found.",
        )
    del _custom[device_type_id]
