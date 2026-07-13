/**
 * ProblemsWorkspace — the Problem Center (v1.2.031, clay design). A dense table
 * of everything wrong with the active project, derived CLIENT-SIDE from data the
 * app already fetches (see problemsLogic.ts) — NO new backend. A 360px inspector
 * on the right details the selected problem and jumps to it in the topology.
 *
 * Data sources reused:
 *  - `projectsApi.topology(id)` (shared ['topology', id]) → node + link health.
 *  - `fiberApi.list` + `fiberApi.budget` (per path, on open) → loss-budget fails.
 *
 * "Acknowledge" is client-only state (localStorage per project) — honestly
 * labelled: acked rows drop to the bottom with a badge. There is no server ack.
 */
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueries } from '@tanstack/react-query';
import { ShieldAlert, TriangleAlert, Info, Search, Network as NetworkIcon, CircleCheck } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { projectsApi, fiberApi } from '@/api/client';
import { useUiStore } from '@/store/uiStore';
import { useTopologyStore } from '@/store/topologyStore';
import { useTopoUiStore } from '@/store/topoUiStore';
import { WorkspaceEmptyState } from '@/components/shell/WorkspaceEmptyState';
import { cn } from '@/lib/cn';
import {
  deriveProblems,
  severityCounts,
  SEVERITY_META,
  SEVERITY_RANK,
  type Problem,
  type Severity,
} from './problemsLogic';

type Filter = 'all' | Severity;

const SEV_ICON: Record<Severity, LucideIcon> = {
  critical: ShieldAlert,
  warning: TriangleAlert,
  info: Info,
};

/** Token → tailwind text/border/bg classes. Kept literal so Tailwind sees them. */
const SEV_CLS: Record<Severity, { text: string; bar: string; softBg: string; softBorder: string }> = {
  critical: { text: 'text-danger', bar: 'bg-danger', softBg: 'bg-danger/10', softBorder: 'border-danger/30' },
  warning: { text: 'text-warning', bar: 'bg-warning', softBg: 'bg-warning/10', softBorder: 'border-warning/30' },
  info: { text: 'text-info', bar: 'bg-info', softBg: 'bg-info/10', softBorder: 'border-info/30' },
};

