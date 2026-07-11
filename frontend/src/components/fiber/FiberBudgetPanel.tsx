/**
 * FiberBudgetPanel — the ~380px right dock. Shows the selected path's loss budget
 * (all figures straight from `/fiber-paths/{id}/budget` — never recomputed here),
 * the GPON sanity checks, and the other paths in the project as an "other ODPs"
 * list. Footer opens the project BOM (modal) and the print-ready HTML report.
 */
import { useState } from 'react';
import { Cable, Check, X, AlertTriangle, Loader2, FileText, ListTree } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useFiberStore } from '@/store/fiberStore';
import { fiberApi, type BomItem, type LossBudget } from '@/api/client';
import { GPON_LABEL, fmtKm } from './fiberLogic';

function Row({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: 'ok' | 'bad' }) {
  return (
    <div className={cn('flex items-center justify-between py-1.5', strong && 'border-t border-fg/15')}>
      <span className={cn('text-xs', strong ? 'font-medium text-fg/80' : 'text-fg/55')}>{label}</span>
      <span
        className={cn(
          'font-mono text-xs',
          tone === 'ok' && 'text-success',
          tone === 'bad' && 'text-danger',
          !tone && (strong ? 'text-fg/90' : 'text-fg/75'),
        )}
      >
        {value}
      </span>
    </div>
  );
}

function PassChip({ passed }: { passed: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold',
        passed ? 'bg-success/15 text-success' : 'bg-danger/15 text-danger',
      )}
    >
      {passed ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
      {passed ? 'PASS' : 'FAIL'}
    </span>
  );
}

