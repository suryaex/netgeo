"""QoS class model for the netstack egress pipeline.

Three fixed strict-priority classes (§2.1 of docs/design/14-ENGINE-WAVE2-ARCH.md):
  EF (0) — DSCP ≥ ef_min_dscp (default 40)  — drains first
  AF (1) — af_min_dscp ≤ DSCP < ef_min_dscp
  BE (2) — DSCP < af_min_dscp

When QosConfig.enabled is False the classify() function maps to exactly the
same two-bucket behaviour that existed before this module (EF≡prio threshold 40,
everything else BE, shared depth 64 via QosConfig defaults) so all existing tests
pass bit-for-bit — the disabled-path parity gate (E-3 acceptance criterion).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import IntEnum


class QosClass(IntEnum):
    EF = 0   # Expedited Forwarding — drains first
    AF = 1   # Assured Forwarding
    BE = 2   # Best Effort


@dataclass(slots=True)
class QosConfig:
    enabled: bool = False
    ef_min_dscp: int = 40     # matches legacy PRIORITY_DSCP_THRESHOLD
    af_min_dscp: int = 8
    depth_per_class: int = 32  # tail-drop per class when enabled


def classify(dscp: int, cfg: QosConfig) -> QosClass:
    """Map a DSCP value to a QosClass.

    Disabled path: replicates the legacy two-queue split exactly —
    dscp >= 40 → EF (was _queue_prio), else → BE (was _queue_be), AF never
    returned.  This keeps the disabled-path behaviour bit-for-bit identical
    to pre-QoS code so replay hashes of old labs are unchanged.
    """
    if not cfg.enabled:
        return QosClass.EF if dscp >= cfg.ef_min_dscp else QosClass.BE
    if dscp >= cfg.ef_min_dscp:
        return QosClass.EF
    if dscp >= cfg.af_min_dscp:
        return QosClass.AF
    return QosClass.BE
