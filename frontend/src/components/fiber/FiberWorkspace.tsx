/**
 * FiberWorkspace — the Fiber/FTTH planner full-bleed view (NG-FI-01/02/03).
 *
 * A logical GPON diagram, NOT the map: an SVG chain of the selected FiberPath with
 * a top-left filter/search bar, the Optical Budget dock (right), the path/element
 * toolbar (bottom), and a GPON status strip. All optical figures come from the
 * backend budget endpoint; the client never recomputes loss.
 */
import { useEffect } from 'react';
import { Search, Loader2, AlertTriangle, Cable } from 'lucide-react';
import { cn } from '@/lib/cn';
import { zc } from '@/theme/z';
import { useUiStore } from '@/store/uiStore';
import { useFiberStore, type SegKey } from '@/store/fiberStore';
import { WorkspaceEmptyState } from '@/components/shell/WorkspaceEmptyState';
import { GPON_LABEL } from './fiberLogic';
import { FiberCanvas } from './FiberCanvas';
import { FiberBudgetPanel } from './FiberBudgetPanel';
import { FiberToolbar } from './FiberToolbar';

const SEG_CHIPS: { key: SegKey; label: string }[] = [
  { key: 'feeder', label: 'Feeder' },
  { key: 'distribution', label: 'Distribution' },
  { key: 'drop', label: 'Drop' },
];

export function FiberWorkspace() {
  const projectId = useUiStore((s) => s.projectId);
  const load = useFiberStore((s) => s.load);
  const hasPaths = useFiberStore((s) => s.paths.length > 0);
  const loading = useFiberStore((s) => s.loading);
  const createPath = useFiberStore((s) => s.createPath);

  useEffect(() => {
    if (projectId) void load(projectId);
  }, [projectId, load]);

  return (
    <div className="absolute inset-0 bg-recess/25">
      <FiberCanvas />
      <FilterBar />
      <FiberBudgetPanel />
      <FiberToolbar />
      <StatusStrip />
      {!loading && !hasPaths && (
        <WorkspaceEmptyState
          icon={Cable}
          title="No fiber paths yet"
          hint="A GPON path runs OLT → feeder → splitter → distribution → ODP. Create your first ODP to start planning the optical budget."
          action={{ label: 'New fiber path', onClick: () => void createPath('ODP-1', 'c_plus') }}
        />
      )}
    </div>
  );
}

function FilterBar() {
  const seg = useFiberStore((s) => s.seg);
  const toggleSeg = useFiberStore((s) => s.toggleSeg);
  const search = useFiberStore((s) => s.search);
  const setSearch = useFiberStore((s) => s.setSearch);

  return (
    <div className={cn('pointer-events-auto absolute left-4 top-4 flex flex-wrap items-center gap-2', zc.workspace)}>
      <div className="glass-strong flex items-center gap-1.5 rounded-lg border border-fg/15 px-2.5 py-1.5 shadow-glass">
        <Search className="h-3.5 w-3.5 text-fg/40" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search paths…"
          aria-label="Search fiber paths"
          className="w-40 bg-transparent text-xs text-fg/85 placeholder:text-fg/35 focus:outline-none"
        />
      </div>
      <div className="glass-strong flex items-center gap-1 rounded-lg border border-fg/15 px-1.5 py-1 shadow-glass">
        {SEG_CHIPS.map((c) => (
          <button
            key={c.key}
            onClick={() => toggleSeg(c.key)}
            aria-pressed={seg[c.key]}
            className={cn(
              'rounded-md px-2 py-1 text-[11px] font-medium transition-colors',
              seg[c.key] ? 'bg-accent/20 text-accent' : 'text-fg/45 hover:bg-fg/8 hover:text-fg/70',
            )}
          >
            {c.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function StatusStrip() {
  const projectId = useFiberStore((s) => s.projectId);
  const paths = useFiberStore((s) => s.paths);
  const budgets = useFiberStore((s) => s.budgets);
  const selected = useFiberStore((s) => s.paths.find((p) => p.id === s.selectedId));
  const loading = useFiberStore((s) => s.loading);
  const error = useFiberStore((s) => s.error);

  const scored = paths.map((p) => budgets[p.id]).filter(Boolean);
  const pass = scored.filter((b) => b!.passed).length;
  const fail = scored.length - pass;
  const budgetDb = selected ? budgets[selected.id]?.budget_db : undefined;

  return (
    <div className={cn('pointer-events-none absolute bottom-0 left-0 flex items-center gap-3 px-4 py-1.5 font-mono text-[11px] text-fg/55', zc.workspace)}>
      {loading ? (
        <span className="flex items-center gap-1.5">
          <Loader2 className="h-3 w-3 animate-spin" /> Loading fiber paths…
        </span>
      ) : error ? (
        <span className="flex items-center gap-1.5 text-danger">
          <AlertTriangle className="h-3 w-3" /> {error}
        </span>
      ) : !projectId ? (
        <span>No project open</span>
      ) : (
        <>
          <span>
            GPON <span className="text-fg/80">{selected ? `Class ${GPON_LABEL[selected.gpon_class]}` : '—'}</span>
          </span>
          <span className="text-fg/25">|</span>
          <span>
            Budget <span className="text-fg/80">{budgetDb != null ? `${budgetDb.toFixed(0)} dB` : '—'}</span>
          </span>
          <span className="text-fg/25">|</span>
          <span>
            <span className="text-success">{pass} PASS</span> / <span className="text-danger">{fail} FAIL</span>
          </span>
        </>
      )}
    </div>
  );
}
