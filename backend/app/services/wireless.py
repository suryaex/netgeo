"""Wireless planning service — adapts stored geo nodes to the RF engine.

Pulls nodes that carry a geographic position (``lat``/``lon``) from a project,
maps each to an ``engine.wireless.GeoDevice``, and runs the deterministic
planner / link-budget primitives. Like ``services/sim.py`` this is the seam
between the persistence schema (``app.models``) and the engine's own shapes.

Unit conventions: the schema's :class:`Radio` and the engine's ``Radio`` use the
*same* units (dBm / GHz / dBi / MHz / metres), so the mapping is field-for-field
with no conversion.
"""
from __future__ import annotations

import hashlib
import json
import math

from app.models import (
    CoverageCircle,
    CoverageRasterRequest,
    Node,
    Radio,
    Topology,
    WirelessLink,
    WirelessPlanResult,
)
from engine import propagation as prop
from engine import wireless as rf

# How a stored NodeKind maps onto an engine planner "role".
_ROLE_BY_KIND = {
    "ap": "ap",
    "olt": "tower",
    "host": "cpe",
    "server": "cpe",
    "router": "router",
    "switch": "switch",
    "firewall": "router",
}


def _to_engine_radio(r: Radio | None) -> rf.Radio:
    if r is None:
        return rf.Radio()
    return rf.Radio(
        tx_power_dbm=r.tx_power_dbm,
        frequency_ghz=r.frequency_ghz,
        antenna_gain_dbi=r.antenna_gain_dbi,
        bandwidth_mhz=r.bandwidth_mhz,
        rx_sensitivity_dbm=r.rx_sensitivity_dbm,
        misc_loss_db=r.misc_loss_db,
        max_range_m=r.max_range_m,
    )


def _role_for(node: Node) -> str:
    kind = str(node.kind)
    # A node placed on a tower position is modelled by kind=ap with a tower
    # intent flag; default to the kind→role table otherwise.
    if node.intent and node.intent.get("map_role") == "tower":
        return "tower"
    return _ROLE_BY_KIND.get(kind, "cpe")


def _geo_devices(nodes: list[Node]) -> list[rf.GeoDevice]:
    out: list[rf.GeoDevice] = []
    for n in nodes:
        if n.lat is None or n.lon is None:
            continue
        out.append(
            rf.GeoDevice(
                id=n.id,
                role=_role_for(n),
                lat=n.lat,
                lon=n.lon,
                radio=_to_engine_radio(n.radio),
            )
        )
    return out


def plan_topology(topo: Topology) -> WirelessPlanResult:
    """Run the RF planner over a project's geo-placed nodes.

    Returns the planned wireless links (with full link budgets) plus a coverage
    circle per serving node, ready for the map to render."""
    geo = _geo_devices(topo.nodes)
    planned = rf.plan_links(geo)
    links = [
        WirelessLink(
            a_id=p.a_id,
            b_id=p.b_id,
            distance_m=round(p.budget.distance_m, 2),
            fspl_db=round(p.budget.fspl_db, 2),
            rssi_dbm=round(p.budget.rssi_dbm, 2),
            margin_db=round(p.budget.margin_db, 2),
            noise_floor_dbm=round(p.budget.noise_floor_dbm, 2),
            snr_db=round(p.budget.snr_db, 2),
            quality=p.budget.quality.value,
            feasible=p.budget.feasible,
        )
        for p in planned
    ]

    coverage: list[CoverageCircle] = []
    for g in geo:
        if g.role in ("ap", "tower"):
            radius = rf.max_range_m(g.radio, g.radio)
            coverage.append(
                CoverageCircle(node_id=g.id, lat=g.lat, lon=g.lon, radius_m=round(radius, 1))
            )

    return WirelessPlanResult(project_id=topo.project.id, links=links, coverage=coverage)


def coverage_radius(node: Node) -> float:
    """Theoretical coverage radius (m) of a single serving node."""
    radio = _to_engine_radio(node.radio)
    return round(rf.max_range_m(radio, radio), 1)


