/**
 * Dock — macOS/Win11-style app launcher pinned to the bottom-center.
 * Each item toggles an app window; open apps get a running indicator dot.
 * Glass pill with a subtle hover magnify (transform scale, GPU-friendly).
 */
import {
  Activity,
  ListVideo,
  Network,
  TerminalSquare,
  FileCode2,
  ListChecks,
  Server,
  Settings2,
} from 'lucide-react';
import { useWindowStore, type WindowKind } from '@/store/windowStore';
import { cn } from '@/lib/cn';

interface DockItem {
  kind: WindowKind;
  title: string;
  icon: typeof Network;
}

// Secondary tools only — the primary canvas (Topology), device picker (was
// "Device Palette") and inspector (was "Properties") now live in the shell,
// not as floating windows, so they're intentionally absent here.
const ITEMS: DockItem[] = [
  { kind: 'console', title: 'Console', icon: TerminalSquare },
  { kind: 'diagnostics', title: 'Diagnostics', icon: Activity },
  { kind: 'ledger', title: 'Event Ledger', icon: ListVideo },
  { kind: 'racks', title: 'Rack Elevation', icon: Server },
  { kind: 'config', title: 'Config Viewer', icon: FileCode2 },
  { kind: 'scenarios', title: 'Scenarios', icon: ListChecks },
  { kind: 'settings', title: 'Settings', icon: Settings2 },
];

export function Dock() {
  const windows = useWindowStore((s) => s.windows);
  const toggleApp = useWindowStore((s) => s.toggleApp);

  const openKinds = new Set(Object.values(windows).map((w) => w.kind));

  return (
    <nav
      aria-label="Application dock"
      className="pointer-events-auto fixed bottom-4 left-1/2 z-[1000] -translate-x-1/2"
    >
      <ul className="glass-strong flex items-end gap-1 rounded-2xl border border-fg/15 px-2 py-2 shadow-dock">
        {ITEMS.map(({ kind, title, icon: Icon }) => {
          const isOpen = openKinds.has(kind);
          return (
            <li key={kind} className="relative">
              <button
                onClick={() => toggleApp(kind, title)}
                aria-label={title}
                aria-pressed={isOpen}
                title={title}
                className={cn(
                  'group grid h-12 w-12 place-items-center rounded-md transition-transform duration-fast',
                  'hover:-translate-y-1.5 hover:scale-110',
                  'bg-fg/5 hover:bg-fg/10',
                )}
              >
                <Icon className="h-6 w-6 text-fg/85 group-hover:text-fg" />
              </button>
              <span
                className={cn(
                  'absolute -bottom-0.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-accent transition-opacity',
                  isOpen ? 'opacity-100' : 'opacity-0',
                )}
              />
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
