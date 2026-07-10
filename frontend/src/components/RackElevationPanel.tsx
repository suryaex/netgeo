/**
 * RackElevationPanel — the physical-mode rack view (NG-PH-04).
 *
 * A front, RU-accurate elevation of every rack in the project. Devices placed
 * via `node.rack_id` / `ru_start` / `ru_span` render as blocks spanning their
 * rack-units; unplaced devices sit in a tray. Drag a device onto a free RU span
 * to place it (collision-checked, persisted via PATCH /nodes/{id}); per-site
 * power + heat totals roll up from device wattage.
 *
 * It also surfaces the NG-PH-03 teachable failure: cables that exceed their
 * rated length error their link, listed here as warnings so the physical view
 * explains *why* a link is down.
 *
 * ponytail: per-device wattage is estimated per node kind below — the device
 * library (NG-DL-01) carries real chassis watts/RU but the /device-types API
 * doesn't surface them yet. Swap `KIND_WATTS` for the real values once it does.
 */
import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Plus, Server, Zap } from 'lucide-react';
import { nodesApi, physicalApi, projectsApi } from '@/api/client';
import type { NodeModel, Rack, Site } from '@/api/types';
import { useUiStore } from '@/store/uiStore';
import { cn } from '@/lib/cn';

const RU_PX = 24; // on-screen height of one rack-unit
const DEFAULT_RU_HEIGHT = 42;

/** Estimated steady-state draw per node kind, in watts (see ponytail note). */
const KIND_WATTS: Record<string, number> = {
  router: 250,
  switch: 150,
  firewall: 200,
  olt: 300,
  server: 400,
  host: 100,
  ap: 20,
  cloud: 0,
};

function nodeWatts(n: NodeModel): number {
  return KIND_WATTS[n.kind] ?? 150;
}

/** watts → heat load in BTU/hr (1 W ≈ 3.412 BTU/hr). */
function wattsToBtu(w: number): number {
  return Math.round(w * 3.412);
}

interface Dragload {
  nodeId: string;
  span: number;
}

