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
import { ChevronsRight, Rewind, Search, StepBack, StepForward } from 'lucide-react';
import { labApi, type LedgerRecord } from '@/api/client';
import { parseLedgerInfo } from '@/lib/parseLedgerInfo';
import { useLabStore } from '@/store/labStore';
import { useTopologyStore } from '@/store/topologyStore';
import { useTopoUiStore } from '@/store/topoUiStore';
import { useUiStore } from '@/store/uiStore';
import { cn } from '@/lib/cn';

const TYPE_STYLES: Record<string, string> = {
  PACKET_TX: 'text-sky-300/90',
  PACKET_RX: 'text-emerald-300/90',
  TIMER: 'text-fg/40',
};

export function EventLedgerPanel() {
  const projectId = useUiStore((s) => s.projectId);
  const nodes = useTopologyStore((s) => s.nodes);
  const select = useTopologyStore((s) => s.select);
  const centerOn = useTopoUiStore((s) => s.centerOn);
  const mode = useLabStore((s) => s.mode);
  const setMode = useLabStore((s) => s.setMode);
  const cursor = useLabStore((s) => s.cursor);
  const setCursor = useLabStore((s) => s.setCursor);
  const pushRecords = useLabStore((s) => s.pushRecords);
  const highlightLink = useLabStore((s) => s.highlightLink);
  const [seekTo, setSeekTo] = useState('');
  const [filter, setFilter] = useState('');
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

  // Client-side filter over the columns already on screen (design §6.4 search).
  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return records;
    return records.filter((r) =>
      `${r.seq} ${r.type} ${nodeName(r.node)} ${r.iface ?? ''} ${r.info ?? ''}`
        .toLowerCase()
        .includes(f),
    );
  }, [records, filter, nodes]);

  // Row click (design §6.4): select + center the device and glow its link.
  const pick = (r: LedgerRecord) => {
    select({ nodeId: r.node || null, linkId: r.link ?? null });
    const n = r.node ? nodes.get(r.node) : undefined;
    if (n && centerOn) centerOn(n.x, n.y);
    if (r.link) highlightLink(r.link, r.node, r.info ?? '');
  };

  return (
    <div className="flex h-full flex-col text-[13px]">
      {/* Status + transport strip */}
      <div className="flex flex-wrap items-center gap-2 border-b border-fg/10 px-2 py-1.5">
        <span
          className={cn(
            'rounded-full px-2 py-0.5 text-[11px] font-medium',
            simMode ? 'bg-accent/25 text-accent' : 'bg-fg/10 text-fg/60',
          )}
        >
          {simMode ? 'Simulation' : 'Realtime'}
        </span>
        <span className="font-mono text-[11px] text-fg/50">
          t={q.data ? q.data.sim_time.toFixed(6) : '—'}s · event {total}
          {q.data ? ` · ${q.data.pending_events} queued` : ''}
        </span>

        <div className="relative ml-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-fg/40" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter events…"
            aria-label="Filter events"
            className="w-40 rounded-md border border-fg/10 bg-fg/5 py-1 pl-6 pr-2 text-[11px] outline-none placeholder:text-fg/30 focus:border-accent"
          />
        </div>

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
            className="w-[64px] rounded-md border border-fg/10 bg-fg/5 px-1.5 py-1 font-mono text-[11px] outline-none placeholder:text-fg/30 focus:border-accent"
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

      {/* Ledger records (newest first) — design §6.4 columns, derived client-side */}
      <div className="ng-scroll min-h-0 flex-1 overflow-auto text-[11px] leading-relaxed">
        {records.length === 0 ? (
          <p className="p-3 font-mono text-fg/35">
            No events yet — switch to simulation mode, launch a ping, then step.
          </p>
        ) : filtered.length === 0 ? (
          <p className="p-3 font-mono text-fg/35">No events match “{filter}”.</p>
        ) : (
          <table className="w-full border-collapse">
            <thead className="sticky top-0 z-10">
              <tr className="glass-strong text-left font-display text-[9px] uppercase tracking-wider text-fg/45">
                <th className="px-2 py-1.5 font-medium">Time</th>
                <th className="px-1 py-1.5 font-medium">Device</th>
                <th className="px-1 py-1.5 font-medium">Layer</th>
                <th className="px-1 py-1.5 font-medium">Event</th>
                <th className="px-1 py-1.5 font-medium">Source</th>
                <th className="px-1 py-1.5 font-medium">Destination</th>
                <th className="px-1 py-1.5 font-medium">Proto</th>
                <th className="px-2 py-1.5 font-medium">Result</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {filtered.map((r) => (
                <LedgerRow
                  key={r.seq}
                  r={r}
                  nodeName={nodeName}
                  onPick={() => pick(r)}
                  onJump={() => seek.mutate(r.seq)}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="border-t border-fg/10 px-2 py-1 text-[10px] text-fg/35">
        Deterministic replay: double-click any row to rewind the lab to that exact event.
        Ledger hash {q.data ? q.data.hash.slice(0, 12) : '—'}…
      </p>
    </div>
  );
}

function LedgerRow({
  r,
  nodeName,
  onPick,
  onJump,
}: {
  r: LedgerRecord;
  nodeName: (id: string) => string;
  onPick: () => void;
  onJump: () => void;
}) {
  const c = parseLedgerInfo(r.info);
  const dim = 'text-fg/25';
  return (
    <tr
      onClick={onPick}
      onDoubleClick={onJump}
      title={`Click: locate & highlight · Double-click: rewind to this event\n${r.info ?? ''}`}
      className="cursor-pointer border-b border-fg/5 hover:bg-fg/8"
    >
      <td className="whitespace-nowrap px-2 py-0.5 tabular-nums text-fg/40">{r.t.toFixed(6)}</td>
      <td className="max-w-[110px] truncate px-1 py-0.5 text-fg/70">{nodeName(r.node)}</td>
      <td className={cn('whitespace-nowrap px-1 py-0.5', c.layer === '—' ? dim : 'text-fg/50')}>
        {c.layer}
      </td>
      <td className={cn('whitespace-nowrap px-1 py-0.5', TYPE_STYLES[r.type] ?? 'text-fg/60')}>
        {r.type}
      </td>
      <td className={cn('max-w-[130px] truncate px-1 py-0.5', c.source === '—' ? dim : 'text-fg/65')}>
        {c.source}
      </td>
      <td className={cn('max-w-[130px] truncate px-1 py-0.5', c.destination === '—' ? dim : 'text-fg/65')}>
        {c.destination}
      </td>
      <td className={cn('whitespace-nowrap px-1 py-0.5', c.proto === '—' ? dim : 'text-fg/55')}>
        {c.proto}
      </td>
      <td
        className={cn(
          'whitespace-nowrap px-2 py-0.5 font-medium',
          c.result === 'FAILED' ? 'text-danger' : c.result === 'OK' ? 'text-success/80' : dim,
        )}
      >
        {c.result}
      </td>
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
        disabled ? 'text-fg/25' : 'text-fg/75 hover:bg-fg/10 hover:text-fg',
      )}
    >
      {children}
    </button>
  );
}
