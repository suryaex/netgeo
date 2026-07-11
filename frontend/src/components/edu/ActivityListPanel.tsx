/**
 * ActivityListPanel — the Education Lab entry point (browse mode). A centered
 * glass card listing every activity with per-row Take / Author / Export / CSV /
 * Delete, plus New and Import in the header. Loading, error, and empty states are
 * all handled inline so the workspace never lands on a blank canvas with no
 * guidance.
 */
import { useRef, useState } from 'react';
import {
  GraduationCap,
  Plus,
  Upload,
  Loader2,
  AlertTriangle,
  PenLine,
  Play,
  Download,
  FileSpreadsheet,
  Trash2,
  ClipboardList,
} from 'lucide-react';
import { useEduStore } from '@/store/eduStore';
import { educationApi } from '@/api/client';
import { zc } from '@/theme/z';

export function ActivityListPanel() {
  const activities = useEduStore((s) => s.activities);
  const loading = useEduStore((s) => s.loading);
  const saving = useEduStore((s) => s.saving);
  const error = useEduStore((s) => s.error);
  const selectForAuthor = useEduStore((s) => s.selectForAuthor);
  const instantiate = useEduStore((s) => s.instantiate);
  const removeActivity = useEduStore((s) => s.removeActivity);
  const exportActivity = useEduStore((s) => s.exportActivity);
  const importActivity = useEduStore((s) => s.importActivity);
  const loadActivities = useEduStore((s) => s.loadActivities);
  const fileRef = useRef<HTMLInputElement>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const onImportFile = async (file: File) => {
    try {
      const envelope = JSON.parse(await file.text()) as Record<string, unknown>;
      await importActivity(envelope);
    } catch {
      useEduStore.setState({ error: 'That file is not valid JSON.' });
    }
  };

  return (
    <section
      aria-label="Activities"
      className={`glass-strong pointer-events-auto absolute left-1/2 top-14 ${zc.workspace} flex max-h-[calc(100vh-8rem)] w-[560px] max-w-[calc(100vw-5rem)] -translate-x-1/2 flex-col rounded-2xl border border-fg/12 shadow-glass-lg`}
    >
      {/* Header */}
      <header className="flex items-center gap-2 border-b border-fg/10 px-4 py-3">
        <GraduationCap className="h-4 w-4 text-accent" />
        <h1 className="text-sm font-semibold text-fg/90">Education Lab</h1>
        <span className="ml-1 rounded-full bg-fg/8 px-2 py-0.5 text-[11px] font-medium text-fg/55">
          {activities.length}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <button
            onClick={() => fileRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-fg/15 px-2.5 py-1.5 text-xs font-medium text-fg/75 hover:bg-fg/8 hover:text-fg"
          >
            <Upload className="h-3.5 w-3.5" />
            Import
          </button>
          <button
            onClick={() => selectForAuthor(null)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-2.5 py-1.5 text-xs font-semibold text-fg hover:bg-accent-soft"
          >
            <Plus className="h-3.5 w-3.5" />
            New activity
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".netgeo-lab,application/json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onImportFile(f);
              e.target.value = '';
            }}
          />
        </div>
      </header>

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-y-auto ng-scroll p-2">
        {error && (
          <div
            role="alert"
            className="mb-2 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-fg/80"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <span className="flex-1">{error}</span>
            <button onClick={() => void loadActivities()} className="font-semibold text-accent hover:underline">
              Retry
            </button>
          </div>
        )}

        {loading ? (
          <div className="grid place-items-center gap-2 py-14 text-xs text-fg/55">
            <Loader2 className="h-5 w-5 animate-spin text-accent" />
            Loading activities…
          </div>
        ) : activities.length === 0 ? (
          <div className="grid place-items-center gap-3 py-14 text-center">
            <ClipboardList className="h-9 w-9 text-fg/25" />
            <p className="max-w-[22rem] text-xs leading-relaxed text-fg/55">
              No activities yet. Create one to bundle instructions, a starting network, and weighted
              grading checks — or import a shared <span className="font-mono text-fg/70">.netgeo-lab</span> file.
            </p>
            <button
              onClick={() => selectForAuthor(null)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-fg hover:bg-accent-soft"
            >
              <Plus className="h-3.5 w-3.5" />
              New activity
            </button>
          </div>
        ) : (
          <ul className="space-y-1.5">
            {activities.map((a) => (
              <li
                key={a.id}
                className="group flex items-center gap-3 rounded-xl border border-fg/8 bg-recess/30 px-3 py-2.5 hover:border-fg/15"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-fg/90">{a.name || 'Untitled activity'}</p>
                  <p className="mt-0.5 flex items-center gap-2 text-[11px] text-fg/45">
                    <span>{a.checks.length} check{a.checks.length === 1 ? '' : 's'}</span>
                    {a.time_limit_s != null && (
                      <span>· {Math.round(a.time_limit_s / 60)} min limit</span>
                    )}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  <button
                    onClick={() => void instantiate(a.id)}
                    disabled={saving}
                    title="Start this activity as a student"
                    className="inline-flex items-center gap-1.5 rounded-lg bg-accent/15 px-2.5 py-1.5 text-xs font-semibold text-accent hover:bg-accent/25 disabled:opacity-40"
                  >
                    <Play className="h-3.5 w-3.5" />
                    Take
                  </button>
                  <IconBtn onClick={() => selectForAuthor(a.id)} title="Author / duplicate" icon={PenLine} />
                  <IconBtn onClick={() => void exportActivity(a.id)} title="Export .netgeo-lab" icon={Download} />
                  <IconBtn
                    onClick={() => void educationApi.downloadResultsCsv(a.id)}
                    title="Download results CSV"
                    icon={FileSpreadsheet}
                  />
                  {confirmId === a.id ? (
                    <button
                      onClick={() => {
                        void removeActivity(a.id);
                        setConfirmId(null);
                      }}
                      className="rounded-lg bg-danger/15 px-2 py-1.5 text-xs font-semibold text-danger hover:bg-danger/25"
                    >
                      Confirm
                    </button>
                  ) : (
                    <IconBtn onClick={() => setConfirmId(a.id)} title="Delete activity" icon={Trash2} danger />
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function IconBtn({
  onClick,
  title,
  icon: Icon,
  danger,
}: {
  onClick: () => void;
  title: string;
  icon: typeof PenLine;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      className={
        'grid h-8 w-8 place-items-center rounded-lg text-fg/50 transition-colors hover:bg-fg/10 ' +
        (danger ? 'hover:text-danger' : 'hover:text-fg/90')
      }
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}
