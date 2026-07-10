/**
 * parseLedgerInfo — derive design-spec ledger columns (Layer / Proto / Source /
 * Destination / Result) from the engine's free-text `info` string, purely on
 * the client. The backend emits `info = EthernetFrame.summary()`:
 *
 *   "<src_mac> > <dst_mac>[ vlan=N] | <inner-summary>"
 *
 * where <inner-summary> is one of:
 *   IPv4 <src> -> <dst> ttl=N  <upper>      (upper: TCP/UDP/ICMP/OSPF/VRRPv3/…)
 *   IPv6 <src> -> <dst> hlim=N <upper>
 *   ARP who-has <ip> tell <ip> | ARP <ip> is-at <mac>
 *   STP BPDU … | LACP … | IS-IS … | LDP … | MPLS [stack] | <inner-ip>
 *
 * ponytail: heuristic string parse — deliberately no grammar, just the shapes
 * the engine actually produces (backend/engine/netstack/frames.py summaries).
 * Upgrade path: have the ledger expose structured fields (layer/proto/src/dst)
 * in `ledger_fields()` and delete this parser. Unknown shapes → em-dash columns.
 */

export interface LedgerCols {
  layer: string; // "L2" | "L3" | "—"
  proto: string; // ARP | TCP | UDP | ICMP | OSPF | STP | MPLS | … | "—"
  source: string; // IP or MAC | "—"
  destination: string; // IP or MAC | "—"
  result: 'OK' | 'FAILED' | '—';
}

const DASH = '—';
const EMPTY: LedgerCols = { layer: DASH, proto: DASH, source: DASH, destination: DASH, result: DASH };

/** Top-level L2 control frames (ride raw Ethernet, no IP header). */
const L2_HEAD = /^(ARP|STP|LACP|IS-IS|LDP)\b/;
/** IPv4/IPv6 header: capture src, dst, and the remainder after ttl=/hlim=. */
const IP_HEAD = /^IPv([46]) (\S+) -> (\S+) (?:ttl|hlim)=\d+\s*(.*)$/;
/** A failure worth flagging red — matches the words the summaries actually use. */
const FAIL = /\b(drop|dropped|fail|failed|unreachable|time-exceeded|timeout|denied|no route|nak|nxdomain)\b/i;

/** First protocol token of an L3 payload tail, normalized. "" → em-dash. */
function protoFromTail(tail: string): string {
  const first = tail.trim().split(/\s+/)[0] ?? '';
  if (!first) return DASH;
  if (first.startsWith('proto=')) return first.slice(6) || DASH; // unknown next-header
  return first;
}

/** Parse the L3 body shared by plain IP and MPLS-wrapped IP. */
function parseIp(body: string): LedgerCols | null {
  const m = IP_HEAD.exec(body);
  if (!m) return null;
  return {
    layer: 'L3',
    proto: protoFromTail(m[4] ?? ''),
    source: m[2] ?? DASH,
    destination: m[3] ?? DASH,
    result: FAIL.test(body) ? 'FAILED' : 'OK',
  };
}

export function parseLedgerInfo(info: string | undefined | null): LedgerCols {
  if (!info || !info.trim()) return EMPTY;

  // Split off the Ethernet header at the FIRST " | " (MPLS inner may add more).
  const pipe = info.indexOf(' | ');
  const eth = pipe >= 0 ? info.slice(0, pipe) : '';
  const body = pipe >= 0 ? info.slice(pipe + 3) : info;
  const macs = /^(\S+) > (\S+)/.exec(eth); // src_mac, dst_mac fallbacks
  const result: 'OK' | 'FAILED' = FAIL.test(info) ? 'FAILED' : 'OK';

  // L3: IPv4 / IPv6 — richest case, gives real src/dst IPs + upper proto.
  const ip = parseIp(body);
  if (ip) return ip;

  // MPLS label-switched: proto MPLS, but dig out the inner IP endpoints if any.
  if (body.startsWith('MPLS')) {
    const inner = parseIp(body.slice(body.indexOf('|') + 1).trim());
    return {
      layer: 'L3',
      proto: 'MPLS',
      source: inner?.source ?? macs?.[1] ?? DASH,
      destination: inner?.destination ?? macs?.[2] ?? DASH,
      result,
    };
  }

  // L2 control frames.
  const l2 = L2_HEAD.exec(body);
  if (l2) {
    const proto = l2[1] ?? DASH;
    let source = macs?.[1] ?? DASH;
    let destination = macs?.[2] ?? DASH;
    // ARP carries clearer L3 endpoints than the MACs — prefer them.
    const who = /^ARP who-has (\S+) tell (\S+)/.exec(body);
    const isAt = /^ARP (\S+) is-at/.exec(body);
    if (who) {
      source = who[2] ?? source;
      destination = who[1] ?? destination;
    } else if (isAt) {
      source = isAt[1] ?? source;
    }
    return { layer: 'L2', proto, source, destination, result };
  }

  // Known Ethernet header but an unrecognized body → at least show the MACs.
  if (macs) return { layer: 'L2', proto: DASH, source: macs[1] ?? DASH, destination: macs[2] ?? DASH, result };
  return EMPTY;
}

/**
 * ponytail self-check (no test runner in this project). Runnable on demand:
 *   npx esbuild src/lib/parseLedgerInfo.ts --bundle --format=esm | node --input-type=module -e "..."
 * Tree-shaken from the browser bundle (unused export). Throws on regression.
 */
export function _demoParseLedgerInfo(): void {
  const eq = (got: LedgerCols, want: Partial<LedgerCols>, label: string) => {
    for (const k of Object.keys(want) as (keyof LedgerCols)[]) {
      if (got[k] !== want[k]) throw new Error(`${label}: ${k} = ${got[k]!}, want ${want[k]!}`);
    }
  };
  eq(
    parseLedgerInfo('aa:bb:cc:00:00:01 > 01:00:5e:00:00:05 | IPv4 10.0.1.1 -> 224.0.0.5 ttl=1 OSPF Hello rid=1.1.1.1 area=0 seen=2'),
    { layer: 'L3', proto: 'OSPF', source: '10.0.1.1', destination: '224.0.0.5', result: 'OK' },
    'ospf-hello',
  );
  eq(
    parseLedgerInfo('aa:bb:cc:00:00:02 > ff:ff:ff:ff:ff:ff | ARP who-has 10.0.1.2 tell 10.0.1.1'),
    { layer: 'L2', proto: 'ARP', source: '10.0.1.1', destination: '10.0.1.2', result: 'OK' },
    'arp-request',
  );
  eq(
    parseLedgerInfo('aa:bb:cc:00:00:03 > aa:bb:cc:00:00:04 | IPv4 10.0.2.5 -> 10.0.3.9 ttl=64 ICMP time-exceeded code=0'),
    { layer: 'L3', proto: 'ICMP', source: '10.0.2.5', destination: '10.0.3.9', result: 'FAILED' },
    'icmp-ttl-exceeded',
  );
  eq(
    parseLedgerInfo('aa:bb:cc:00:00:05 > aa:bb:cc:00:00:06 | IPv4 10.0.1.10 -> 10.0.2.20 ttl=64 TCP 179->51000 [PSH] BGP UPDATE 3 route(s)'),
    { layer: 'L3', proto: 'TCP', source: '10.0.1.10', destination: '10.0.2.20', result: 'OK' },
    'bgp-over-tcp',
  );
  eq(parseLedgerInfo(''), { layer: DASH, proto: DASH, result: DASH }, 'empty');
}
