/**
 * problemsLogic — pure derivation of the Problem Center's list from data the app
 * ALREADY fetches. No new backend, no engine: every problem is read off the
 * topology snapshot (`projectsApi.topology`) or a fiber loss budget
 * (`fiberApi.budget`) that other workspaces already consume.
 *
 * Honestly derived today:
 *  - Node health   — NodeModel.status `error` (critical) / `degraded` (warning).
 *  - Link health   — LinkModel.status `errored` (critical) / `down` (warning) /
 *                    `admin_down` (info, intentional).
 *  - Fiber budget  — LossBudget.passed === false (warning), failing checks as evidence.
 *
 * Deliberately NOT derived (would be fake or a request storm — see report):
 *  - Protocol neighbor down (OSPF/BGP): only in labApi.tables, which needs a
 *    running lab + one fetch per node. No live table => no honest signal.
 *  - Config drift: configsApi.diff is one request PER node — a storm on open.
 * Whatever we can't observe, we don't invent. A healthy project shows an empty
 * state, not dummy rows.
 */
import type { NodeModel, LinkModel, Topology } from '@/api/types';
import type { LossBudget } from '@/api/client';

export type Severity = 'critical' | 'warning' | 'info';

/** Which observed field produced the problem — shown as the category label. */
export type ProblemCategory = 'Node health' | 'Link health' | 'Fiber budget';

export interface Problem {
  id: string;
  severity: Severity;
  category: ProblemCategory;
  title: string;
  /** Affected entity name (node, link endpoints, or fiber path). */
  nodeRef: string;
  detail: string;
  /** Mono evidence block for the inspector. */
  evidence?: string;
  suggested?: string[];
  /** Present when the problem maps to a placed node — enables "Open in Topology". */
  jump?: { nodeId: string; x: number; y: number } | null;
}

export const SEVERITY_RANK: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };

export const SEVERITY_META: Record<Severity, { label: string; token: 'danger' | 'warning' | 'info' }> = {
  critical: { label: 'Critical', token: 'danger' },
  warning: { label: 'Warning', token: 'warning' },
  info: { label: 'Info', token: 'info' },
};

function nodeProblem(n: NodeModel): Problem | null {
  if (n.status !== 'error' && n.status !== 'degraded') return null;
  const critical = n.status === 'error';
  return {
    id: `node:${n.id}`,
    severity: critical ? 'critical' : 'warning',
    category: 'Node health',
    title: critical ? 'Node in error state' : 'Node degraded',
    nodeRef: n.name,
    detail: critical
      ? `${n.name} (${n.kind}, ${n.nos}) reported an error status from the engine — it is not forwarding.`
      : `${n.name} (${n.kind}, ${n.nos}) is up but reporting a degraded status.`,
    evidence: `status = ${n.status}\nkind   = ${n.kind}\nnos    = ${n.nos}`,
    suggested: critical
      ? ['Open the device console and check boot / log output.', 'Verify its config generated cleanly.', 'Restart the node from the topology.']
      : ['Inspect interface counters for errors / drops.', 'Check CPU or resource pressure on the device.'],
    jump: { nodeId: n.id, x: n.x, y: n.y },
  };
}

function linkProblem(l: LinkModel, ifaceNode: Map<string, NodeModel>): Problem | null {
  const st = l.status;
  if (st !== 'errored' && st !== 'down' && st !== 'admin_down') return null;
  const a = ifaceNode.get(l.a_iface);
  const b = ifaceNode.get(l.b_iface);
  const ref = `${a?.name ?? '?'} ↔ ${b?.name ?? '?'}`;
  const severity: Severity = st === 'errored' ? 'critical' : st === 'down' ? 'warning' : 'info';
  const title =
    st === 'errored' ? 'Link failed (physical run)' : st === 'down' ? 'Link down' : 'Link administratively down';
  const detail =
    st === 'errored'
      ? `The ${l.type} link ${ref} was brought down by a physical run — e.g. a cable over its rated maximum length.`
      : st === 'down'
        ? `The ${l.type} link ${ref} is down; traffic across it will reroute or blackhole.`
        : `The ${l.type} link ${ref} is administratively disabled.`;
  return {
    id: `link:${l.id}`,
    severity,
    category: 'Link health',
    title,
    nodeRef: ref,
    detail,
    evidence: `status    = ${st}\ntype      = ${l.type}\nbandwidth = ${l.bandwidth} Mbps\ndelay     = ${l.delay} ms`,
    suggested:
      st === 'admin_down'
        ? ['Re-enable the link if the outage is unintended.']
        : ['Check both endpoint interfaces.', 'Verify cabling / media length in the physical plant.'],
    jump: a ? { nodeId: a.id, x: a.x, y: a.y } : b ? { nodeId: b.id, x: b.x, y: b.y } : null,
  };
}

