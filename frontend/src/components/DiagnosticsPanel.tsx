/**
 * DiagnosticsPanel — packet-level tooling over the live lab:
 *   - Ping / Traceroute between simulated devices (real DES run per request)
 *   - Packet capture inspector per link (built-in "Wireshark lite")
 *
 * Design: clean tab strip, monospace results, no clutter — every action is
 * one click away, matching the "3 clicks to any feature" rule.
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Activity, ArrowRight, Radio, Route } from 'lucide-react';
import {
  labApi,
  type CaptureRecord,
  type PingResult,
  type TracerouteResult,
} from '@/api/client';
import { useTopologyStore } from '@/store/topologyStore';
import { useUiStore } from '@/store/uiStore';
import { cn } from '@/lib/cn';

type Tab = 'ping' | 'trace' | 'capture';

export function DiagnosticsPanel() {
  const [tab, setTab] = useState<Tab>('ping');
  return (
    <div className="flex h-full flex-col text-[13px]">
      <div className="flex items-center gap-1 border-b border-white/10 px-2 py-1.5">
        <TabButton active={tab === 'ping'} onClick={() => setTab('ping')} icon={Activity}>
          Ping
        </TabButton>
        <TabButton active={tab === 'trace'} onClick={() => setTab('trace')} icon={Route}>
          Traceroute
        </TabButton>
        <TabButton active={tab === 'capture'} onClick={() => setTab('capture')} icon={Radio}>
          Capture
        </TabButton>
      </div>
      <div className="ng-scroll flex-1 overflow-auto p-3">
        {tab === 'ping' && <PingTool />}
        {tab === 'trace' && <TraceTool />}
        {tab === 'capture' && <CaptureTool />}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon: Icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Activity;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-colors',
        active ? 'bg-accent text-white' : 'text-white/55 hover:bg-white/8 hover:text-white/85',
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {children}
    </button>
  );
}

/* ------------------------------ shared bits ------------------------------- */