def link_budget_between(
    tx: Radio,
    rx: Radio | None,
    *,
    distance_m: float | None = None,
    a_lat: float | None = None,
    a_lon: float | None = None,
    b_lat: float | None = None,
    b_lon: float | None = None,
    rain_rate_mm_hr: float = 0.0,
) -> rf.LinkBudget:
    """Compute a single point-to-point budget. Distance is taken from
    ``distance_m`` if given, else derived from the two coordinate pairs."""
    etx = _to_engine_radio(tx)
    erx = _to_engine_radio(rx) if rx is not None else etx
    if distance_m is None:
        if None in (a_lat, a_lon, b_lat, b_lon):
            raise ValueError("provide distance_m or both endpoint coordinates")
        distance_m = rf.haversine_m(a_lat, a_lon, b_lat, b_lon)  # type: ignore[arg-type]
    return rf.link_budget(etx, erx, distance_m, rain_rate_mm_hr)


def list_models() -> list[dict]:
    """Registry metadata for every propagation model (NG-RF-01)."""
    return prop.list_models()


def path_loss(
    model_id: str,
    distance_m: float,
    freq_mhz: float,
    tx_height_m: float = 30.0,
    rx_height_m: float = 1.5,
    **params: object,
) -> float:
    """Path loss (dB) from the chosen propagation model. Raises ``ValueError``
    on an unknown model id or out-of-range frequency."""
    return prop.path_loss(
        model_id, distance_m, freq_mhz, tx_height_m, rx_height_m, **params
    )


# --- NG-RF-03 point-to-point link budget -----------------------------------
def ptp_budget(
    *,
    model_id: str,
    distance_m: float,
    freq_mhz: float,
    tx_height_m: float,
    rx_height_m: float,
    tx_power_dbm: float,
    tx_gain_dbi: float,
    rx_gain_dbi: float,
    misc_loss_db: float,
    rx_sensitivity_dbm: float,
    params: dict,
) -> dict:
    """PtP link budget with path loss taken THROUGH the propagation registry.

        EIRP = Ptx + Gtx
        RSSI = EIRP + Grx - path_loss(model) - Lmisc

    Raises ``ValueError`` (→ HTTP 422) on an unknown model or out-of-range freq.
    """
    loss = prop.path_loss(model_id, distance_m, freq_mhz, tx_height_m, rx_height_m, **params)
    eirp = tx_power_dbm + tx_gain_dbi
    rssi = eirp + rx_gain_dbi - loss - misc_loss_db
    return {
        "eirp_dbm": round(eirp, 2),
        "path_loss_db": round(loss, 2),
        "rssi_dbm": round(rssi, 2),
        "fade_margin_db": round(rssi - rx_sensitivity_dbm, 2),
    }


# --- NG-RF-02 coverage raster ----------------------------------------------
# Cap on raster cells: bounds the sites×cells compute so a synchronous study
# stays within the request budget. 64×64. ponytail: synchronous bounded compute
# (a pure function of inputs is deterministic → cacheable via study_key); an
# async job queue is a follow-up only if bigger rasters are needed.
MAX_COVERAGE_CELLS = 4096

# Per-technology radio defaults (carrier / tx power / antenna gain). Sites may
# override any of these; sensitivity is informational for the caller's legend.
_TECH_PRESETS: dict[str, dict[str, float]] = {
    "wifi_2ghz":  {"freq_mhz": 2400.0,  "tx_power_dbm": 20.0, "tx_gain_dbi": 3.0},
    "wifi_5ghz":  {"freq_mhz": 5000.0,  "tx_power_dbm": 23.0, "tx_gain_dbi": 5.0},
    "wifi_6ghz":  {"freq_mhz": 6000.0,  "tx_power_dbm": 23.0, "tx_gain_dbi": 5.0},
    "lte":        {"freq_mhz": 1800.0,  "tx_power_dbm": 43.0, "tx_gain_dbi": 15.0},
    "wifi_60ghz": {"freq_mhz": 60000.0, "tx_power_dbm": 10.0, "tx_gain_dbi": 25.0},
}

# Legend thresholds mirror engine.wireless.LinkQuality so map + engine agree.
_COVERAGE_LEGEND = [
    {"label": "excellent", "min_dbm": -55.0},
    {"label": "good", "min_dbm": -70.0},
    {"label": "fair", "min_dbm": -80.0},
    {"label": "weak", "min_dbm": -95.0},
]


