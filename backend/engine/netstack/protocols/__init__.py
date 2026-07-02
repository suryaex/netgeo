"""Dynamic routing protocol processes that attach to a Router."""
from engine.netstack.protocols.ospf import OspfProcess
from engine.netstack.protocols.bgp import BgpProcess

__all__ = ["OspfProcess", "BgpProcess"]
