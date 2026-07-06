"""Fiber plant + loss budget tests (NG-FI-01/02/03)."""
from __future__ import annotations

from app.models import FiberElement, FiberPath, GponClass
from app.services.fiber import loss_budget


def _ref_path(**kw) -> FiberPath:
    # OLT → 2 km G.652 → 1:32 splitter → 0.5 km drop → 4 connectors → 2 splices
    els = [
        FiberElement(kind="fiber", length_m=2000, atten_db_km=0.22),
        FiberElement(kind="splitter", split_ratio=32),
        FiberElement(kind="fiber", length_m=500, atten_db_km=0.22),
        *[FiberElement(kind="connector") for _ in range(4)],
        *[FiberElement(kind="splice") for _ in range(2)],
    ]
    return FiberPath(id="f1", project_id="p1", name="ref", elements=els, **kw)


# --- pure loss budget -------------------------------------------------------
def test_reference_path_loss_and_pass():
    b = loss_budget(_ref_path(gpon_class=GponClass.c_plus))
    assert abs(b.total_loss_db - 19.05) < 1e-6   # 0.44+17.1+0.11+1.2+0.2
    assert b.budget_db == 32.0
    assert abs(b.margin_db - 12.95) < 1e-6
    assert b.passed is True
    assert b.total_length_m == 2500
    assert b.total_split == 32


def test_over_budget_fails_with_reason():
    # 1:128 (23.6) + 25 km G.652 (5.5) = 29.1 dB > B+ 28 dB budget
    path = FiberPath(
        id="f2", project_id="p1", name="long", gpon_class=GponClass.b_plus,
        elements=[
            FiberElement(kind="fiber", length_m=25000, atten_db_km=0.22),
            FiberElement(kind="splitter", split_ratio=128),
        ],
    )
    b = loss_budget(path)
    assert b.passed is False
    assert b.margin_db < 0
    assert any("Over budget" in c.reason for c in b.checks)


def test_gpon_checks_split_and_reach():
    # two cascaded 1:16 = 1:256 logical (> 128) and 30 km reach
    path = FiberPath(
        id="f3", project_id="p1", name="bad",
        elements=[
            FiberElement(kind="fiber", length_m=30000, atten_db_km=0.22),
            FiberElement(kind="splitter", split_ratio=16),
            FiberElement(kind="splitter", split_ratio=16),
        ],
    )
    b = loss_budget(path)
    assert b.total_split == 256
    assert any("exceeds 1:128" in c.reason for c in b.checks)
    assert any("exceeds 20 km" in c.reason for c in b.checks)


def test_loss_db_override_wins():
    path = FiberPath(
        id="f4", project_id="p1", name="ovr",
        elements=[FiberElement(kind="splitter", split_ratio=32, loss_db=99.0)],
    )
    assert loss_budget(path).total_loss_db == 99.0


# --- API --------------------------------------------------------------------
async def _project(client) -> str:
    return (await client.post("/api/projects", json={"name": "ftth"})).json()["id"]


async def test_fiber_crud_and_budget_endpoint(client):
    pid = await _project(client)
    body = {
        "project_id": pid,
        "name": "branch-1",
        "gpon_class": "c_plus",
        "elements": [
            {"kind": "fiber", "length_m": 2000, "atten_db_km": 0.22},
            {"kind": "splitter", "split_ratio": 32},
        ],
    }
    created = await client.post("/api/fiber-paths", json=body)
    assert created.status_code == 201, created.text
    fid = created.json()["id"]

    assert (await client.get(f"/api/fiber-paths?project_id={pid}")).json()[0]["id"] == fid

    budget = await client.get(f"/api/fiber-paths/{fid}/budget")
    assert budget.status_code == 200
    assert abs(budget.json()["total_loss_db"] - 17.54) < 1e-6  # 0.44 + 17.1
    assert budget.json()["passed"] is True

    await client.delete(f"/api/fiber-paths/{fid}")
    assert (await client.get(f"/api/fiber-paths/{fid}")).status_code == 404


async def test_budget_unknown_path_404(client):
    assert (await client.get("/api/fiber-paths/ghost/budget")).status_code == 404