function fiberProblem(path: { id: string; name: string }, budget: LossBudget | undefined): Problem | null {
  if (!budget || budget.passed) return null;
  const reasons = budget.checks.filter((c) => !c.ok).map((c) => c.reason);
  return {
    id: `fiber:${path.id}`,
    severity: 'warning',
    category: 'Fiber budget',
    title: 'Fiber path exceeds loss budget',
    nodeRef: path.name,
    detail: `${path.name} fails its optical power budget — margin ${budget.margin_db.toFixed(1)} dB against a ${budget.budget_db.toFixed(1)} dB budget (total loss ${budget.total_loss_db.toFixed(1)} dB).`,
    evidence: [
      `total_loss = ${budget.total_loss_db.toFixed(2)} dB`,
      `budget     = ${budget.budget_db.toFixed(2)} dB`,
      `margin     = ${budget.margin_db.toFixed(2)} dB`,
      `length     = ${budget.total_length_m} m`,
      `splitters  = 1:${budget.total_split}`,
      ...(reasons.length ? ['', ...reasons.map((r) => `FAIL ${r}`)] : []),
    ].join('\n'),
    suggested: ['Reduce splitter ratio or add an amplifier.', 'Shorten the run or upgrade the fiber grade.', 'Review the failing checks in the Fiber workspace.'],
    jump: null,
  };
}

/** Build the sorted problem list from already-fetched data. Pure & synchronous. */
export function deriveProblems(
  topology: Topology | undefined,
  fiberBudgets: { path: { id: string; name: string }; budget: LossBudget | undefined }[],
): Problem[] {
  const out: Problem[] = [];
  if (topology) {
    const ifaceNode = new Map<string, NodeModel>();
    for (const n of topology.nodes) for (const i of n.interfaces) ifaceNode.set(i.id, n);
    for (const n of topology.nodes) {
      const p = nodeProblem(n);
      if (p) out.push(p);
    }
    for (const l of topology.links) {
      const p = linkProblem(l, ifaceNode);
      if (p) out.push(p);
    }
  }
  for (const { path, budget } of fiberBudgets) {
    const p = fiberProblem(path, budget);
    if (p) out.push(p);
  }
  return out.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}

export function severityCounts(problems: Problem[]): { all: number; critical: number; warning: number; info: number } {
  const c = { all: problems.length, critical: 0, warning: 0, info: 0 };
  for (const p of problems) c[p.severity]++;
  return c;
}

// Transient severity-mapping self-check (no test runner in this frontend).
// Dead-code-eliminated from the production build (import.meta.env.DEV === false).
if (import.meta.env?.DEV) {
  const mkNode = (status: NodeModel['status']) =>
    ({ id: 'x', name: 'r1', kind: 'router', nos: 'ios', status, interfaces: [], x: 0, y: 0 }) as unknown as NodeModel;
  console.assert(nodeProblem(mkNode('error'))?.severity === 'critical', 'error node → critical');
  console.assert(nodeProblem(mkNode('degraded'))?.severity === 'warning', 'degraded node → warning');
  console.assert(nodeProblem(mkNode('running')) === null, 'running node → no problem');
  console.assert(
    fiberProblem({ id: 'p', name: 'PON-1' }, {
      passed: false,
      checks: [{ ok: false, reason: 'reach' }],
      margin_db: -2,
      budget_db: 28,
      total_loss_db: 30,
      total_length_m: 1000,
      total_split: 64,
    } as LossBudget)?.severity === 'warning',
    'failed fiber budget → warning',
  );
}
