"""Digital twin endpoints (R6 base).

NG-TW-01 config import: parse a device config into a real node in the project,
so an existing network can be brought into the twin from its running configs.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.api.deps import repo, translate_not_found
from app.exceptions.base import AppException
from app.models import Interface, Node
from app.services import configimport, notify
from app.store import MemoryRepository
from app.store import NotFound as StoreNotFound
from app.utils.ids import new_id

router = APIRouter(tags=["twin"])


class ImportConfigFailed(AppException):
    status_code = 422
    code = "IMPORT_CONFIG_FAILED"


class ImportConfigRequest(BaseModel):
    vendor: str = "ios"
    text: str


@router.post("/projects/{project_id}/import-config", response_model=Node, status_code=201)
async def import_config(
    project_id: str, body: ImportConfigRequest, r: MemoryRepository = Depends(repo)
):
    """Parse an IOS-like config (NG-TW-01) into a node in ``project_id``."""
    try:
        await r.get_project(project_id)
    except StoreNotFound as exc:
        raise translate_not_found(exc) from exc
    try:
        parsed = configimport.parse(body.vendor, body.text)
    except ValueError as exc:
        raise ImportConfigFailed(str(exc)) from exc

    nid = new_id()
    ifaces = [
        Interface(id=new_id(), node_id=nid, name=i["name"], ip=i["ip"])
        for i in parsed["interfaces"]
    ]
    node = Node(
        id=nid,
        project_id=project_id,
        name=parsed["hostname"],
        kind="router",
        nos=body.vendor.lower(),
        interfaces=ifaces,
        intent={"static_routes": parsed["static_routes"], "imported": True},
    )
    created = await r.add_node(node)
    await notify.node_changed(r, created)
    return created
