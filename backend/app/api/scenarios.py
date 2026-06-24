"""Scenario endpoints (read + create). Scenario *execution* is driven through
the simulation endpoints; this just manages the saved definitions."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from app.api.deps import repo
from app.models import Scenario
from app.store import MemoryRepository

router = APIRouter(tags=["scenarios"])


@router.get("/scenarios", response_model=list[Scenario])
async def list_scenarios(
    project_id: str = Query(...), r: MemoryRepository = Depends(repo)
):
    return await r.list_scenarios(project_id)


@router.post("/scenarios", response_model=Scenario, status_code=201)
async def create_scenario(body: Scenario, r: MemoryRepository = Depends(repo)):
    return await r.add_scenario(body)
