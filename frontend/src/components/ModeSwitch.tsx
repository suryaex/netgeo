/**
 * ModeSwitch — Packet Tracer-parity Realtime | Simulation toggle (NG-SIM-01).
 *
 * Realtime: lab actions run the engine to completion (classic behaviour).
 * Simulation: actions only enqueue events; the Event Ledger window (opened
 * automatically) steps, seeks and rewinds the deterministic event stream.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Clock, ListVideo } from 'lucide-react';
import { labApi, type LabMode } from '@/api/client';
import { useLabStore } from '@/store/labStore';
import { useUiStore } from '@/store/uiStore';
import { useWindowStore } from '@/store/windowStore';
import { cn } from '@/lib/cn';

export function ModeSwitch() {
  const projectId = useUiStore((s) => s.projectId);
  const mode = useLabStore((s) => s.mode);
  const setMode = useLabStore((s) => s.setMode);
  const toggleApp = useWindowStore((s) => s.toggleApp);
  const queryClient = useQueryClient();

  const m = useMutation({
    mutationFn: (next: LabMode) => labApi.mode(projectId!, next),
    onSuccess: (data) => {
      setMode(data.mode);
      if (data.mode === 'simulation') toggleApp('ledger', 'Event Ledger');
      void queryClient.invalidateQueries({ queryKey: ['ledger', projectId] });
    },
  });

  const pick = (next: LabMode) => {
    if (!projectId || next === mode || m.isPending) return;
    m.mutate(next);
  };

  return (
    <div
      className="flex items-center rounded-md border border-fg/10 bg-fg/5 p-0.5"
      role="group"
      aria-label="Lab mode"
    >
      <ModeButton
        active={mode === 'realtime'}
        onClick={() => pick('realtime')}
        icon={Clock}
        label="Realtime"
        title="Realtime: actions run the lab to completion"
      />
      <ModeButton
        active={mode === 'simulation'}
        onClick={() => pick('simulation')}
        icon={ListVideo}
        label="Simulation"
        title="Simulation: step through every event in the ledger"
      />
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  icon: Icon,
  label,
  title,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Clock;
  label: string;
  title: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={cn(
        'flex items-center gap-1.5 rounded px-2 py-1 text-xs transition-colors',
        active ? 'bg-accent text-fg' : 'text-fg/50 hover:text-fg/80',
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      <span className="hidden md:inline">{label}</span>
    </button>
  );
}
