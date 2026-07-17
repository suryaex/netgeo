/**
 * NavigationRail — 64px icon rail, the app's primary navigation (design §3.2).
 * Topology/Map/Twin/RF/Fiber/Education/Physical Plant switch the workspace view.
 * Labs opens the Scenarios modal, Diagnostics opens the shared drawer (in a
 * canvas mode), Settings opens the Settings modal. Projects opens the Projects
 * Portal workspace (card grid of every project).
 */
import {
  FolderKanban,
  Network,
  Map as MapIcon,
  Boxes,
  RadioTower,
  Cable,
  Server,
  FileCode2,
  Siren,
  FlaskConical,
  GraduationCap,
  Activity,
  Settings2,
  type LucideIcon,
} from 'lucide-react';
import { useUiStore, type ViewMode } from '@/store/uiStore';
import { cn } from '@/lib/cn';

type RailItem = {
  key: string;
  label: string;
  icon: LucideIcon;
} & ({ view: ViewMode } | { action: 'scenarios' | 'diagnostics' | 'settings' } | { soon: true });

const ITEMS: RailItem[] = [
  { key: 'projects', label: 'Projects', icon: FolderKanban, view: 'projects' },
  { key: 'topology', label: 'Topology', icon: Network, view: 'topology' },
  { key: 'map', label: 'Map', icon: MapIcon, view: 'map' },
  { key: 'twin', label: 'Digital Twin', icon: Boxes, view: 'twin' },
  { key: 'rf', label: 'RF Planning', icon: RadioTower, view: 'rf' },
  { key: 'fiber', label: 'Fiber / FTTH', icon: Cable, view: 'fiber' },
  { key: 'edu', label: 'Education Lab', icon: GraduationCap, view: 'edu' },
  { key: 'plant', label: 'Physical Plant', icon: Server, view: 'plant' },
  { key: 'config', label: 'Config Center', icon: FileCode2, view: 'config' },
  { key: 'problems', label: 'Problem Center', icon: Siren, view: 'problems' },
  { key: 'labs', label: 'Labs', icon: FlaskConical, action: 'scenarios' },
  { key: 'diag', label: 'Diagnostics', icon: Activity, action: 'diagnostics' },
];

const SETTINGS: RailItem = { key: 'settings', label: 'Settings', icon: Settings2, action: 'settings' };

export function NavigationRail() {
  const viewMode = useUiStore((s) => s.viewMode);
  const setViewMode = useUiStore((s) => s.setViewMode);
  const openModal = useUiStore((s) => s.openModal);
  const activeModal = useUiStore((s) => s.activeModal);
  const openDrawer = useUiStore((s) => s.openDrawer);

  const isActive = (item: RailItem): boolean => {
    if ('view' in item) return viewMode === item.view;
    if ('action' in item) {
      if (item.action === 'settings') return activeModal === 'settings';
      if (item.action === 'scenarios') return activeModal === 'scenarios';
    }
    return false;
  };

  const activate = (item: RailItem) => {
    if ('view' in item) {
      setViewMode(item.view);
    } else if ('action' in item && item.action === 'settings') {
      openModal('settings');
    } else if ('action' in item && item.action === 'scenarios') {
      openModal('scenarios');
    } else if ('action' in item && item.action === 'diagnostics') {
      // Diagnostics is a drawer tab (topology/map only) — hop to topology if the
      // current workspace can't host the drawer, then open it.
      const vm = useUiStore.getState().viewMode;
      if (vm !== 'topology' && vm !== 'map') setViewMode('topology');
      openDrawer('diagnostics');
    }
  };

  return (
    <nav
      aria-label="Primary"
      className="panel flex w-16 shrink-0 flex-col items-center gap-1 border-r border-fg/10 py-3"
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
