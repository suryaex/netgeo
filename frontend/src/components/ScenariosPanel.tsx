/**
 * ScenariosPanel — lists scenarios for the open project (MASTER_SPEC §4
 * Scenario). Each scenario has ordered steps + expected outcomes; running one
 * drives the simulation engine. Loads via REST; shows loading/empty/error
 * states as first-class UX.
 */
import { useEffect, useState } from 'react';
import { ListChecks, Play } from 'lucide-react';
import { scenariosApi } from '@/api/client';
import { useUiStore } from '@/store/uiStore';
import type { Scenario } from '@/api/types';

export function ScenariosPanel() {
  const projectId = useUiStore((s) => s.projectId);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    setLoading(true);
    scenariosApi
      .list(projectId)
      .then(setScenarios)
      .catch((e) => setError(e?.message ?? 'Failed to load scenarios'))
      .finally(() => setLoading(false));
  }, [projectId]);

  if (loading) return <Centered>Loading scenarios…</Centered>;
  if (error) return <Centered tone="danger">{error}</Centered>;
  if (scenarios.length === 0)
    return (
      <Centered>
        <ListChecks className="mx-auto mb-2 h-8 w-8" />
        No scenarios yet for this project.
      </Centered>
    );

  return (
    <ul className="nf-scroll h-full space-y-2 overflow-auto p-3">
      {scenarios.map((sc) => (
        <li key={sc.id} className="rounded-md border border-white/10 bg-white/5 p-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium text-white/90">{sc.name}</h4>
            <button
              className="flex items-center gap-1 rounded bg-accent px-2 py-1 text-xs text-white hover:bg-accent-soft"
              aria-label={`Run scenario ${sc.name}`}
            >
              <Play className="h-3 w-3" /> Run
            </button>
          </div>
          <ol className="mt-2 list-decimal space-y-1 pl-4 text-xs text-white/60">
            {sc.steps.map((step) => (
              <li key={step.id}>{step.description}</li>
            ))}
          </ol>
        </li>
      ))}
    </ul>
  );
}

function Centered({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone?: 'danger';
}) {
  return (
    <div
      className={`grid h-full place-items-center p-6 text-center text-sm ${
        tone === 'danger' ? 'text-danger' : 'text-white/40'
      }`}
    >
      <div>{children}</div>
    </div>
  );
}
