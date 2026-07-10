/**
 * NavigationRail — 64px icon rail, the app's primary navigation (design §3.2).
 * Topology/Map switch the workspace view; Physical Plant/Labs/Diagnostics/
 * Settings open their floating windows. Modules without a workspace yet
 * (Projects, Digital Twin, RF, Fiber) are shown but disabled with a tooltip so
 * the rail reflects the full product map without dead/lying controls.
 */
import {
  FolderKanban,
  Network,
  Map as MapIcon,
  Boxes,
  RadioTower,
  Cable,
  Server,
  FlaskConical,
  Activity,
  Settings2,
  type LucideIcon,
} from 'lucide-react';
import { useUiStore } from '@/store/uiStore';
import { useWindowStore, type WindowKind } from '@/store/windowStore';
import { cn } from '@/lib/cn';

type RailItem = {
  key: string;
  label: string;
  icon: LucideIcon;
} & (
  | { view: 'topology' | 'map' }
  | { window: WindowKind; title: string }
  | { soon: true }
);

const ITEMS: RailItem[] = [
  { key: 'projects', label: 'Projects', icon: FolderKanban, soon: true },
  { key: 'topology', label: 'Topology', icon: Network, view: 'topology' },
  { key: 'map', label: 'Map', icon: MapIcon, view: 'map' },
  { key: 'twin', label: 'Digital Twin', icon: Boxes, soon: true },
  { key: 'rf', label: 'RF Planning', icon: RadioTower, soon: true },
  { key: 'fiber', label: 'Fiber / FTTH', icon: Cable, soon: true },
  { key: 'plant', label: 'Physical Plant', icon: Server, window: 'racks', title: 'Rack Elevation' },
  { key: 'labs', label: 'Labs', icon: FlaskConical, window: 'scenarios', title: 'Scenarios' },
  { key: 'diag', label: 'Diagnostics', icon: Activity, window: 'diagnostics', title: 'Diagnostics' },
];

const SETTINGS: RailItem = { key: 'settings', label: 'Settings', icon: Settings2, window: 'settings', title: 'Settings' };

export function NavigationRail() {
  const viewMode = useUiStore((s) => s.viewMode);
  const setViewMode = useUiStore((s) => s.setViewMode);
  const toggleApp = useWindowStore((s) => s.toggleApp);
  const windows = useWindowStore((s) => s.windows);
  const openKinds = new Set(Object.values(windows).map((w) => w.kind));

  const isActive = (item: RailItem): boolean => {
    if ('view' in item) return viewMode === item.view;
    if ('window' in item) return openKinds.has(item.window);
    return false;
  };

  const activate = (item: RailItem) => {
    if ('view' in item) setViewMode(item.view);
    else if ('window' in item) toggleApp(item.window, item.title);
  };

  return (
    <nav
      aria-label="Primary"
      className="panel z-[500] flex w-16 shrink-0 flex-col items-center gap-1 border-r border-fg/10 py-3"
    >
      {ITEMS.map((item) => (
        <RailButton key={item.key} item={item} active={isActive(item)} onClick={() => activate(item)} />
      ))}
      <div className="flex-1" />
      <RailButton item={SETTINGS} active={isActive(SETTINGS)} onClick={() => activate(SETTINGS)} />
    </nav>
  );
}

function RailButton({ item, active, onClick }: { item: RailItem; active: boolean; onClick: () => void }) {
  const soon = 'soon' in item;
  const Icon = item.icon;
  return (
    <button
      onClick={onClick}
      disabled={soon}
      aria-label={soon ? `${item.label} (coming soon)` : item.label}
      aria-current={active ? 'page' : undefined}
      title={soon ? `${item.label} — coming in a later phase` : item.label}
      className={cn(
        'group relative grid h-11 w-11 place-items-center rounded-lg transition-colors',
        soon && 'cursor-not-allowed opacity-35',
        !soon && active && 'bg-accent/20 text-accent',
        !soon && !active && 'text-fg/55 hover:bg-fg/8 hover:text-fg/90',
      )}
    >
      {/* Active indicator bar */}
      <span
        className={cn(
          'absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r bg-accent transition-opacity',
          active ? 'opacity-100' : 'opacity-0',
        )}
        aria-hidden
      />
      <Icon className="h-5 w-5" />
    </button>
  );
}
