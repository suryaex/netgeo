"""NG-SIM-04 — LACP/static LAG with hash-based member selection + STP interop.

Covers: LACP negotiation bundles members, per-flow hashing spreads distinct
flows across members while keeping one flow on one member, member failure
drains traffic onto the survivor, a dual-link LAG between two switches is
NOT STP-blocked (one logical port = no loop), and static mode works without
LACPDUs.
"""
from __future__ import annotations

from engine.netstack import Network
from engine.netstack.cli import CliSession
from engine.netstack.device import Host
from engine.netstack.lag import LagInterface
from engine.netstack.routing import Router
from engine.netstack.switching import Switch


def _router_pair(mode: str = "lacp") -> tuple[Network, Router, Router]:
    """r1 ==(2 links)== r2, bundled as po1 on both ends, /30 on the LAG."""
    net = Network(seed=31)
    r1, r2 = net.add_device(Router("r1")), net.add_device(Router("r2"))
    for r in (r1, r2):
        net.add_iface(r, "eth1")
        net.add_iface(r, "eth2")
    net.connect("l1", r1.interfaces["eth1"], r2.interfaces["eth1"])
    net.connect("l2", r1.interfaces["eth2"], r2.interfaces["eth2"])
    lag1 = r1.create_lag("po1", ["eth1", "eth2"], mode=mode)
    lag2 = r2.create_lag("po1", ["eth1", "eth2"], mode=mode)
    from engine.netstack.addr import parse_ip_interface

    lag1.ips = [parse_ip_interface("10.0.0.1/30")]
    lag2.ips = [parse_ip_interface("10.0.0.2/30")]
    r1.sync_connected_routes()
    r2.sync_connected_routes()
    return net, r1, r2


def test_lacp_bundles_members_and_traffic_flows():
    net, r1, _r2 = _router_pair()
    net.run_for(5.0)
    lag: LagInterface = r1.interfaces["po1"]  # type: ignore[assignment]
    assert [m.name for m in lag.active_members(net.now)] == ["eth1", "eth2"]
    rep = net.ping("r1", "10.0.0.2", count=3)
    assert rep.received == 3


def test_hash_spreads_flows_but_keeps_flow_affinity():
    net = Network(seed=32)
    sw = net.add_device(Switch("sw", stp_enabled=False))
    srv = net.add_device(Host("srv"))
    hosts = []
    # 8 hosts ping one server through a switch that uplinks via a 2-member LAG.
    up1, up2 = net.add_iface(sw, "up1"), net.add_iface(sw, "up2")
    s1, s2 = net.add_iface(srv, "eth1"), net.add_iface(srv, "eth2")
    net.connect("u1", up1, s1)
    net.connect("u2", up2, s2)
    sw.create_lag("po1", ["up1", "up2"])
    srv_lag = srv.create_lag("po1", ["eth1", "eth2"])
    from engine.netstack.addr import parse_ip_interface

    srv_lag.ips = [parse_ip_interface("10.1.0.100/24")]
    for n in range(8):
        h = net.add_device(Host(f"h{n}"))
        hosts.append(h)
        ih = net.add_iface(h, "eth0", [f"10.1.0.{10 + n}/24"])
        net.connect(f"lh{n}", ih, net.add_iface(sw, f"gi0/{n}"))
    net.run_for(5.0)  # LACP up
    for h in hosts:
        assert net.ping(h.name, "10.1.0.100", count=2).received == 2

    # Distinct flows should have used both members; per-flow affinity holds —
    # a flow is the (src, dst) MAC pair, and it must stick to one member.
    def flows(link: str) -> set[tuple[str, str]]:
        return {
            (r.layers["eth"]["src"], r.layers["eth"]["dst"])
            for r in net.capture.records(link, limit=2000)
            if r.direction == "tx" and "ICMP" in r.info
        }

    tx1, tx2 = flows("u1"), flows("u2")
    assert tx1 and tx2, "expected both LAG members to carry flows"
    assert not (tx1 & tx2), "a flow must stick to a single member"


def test_member_failure_drains_to_survivor():
    net, r1, _r2 = _router_pair()
    net.run_for(5.0)
    net.set_link_state("l1", False)
    net.run_for(5.0)  # LACP partner times out on the dead member
    lag: LagInterface = r1.interfaces["po1"]  # type: ignore[assignment]
    assert [m.name for m in lag.active_members(net.now)] == ["eth2"]
    rep = net.ping("r1", "10.0.0.2", count=3)
    assert rep.received == 3
    assert lag.is_up  # port-channel survives with one member


def test_static_mode_needs_no_lacp():
    net, r1, _r2 = _router_pair(mode="static")
    net.run_for(0.5)  # no negotiation needed
    lag: LagInterface = r1.interfaces["po1"]  # type: ignore[assignment]
    assert len(lag.active_members(net.now)) == 2
    assert net.ping("r1", "10.0.0.2", count=2).received == 2
    lacp = [r for r in net.capture.records(limit=2000) if "LACP" in r.info]
    assert not lacp


def test_lag_between_switches_is_not_stp_blocked():
    """Two parallel links between two switches: without LAG, STP blocks one;
    with LAG they are one logical port, so nothing blocks and both carry."""
    net = Network(seed=33)
    sw1 = net.add_device(Switch("sw1", priority=4096))
    sw2 = net.add_device(Switch("sw2", priority=8192))
    h1, h2 = net.add_device(Host("h1")), net.add_device(Host("h2"))
    for sw in (sw1, sw2):
        net.add_iface(sw, "up1")
        net.add_iface(sw, "up2")
    net.connect("t1", sw1.interfaces["up1"], sw2.interfaces["up1"])
    net.connect("t2", sw1.interfaces["up2"], sw2.interfaces["up2"])
    sw1.create_lag("po1", ["up1", "up2"])
    sw2.create_lag("po1", ["up1", "up2"])
    net.connect("lh1", net.add_iface(h1, "eth0", ["10.2.0.1/24"]),
                net.add_iface(sw1, "gi0/1"))
    net.connect("lh2", net.add_iface(h2, "eth0", ["10.2.0.2/24"]),
                net.add_iface(sw2, "gi0/1"))
    net.run_for(15.0)  # STP + LACP settle

    po1 = sw1.interfaces["po1"]
    po2 = sw2.interfaces["po1"]
    assert po1.stp_state != "blocking" and po2.stp_state != "blocking"
    assert net.ping("h1", "10.2.0.2", count=3).received == 3
    assert net.drops.get("stp_blocked") is None


def test_cli_show_etherchannel():
    net, r1, _r2 = _router_pair()
    net.run_for(5.0)
    out = CliSession(net, r1).execute("show etherchannel")
    assert "po1" in out and "eth1(P)" in out and "eth2(P)" in out


def test_lag_determinism():
    def build():
        n, _r1, _r2 = _router_pair()
        n.run_for(5.0)
        n.ping("r1", "10.0.0.2", count=2)
        return n

    a, b = build(), build()
    assert a.ledger.hash() == b.ledger.hash()
