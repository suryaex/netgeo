/**
 * NodePalette — categorized list of draggable device templates.
 * Drag a card onto the TopologyCanvas to create a node. Uses native HTML5 DnD
 * with a custom mime type so the canvas can resolve the template by key.
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
} from 'lucide-react';
import { deviceCatalog, type DeviceTemplate } from '@/data/deviceCatalog';
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
  const query = q.trim().toLowerCase();

  return (
    <div className="flex h-full flex-col">
      <div className="sticky top-0 z-10 border-b border-white/10 bg-white/5 p-2 backdrop-blur">
        <label className="flex items-center gap-2 rounded-md bg-black/20 px-2 py-1.5">
          <Search className="h-3.5 w-3.5 text-white/50" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search devices"
            aria-label="Search devices"
            className="w-full bg-transparent text-xs text-white/90 placeholder:text-white/40 outline-none"
          />
        </label>
      </div>

      <div className="nf-scroll flex-1 space-y-4 overflow-auto p-2">
        {deviceCatalog.map((group) => {
          const devices = group.devices.filter(
            (d) => !query || d.label.toLowerCase().includes(query) || d.kind.includes(query),
          );
          if (devices.length === 0) return null;
          return (
            <section key={group.category}>
              <h3 className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wider text-white/40">
                {group.category}
              </h3>
              <ul className="space-y-1">
                {devices.map((d) => (
                  <PaletteCard key={d.key} device={d} />
                ))}
              </ul>
            </section>
          );
        })}
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
          e.dataTransfer.setData('application/netforge-device', device.key);
          e.dataTransfer.effectAllowed = 'copy';
        }}
        title={device.description}
        className={cn(
          'flex cursor-grab items-center gap-2.5 rounded-md border border-white/10 bg-white/5 p-2',
          'transition-colors hover:border-accent/50 hover:bg-white/10 active:cursor-grabbing',
        )}
      >
        <span
          className="grid h-8 w-8 shrink-0 place-items-center rounded-md"
          style={{ background: `${color}22`, color }}
        >
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-white/90">{device.label}</p>
          <p className="truncate text-[10px] text-white/45">{device.defaultNos.toUpperCase()}</p>
        </div>
      </div>
    </li>
  );
}
