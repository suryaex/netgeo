"""Dynamic routing protocol processes that attach to a Router."""
from engine.netstack.protocols.ospf import OspfProcess
from engine.netstack.protocols.bgp import BgpProcess
from engine.netstack.protocols.isis import IsisProcess
from engine.netstack.protocols.mpls import LdpProcess, L3vpnProcess

__all__ = ["OspfProcess", "BgpProcess", "IsisProcess", "LdpProcess", "L3vpnProcess"]
