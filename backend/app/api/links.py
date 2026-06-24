"""Link endpoints."""
from __future__ import annotations

from fastapi import APIRouter, Depends

from app.api.deps import repo, translate_not_found
from app.models import Link, LinkCreate, LinkUpdate
from app.store import MemoryRepository
from app.store import NotFound as StoreNotFound
from app.utils.ids import new_id

router = APIRouter(tags=["links"])


@router.post("/links", response_model=Link, status_code=201)
async def create_link(body: LinkCreate, r: MemoryRepository = Depends(repo)):
    link = Link(id=new_id(), **body.model_dump())
    return await r.add_link(link)


@router.patch("/links/{link_id}", response_model=Link)
async def update_link(link_id: str, patch: LinkUpdate, r: MemoryRepository = Depends(repo)):
    try:
        return await r.update_link(link_id, patch.model_dump(exclude_unset=True))
    except StoreNotFound as exc:
        raise translate_not_found(exc) from exc


@router.delete("/links/{link_id}", status_code=204)
async def delete_link(link_id: str, r: MemoryRepository = Depends(repo)):
    try:
        await r.delete_link(link_id)
    except StoreNotFound as exc:
        raise translate_not_found(exc) from exc
