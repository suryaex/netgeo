/**
 * NodePalette — categorized list of draggable device templates.
 * Drag a card onto the TopologyCanvas to create a node. Uses native HTML5 DnD
 * with a custom mime type so the canvas can resolve the template by key.
 * Custom NOS entries from nosStore are shown as a count badge on each device.
 */
import { useState } from 'react';
import {
  Router,
  Network,
  Monitor,
  Wifi,
  Cable,
  ShieldAlert,
  Server,
  Cloud,
  Search,
  Package,
} from 'lucide-react';
import { deviceCatalog, type DeviceTemplate } from '@/data/deviceCatalog';
import { useNosStore } from '@/store/nosStore';
import { nodeColors } from '@/theme/tokens';
import type { NodeKind } from '@/api/types';
import { cn } from '@/lib/cn';

const KIND_ICON: Record<NodeKind, typeof Router> = {
  router: Router,
  switch: Network,
  host: Monitor,
  ap: Wifi,
  olt: Cable,
  firewall: ShieldAlert,
  server: Server,
  cloud: Cloud,
};

export function NodePalette() {
  const [q, setQ] = useState('');
  const { customNos } = useNosStore();
  const query = q.trim().toLowerCase();

  return (
    <div className="flex h-full flex-col">
      {/* Search bar */}
      <div className="sticky top-0 z-10 border-b border-fg/10 bg-recess/20 p-2 backdrop-blur">
        <label className="flex items-center gap-2 rounded-md border border-fg/10 bg-recess/25 px-2.5 py-1.5 transition-colors focus-within:border-accent/50">
          <Search className="h-3.5 w-3.5 shrink-0 text-fg/40" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search devices…"
            aria-label="Search devices"
            className="w-full bg-transparent text-xs text-fg/90 placeholder:text-fg/35 outline-none"
          />
        </label>
      </div>

      <div className="ng-scroll flex-1 space-y-5 overflow-auto p-2.5">
        {deviceCatalog.map((group) => {
          const devices = group.devices.filter(
            (d) =>
              !query ||
              d.label.toLowerCase().includes(query) ||
              d.kind.includes(query) ||
              d.defaultNos.includes(query),
          );
          if (devices.length === 0) return null;
          return (
            <section key={group.category}>
              <h3 className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-wider text-fg/35">
                {group.category}
              </h3>
              <ul className="space-y-1.5">
                {devices.map((d) => (
                  <PaletteCard key={d.key} device={d} />
                ))}
              </ul>
            </section>
          );
        })}

        {/* Custom NOS hint at bottom */}
        {customNos.length > 0 && (
          <section>
            <h3 className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-wider text-fg/35">
              Custom OS Available
            </h3>
            <div className="rounded-md border border-fg/8 bg-fg/4 px-3 py-2.5">
              <div className="flex items-center gap-2">
                <Package className="h-4 w-4 text-accent/70 shrink-0" />
                <p className="text-xs text-fg/60">
                  <span className="font-medium text-accent">{customNos.length}</span> custom NOS{' '}
                  {customNos.length === 1 ? 'entry' : 'entries'} available.
                  Select a node to assign them in Properties.
                </p>
              </div>
            </div>
          </section>
        )}
      </div>

      {/* Footer tip */}
      <div className="shrink-0 border-t border-fg/8 px-3 py-2 text-center">
        <p className="text-[10px] text-fg/25">Drag a card onto the canvas to place a device</p>
      </div>
    </div>
  );
}

function PaletteCard({ device }: { device: DeviceTemplate }) {
  const Icon = KIND_ICON[device.kind];
  const color = nodeColors[device.kind];

  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('application/netgeo-device', device.key);
          e.dataTransfer.effectAllowed = 'copy';
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            // keyboard users: could open a dialog to place the node
          }
        }}
        title={device.description}
        className={cn(
          'flex cursor-grab items-center gap-2.5 rounded-lg border border-fg/8 bg-fg/4 p-2.5',
          'transition-all duration-fast hover:border-fg/20 hover:bg-fg/8 active:cursor-grabbing active:scale-[0.98]',
        )}
      >
        {/* Icon */}
        <span
          className="grid h-8 w-8 shrink-0 place-items-center rounded-md"
          style={{ background: `${color}1a`, color }}
        >
          <Icon className="h-4 w-4" />
        </span>

        {/* Info */}
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium text-fg/90">{device.label}</p>
          <p className="truncate text-[10px] text-fg/40">
            {device.defaultNos.toUpperCase()} &middot; {device.kind}
          </p>
        </div>

        {/* Port count badge */}
        <span className="shrink-0 rounded bg-fg/8 px-1.5 py-0.5 text-[9px] font-mono text-fg/35">
          {device.ports.reduce((acc, p) => acc + p.count, 0)}p
        </span>
      </div>
    </li>
  );
}
