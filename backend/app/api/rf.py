"""RF planning endpoints (NG-RF-01) — propagation model registry.

A study picks a propagation model by id and supplies geometry + params; the
registry (``engine.propagation``) dispatches to a closed-form path-loss model.
``GET /api/rf/models`` lists the available models with their metadata;
``POST /api/rf/path-loss`` computes loss for a chosen model.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.models import PathLossRequest, PathLossResult, PropagationModelInfo
from app.services import wireless as wsvc

router = APIRouter(prefix="/rf", tags=["rf"])


@router.get("/models", response_model=list[PropagationModelInfo])
async def list_models():
    """List every registered propagation model with its metadata (valid
    frequency/distance ranges + tunable params)."""
    return wsvc.list_models()


@router.post("/path-loss", response_model=PathLossResult)
async def compute_path_loss(body: PathLossRequest):
    """Compute path loss (dB) for a chosen model. 422 on an unknown model id or
    a frequency outside the model's valid range."""
    try:
        loss = wsvc.path_loss(
            body.model_id,
            body.distance_m,
            body.freq_mhz,
            tx_height_m=body.tx_height_m,
            rx_height_m=body.rx_height_m,
            **body.params,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return PathLossResult(
        model_id=body.model_id,
        path_loss_db=round(loss, 2),
        distance_m=body.distance_m,
        freq_mhz=body.freq_mhz,
    )