function relTime(from: number): string {
  if (!from) return '—';
  const s = Math.max(0, Math.round((Date.now() - from) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return `${h}h ago`;
}

const ackKey = (projectId: string) => `netgeo.problems.ack.${projectId}`;

function loadAcked(projectId: string): Set<string> {
  try {
    const raw = localStorage.getItem(ackKey(projectId));
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

export function ProblemsWorkspace() {
  const projectId = useUiStore((s) => s.projectId);
  const setViewMode = useUiStore((s) => s.setViewMode);
  const select = useTopologyStore((s) => s.select);
  const centerOn = useTopoUiStore((s) => s.centerOn);

  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [acked, setAcked] = useState<Set<string>>(() => (projectId ? loadAcked(projectId) : new Set()));

  // Reload ack set when the active project changes.
  useEffect(() => {
    setAcked(projectId ? loadAcked(projectId) : new Set());
  }, [projectId]);

  const topoQ = useQuery({
    queryKey: ['topology', projectId],
    queryFn: () => projectsApi.topology(projectId!),
    enabled: !!projectId,
    staleTime: 30_000,
  });

  const fiberListQ = useQuery({
    queryKey: ['fiber-paths', projectId],
    queryFn: () => fiberApi.list(projectId!),
    enabled: !!projectId,
    staleTime: 60_000,
  });
  const paths = fiberListQ.data ?? [];

  // One budget request per path, in parallel — only while the workspace is open.
  const budgetQs = useQueries({
    queries: paths.map((p) => ({
      queryKey: ['fiber-budget', p.id],
      queryFn: () => fiberApi.budget(p.id),
      enabled: !!projectId,
      staleTime: 60_000,
    })),
  });

  const fiberBudgets = useMemo(
    () => paths.map((p, i) => ({ path: { id: p.id, name: p.name }, budget: budgetQs[i]?.data })),
    // budgetQs identity changes each render; key on the resolved data instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [paths, budgetQs.map((q) => q.data).join('|')],
  );

  const problems = useMemo(() => deriveProblems(topoQ.data, fiberBudgets), [topoQ.data, fiberBudgets]);
  const counts = useMemo(() => severityCounts(problems), [problems]);
  const observedAt = topoQ.dataUpdatedAt;

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return problems
      .filter((p) => (filter === 'all' ? true : p.severity === filter))
      .filter((p) =>
        q ? p.title.toLowerCase().includes(q) || p.nodeRef.toLowerCase().includes(q) || p.detail.toLowerCase().includes(q) : true,
      )
      .sort((a, b) => {
        const ackA = acked.has(a.id) ? 1 : 0;
        const ackB = acked.has(b.id) ? 1 : 0;
        if (ackA !== ackB) return ackA - ackB; // acknowledged sink to the bottom
        return SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
      });
  }, [problems, filter, search, acked]);

  const selected = problems.find((p) => p.id === selectedId) ?? visible[0] ?? null;

  const persistAck = (next: Set<string>) => {
    setAcked(next);
    if (projectId) localStorage.setItem(ackKey(projectId), JSON.stringify([...next]));
  };
  const ackOne = (id: string) => persistAck(new Set(acked).add(id));
  const ackAll = () => persistAck(new Set([...acked, ...problems.map((p) => p.id)]));

  const openInTopology = (p: Problem) => {
    if (!p.jump) return;
    select({ nodeId: p.jump.nodeId });
    setViewMode('topology');
    centerOn?.(p.jump.x, p.jump.y);
  };

  if (!projectId) {
    return (
      <div className="absolute inset-0 bg-surface">
        <WorkspaceEmptyState
          icon={TriangleAlert}
          title="No project open"
          hint="Open a project from the Projects portal to see its health problems."
        />
      </div>
    );
  }

  const loading = topoQ.isLoading || fiberListQ.isLoading;

  return (
    <div className="absolute inset-0 flex bg-surface">
      {/* Left: header + filters + table */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header */}
        <div className="flex shrink-0 flex-col gap-4 border-b border-fg/10 bg-panel px-6 pb-3 pt-5">
          <div className="flex items-end justify-between gap-4">
            <h1 className="text-2xl font-semibold tracking-tight text-fg">Problems</h1>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 rounded-lg border border-fg/10 bg-recess/30 px-2.5 py-1.5">
                <Search className="h-4 w-4 text-fg/40" aria-hidden />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search nodes, problems…"
                  aria-label="Search problems"
                  className="w-56 bg-transparent text-sm text-fg/85 placeholder:text-fg/35 focus:outline-none"
                />
              </label>
              <button
                onClick={ackAll}
                disabled={problems.length === 0}
                className="rounded-lg border border-fg/10 px-4 py-1.5 text-sm font-medium text-fg/85 transition-colors hover:bg-fg/5 disabled:opacity-40"
              >
                Acknowledge all
              </button>
            </div>
          </div>

          {/* Filter chips — icon + label + count, never colour-only */}
          <div className="flex items-center gap-2" role="tablist" aria-label="Severity filter">
            <FilterChip active={filter === 'all'} onClick={() => setFilter('all')} label="All" count={counts.all} />
            <FilterChip active={filter === 'critical'} onClick={() => setFilter('critical')} label="Critical" count={counts.critical} severity="critical" />
            <FilterChip active={filter === 'warning'} onClick={() => setFilter('warning')} label="Warning" count={counts.warning} severity="warning" />
            <FilterChip active={filter === 'info'} onClick={() => setFilter('info')} label="Info" count={counts.info} severity="info" />
          </div>
        </div>

        {/* Table */}
        <div className="ng-scroll min-h-0 flex-1 overflow-auto p-6">
          {loading ? (
            <p className="p-4 text-sm text-fg/40">Scanning project health…</p>
          ) : problems.length === 0 ? (
            <div className="grid h-full place-items-center text-center">
              <div className="max-w-sm space-y-2">
                <CircleCheck className="mx-auto h-9 w-9 text-success" aria-hidden />
                <p className="text-sm text-fg/70">No problems detected</p>
                <p className="text-xs leading-relaxed text-fg/40">
                  Checked node status, link status, and fiber loss budgets across this project. Nothing is degraded,
                  down, or over budget.
                </p>
              </div>
            </div>
          ) : visible.length === 0 ? (
            <p className="p-4 text-sm text-fg/40">No problem matches this filter.</p>
          ) : (
            <div className="overflow-hidden rounded-lg border border-fg/10 bg-panel">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-fg/10 bg-recess/30 text-[12px] text-fg/50">
                    <th className="w-12 px-4 py-2 font-normal">
                      <span className="sr-only">Severity</span>
                    </th>
                    <th className="px-4 py-2 font-normal">Problem</th>
                    <th className="px-4 py-2 font-normal">Affected node</th>
                    <th className="px-4 py-2 font-normal">Detected</th>
                    <th className="px-4 py-2 font-normal">Status</th>
                  </tr>
                </thead>
                <tbody className="font-mono text-[13px]">
                  {visible.map((p) => {
                    const Icon = SEV_ICON[p.severity];
                    const cls = SEV_CLS[p.severity];
                    const isAck = acked.has(p.id);
                    const isSel = selected?.id === p.id;
                    return (
                      <tr
                        key={p.id}
                        onClick={() => setSelectedId(p.id)}
                        aria-selected={isSel}
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setSelectedId(p.id);
                          }
                        }}
                        className={cn(
                          'relative cursor-pointer border-b border-fg/10 transition-colors focus:outline-none focus:ring-1 focus:ring-inset focus:ring-accent',
                          isSel ? 'bg-fg/8' : 'hover:bg-fg/5',
                          isAck && 'opacity-60',
                        )}
                      >
                        {isSel && <td className="absolute inset-y-0 left-0 w-1 p-0"><span className={cn('block h-full w-full', cls.bar)} aria-hidden /></td>}
                        <td className="px-4 py-2.5">
                          <Icon className={cn('h-[18px] w-[18px]', cls.text)} aria-hidden />
                          <span className="sr-only">{SEVERITY_META[p.severity].label}</span>
                        </td>
                        <td className="px-4 py-2.5 font-sans text-fg">{p.title}</td>
                        <td className="px-4 py-2.5 text-fg/60">{p.nodeRef}</td>
                        <td className="px-4 py-2.5 text-fg/45">{relTime(observedAt)}</td>
                        <td className="px-4 py-2.5">
                          {isAck ? (
                            <span className="text-[11px] text-fg/45">Acknowledged</span>
                          ) : (
                            <span className="inline-flex items-center rounded border border-fg/15 bg-recess/40 px-2 py-0.5 text-[11px] text-fg/75">
                              Open
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Right: inspector */}
      <aside className="flex w-[360px] shrink-0 flex-col border-l border-fg/10 bg-panel">
        {selected ? (
          <Inspector
            key={selected.id}
            problem={selected}
            acked={acked.has(selected.id)}
            onAck={() => ackOne(selected.id)}
            onOpenTopology={() => openInTopology(selected)}
          />
        ) : (
          <div className="grid h-full place-items-center p-6 text-center text-xs text-fg/40">
            Select a problem to inspect it.
          </div>
        )}
      </aside>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  label,
  count,
  severity,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  severity?: Severity;
}) {
  const Icon = severity ? SEV_ICON[severity] : null;
  const cls = severity ? SEV_CLS[severity] : null;
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'flex items-center gap-2 rounded-full border px-3 py-1 text-sm transition-colors',
        active ? 'border-accent bg-accent/10 text-fg' : 'border-fg/10 text-fg/60 hover:bg-fg/5',
      )}
    >
      {Icon && cls && <Icon className={cn('h-4 w-4', cls.text)} aria-hidden />}
      <span>{label}</span>
      <span className="rounded-sm bg-fg/10 px-1.5 text-[11px] tabular-nums text-fg/70">{count}</span>
    </button>
  );
}

function Inspector({
  problem,
  acked,
  onAck,
  onOpenTopology,
}: {
  problem: Problem;
  acked: boolean;
  onAck: () => void;
  onOpenTopology: () => void;
}) {
  const Icon = SEV_ICON[problem.severity];
  const cls = SEV_CLS[problem.severity];
  const meta = SEVERITY_META[problem.severity];
  return (
    <>
      <div className={cn('h-1.5 w-full shrink-0', cls.bar)} aria-hidden />
      <div className="ng-scroll flex min-h-0 flex-1 flex-col overflow-y-auto p-6">
        <div className="mb-2 flex items-center gap-2">
          <Icon className={cn('h-[18px] w-[18px]', cls.text)} aria-hidden />
          <span className={cn('text-[12px] font-medium uppercase tracking-wider', cls.text)}>{meta.label} · {problem.category}</span>
        </div>
        <h2 className="mb-1 text-lg font-semibold text-fg">{problem.title}</h2>
        <div className="mb-4 font-mono text-[12px] text-fg/55">{problem.nodeRef}</div>
        <p className="mb-5 text-[13px] leading-relaxed text-fg/70">{problem.detail}</p>

        {problem.evidence && (
          <div className="mb-5">
            <h3 className="mb-2 text-[13px] font-medium text-fg/85">Evidence</h3>
            <pre className="ng-scroll overflow-x-auto whitespace-pre rounded border border-fg/10 bg-recess/50 p-3 font-mono text-[11px] leading-tight text-fg/70">
              {problem.evidence}
            </pre>
          </div>
        )}

        {problem.suggested && problem.suggested.length > 0 && (
          <div className={cn('mb-auto rounded-lg border p-4', cls.softBorder, cls.softBg)}>
            <h3 className="mb-2 text-[13px] font-medium text-fg">Suggested actions</h3>
            <ul className="list-inside list-disc space-y-1 text-[13px] text-fg/70">
              {problem.suggested.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-6 flex flex-col gap-2">
          <button
            onClick={onOpenTopology}
            disabled={!problem.jump}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-fg/10 px-4 py-2 text-sm font-medium text-fg/85 transition-colors hover:bg-fg/5 disabled:opacity-40"
            title={problem.jump ? undefined : 'This problem has no placed node to open'}
          >
            <NetworkIcon className="h-4 w-4" aria-hidden />
            Open in Topology
          </button>
          <button
            onClick={onAck}
            disabled={acked}
            className="w-full rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-soft disabled:opacity-40"
          >
            {acked ? 'Acknowledged' : 'Acknowledge'}
          </button>
        </div>
      </div>
    </>
  );
}
