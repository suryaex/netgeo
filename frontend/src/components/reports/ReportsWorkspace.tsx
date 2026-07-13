/**
 * ReportsWorkspace — the Reports Center (v1.2.032, clay design). Left: a grid of
 * report-type cards. Right: an ivory "paper" document preview + download toolbar.
 *
 * NO new backend — every card maps to data the app already exposes:
 *  - Bill of Materials → `fiberApi.bom(id)`   (GET /projects/{id}/bom, NG-FI-04)
 *  - Project Report     → `fiberApi.report(id)` (GET /projects/{id}/report, NG-CFG-02,
 *    HTML, Bearer-gated → fetched as text and rendered in an isolated iframe)
 *
 * The other two design cards are kept for layout but stay HONEST: Link Budget is
 * a cross-ref that jumps to the Fiber planner (loss budget is per-path there, not
 * a project report); RF Coverage Study has no honest project-level endpoint, so it
 * is a disabled "coming soon" card. No fake data, no fabricated history — the
 * "Generated" line is the client-side fetch time, shown only after a real fetch.
 *
 * The paper preview is intentionally ivory in BOTH themes: it is a print document,
 * per the design intent. Everything else uses the app's theme-aware tokens.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  FileBarChart,
  Boxes,
  FileText,
  LineChart,
  RadioTower,
  Download,
  ExternalLink,
  RefreshCw,
  Loader2,
  AlertTriangle,
  ArrowRight,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { projectsApi, fiberApi } from '@/api/client';
import { useUiStore } from '@/store/uiStore';
import { WorkspaceEmptyState } from '@/components/shell/WorkspaceEmptyState';
import { cn } from '@/lib/cn';

type ReportKind = 'bom' | 'report';

type CardDef = {
  key: string;
  title: string;
  desc: string;
  icon: LucideIcon;
} & ({ kind: ReportKind } | { action: 'fiber' } | { soon: true });

const CARDS: CardDef[] = [
  { key: 'bom', title: 'Bill of Materials', desc: 'Hardware inventory grouped by category.', icon: Boxes, kind: 'bom' },
  { key: 'report', title: 'Project Report', desc: 'Full engineering documentation (HTML).', icon: FileText, kind: 'report' },
  { key: 'linkbudget', title: 'Link Budget', desc: 'Optical loss budget — planned per fiber path.', icon: LineChart, action: 'fiber' },
  { key: 'rf', title: 'RF Coverage Study', desc: 'Signal propagation heatmaps.', icon: RadioTower, soon: true },
];

function relTime(from: number): string {
  if (!from) return '';
  const s = Math.max(0, Math.round((Date.now() - from) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.round(m / 60)}h ago`;
}

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

function downloadBlob(text: string, type: string, filename: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function ReportsWorkspace() {
  const projectId = useUiStore((s) => s.projectId);
  const setViewMode = useUiStore((s) => s.setViewMode);
  const [selected, setSelected] = useState<ReportKind>('bom');

  const projectQ = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => projectsApi.get(projectId!),
    enabled: !!projectId,
    staleTime: 60_000,
  });
  const bomQ = useQuery({
    queryKey: ['bom', projectId],
    queryFn: () => fiberApi.bom(projectId!),
    enabled: !!projectId && selected === 'bom',
    staleTime: 30_000,
  });
  const reportQ = useQuery({
    queryKey: ['report', projectId],
    queryFn: () => fiberApi.report(projectId!),
    enabled: !!projectId && selected === 'report',
    staleTime: 30_000,
  });

  if (!projectId) {
    return (
      <div className="absolute inset-0 bg-surface">
        <WorkspaceEmptyState
          icon={FileBarChart}
          title="No project open"
          hint="Open a project from the Projects portal to generate its reports."
        />
      </div>
    );
  }

  const activeQ = selected === 'bom' ? bomQ : reportQ;
  const generated = activeQ.dataUpdatedAt ? `Generated ${relTime(activeQ.dataUpdatedAt)}` : '';
  const projectName = projectQ.data?.name ?? projectId;

  const openFiber = () => setViewMode('fiber');

  const downloadReportHtml = () => {
    if (reportQ.data) downloadBlob(reportQ.data, 'text/html', `netgeo-report-${projectId}.html`);
  };
  const openReportTab = () => {
    if (!reportQ.data) return;
    const url = URL.createObjectURL(new Blob([reportQ.data], { type: 'text/html' }));
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };
  const downloadBomCsv = () => {
    const items = bomQ.data ?? [];
    const rows = [
      ['Category', 'Item', 'Qty', 'Unit', 'Notes'],
      ...items.map((i) => [i.category, i.item, String(i.qty), i.unit, i.notes ?? '']),
    ];
    downloadBlob(rows.map((r) => r.map(csvCell).join(',')).join('\n'), 'text/csv', `netgeo-bom-${projectId}.csv`);
  };

  return (
    <div className="absolute inset-0 flex flex-col bg-surface">
      {/* Page header */}
      <div className="flex shrink-0 items-end justify-between gap-4 border-b border-fg/10 bg-panel px-6 pb-4 pt-5">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-fg">Reports Center</h1>
          <p className="mt-1 text-sm text-fg/55">Generate and download engineering documentation.</p>
        </div>
        <button
          onClick={() => activeQ.refetch()}
          disabled={activeQ.isFetching}
          className="inline-flex items-center gap-2 rounded-lg border border-fg/10 px-4 py-2 text-sm font-medium text-fg/85 transition-colors hover:bg-fg/5 disabled:opacity-40"
        >
          <RefreshCw className={cn('h-4 w-4', activeQ.isFetching && 'animate-spin')} aria-hidden />
          Regenerate
        </button>
      </div>

      {/* Split: report cards | document preview */}
      <div className="flex min-h-0 flex-1">
        {/* Left — report type cards */}
        <div className="ng-scroll w-1/2 min-w-0 overflow-y-auto border-r border-fg/10 p-6">
          <div className="grid grid-cols-2 gap-4">
            {CARDS.map((card) => (
              <ReportCard
                key={card.key}
                card={card}
                selected={'kind' in card && card.kind === selected}
                onSelect={() => {
                  if ('kind' in card) setSelected(card.kind);
                  else if ('action' in card) openFiber();
                }}
              />
            ))}
          </div>
        </div>

        {/* Right — paper document preview */}
        <div className="flex w-1/2 min-w-0 flex-col bg-recess/40">
          {/* Toolbar */}
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-fg/10 bg-panel px-6 py-3">
            <div className="flex items-center gap-2">
              {selected === 'bom' ? (
                <ToolbarButton icon={Download} label="Download CSV" onClick={downloadBomCsv} disabled={!bomQ.data} primary />
              ) : (
                <>
                  <ToolbarButton icon={Download} label="Download HTML" onClick={downloadReportHtml} disabled={!reportQ.data} primary />
                  <ToolbarButton icon={ExternalLink} label="Open in new tab" onClick={openReportTab} disabled={!reportQ.data} />
                </>
              )}
            </div>
            {generated && <span className="font-mono text-[11px] text-fg/40">{generated}</span>}
          </div>

          {/* Preview area */}
          <div className="ng-scroll min-h-0 flex-1 overflow-y-auto p-8">
            <div className="mx-auto flex min-h-full w-full max-w-[680px] flex-col overflow-hidden rounded-sm bg-[#FAF9F5] text-[#1F1E1D] shadow-lg">
              {selected === 'bom' ? (
                <BomPaper query={bomQ} projectName={projectName} projectId={projectId} />
              ) : (
                <ReportPaper query={reportQ} />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ReportCard({ card, selected, onSelect }: { card: CardDef; selected: boolean; onSelect: () => void }) {
  const Icon = card.icon;
  const soon = 'soon' in card;
  const crossref = 'action' in card;
  return (
    <button
      onClick={onSelect}
      disabled={soon}
      aria-pressed={'kind' in card ? selected : undefined}
      title={soon ? 'RF coverage report — coming in a later phase' : undefined}
      className={cn(
        'group relative flex flex-col rounded-xl border bg-panel p-5 text-left transition-colors',
        soon && 'cursor-not-allowed opacity-45',
        !soon && (selected ? 'border-accent' : 'border-transparent hover:border-fg/20'),
      )}
    >
      <div className="mb-3 flex items-start justify-between">
        <div
          className={cn(
            'grid h-10 w-10 place-items-center rounded-lg bg-fg/5',
            selected ? 'text-accent' : 'text-fg/55 group-hover:text-fg/80',
          )}
        >
          <Icon className="h-5 w-5" aria-hidden />
        </div>
        {selected && <span className="mt-1 h-2 w-2 rounded-full bg-accent" aria-hidden />}
      </div>
      <h3 className="mb-1 text-[15px] font-medium text-fg">{card.title}</h3>
      <p className="mb-4 text-[13px] leading-snug text-fg/55">{card.desc}</p>
      <span className="mt-auto inline-flex items-center gap-1 font-mono text-[11px] text-fg/40">
        {soon ? (
          'Coming soon'
        ) : crossref ? (
          <>
            Open in Fiber planner <ArrowRight className="h-3 w-3" aria-hidden />
          </>
        ) : (
          'On demand'
        )}
      </span>
    </button>
  );
}

function ToolbarButton({
  icon: Icon,
  label,
  onClick,
  disabled,
  primary,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-40',
        primary
          ? 'bg-accent text-accent-fg hover:bg-accent-soft'
          : 'border border-fg/15 text-fg/85 hover:bg-fg/5',
      )}
    >
      <Icon className="h-4 w-4" aria-hidden />
      {label}
    </button>
  );
}

