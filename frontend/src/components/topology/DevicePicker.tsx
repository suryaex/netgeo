/**
 * DevicePicker — centered, searchable "Add device" modal (design §5.2).
 * Replaces the permanent NodePalette: opened by the floating [+ Add] button,
 * the `A` shortcut, double-click on empty canvas, or the command palette.
 * Shows recently-used devices first, then categories, with a live text filter.
 * Picking a device places it via the shared placeDevice() flow and closes.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
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
  X,
} from 'lucide-react';
import { deviceCatalog, deviceByKey, type DeviceTemplate } from '@/data/deviceCatalog';
import { nodeColors } from '@/theme/tokens';
import { useTopoUiStore } from '@/store/topoUiStore';
import { useUiStore } from '@/store/uiStore';
import { placeDevice } from '@/lib/placeDevice';
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

const RECENT_KEY = 'netgeo.recentDevices';

function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(arr) ? arr.filter((k) => typeof k === 'string' && k in deviceByKey).slice(0, 6) : [];
  } catch {
    return [];
  }
}

function pushRecent(key: string): void {
  const next = [key, ...loadRecent().filter((k) => k !== key)].slice(0, 6);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* localStorage unavailable — recents are a nicety, not load-bearing */
  }
}

export function DevicePicker() {
  const open = useTopoUiStore((s) => s.pickerOpen);
  const pickerPos = useTopoUiStore((s) => s.pickerPos);
  const closePicker = useTopoUiStore((s) => s.closePicker);
  const projectId = useUiStore((s) => s.projectId);
  const [q, setQ] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus the search field whenever the modal opens; reset the query on close.
  useEffect(() => {
    if (open) {
      setQ('');
      // rAF so the input exists and isn't stolen by the opening keystroke.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const query = q.trim().toLowerCase();
  const recent = useMemo<DeviceTemplate[]>(
    () => (open ? loadRecent().map((k) => deviceByKey[k]).filter((d): d is DeviceTemplate => Boolean(d)) : []),
    [open],
  );

  if (!open) return null;

  const pick = (d: DeviceTemplate) => {
    if (!projectId) return;
    pushRecent(d.key);
    placeDevice(projectId, d.key, pickerPos ?? undefined);
    closePicker();
  };

  const matches = (d: DeviceTemplate) =>
    !query ||
    d.label.toLowerCase().includes(query) ||
    d.kind.includes(query) ||
    d.defaultNos.includes(query) ||
    d.description.toLowerCase().includes(query);

  return (
    <div
      className="fixed inset-0 z-[1200] grid place-items-start justify-center pt-[12vh]"
      role="dialog"
      aria-modal="true"
      aria-label="Add device"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closePicker();
      }}
    >
      {/* Scrim */}
      <div className="absolute inset-0 bg-recess/50 backdrop-blur-sm" aria-hidden />

      <div className="glass-strong relative z-10 flex max-h-[70vh] w-[min(560px,92vw)] flex-col overflow-hidden rounded-xl border border-fg/15 shadow-glass-lg animate-scale-in">
        {/* Search */}
        <div className="flex items-center gap-2 border-b border-fg/10 px-3.5 py-3">
          <Search className="h-4 w-4 shrink-0 text-fg/40" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') closePicker();
              if (e.key === 'Enter') {
                const first = deviceCatalog.flatMap((g) => g.devices).find(matches);
                if (first) pick(first);
              }
            }}
            placeholder="Search devices, templates, vendors…"
            aria-label="Search devices"
            className="w-full bg-transparent text-sm text-fg/90 placeholder:text-fg/35 outline-none"
          />
          <button
            onClick={closePicker}
            aria-label="Close"
            className="grid h-6 w-6 shrink-0 place-items-center rounded text-fg/40 hover:bg-fg/10 hover:text-fg/80"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="ng-scroll flex-1 space-y-4 overflow-auto p-3.5">
          {/* Recent */}
          {!query && recent.length > 0 && (
            <section>
              <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-fg/35">Recent</h3>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {recent.map((d) => (
                  <DeviceButton key={`r-${d.key}`} device={d} onPick={pick} />
                ))}
              </div>
            </section>
          )}

          {/* Categories */}
          {deviceCatalog.map((group) => {
            const devices = group.devices.filter(matches);
            if (devices.length === 0) return null;
            return (
              <section key={group.category}>
                <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-fg/35">
                  {group.category}
                </h3>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {devices.map((d) => (
                    <DeviceButton key={d.key} device={d} onPick={pick} />
                  ))}
                </div>
              </section>
            );
          })}

          {query && deviceCatalog.every((g) => g.devices.every((d) => !matches(d))) && (
            <p className="px-1 py-6 text-center text-sm text-fg/40">No device matches “{q}”.</p>
          )}
        </div>

        <div className="shrink-0 border-t border-fg/8 px-3.5 py-2 text-[10px] text-fg/30">
          Enter to add the first match · Esc to close
        </div>
      </div>
    </div>
  );
}

function DeviceButton({ device, onPick }: { device: DeviceTemplate; onPick: (d: DeviceTemplate) => void }) {
  const Icon = KIND_ICON[device.kind];
  const color = nodeColors[device.kind];
  return (
    <button
      onClick={() => onPick(device)}
      title={device.description}
      className={cn(
        'flex items-center gap-2.5 rounded-lg border border-fg/8 bg-fg/4 p-2.5 text-left',
        'transition-all duration-fast hover:border-fg/20 hover:bg-fg/8 active:scale-[0.98]',
      )}
    >
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md" style={{ background: `${color}1a`, color }}>
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium text-fg/90">{device.label}</span>
        <span className="block truncate text-[10px] text-fg/40">
          {device.defaultNos.toUpperCase()} · {device.kind}
        </span>
      </span>
    </button>
  );
}
