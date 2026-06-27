"""Config generation service — the bridge to ``config-gen/``.

Turns a :class:`Node` (optionally carrying a ForgeOS *intent*) into a
vendor-specific device configuration. Two paths:

  1. **Direct vendor render** — pick the Jinja2 template for ``node.nos`` and
     render it against a normalized context built from the node + its intent.
  2. **ForgeOS compile** — when ``vendor`` differs from the node's native NOS,
     the same intent is compiled to *another* vendor's syntax. This is the
     "satu intent → banyak config vendor" promise of MASTER_SPEC §5.

Security: templates are rendered in a Jinja2 ``SandboxedEnvironment`` with
autoescape off (we emit CLI, not HTML) but attribute access locked down — see
security/hardening-guide.md §4 (SSTI mitigation).
"""
from __future__ import annotations

from pathlib import Path

from jinja2 import ChainableUndefined
from jinja2.sandbox import SandboxedEnvironment

from app.models import ConfigArtifact, ConfigFormat, Node
from app.utils.ids import new_id

# repo-root/config-gen/templates  (backend/app/services/ -> ../../../config-gen)
_CONFIGGEN_DIR = Path(__file__).resolve().parents[3] / "config-gen"
_TEMPLATE_DIR = _CONFIGGEN_DIR / "templates"

# node.nos / requested vendor -> template filename
_TEMPLATE_MAP: dict[str, str] = {
    "ios": "cisco_ios.j2",
    "iosxr": "cisco_ios.j2",
    "nxos": "cisco_ios.j2",
    "junos": "junos.j2",
    "eos": "arista_eos.j2",
    "routeros": "mikrotik_routeros.j2",
    "vyos": "vyos.j2",
    "frr": "frr.j2",
    "forgeos": "forgeos.j2",
    # Nokia SR OS — MD-CLI hierarchical flat-path syntax
    "sros": "nokia_sros.j2",
    # Huawei VRP — VRP CLI syntax
    "vrp": "huawei_vrp.j2",
}


class ConfigGenError(RuntimeError):
    """Raised when no template/strategy exists for a vendor."""


def _cidr_to_mask(cidr: str) -> str:
    """'10.0.0.1/24' or '24' -> dotted netmask '255.255.255.0'."""
    import ipaddress

    prefix = cidr.split("/")[1] if "/" in cidr else cidr
    bits = int(prefix)
    mask = (0xFFFFFFFF << (32 - bits)) & 0xFFFFFFFF
    return ".".join(str((mask >> (8 * i)) & 0xFF) for i in (3, 2, 1, 0))


def _ip_only(cidr: str) -> str:
    return cidr.split("/")[0]


def _prefixlen(cidr: str) -> str:
    return cidr.split("/")[1] if "/" in cidr else "32"


def _env() -> SandboxedEnvironment:
    from jinja2 import FileSystemLoader

    # ChainableUndefined (not StrictUndefined): ForgeOS intents are partial by
    # design — an absent optional key (e.g. neighbor.description) must render as
    # empty / falsy inside {% if %}, not raise. Deep access on a missing branch
    # also stays safe. (Finding from docs/academic verification pass.)
    env = SandboxedEnvironment(
        loader=FileSystemLoader(str(_TEMPLATE_DIR)),
        undefined=ChainableUndefined,
        trim_blocks=True,
        lstrip_blocks=True,
        autoescape=False,
    )
    env.filters["cidr_to_mask"] = _cidr_to_mask
    env.filters["ip_only"] = _ip_only
    env.filters["prefixlen"] = _prefixlen
    return env


def _context(node: Node) -> dict:
    """Normalize a node + ForgeOS intent into a flat render context.

    The intent (if present) is the high-level, vendor-neutral description; node
    fields provide the physical reality (interfaces, names). Templates read from
    this single dict so every vendor template sees the same inputs.
    """
    intent = node.intent or {}
    return {
        "hostname": node.name,
        "kind": node.kind,
        "nos": node.nos,
        "interfaces": [i.model_dump() for i in node.interfaces],
        # intent sub-trees (see config-gen/forgeos/schema.md)
        "bgp": intent.get("bgp"),
        "ospf": intent.get("ospf"),
        "isis": intent.get("isis"),
        "vrfs": intent.get("vrfs", []),
        "vlans": intent.get("vlans", []),
        "evpn": intent.get("evpn"),
        "fhrp": intent.get("fhrp"),
        "static_routes": intent.get("static_routes", []),
        "intent": intent,
    }


def vendor_for(node: Node, requested: str | None) -> str:
    return (requested or node.nos or "forgeos").lower()


def generate(node: Node) -> str:  # convenience: native vendor
    return render(node, node.nos)


def render(node: Node, vendor: str) -> str:
    """Render ``node`` to ``vendor`` CLI text."""
    vendor = vendor.lower()
    template_name = _TEMPLATE_MAP.get(vendor)
    if template_name is None:
        raise ConfigGenError(f"no template for vendor '{vendor}'")
    if not (_TEMPLATE_DIR / template_name).exists():
        raise ConfigGenError(
            f"template '{template_name}' missing under {_TEMPLATE_DIR}"
        )
    tmpl = _env().get_template(template_name)
    return tmpl.render(**_context(node)).rstrip() + "\n"


def build_artifact(node: Node, requested_vendor: str | None) -> ConfigArtifact:
    vendor = vendor_for(node, requested_vendor)
    content = render(node, vendor)
    return ConfigArtifact(
        id=new_id(),
        node_id=node.id,
        vendor=vendor,
        format=ConfigFormat.cli,
        content=content,
    )
