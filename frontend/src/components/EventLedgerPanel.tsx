/**
 * EventLedgerPanel — the simulation-mode control surface (NG-SIM-01).
 *
 * Shows the deterministic event ledger of the living lab and, in simulation
 * mode, drives it: step forward by events or sim-time, step back / seek to
 * any event (replay-to-cursor on the backend). New PACKET_TX records are fed
 * to the lab store so the canvas animates them (NG-CAP-04 MVP).
 */
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronsRight, Rewind, StepBack, StepForward } from 'lucide-react';
import { labApi, type LedgerRecord } from '@/api/client';
import { useLabStore } from '@/store/labStore';
import { useTopologyStore } from '@/store/topologyStore';
import { useUiStore } from '@/store/uiStore';
import { cn } from '@/lib/cn';

const TYPE_STYLES: Record<string, string> = {
  PACKET_TX: 'text-sky-300/90',
  PACKET_RX: 'text-emerald-300/90',
  TIMER: 'text-white/40',
};

export function EventLedgerPanel() {
  const projectId = useUiStore((s) => s.projectId);
  const nodes = useTopologyStore((s) => s.nodes);
  const mode = useLabStore((s) => s.mode);
  const setMode = useLabStore((s) => s.setMode);
  const cursor = useLabStore((s) => s.cursor);
  const setCursor = useLabStore((s) => s.setCursor);
  const pushRecords = useLabStore((s) => s.pushRecords);
  const [seekTo, setSeekTo] = useState('');
  const queryClient = useQueryClient();

  const q = useQuery({
    queryKey: ['ledger', projectId],
    queryFn: () => labApi.ledger(projectId!, 0, 400),
    enabled: !!projectId,
    refetchInterval: mode === 'realtime' ? 3000 : false,
  });

  // Adopt the backend's authoritative mode + animate newly-arrived TX events.
  useEffect(() => {
    if (!q.data) return;
    if (q.data.mode !== mode) setMode(q.data.mode);
    const fresh = q.data.records.filter((r) => r.seq > cursor);
    if (fresh.length > 0 && cursor > 0) pushRecords(fresh);
    if (q.data.total !== cursor) setCursor(q.data.total);
  }, [q.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['ledger', projectId] });

  const step = useMutation({
    mutationFn: (body: { events?: number; duration?: number }) =>
      labApi.step(projectId!, body),
    onSuccess: (data) => {
      pushRecords(data.records);
      refresh();
    },
  });

  const seek = useMutation({
    mutationFn: (seq: number) => labApi.seek(projectId!, seq),
    onSuccess: (data) => {
      setMode(data.mode);
      setCursor(data.seq);
      refresh();
    },
  });

  const total = q.data?.total ?? 0;
  const records = useMemo(() => (q.data?.records ?? []).slice().reverse(), [q.data]);
  const nodeName = (id: string) => nodes.get(id)?.name ?? (id ? id.slice(0, 8) : '—');
  const busy = step.isPending || seek.isPending;
  const simMode = mode === 'simulation';

  return (
    <div className="flex h-full flex-col text-[13px]">
      {/* Status + transport strip */}
      <div className="flex flex-wrap items-center gap-2 border-b border-white/10 px-2 py-1.5">
        <span
          className={cn(
            'rounded-full px-2 py-0.5 text-[11px] font-medium',
            simMode ? 'bg-accent/25 text-accent' : 'bg-white/10 text-white/60',
          )}
        >
          {simMode ? 'Simulation' : 'Realtime'}
        </span>
        <span className="font-mono text-[11px] text-white/50">
          t={q.data ? q.data.sim_time.toFixed(6) : '—'}s · event {total}
          {q.data ? ` · ${q.data.pending_events} queued` : ''}
        </span>

        <div className="flex-1" />

        <LedgerButton
          label="Step back"
          disabled={busy || total === 0}
          onClick={() => seek.mutate(Math.max(0, total - 1))}
        >
          <StepBack className="h-3.5 w-3.5" />
        </LedgerButton>
        <LedgerButton label="Step 1 event" disabled={busy} onClick={() => step.mutate({ events: 1 })}>
          <StepForward className="h-3.5 w-3.5" />
        </LedgerButton>
        <LedgerButton
          label="Step 10 events"
          disabled={busy}
          onClick={() => step.mutate({ events: 10 })}
        >
          <ChevronsRight className="h-3.5 w-3.5" />
          <span className="text-[10px]">10</span>
        </LedgerButton>
        <LedgerButton
          label="Run 1 sim-second"
          disabled={busy}
          onClick={() => step.mutate({ duration: 1.0 })}
        >
          <ChevronsRight className="h-3.5 w-3.5" />
          <span className="text-[10px]">1s</span>
        </LedgerButton>

        <div className="ml-1 flex items-center gap-1">
          <input
            value={seekTo}
            onChange={(e) => setSeekTo(e.target.value.replace(/\D/g, ''))}
            placeholder="seek #"
            aria-label="Seek to event"
            className="w-[64px] rounded-md border border-white/10 bg-white/5 px-1.5 py-1 font-mono text-[11px] outline-none placeholder:text-white/30 focus:border-accent"
          />
          <LedgerButton
            label="Seek to event"
            disabled={busy || seekTo === ''}
            onClick={() => seek.mutate(Number(seekTo))}
          >
            <Rewind className="h-3.5 w-3.5" />
          </LedgerButton>
        </div>
      </div>

      {/* Ledger records (newest first) */}
      <div className="ng-scroll min-h-0 flex-1 overflow-auto font-mono text-[11px] leading-relaxed">
        {records.length === 0 ? (
          <p className="p-3 text-white/35">
            No events yet — switch to simulation mode, launch a ping, then step.
          </p>
        ) : (
          <table className="w-full">
            <tbody>
              {records.map((r) => (
                <LedgerRow key={r.seq} r={r} nodeName={nodeName} onJump={() => seek.mutate(r.seq)} />
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="border-t border-white/10 px-2 py-1 text-[10px] text-white/35">
        Deterministic replay: double-click any row to rewind the lab to that exact event.
        Ledger hash {q.data ? q.data.hash.slice(0, 12) : '—'}…
      </p>
    </div>
  );
}

function LedgerRow({
  r,
  nodeName,
  onJump,
}: {
  r: LedgerRecord;
  nodeName: (id: string) => string;
  onJump: () => void;
}) {
  return (
    <tr
      onDoubleClick={onJump}
      title="Double-click: rewind to this event"
      className="cursor-default border-b border-white/5 hover:bg-white/8"
    >
      <td className="whitespace-nowrap px-2 py-0.5 text-right text-white/35">{r.seq}</td>
      <td className="whitespace-nowrap px-1 py-0.5 text-white/40">{r.t.toFixed(6)}</td>
      <td className={cn('whitespace-nowrap px-1 py-0.5', TYPE_STYLES[r.type] ?? 'text-white/60')}>
        {r.type}
      </td>
      <td className="whitespace-nowrap px-1 py-0.5 text-white/55">
        {r.iface ?? nodeName(r.node)}
      </td>
      <td className="truncate px-2 py-0.5 text-white/75">{r.info ?? ''}</td>
    </tr>
  );
}

function LedgerButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        'flex h-6 items-center gap-0.5 rounded px-1.5 transition-colors',
        disabled ? 'text-white/25' : 'text-white/75 hover:bg-white/10 hover:text-white',
      )}
    >
      {children}
    </button>
  );
}
