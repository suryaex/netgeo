/**
 * Digital-twin client-side derivations (NG-TW-01/02).
 *
 * The backend owns import + reachability; these helpers derive the *review*
 * surface from data the frontend already holds (nodes/links in the topology
 * store), so no dry-run endpoints are needed:
 *   - link *proposals*  — mirror `configimport.infer_links`: interfaces sharing
 *     an IPv4 subnet across different nodes, star-anchored per subnet.
 *   - validation issues — cheap, teachable lint over the twin.
 *   - stepper state     — which review stage the twin is at, from what exists.
 */
import type { Interface, LinkModel, NodeModel } from '@/api/types';

/* ------------------------------- IPv4 utils ------------------------------ */
// ponytail: IPv4-only, matching the importer (its regex parsers are IPv4).
// Add v6 here if the importer ever grows a v6 path.
function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const o = Number(p);
    if (!Number.isInteger(o) || o < 0 || o > 255) return null;
    n = n * 256 + o;
  }
  return n >>> 0;
}

/** Canonical network key ("a.b.c.d/len") for a CIDR, or null if unparseable
 *  or a /32 host route (no peer to pair — mirrors the backend). */
export function subnetOf(cidr: string): string | null {
  const [ip, lenStr] = cidr.split('/');
  const len = Number(lenStr);
  const base = ipv4ToInt(ip ?? '');
  if (base === null || !Number.isInteger(len) || len < 0 || len > 32) return null;
  if (len === 32) return null;
  const mask = len === 0 ? 0 : (0xffffffff << (32 - len)) >>> 0;
  const net = (base & mask) >>> 0;
  const octets = [net >>> 24, (net >>> 16) & 255, (net >>> 8) & 255, net & 255];
  return `${octets.join('.')}/${len}`;
}

/* ---------------------------- Link proposals ----------------------------- */
export interface LinkProposal {
  /** Stable id: sorted iface-id pair, so React keys + dismiss survive refetch. */
  id: string;
  subnet: string;
  aNode: NodeModel;
  aIface: Interface;
  bNode: NodeModel;
  bIface: Interface;
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Interfaces sharing an IPv4 subnet across different nodes → proposed links.
 * Star-anchored to the first interface in each subnet (same shape the bulk
 * `infer-links` endpoint produces), and skips pairs already linked.
 */
export function deriveProposals(nodes: NodeModel[], links: LinkModel[]): LinkProposal[] {
  const linked = new Set(links.map((l) => pairKey(l.a_iface, l.b_iface)));

  type Member = { node: NodeModel; iface: Interface };
  const groups = new Map<string, Member[]>();
  for (const node of nodes) {
    for (const iface of node.interfaces) {
      for (const cidr of iface.ip) {
        const subnet = subnetOf(cidr);
        if (!subnet) continue;
        const bucket = groups.get(subnet);
        if (bucket) bucket.push({ node, iface });
        else groups.set(subnet, [{ node, iface }]);
      }
    }
  }

  const proposals: LinkProposal[] = [];
  const seen = new Set<string>();
  for (const [subnet, members] of groups) {
    const anchor = members[0]!;
    for (const m of members.slice(1)) {
      if (m.node.id === anchor.node.id) continue; // same device, different iface
      const key = pairKey(anchor.iface.id, m.iface.id);
      if (linked.has(key) || seen.has(key)) continue;
      seen.add(key);
      proposals.push({
        id: key,
        subnet,
        aNode: anchor.node,
        aIface: anchor.iface,
        bNode: m.node,
        bIface: m.iface,
      });
    }
  }
  return proposals;
}

/* --------------------------- Validation issues --------------------------- */
export type IssueSeverity = 'warning' | 'error';
export interface ValidationIssue {
  id: string;
  severity: IssueSeverity;
  message: string;
}

/** True when the node came in via config import (intent.imported). */
export function isImported(node: NodeModel): boolean {
  return Boolean(node.intent && (node.intent as { imported?: boolean }).imported);
}

/**
 * Cheap lint over the twin: interfaces with no IP, and imported devices with no
 * links yet. Deliberately conservative — false positives erode trust.
 */
export function deriveValidationIssues(nodes: NodeModel[], links: LinkModel[]): ValidationIssue[] {
  const wiredNodes = new Set<string>();
  const ifaceOwner = new Map<string, string>();
  for (const n of nodes) for (const i of n.interfaces) ifaceOwner.set(i.id, n.id);
  for (const l of links) {
    const a = ifaceOwner.get(l.a_iface);
    const b = ifaceOwner.get(l.b_iface);
    if (a) wiredNodes.add(a);
    if (b) wiredNodes.add(b);
  }

  const issues: ValidationIssue[] = [];
  for (const n of nodes) {
    for (const i of n.interfaces) {
      if (i.ip.length === 0) {
        issues.push({
          id: `noip:${i.id}`,
          severity: 'warning',
          message: `${n.name}: interface ${i.name} has no IP`,
        });
      }
    }
    if (isImported(n) && n.interfaces.length > 0 && !wiredNodes.has(n.id)) {
      issues.push({
        id: `nolink:${n.id}`,
        severity: 'warning',
        message: `${n.name}: no links — infer or connect it`,
      });
    }
  }
  return issues;
}

/* ------------------------------- Stepper --------------------------------- */
export const TWIN_STEPS = [
  'Import Configs',
  'Parse',
  'Review Devices',
  'Infer Links',
  'Validate',
  'Create Twin',
] as const;
export type TwinStep = (typeof TWIN_STEPS)[number];

/**
 * Current stage index, derived from what exists (not a rigid wizard):
 *   no imported devices              → Import Configs
 *   devices but unresolved proposals → Infer Links
 *   links present, issues remain     → Validate
 *   links present, clean             → Create Twin
 */
export function deriveStepIndex(
  nodes: NodeModel[],
  links: LinkModel[],
  openProposals: number,
  issues: number,
): number {
  const imported = nodes.filter(isImported);
  if (imported.length === 0) return 0; // Import Configs
  if (links.length === 0 || openProposals > 0) return 3; // Infer Links
  if (issues > 0) return 4; // Validate
  return 5; // Create Twin
}
