"""Projects + topology endpoints."""
from __future__ import annotations

from fastapi import APIRouter, Depends

from app.api.deps import repo, translate_not_found
from app.models import Project, ProjectCreate, Topology
from app.store import MemoryRepository
from app.store import NotFound as StoreNotFound

router = APIRouter(tags=["projects"])


@router.get("/projects", response_model=list[Project])
async def list_projects(r: MemoryRepository = Depends(repo)):
    return await r.list_projects()


@router.post("/projects", response_model=Project, status_code=201)
async def create_project(body: ProjectCreate, r: MemoryRepository = Depends(repo)):
    return await r.create_project(body.name, body.description)


@router.get("/projects/{project_id}", response_model=Project)
async def get_project(project_id: str, r: MemoryRepository = Depends(repo)):
    try:
        return await r.get_project(project_id)
    except StoreNotFound as exc:
        raise translate_not_found(exc) from exc


@router.get("/projects/{project_id}/topology", response_model=Topology)
async def get_topology(project_id: str, r: MemoryRepository = Depends(repo)):
    try:
        return await r.topology(project_id)
    except StoreNotFound as exc:
        raise translate_not_found(exc) from exc