def _resolve_bounds(req: CoverageRasterRequest) -> tuple[float, float, float, float]:
    """(min_lat, min_lon, max_lat, max_lon) from an explicit bbox or centre+radius."""
    if None not in (req.min_lat, req.min_lon, req.max_lat, req.max_lon):
        lo_lat, hi_lat = sorted((req.min_lat, req.max_lat))  # type: ignore[arg-type]
        lo_lon, hi_lon = sorted((req.min_lon, req.max_lon))  # type: ignore[arg-type]
        if lo_lat == hi_lat or lo_lon == hi_lon:
            raise ValueError("bounding box has zero area")
        return lo_lat, lo_lon, hi_lat, hi_lon
    if None not in (req.center_lat, req.center_lon, req.radius_m):
        dlat = req.radius_m / 111_320.0  # type: ignore[operator]
        dlon = req.radius_m / (111_320.0 * max(math.cos(math.radians(req.center_lat)), 1e-6))  # type: ignore[operator,arg-type]
        return (req.center_lat - dlat, req.center_lon - dlon,  # type: ignore[operator]
                req.center_lat + dlat, req.center_lon + dlon)  # type: ignore[operator]
    raise ValueError("provide a bbox (min/max lat/lon) or center+radius")


def _study_key(req: CoverageRasterRequest) -> str:
    """Deterministic cache key: sha256 of the canonical request JSON. Same
    request → same key AND same raster (feeds the R4 'study re-opens identically'
    exit criterion)."""
    canonical = json.dumps(req.model_dump(mode="json"), sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode()).hexdigest()[:16]


def coverage_raster(req: CoverageRasterRequest) -> dict:
    """Compute a best-server RSSI raster (dBm per cell) over the request's bbox.

    O(sites × cells), bounded by ``MAX_COVERAGE_CELLS``. Great-circle distance
    per cell; path loss via the registry so ``model_id`` is honoured. Raises
    ``ValueError`` (→ 422) on cap overflow, bad geometry, unknown technology, or
    an unknown/out-of-range propagation model."""
    rows, cols = req.rows, req.cols
    if rows * cols > MAX_COVERAGE_CELLS:
        raise ValueError(
            f"grid {rows}x{cols} = {rows * cols} cells exceeds cap {MAX_COVERAGE_CELLS}"
        )
    preset = _TECH_PRESETS.get(req.technology)
    if preset is None:
        raise ValueError(f"unknown technology: {req.technology!r}")
    min_lat, min_lon, max_lat, max_lon = _resolve_bounds(req)

    # Resolve each site's radio once (preset defaults + per-site overrides).
    sites = [
        (
            s.lat, s.lon, s.height_m,
            preset["tx_power_dbm"] if s.tx_power_dbm is None else s.tx_power_dbm,
            preset["freq_mhz"] if s.freq_mhz is None else s.freq_mhz,
            preset["tx_gain_dbi"] if s.tx_gain_dbi is None else s.tx_gain_dbi,
        )
        for s in req.sites
    ]

    values: list[list[float]] = []
    for r in range(rows):
        lat = min_lat + (r + 0.5) / rows * (max_lat - min_lat)  # cell-centre latitude
        row_vals: list[float] = []
        for c in range(cols):
            lon = min_lon + (c + 0.5) / cols * (max_lon - min_lon)
            best = -math.inf
            for slat, slon, sh, sp, sf, sg in sites:
                dist = rf.haversine_m(slat, slon, lat, lon)
                loss = prop.path_loss(req.model_id, dist, sf, sh, req.rx_height_m, **req.params)
                rssi = sp + sg + req.rx_gain_dbi - loss - req.misc_loss_db
                if rssi > best:
                    best = rssi
            row_vals.append(round(best, 2))
        values.append(row_vals)

    return {
        "model_id": req.model_id,
        "technology": req.technology,
        "rows": rows,
        "cols": cols,
        "bounds": {"min_lat": min_lat, "min_lon": min_lon,
                   "max_lat": max_lat, "max_lon": max_lon},
        "values": values,
        "legend": _COVERAGE_LEGEND,
        "study_key": _study_key(req),
        "site_count": len(sites),
    }


__all__ = [
    "plan_topology",
    "coverage_radius",
    "link_budget_between",
    "list_models",
    "path_loss",
    "ptp_budget",
    "coverage_raster",
    "MAX_COVERAGE_CELLS",
]
