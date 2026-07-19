"""Drift-diff service: canonical diff of an imported config snapshot vs current
node intent (NG-TW-03).

Both sides are rendered through the same configgen.render() pipeline so that
formatting / ordering differences vanish and only semantic drift shows.
Pure function — no FastAPI imports, no I/O.

Limitation: drift is bounded by what configimport parsers understand; stanzas
unknown to the parser are silently absent from the diff (documented in §1.3 of
docs/design/14-ENGINE-WAVE2-ARCH.md).
"""
from __future__ import annotations

from app.models import DriftReport, ImportSnapshot, Node
from app.services import configgen, configimport


def _node_from_parsed(parsed: dict, original: Node) -> Node:
    """Reconstruct a minimal Node from a parsed import dict to feed configgen.

    Re-uses the original node's id/project/position — only the intent-driving
    fields (hostname→name, interfaces, intent sub-trees) come from the parsed
    snapshot, so configgen.render() produces the same canonical text as it would
    have produced at import time.
    """
    from app.models import Interface
    from app.utils.ids import new_id

    ifaces = [
        Interface(id=new_id(), node_id=original.id, name=i["name"], ip=i["ip"])
        for i in parsed["interfaces"]
    ]
    intent: dict = {"static_routes": parsed.get("static_routes", []), "imported": True}
    for proto in ("ospf", "bgp"):
        if parsed.get(proto):
            intent[proto] = parsed[proto]

    return Node(
        id=original.id,
        project_id=original.project_id,
        # Use the node's current store name (may differ from snapshot hostname due to
        # auto-rename on collision) so both sides render under the same hostname.
        name=original.name,
        kind=original.kind,
        nos=original.nos,
        interfaces=ifaces,
        intent=intent,
    )


def drift_report(node: Node, snap: ImportSnapshot | None) -> DriftReport:
    """Return a DriftReport for *node* against its import *snap*.

    When snap is None → has_snapshot=False, drifted=False, diff="".
    Both snapshot text and current intent are canonicalized through
    configgen.render() before diffing so formatting noise is eliminated.
    Falls back to empty diff on ConfigGenError (unknown NOS template) —
    drift is best-effort, not a hard failure.
    """
    if snap is None:
        return DriftReport(
            node_id=node.id,
            node_name=node.name,
            has_snapshot=False,
            drifted=False,
            diff="",
            imported_at=None,
        )

    try:
        parsed = configimport.parse(snap.vendor, snap.text)
        snapshot_node = _node_from_parsed(parsed, node)
        text_a = configgen.render(snapshot_node, snap.vendor)
        text_b = configgen.render(node, snap.vendor)
        diff = configgen.config_diff(text_a, text_b, node.name)
    except (configgen.ConfigGenError, ValueError):
        # Unknown template or parse error — report as no-diff rather than crash.
        diff = ""

    return DriftReport(
        node_id=node.id,
        node_name=node.name,
        has_snapshot=True,
        drifted=bool(diff.strip()),
        diff=diff,
        imported_at=snap.imported_at,
    )
