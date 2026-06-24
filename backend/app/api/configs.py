"""Config generation endpoints — the multi-vendor / ForgeOS output surface."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from app.api.deps import repo, translate_not_found
from app.exceptions.base import AppException
from app.models import ConfigArtifact, GenerateConfigRequest
from app.services import configgen
from app.store import MemoryRepository
from app.store import NotFound as StoreNotFound

router = APIRouter(tags=["configs"])


class ConfigGenFailed(AppException):
    status_code = 422
    code = "CONFIG_GEN_FAILED"


@router.post("/configs/generate", response_model=ConfigArtifact, status_code=201)
async def generate_config(body: GenerateConfigRequest, r: MemoryRepository = Depends(repo)):
    try:
        node = await r.get_node(body.node_id)
    except StoreNotFound as exc:
        raise translate_not_found(exc) from exc
    try:
        artifact = configgen.build_artifact(node, body.vendor)
    except configgen.ConfigGenError as exc:
        raise ConfigGenFailed(str(exc)) from exc
    await r.add_config(artifact)
    # link the latest artifact back onto the node
    await r.update_node(node.id, {"config_ref": artifact.id})
    return artifact


@router.get("/configs", response_model=list[ConfigArtifact])
async def list_configs(node_id: str = Query(...), r: MemoryRepository = Depends(repo)):
    return await r.configs_for_node(node_id)
