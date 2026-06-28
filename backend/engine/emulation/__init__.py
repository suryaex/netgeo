"""Emulation adaptor layer — accurate NOS nodes backed by real containers.

For nodes in ``mode="emul"`` NetGeo runs an actual network OS image inside a
container (via containerlab / Docker / Podman). The DES kernel still owns the
*virtual clock and link model*; the adaptor owns the *node internals*. The two
meet at the link boundary: packets leaving a sim node toward an emul node are
injected into the container's veth, and vice-versa.

This package defines the abstraction (:class:`EmulationAdaptor`) plus a
:class:`NullEmulationAdaptor` no-op used when emulation is unavailable (CI, or
a pure-sim run). Concrete backends (containerlab) are added later behind the
same ABC so the engine never imports Docker directly.
"""
from __future__ import annotations

from engine.emulation.adaptor import (
    EmulationAdaptor,
    EmulationStatus,
    NullEmulationAdaptor,
)

__all__ = ["EmulationAdaptor", "EmulationStatus", "NullEmulationAdaptor"]