function BudgetBody({ budget }: { budget: LossBudget }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-fg/50">Optical Budget</p>
        <PassChip passed={budget.passed} />
      </div>

      <div className="rounded-lg border border-fg/10 bg-recess/30 px-3 py-1">
        <Row label="Fiber length" value={fmtKm(budget.total_length_m)} />
        <Row label="Split" value={`1:${budget.total_split}`} />
        <Row label="Insertion loss" value={`${budget.total_loss_db.toFixed(2)} dB`} />
        <Row label="Class budget" value={`${budget.budget_db.toFixed(1)} dB`} />
        <Row
          label="Margin"
          value={`${budget.margin_db >= 0 ? '+' : ''}${budget.margin_db.toFixed(2)} dB`}
          strong
          tone={budget.margin_db >= 0 ? 'ok' : 'bad'}
        />
      </div>

      <div>
        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg/50">GPON Checks</p>
        <ul className="space-y-1.5">
          {budget.checks.map((c, i) => (
            <li key={i} className="flex items-start gap-2 text-xs leading-relaxed text-fg/70">
              {c.ok ? (
                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
              ) : (
                <X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger" />
              )}
              <span>{c.reason}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function OtherPaths() {
  const paths = useFiberStore((s) => s.paths);
  const budgets = useFiberStore((s) => s.budgets);
  const selectedId = useFiberStore((s) => s.selectedId);
  const search = useFiberStore((s) => s.search).trim().toLowerCase();
  const select = useFiberStore((s) => s.select);

  const others = paths.filter(
    (p) => p.id !== selectedId && (!search || p.name.toLowerCase().includes(search)),
  );
  if (others.length === 0) return null;

  return (
    <div className="mt-5">
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg/50">Other ODPs</p>
      <ul className="space-y-1">
        {others.map((p) => {
          const b = budgets[p.id];
          const passed = b?.passed ?? true;
          return (
            <li key={p.id}>
              <button
                onClick={() => select(p.id)}
                className="flex w-full items-center justify-between gap-2 rounded-lg border border-fg/10 bg-recess/30 px-2.5 py-1.5 text-left hover:border-fg/25"
              >
                <span className="flex items-center gap-2 truncate">
                  <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', passed ? 'bg-success' : 'bg-danger')} />
                  <span className="truncate text-xs text-fg/80">{p.name}</span>
                </span>
                <span className="shrink-0 font-mono text-[11px] text-fg/55">
                  {b ? `${b.margin_db >= 0 ? '+' : ''}${b.margin_db.toFixed(1)} dB` : '—'}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function FiberBudgetPanel() {
  const projectId = useFiberStore((s) => s.projectId);
  const path = useFiberStore((s) => s.paths.find((p) => p.id === s.selectedId));
  const budget = useFiberStore((s) => (s.selectedId ? s.budgets[s.selectedId] : undefined));
  const busy = useFiberStore((s) => s.busy);
  const error = useFiberStore((s) => s.error);

  const [bom, setBom] = useState<BomItem[] | null>(null);
  const [bomOpen, setBomOpen] = useState(false);
  const [actErr, setActErr] = useState<string | null>(null);

  async function openBom() {
    if (!projectId) return;
    setBomOpen(true);
    setBom(null);
    setActErr(null);
    try {
      setBom(await fiberApi.bom(projectId));
    } catch (err) {
      setActErr((err as { message?: string })?.message ?? 'Failed to load BOM.');
    }
  }

  async function openReport() {
    if (!projectId) return;
    setActErr(null);
    try {
      const html = await fiberApi.report(projectId);
      const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      setActErr((err as { message?: string })?.message ?? 'Failed to open report.');
    }
  }

  return (
    <aside
      role="region"
      aria-label="Optical Budget"
      className="glass-strong pointer-events-auto absolute right-0 top-0 z-[1001] flex h-full w-[380px] max-w-[85vw] flex-col border-l border-fg/12 shadow-glass-lg"
    >
      <div className="flex items-center gap-2 border-b border-fg/10 px-4 py-3">
        <Cable className="h-4 w-4 text-accent" />
        <h2 className="truncate text-sm font-semibold text-fg/85">{path ? path.name : 'Optical Budget'}</h2>
        {path && (
          <span className="ml-auto rounded-full bg-fg/8 px-2 py-0.5 font-mono text-[10px] text-fg/60">
            {GPON_LABEL[path.gpon_class]}
          </span>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {!path ? (
          <p className="py-10 text-center text-xs text-fg/50">Select a fiber path to see its budget.</p>
        ) : busy && !budget ? (
          <div className="grid place-items-center gap-2 py-10 text-xs text-fg/55">
            <Loader2 className="h-5 w-5 animate-spin text-accent" /> Computing budget…
          </div>
        ) : !budget ? (
          <p className="py-10 text-center text-xs text-fg/50">No budget available for this path.</p>
        ) : (
          <>
            <BudgetBody budget={budget} />
            <OtherPaths />
          </>
        )}
        {error && (
          <p className="mt-4 flex items-center gap-1.5 text-xs text-danger">
            <AlertTriangle className="h-3.5 w-3.5" /> {error}
          </p>
        )}
      </div>

      {/* Footer actions */}
      <div className="flex items-center gap-2 border-t border-fg/10 px-4 py-3">
        <button
          onClick={openBom}
          disabled={!projectId}
          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-fg/15 bg-recess/50 px-3 py-1.5 text-xs font-medium text-fg/80 hover:border-fg/30 disabled:opacity-40"
        >
          <ListTree className="h-3.5 w-3.5" /> BOM
        </button>
        <button
          onClick={openReport}
          disabled={!projectId}
          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-fg hover:bg-accent-soft disabled:opacity-40"
        >
          <FileText className="h-3.5 w-3.5" /> Report
        </button>
      </div>
      {actErr && <p className="px-4 pb-2 text-[11px] text-danger">{actErr}</p>}

      {bomOpen && <BomModal items={bom} onClose={() => setBomOpen(false)} />}
    </aside>
  );
}

function BomModal({ items, onClose }: { items: BomItem[] | null; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[2000] grid place-items-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Bill of materials"
      onClick={onClose}
    >
      <div
        className="glass-strong flex max-h-[80vh] w-full max-w-lg flex-col rounded-xl border border-fg/15 shadow-glass-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-fg/10 px-4 py-3">
          <ListTree className="h-4 w-4 text-accent" />
          <h3 className="text-sm font-semibold text-fg/85">Bill of Materials</h3>
          <button
            onClick={onClose}
            aria-label="Close"
            className="ml-auto grid h-6 w-6 place-items-center rounded text-fg/50 hover:bg-fg/10 hover:text-fg"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
          {items === null ? (
            <div className="grid place-items-center gap-2 py-10 text-xs text-fg/55">
              <Loader2 className="h-5 w-5 animate-spin text-accent" /> Loading…
            </div>
          ) : items.length === 0 ? (
            <p className="py-8 text-center text-xs text-fg/50">No materials yet — add plant and fiber paths.</p>
          ) : (
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="text-[10px] uppercase tracking-wide text-fg/40">
                  <th className="py-1 pr-2 font-medium">Category</th>
                  <th className="py-1 pr-2 font-medium">Item</th>
                  <th className="py-1 pr-2 text-right font-medium">Qty</th>
                  <th className="py-1 font-medium">Unit</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, i) => (
                  <tr key={i} className="border-t border-fg/8 text-fg/75">
                    <td className="py-1.5 pr-2 text-fg/55">{it.category}</td>
                    <td className="py-1.5 pr-2">{it.item}</td>
                    <td className="py-1.5 pr-2 text-right font-mono">{it.qty}</td>
                    <td className="py-1.5 text-fg/55">{it.unit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