/** Loading / error scaffolding shared by both papers (dark text on ivory). */
function PaperState({ children, tone = 'muted' }: { children: React.ReactNode; tone?: 'muted' | 'error' }) {
  return (
    <div
      className={cn(
        'grid flex-1 place-items-center gap-2 p-10 text-center text-sm',
        tone === 'error' ? 'text-red-700' : 'text-[#494740]',
      )}
    >
      {children}
    </div>
  );
}

function BomPaper({
  query,
  projectName,
  projectId,
}: {
  query: ReturnType<typeof useQuery<import('@/api/client').BomItem[]>>;
  projectName: string;
  projectId: string;
}) {
  if (query.isLoading) {
    return (
      <PaperState>
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> Building bill of materials…
      </PaperState>
    );
  }
  if (query.isError) {
    return (
      <PaperState tone="error">
        <AlertTriangle className="h-5 w-5" aria-hidden />
        {(query.error as { message?: string })?.message ?? 'Failed to load bill of materials.'}
      </PaperState>
    );
  }
  const items = query.data ?? [];
  return (
    <div className="p-10">
      <header className="mb-8 border-b-2 border-[#1F1E1D] pb-4">
        <h2 className="m-0 text-2xl font-bold text-[#1F1E1D]">NetGeo — Bill of Materials</h2>
        <div className="mt-3 flex justify-between font-mono text-[12px] text-[#494740]">
          <span>Project: {projectName}</span>
          <span>ID: {projectId}</span>
        </div>
      </header>
      {items.length === 0 ? (
        <p className="py-10 text-center text-sm text-[#494740]">
          No materials yet — add physical plant and fiber paths, then regenerate.
        </p>
      ) : (
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-[#a38c85]/40 font-mono text-[12px] text-[#494740]">
              <th className="py-2 pr-4 font-medium">Category</th>
              <th className="py-2 px-4 font-medium">Item</th>
              <th className="py-2 px-4 text-right font-medium">Qty</th>
              <th className="py-2 px-4 font-medium">Unit</th>
              <th className="py-2 pl-4 font-medium">Notes</th>
            </tr>
          </thead>
          <tbody className="font-mono text-[13px] text-[#1F1E1D]">
            {items.map((it, i) => (
              <tr key={i} className="border-b border-[#a38c85]/20">
                <td className="py-2.5 pr-4 text-[#494740]">{it.category}</td>
                <td className="py-2.5 px-4">{it.item}</td>
                <td className="py-2.5 px-4 text-right tabular-nums">{it.qty}</td>
                <td className="py-2.5 px-4 text-[#494740]">{it.unit}</td>
                <td className="py-2.5 pl-4 text-[#494740]">{it.notes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function ReportPaper({ query }: { query: ReturnType<typeof useQuery<string>> }) {
  if (query.isLoading) {
    return (
      <PaperState>
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> Rendering project report…
      </PaperState>
    );
  }
  if (query.isError) {
    return (
      <PaperState tone="error">
        <AlertTriangle className="h-5 w-5" aria-hidden />
        {(query.error as { message?: string })?.message ?? 'Failed to load project report.'}
      </PaperState>
    );
  }
  // The report is a full styled HTML document — isolate it in an iframe so its
  // styles never leak into the app shell.
  return (
    <iframe
      title="Project report"
      srcDoc={query.data ?? ''}
      sandbox=""
      className="min-h-[800px] w-full flex-1 border-0 bg-white"
    />
  );
}