function useNodeOptions() {
  const nodes = useTopologyStore((s) => s.nodes);
  return useMemo(
    () =>
      Array.from(nodes.values())
        .map((n) => ({ id: n.id, name: n.name, kind: n.kind }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [nodes],
  );
}

function SrcDstRow({
  src,
  setSrc,
  dst,
  setDst,
  onRun,
  running,
  runLabel,
}: {
  src: string;
  setSrc: (v: string) => void;
  dst: string;
  setDst: (v: string) => void;
  onRun: () => void;
  running: boolean;
  runLabel: string;
}) {
  const options = useNodeOptions();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={src}
        onChange={(e) => setSrc(e.target.value)}
        aria-label="Source device"
        className="min-w-[130px] rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-xs outline-none focus:border-accent"
      >
        <option value="">source device…</option>
        {options.map((o) => (
          <option key={o.id} value={o.id} className="bg-neutral-900">
            {o.name} ({o.kind})
          </option>
        ))}
      </select>
      <ArrowRight className="h-3.5 w-3.5 shrink-0 text-white/35" />
      <input
        value={dst}
        onChange={(e) => setDst(e.target.value)}
        list="ng-diag-dst-options"
        placeholder="destination IP or device"
        aria-label="Destination"
        spellCheck={false}
        className="w-[190px] rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-xs outline-none placeholder:text-white/30 focus:border-accent"
      />
      <datalist id="ng-diag-dst-options">
        {options.map((o) => (
          <option key={o.id} value={o.name} />
        ))}
      </datalist>
      <button
        onClick={onRun}
        disabled={!src || !dst || running}
        className={cn(
          'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
          !src || !dst || running
            ? 'bg-white/10 text-white/35'
            : 'bg-accent text-white hover:bg-accent/85',
        )}
      >
        {running ? 'Running…' : runLabel}
      </button>
    </div>
  );
}

function ErrorNote({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="mt-3 rounded-md bg-danger/10 px-3 py-2 text-xs text-danger">{message}</p>;
}

/* --------------------------------- Ping ----------------------------------- */

function PingTool() {
  const projectId = useUiStore((s) => s.projectId);
  const [src, setSrc] = useState('');
  const [dst, setDst] = useState('');

  const m = useMutation<PingResult, { message?: string }>({
    mutationFn: () => labApi.ping(projectId!, src, dst.trim(), 5),
  });

  return (
    <div>
      <SrcDstRow
        src={src}
        setSrc={setSrc}
        dst={dst}
        setDst={setDst}
        onRun={() => m.mutate()}
        running={m.isPending}
        runLabel="Ping"
      />
      <ErrorNote message={m.error?.message} />
      {m.data && (
        <div className="mt-3 rounded-lg border border-white/10 bg-black/25 p-3 font-mono text-xs leading-relaxed">
          <p className="text-white/60">
            {m.data.src} → {m.data.dst}
          </p>
          {m.data.rtts_ms.map((rtt, i) => (
            <p key={i} className="text-emerald-300/90">
              reply seq={i + 1} time={rtt} ms
            </p>
          ))}
          {m.data.errors.map((e, i) => (
            <p key={`e${i}`} className="text-warning">
              {e}
            </p>
          ))}
          <p className={cn('mt-1', m.data.loss_pct === 0 ? 'text-success' : 'text-warning')}>
            {m.data.received}/{m.data.sent} received, {m.data.loss_pct}% loss
            {m.data.avg_ms !== null &&
              ` — rtt min/avg/max ${m.data.min_ms}/${m.data.avg_ms}/${m.data.max_ms} ms`}
          </p>
        </div>
      )}
    </div>
  );
}

/* ------------------------------ Traceroute --------------------------------- */

function TraceTool() {
  const projectId = useUiStore((s) => s.projectId);
  const [src, setSrc] = useState('');
  const [dst, setDst] = useState('');

  const m = useMutation<TracerouteResult, { message?: string }>({
    mutationFn: () => labApi.traceroute(projectId!, src, dst.trim()),
  });

  return (
    <div>
      <SrcDstRow
        src={src}
        setSrc={setSrc}
        dst={dst}
        setDst={setDst}
        onRun={() => m.mutate()}
        running={m.isPending}
        runLabel="Trace"
      />
      <ErrorNote message={m.error?.message} />
      {m.data && (
        <div className="mt-3 rounded-lg border border-white/10 bg-black/25 p-3 font-mono text-xs leading-relaxed">
          <p className="text-white/60">
            {m.data.src} → {m.data.dst}
          </p>
          {m.data.hops.map((h) => (
            <p key={h.hop}>
              <span className="text-white/40">{String(h.hop).padStart(2)} </span>
              <span className={h.address ? 'text-emerald-300/90' : 'text-white/30'}>
                {h.address ?? '*'}
              </span>
              {h.rtt_ms !== null && <span className="text-white/50"> {h.rtt_ms} ms</span>}
            </p>
          ))}
          <p className={cn('mt-1', m.data.reached ? 'text-success' : 'text-warning')}>
            {m.data.reached ? 'Destination reached.' : 'Destination not reached.'}
          </p>
        </div>
      )}
    </div>
  );
}

/* -------------------------------- Capture ---------------------------------- */

function CaptureTool() {
  const projectId = useUiStore((s) => s.projectId);
  const links = useTopologyStore((s) => s.links);
  const [linkId, setLinkId] = useState<string>('');
  const [selected, setSelected] = useState<CaptureRecord | null>(null);

  const q = useQuery({
    queryKey: ['captures', projectId, linkId],
    queryFn: () => labApi.captures(projectId!, linkId || undefined, 300),
    enabled: !!projectId,
    refetchInterval: 4000,
  });

  const linkOptions = useMemo(() => Array.from(links.values()), [links]);

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center gap-2">
        <select
          value={linkId}
          onChange={(e) => setLinkId(e.target.value)}
          aria-label="Capture link filter"
          className="rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-xs outline-none focus:border-accent"
        >
          <option value="">all links</option>
          {linkOptions.map((l) => (
            <option key={l.id} value={l.id} className="bg-neutral-900">
              {l.id.slice(0, 8)} ({l.type})
            </option>
          ))}
        </select>
        <span className="text-xs text-white/40">
          {q.data?.length ?? 0} frames · auto-refresh
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-white/10 bg-black/25 font-mono text-[11px] leading-relaxed">
        {(q.data ?? []).length === 0 ? (
          <p className="p-3 text-white/35">
            No frames captured yet — run a ping or let protocols talk.
          </p>
        ) : (
          <table className="w-full">
            <tbody>
              {(q.data ?? [])
                .slice()
                .reverse()
                .map((r) => (
                  <tr
                    key={`${r.frame_id}-${r.t}-${r.dir}-${r.iface}`}
                    onClick={() => setSelected(r)}
                    className={cn(
                      'cursor-pointer border-b border-white/5 hover:bg-white/8',
                      r.dir === 'drop' && 'text-danger/80',
                    )}
                  >
                    <td className="whitespace-nowrap px-2 py-0.5 text-white/40">
                      {r.t.toFixed(6)}
                    </td>
                    <td className="px-1 py-0.5 uppercase text-white/50">{r.dir}</td>
                    <td className="whitespace-nowrap px-1 py-0.5 text-white/50">{r.iface}</td>
                    <td className="truncate px-2 py-0.5 text-emerald-200/85">{r.info}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
      </div>

      {selected && (
        <div className="max-h-[130px] overflow-auto rounded-lg border border-white/10 bg-black/40 p-2 font-mono text-[11px] text-sky-200/85">
          {Object.entries(selected.layers).map(([layer, fields]) => (
            <p key={layer}>
              <span className="text-white/50">{layer}:</span> {JSON.stringify(fields)}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
