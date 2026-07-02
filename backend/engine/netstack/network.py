"""The Network — one runnable packet-level lab.

Owns the DES scheduler, the seeded RNG, packet capture, all devices and link
attachments, plus the application-level session tracking for ping and
traceroute. Deterministic: the same topology + seed always produces the same
event sequence (replay = rebuild + rerun).
"""
from __future__ import annotations

import random
from dataclasses import dataclass, field
from ipaddress import IPv4Address
from typing import Optional

from engine.events import EventType, SimEvent
from engine.netstack.addr import mac_from_int
from engine.netstack.capture import CaptureManager
from engine.netstack.device import Device, Host
from engine.netstack.frames import DnsMessage, IcmpMessage, Ipv4Packet
from engine.netstack.iface import Interface, LinkAttachment
from engine.netstack.routing import Router
from engine.netstack.switching import Switch
from engine.scheduler import Scheduler


@dataclass(slots=True)
class PingReport:
    ident: int
    src: str
    dst: str
    sent: int = 0
    received: int = 0
    errors: list[str] = field(default_factory=list)
    rtts_ms: list[float] = field(default_factory=list)
    _sent_at: dict[int, float] = field(default_factory=dict)
    done: bool = False

    @property
    def loss_pct(self) -> float:
        if self.sent == 0:
            return 0.0
        return round(100.0 * (self.sent - self.received) / self.sent, 1)

    def as_dict(self) -> dict:
        rtts = self.rtts_ms
        return {
            "src": self.src,
            "dst": self.dst,
            "sent": self.sent,
            "received": self.received,
            "loss_pct": self.loss_pct,
            "rtts_ms": [round(r, 3) for r in rtts],
            "min_ms": round(min(rtts), 3) if rtts else None,
            "avg_ms": round(sum(rtts) / len(rtts), 3) if rtts else None,
            "max_ms": round(max(rtts), 3) if rtts else None,
            "errors": self.errors,
        }


@dataclass(slots=True)
class TracerouteReport:
    ident: int
    src: str
    dst: str
    max_hops: int = 16
    # hop number -> (address, rtt_ms) — filled as replies arrive
    hops: dict[int, tuple[str, float]] = field(default_factory=dict)
    _sent_at: dict[int, float] = field(default_factory=dict)
    reached: bool = False

    def as_dict(self) -> dict:
        rows = []
        last = max(self.hops) if self.hops else 0
        for ttl in range(1, last + 1):
            hop = self.hops.get(ttl)
            rows.append(
                {
                    "hop": ttl,
                    "address": hop[0] if hop else None,
                    "rtt_ms": round(hop[1], 3) if hop else None,
                }
            )
        return {"src": self.src, "dst": self.dst, "reached": self.reached, "hops": rows}