export function RackElevationPanel() {
  const projectId = useUiStore((s) => s.projectId);
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [newSite, setNewSite] = useState('');
  const [newRackName, setNewRackName] = useState('');
  const [newRackSite, setNewRackSite] = useState<string>('');

  const topoQ = useQuery({
    queryKey: ['topology', projectId],
    queryFn: () => projectsApi.topology(projectId!),
    enabled: !!projectId,
  });
  const plantQ = useQuery({
    queryKey: ['plant', projectId],
    queryFn: () => physicalApi.plant(projectId!),
    enabled: !!projectId,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['topology', projectId] });
    queryClient.invalidateQueries({ queryKey: ['plant', projectId] });
  };

  const place = useMutation({
    mutationFn: (v: { nodeId: string; rackId: string; ruStart: number; ruSpan: number }) =>
      nodesApi.update(v.nodeId, {
        rack_id: v.rackId,
        ru_start: v.ruStart,
        ru_span: v.ruSpan,
      }),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: () => setError('Failed to save device placement.'),
  });

  const unplace = useMutation({
    mutationFn: (nodeId: string) =>
      nodesApi.update(nodeId, { rack_id: null, ru_start: null }),
    onSuccess: invalidate,
  });

  const createSite = useMutation({
    mutationFn: (name: string) => physicalApi.createSite({ project_id: projectId!, name }),
    onSuccess: () => {
      setNewSite('');
      invalidate();
    },
  });

  const createRack = useMutation({
    mutationFn: (v: { name: string; siteId: string | null }) =>
      physicalApi.createRack({ project_id: projectId!, name: v.name, site_id: v.siteId }),
    onSuccess: () => {
      setNewRackName('');
      invalidate();
    },
  });

  const nodes = topoQ.data?.nodes ?? [];
  const racks = topoQ.data?.racks ?? [];
  const sites = topoQ.data?.sites ?? [];
  const cables = topoQ.data?.cables ?? [];

  const nodesByRack = useMemo(() => {
    const m = new Map<string, NodeModel[]>();
    for (const n of nodes) {
      if (!n.rack_id) continue;
      const list = m.get(n.rack_id) ?? [];
      list.push(n);
      m.set(n.rack_id, list);
    }
    return m;
  }, [nodes]);

  const unplaced = useMemo(() => nodes.filter((n) => !n.rack_id), [nodes]);

  // Over-length cables (NG-PH-03): join the plant report to cables for names.
  const overLength = useMemo(() => {
    const links = plantQ.data?.links ?? {};
    return cables
      .filter((c) => links[c.link_id]?.over_length)
      .map((c) => ({ cable: c, media: links[c.link_id]?.over_media ?? c.media }));
  }, [cables, plantQ.data]);

  if (!projectId) {
    return <div className="p-6 text-sm text-fg/50">Select a project to view racks.</div>;
  }

  /** Racks grouped under their site (null site_id → an "Unassigned" bucket). */
  const bucketBySite: { site: Site | null; racks: Rack[] }[] = [
    ...sites.map((s) => ({ site: s, racks: racks.filter((r) => r.site_id === s.id) })),
    { site: null, racks: racks.filter((r) => !r.site_id || !sites.some((s) => s.id === r.site_id)) },
  ].filter((b) => b.site !== null || b.racks.length > 0);

  return (
    <div className="flex h-full flex-col bg-panel text-fg/90">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-fg/10 px-3 py-2 text-xs">
        <Server size={14} className="text-fg/50" />
        <span className="font-medium">Rack Elevation</span>
        <span className="text-fg/30">·</span>
        <input
          value={newSite}
          onChange={(e) => setNewSite(e.target.value)}
          placeholder="New site name"
          className="w-32 rounded bg-fg/10 px-2 py-1 outline-none placeholder:text-fg/30"
        />
        <button
          onClick={() => newSite.trim() && createSite.mutate(newSite.trim())}
          className="flex items-center gap-1 rounded bg-fg/10 px-2 py-1 hover:bg-fg/20"
        >
          <Plus size={12} /> Site
        </button>
        <span className="text-fg/30">·</span>
        <input
          value={newRackName}
          onChange={(e) => setNewRackName(e.target.value)}
          placeholder="New rack name"
          className="w-32 rounded bg-fg/10 px-2 py-1 outline-none placeholder:text-fg/30"
        />
        <select
          value={newRackSite}
          onChange={(e) => setNewRackSite(e.target.value)}
          className="rounded bg-fg/10 px-2 py-1 outline-none"
        >
          <option value="">(no site)</option>
          {sites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <button
          onClick={() =>
            newRackName.trim() &&
            createRack.mutate({ name: newRackName.trim(), siteId: newRackSite || null })
          }
          className="flex items-center gap-1 rounded bg-fg/10 px-2 py-1 hover:bg-fg/20"
        >
          <Plus size={12} /> Rack
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-red-500/15 px-3 py-1.5 text-xs text-red-300">
          <AlertTriangle size={13} /> {error}
        </div>
      )}

      {overLength.length > 0 && (
        <div className="border-b border-amber-500/20 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-300">
          <div className="flex items-center gap-1 font-medium">
            <AlertTriangle size={13} /> Cable exceeds maximum length (link errored)
          </div>
          <ul className="mt-1 space-y-0.5 pl-5">
            {overLength.map(({ cable, media }) => (
              <li key={cable.id} className="list-disc text-amber-200/80">
                {cable.label || cable.id.slice(0, 6)} — {media} @ {cable.length_m} m
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* tray of unplaced devices */}
        <div className="w-44 shrink-0 overflow-y-auto border-r border-fg/10 p-2">
          <div className="mb-1 text-[11px] uppercase tracking-wide text-fg/40">
            Unplaced ({unplaced.length})
          </div>
          {unplaced.map((n) => (
            <div
              key={n.id}
              draggable
              onDragStart={(e) =>
                e.dataTransfer.setData(
                  'application/netgeo-device',
                  JSON.stringify({ nodeId: n.id, span: n.ru_span ?? 1 } satisfies Dragload),
                )
              }
              className="mb-1 cursor-grab rounded border border-fg/10 bg-fg/5 px-2 py-1 text-xs hover:bg-fg/10 active:cursor-grabbing"
              title={`${n.kind} · ${nodeWatts(n)} W`}
            >
              {n.name}
              <span className="ml-1 text-fg/40">{n.ru_span ?? 1}U</span>
            </div>
          ))}
          {unplaced.length === 0 && (
            <div className="text-xs text-fg/30">All devices are placed.</div>
          )}
        </div>

        {/* racks grouped by site */}
        <div className="flex-1 overflow-auto p-3">
          {bucketBySite.length === 0 && (
            <div className="text-sm text-fg/40">
              No racks yet. Create a site, then a rack, from the toolbar above.
            </div>
          )}
          {bucketBySite.map((bucket) => {
            const siteNodes = bucket.racks.flatMap((r) => nodesByRack.get(r.id) ?? []);
            const watts = siteNodes.reduce((sum, n) => sum + nodeWatts(n), 0);
            return (
              <div key={bucket.site?.id ?? '_unassigned'} className="mb-6">
                <div className="mb-2 flex items-center gap-2 text-sm">
                  <span className="font-medium">{bucket.site?.name ?? 'No site'}</span>
                  {bucket.site?.region && (
                    <span className="text-fg/40">· {bucket.site.region}</span>
                  )}
                  <span className="ml-2 flex items-center gap-1 text-xs text-amber-300/80">
                    <Zap size={12} /> {watts} W · {wattsToBtu(watts)} BTU/hr
                  </span>
                </div>
                <div className="flex flex-wrap gap-5">
                  {bucket.racks.map((rack) => (
                    <RackColumn
                      key={rack.id}
                      rack={rack}
                      devices={nodesByRack.get(rack.id) ?? []}
                      onPlace={(nodeId, ruStart, ruSpan) =>
                        place.mutate({ nodeId, rackId: rack.id, ruStart, ruSpan })
                      }
                      onUnplace={(nodeId) => unplace.mutate(nodeId)}
                      onError={setError}
                    />
                  ))}
                  {bucket.racks.length === 0 && (
                    <div className="text-xs text-fg/30">This site has no racks yet.</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

interface RackColumnProps {
  rack: Rack;
  devices: NodeModel[];
  onPlace: (nodeId: string, ruStart: number, ruSpan: number) => void;
  onUnplace: (nodeId: string) => void;
  onError: (msg: string | null) => void;
}

function RackColumn({ rack, devices, onPlace, onUnplace, onError }: RackColumnProps) {
  const ruHeight = rack.ru_height || DEFAULT_RU_HEIGHT;
  const bodyRef = useRef<HTMLDivElement>(null);

  /** RUs occupied by every device except `exceptId`. */
  const occupied = (exceptId?: string): Set<number> => {
    const s = new Set<number>();
    for (const d of devices) {
      if (d.id === exceptId || d.ru_start == null) continue;
      const span = d.ru_span ?? 1;
      for (let u = d.ru_start; u < d.ru_start + span; u++) s.add(u);
    }
    return s;
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const raw = e.dataTransfer.getData('application/netgeo-device');
    if (!raw) return;
    let load: Dragload;
    try {
      load = JSON.parse(raw);
    } catch {
      return;
    }
    const body = bodyRef.current;
    if (!body) return;
    const rect = body.getBoundingClientRect();
    // RU 1 sits at the bottom; convert cursor Y (top-down) to a bottom-up RU.
    const yFromBottom = rect.bottom - e.clientY;
    let ruStart = Math.floor(yFromBottom / RU_PX) + 1;
    const span = load.span || 1;
    ruStart = Math.max(1, Math.min(ruStart, ruHeight - span + 1));

    const taken = occupied(load.nodeId);
    for (let u = ruStart; u < ruStart + span; u++) {
      if (taken.has(u)) {
        onError(`Collision at RU ${u} in rack ${rack.name}.`);
        return;
      }
    }
    onError(null);
    onPlace(load.nodeId, ruStart, span);
  };

  return (
    <div className="select-none">
      <div className="mb-1 text-xs font-medium text-fg/70">
        {rack.name} <span className="text-fg/30">{ruHeight}U</span>
      </div>
      <div className="flex">
        {/* RU number gutter (top = highest RU) */}
        <div className="flex flex-col text-right text-[9px] leading-none text-fg/30">
          {Array.from({ length: ruHeight }, (_, i) => ruHeight - i).map((u) => (
            <div key={u} style={{ height: RU_PX }} className="pr-1 pt-0.5">
              {u}
            </div>
          ))}
        </div>
        {/* rack body */}
        <div
          ref={bodyRef}
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
          className="relative w-40 rounded border border-fg/15 bg-recess/40"
          style={{ height: ruHeight * RU_PX }}
        >
          {/* RU gridlines */}
          {Array.from({ length: ruHeight }, (_, i) => (
            <div
              key={i}
              className="absolute inset-x-0 border-t border-fg/5"
              style={{ top: i * RU_PX, height: RU_PX }}
            />
          ))}
          {/* placed devices */}
          {devices
            .filter((d) => d.ru_start != null)
            .map((d) => {
              const span = d.ru_span ?? 1;
              const bottom = (d.ru_start! - 1) * RU_PX;
              return (
                <div
                  key={d.id}
                  draggable
                  onDragStart={(e) =>
                    e.dataTransfer.setData(
                      'application/netgeo-device',
                      JSON.stringify({ nodeId: d.id, span } satisfies Dragload),
                    )
                  }
                  onDoubleClick={() => onUnplace(d.id)}
                  title={`${d.kind} · ${nodeWatts(d)} W — double-click to remove`}
                  className={cn(
                    'absolute inset-x-1 flex cursor-grab items-center justify-center rounded px-1 text-[11px] active:cursor-grabbing',
                    'border border-sky-400/40 bg-sky-500/20 text-sky-900 hover:bg-sky-500/30 dark:text-sky-100',
                  )}
                  style={{ bottom, height: span * RU_PX - 2 }}
                >
                  <span className="truncate">{d.name}</span>
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
}