class Network:
    """A built lab: devices + links + the kernel to run them."""

    def __init__(self, seed: int = 0) -> None:
        self.seed = seed
        self.rng = random.Random(seed)
        self.scheduler = Scheduler(context=self)
        self.capture = CaptureManager()
        self.devices: dict[str, Device] = {}          # by name
        self.devices_by_id: dict[str, Device] = {}    # by node id
        self.attachments: dict[str, LinkAttachment] = {}
        self.drops: dict[str, int] = {}
        self._mac_counter = 0
        self._xid_counter = 0
        self._ping_ident = 0
        self.pings: dict[int, PingReport] = {}
        self.traceroutes: dict[int, TracerouteReport] = {}
        self.events_log: list[dict] = []               # notable control events
        self._started = False

    # ----- time ------------------------------------------------------------
    @property
    def now(self) -> float:
        return self.scheduler.now

    # ----- construction -------------------------------------------------------
    def add_device(self, device: Device) -> Device:
        self.devices[device.name] = device
        self.devices_by_id[device.node_id] = device
        return device

    def new_mac(self):
        self._mac_counter += 1
        return mac_from_int(self._mac_counter)

    def add_iface(self, device: Device, name: str, ips: list[str] | None = None) -> Interface:
        from engine.netstack.addr import parse_ip_interface

        iface = Interface(
            name=name,
            device=device,
            mac=self.new_mac(),
            ips=[parse_ip_interface(i) for i in (ips or [])],
        )
        return device.add_interface(iface)

    def connect(
        self,
        link_id: str,
        a: Interface,
        b: Interface,
        bandwidth_bps: float = 1_000_000_000.0,
        delay: float = 0.000_1,
        jitter: float = 0.0,
        loss: float = 0.0,
        mtu: int = 1500,
        up: bool = True,
        kind: str = "copper",
    ) -> LinkAttachment:
        att = LinkAttachment(
            id=link_id,
            a=a,
            b=b,
            bandwidth_bps=bandwidth_bps,
            delay=delay,
            jitter=jitter,
            loss=loss,
            mtu=mtu,
            up=up,
            kind=kind,
        )
        self.attachments[link_id] = att
        return att

    def find_device(self, ref: str) -> Optional[Device]:
        return self.devices.get(ref) or self.devices_by_id.get(ref)

    # ----- lifecycle -----------------------------------------------------------
    def start(self) -> None:
        """Sync derived state and kick off periodic protocol machinery."""
        if self._started:
            return
        self._started = True
        for device in self.devices.values():
            if isinstance(device, Router):
                device.sync_connected_routes()
        for device in self.devices.values():
            if isinstance(device, Switch):
                device.start(self)
            if isinstance(device, Router):
                for proc in device.processes:
                    proc.start(self)

    def run(self, until: float | None = None, max_events: int | None = 500_000) -> int:
        """Drain events synchronously. Returns events dispatched."""
        self.start()
        return self.scheduler.run(until=until, max_events=max_events)

    def run_for(self, duration: float, max_events: int | None = 500_000) -> int:
        return self.run(until=self.now + duration, max_events=max_events)

    # ----- link/node operations (fault injection) ---------------------------------
    def set_link_state(self, link_id: str, up: bool) -> None:
        att = self.attachments.get(link_id)
        if att is not None:
            att.up = up
            self.log_event("link.up" if up else "link.down", link=link_id)

    def set_device_power(self, ref: str, on: bool) -> None:
        dev = self.find_device(ref)
        if dev is not None:
            dev.powered_on = on
            self.log_event("device.up" if on else "device.down", device=dev.name)

    # ----- accounting ----------------------------------------------------------------
    def record_drop(self, reason: str) -> None:
        self.drops[reason] = self.drops.get(reason, 0) + 1

    def log_event(self, kind: str, **data) -> None:
        self.events_log.append({"t": round(self.now, 9), "event": kind, **data})

    def next_xid(self) -> int:
        self._xid_counter += 1
        return self._xid_counter

    # ----- ping sessions ----------------------------------------------------------------
    def new_ping_session(self, src: Device, dst: IPv4Address, count: int) -> int:
        self._ping_ident += 1
        self.pings[self._ping_ident] = PingReport(
            ident=self._ping_ident, src=src.name, dst=str(dst)
        )
        return self._ping_ident

    def ping_sent(self, ident: int, seq: int) -> None:
        rep = self.pings.get(ident)
        if rep is not None:
            rep.sent += 1
            rep._sent_at[seq] = self.now
            return
        tr = self.traceroutes.get(ident)
        if tr is not None:
            tr._sent_at[seq] = self.now

    def ping_reply_received(self, device: Device, pkt: Ipv4Packet, icmp: IcmpMessage) -> None:
        rep = self.pings.get(icmp.ident)
        if rep is not None:
            sent_at = rep._sent_at.get(icmp.seq)
            if sent_at is not None:
                rep.received += 1
                rep.rtts_ms.append((self.now - sent_at) * 1000.0)
                if rep.received + len(rep.errors) >= rep.sent:
                    rep.done = True
            return
        tr = self.traceroutes.get(icmp.ident)
        if tr is not None:
            sent_at = tr._sent_at.get(icmp.seq)
            if sent_at is not None:
                tr.hops[icmp.seq] = (str(pkt.src), (self.now - sent_at) * 1000.0)
                tr.reached = True

    def on_icmp(self, device: Device, pkt: Ipv4Packet, icmp: IcmpMessage) -> None:
        """ICMP errors (time-exceeded / unreachable) delivered to a device."""
        if icmp.type == 11:
            tr = self.traceroutes.get(icmp.orig_ident)
            if tr is not None:
                sent_at = tr._sent_at.get(icmp.orig_seq)
                if sent_at is not None:
                    tr.hops[icmp.orig_seq] = (
                        str(pkt.src),
                        (self.now - sent_at) * 1000.0,
                    )
                return
        rep = self.pings.get(icmp.orig_ident)
        if rep is not None:
            kind = "time-exceeded" if icmp.type == 11 else f"unreachable(code={icmp.code})"
            rep.errors.append(f"{kind} from {pkt.src}")
            if rep.received + len(rep.errors) >= rep.sent:
                rep.done = True

    # ----- service callbacks (observability hooks) -----------------------------------------
    def on_dhcp_bound(self, host: Host, iface: Interface, prefix) -> None:
        self.log_event(
            "dhcp.bound", device=host.name, iface=iface.name, address=str(prefix)
        )

    def on_dns_response(self, host: Host, msg: DnsMessage) -> None:
        self.log_event(
            "dns.answer", device=host.name, qname=msg.qname, answer=msg.answer
        )

    # ----- applications ------------------------------------------------------------------------
    def ping(
        self,
        src_ref: str,
        dst_ip: str | IPv4Address,
        count: int = 4,
        interval: float = 1.0,
        run_after: bool = True,
        settle: float = 0.0,
    ) -> PingReport:
        """Convenience: ping from a device and (optionally) run the sim until done."""
        dev = self.find_device(src_ref)
        if dev is None or not isinstance(dev, (Host, Router)):
            raise ValueError(f"unknown or non-IP device: {src_ref}")
        self.start()
        if settle > 0:
            self.run_for(settle)
        ident = _pingable(dev).ping(self, IPv4Address(dst_ip), count=count, interval=interval)
        if run_after:
            self.run_for(count * interval + 5.0)
        return self.pings[ident]

    def traceroute(
        self,
        src_ref: str,
        dst_ip: str | IPv4Address,
        max_hops: int = 16,
        run_after: bool = True,
        settle: float = 0.0,
    ) -> TracerouteReport:
        dev = self.find_device(src_ref)
        if dev is None or not isinstance(dev, (Host, Router)):
            raise ValueError(f"unknown or non-IP device: {src_ref}")
        self.start()
        if settle > 0:
            self.run_for(settle)
        dst = IPv4Address(dst_ip)
        self._ping_ident += 1
        ident = self._ping_ident
        tr = TracerouteReport(ident=ident, src=dev.name, dst=str(dst), max_hops=max_hops)
        self.traceroutes[ident] = tr
        pinger = _pingable(dev)
        for ttl in range(1, max_hops + 1):
            self.scheduler.schedule_after(
                (ttl - 1) * 0.2,
                SimEvent(
                    time=0.0,
                    type=EventType.TIMER,
                    handler=lambda _c, _e, t=ttl: pinger._send_echo(
                        self, dst, ident, t, 36, t
                    ),
                    node_id=dev.node_id,
                ),
            )
        if run_after:
            self.run_for(max_hops * 0.2 + 5.0)
            # Trim hops after the destination was reached.
            reached_at = min(
                (ttl for ttl, (addr, _r) in tr.hops.items() if addr == str(dst)),
                default=None,
            )
            if reached_at is not None:
                tr.reached = True
                tr.hops = {t: h for t, h in tr.hops.items() if t <= reached_at}
        return tr

    # ----- reporting -------------------------------------------------------------------------------
    def stats(self) -> dict:
        return {
            "devices": len(self.devices),
            "links": len(self.attachments),
            "sim_time": round(self.now, 6),
            "events_dispatched": self.scheduler.dispatched,
            "drops": dict(self.drops),
            "captured_frames": self.capture.total_records,
        }


def _pingable(dev: Device) -> Host:
    """Routers can ping too — they share the Host echo machinery via duck typing."""
    if isinstance(dev, Host):
        return dev
    # Graft the minimal echo-sender onto routers: reuse Host methods unbound.
    if not hasattr(dev, "_send_echo"):
        import types

        dev._send_echo = types.MethodType(Host._send_echo, dev)  # type: ignore[attr-defined]
        dev.ping = types.MethodType(Host.ping, dev)              # type: ignore[attr-defined]
    return dev  # type: ignore[return-value]
