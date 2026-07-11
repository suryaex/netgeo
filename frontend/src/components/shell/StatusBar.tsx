/**
 * StatusBar — thin bottom context strip (design §3, bottom row). Read-only view
 * of the current selection, graph size, simulation state/time and connection.
 * Everything derives from existing stores; no new state, no side effects.
 */
import { Activity, AlertTriangle, CircleDot, FileCode2, ListVideo, TerminalSquare, type LucideIcon } from 'lucide-react';
import type { ConnState } from '@/api/ws';
import { useUiStore, type DrawerTab } from '@/store/uiStore';
import { useTopologyStore } from '@/store/topologyStore';
import { cn } from '@/lib/cn';

const SIM_LABEL: Record<string, string> = {
  idle: 'System ready',
  running: 'Simulation running',
  paused: 'Simulation paused',
};

const DRAWER_TOGGLES: { tab: DrawerTab; label: string; icon: LucideIcon }[] = [
  { tab: 'console', label: 'Console', icon: TerminalSquare },
  { tab: 'diagnostics', label: 'Diagnostics', icon: Activity },
  { tab: 'ledger', label: 'Event Ledger', icon: ListVideo },
  { tab: 'config', label: 'Config', icon: FileCode2 },
];

export function StatusBar({ conn }: { conn: ConnState }) {
  const simState = useUiStore((s) => s.simState);
  const simTime = useUiStore((s) => s.simTime);
  const viewMode = useUiStore((s) => s.viewMode);
  const drawerOpen = useUiStore((s) => s.drawerOpen);
  const drawerTab = useUiStore((s) => s.drawerTab);
  const openDrawer = useUiStore((s) => s.openDrawer);
  const nodeCount = useTopologyStore((s) => s.nodes.size);
  const linkCount = useTopologyStore((s) => s.links.size);
  const selectedNode = useTopologyStore((s) => s.selectedNode());
  const selectedLinkId = useTopologyStore((s) => s.selectedLinkId);
  const dropped = useUiStore((s) => s.simMetrics?.dropped ?? 0);

  const online = conn === 'open';
  const drawerHosted = viewMode === 'topology' || viewMode === 'map';
  const selection = selectedNode ? selectedNode.name : selectedLinkId ? 'Link selected' : 'No selection';

  return (
    <footer className="panel flex h-6 shrink-0 items-center gap-4 border-t border-fg/10 px-3 text-[11px] text-fg/50">
      <span className="flex items-center gap-1.5">
        <CircleDot className={cn('h-3 w-3', simState === 'running' ? 'text-success' : 'text-fg/40')} />
        {SIM_LABEL[simState] ?? simState}
      </span>
      <span className="hidden sm:inline">{selection}</span>
      <span className="hidden tabular-nums md:inline">
        {nodeCount} nodes · {linkCount} links
      </span>
      {drawerHosted && (
        <div className="flex items-center gap-0.5" aria-label="Diagnostics drawer">
          {DRAWER_TOGGLES.map(({ tab, label, icon: Icon }) => {
            const active = drawerOpen && drawerTab === tab;
            return (
              <button
                key={tab}
                onClick={() => openDrawer(tab)}
                aria-label={label}
                aria-pressed={active}
                title={label}
                className={cn(
                  'grid h-5 w-5 place-items-center rounded transition-colors',
                  active ? 'bg-accent/20 text-accent' : 'text-fg/45 hover:bg-fg/10 hover:text-fg/80',
                )}
              >
                <Icon className="h-3 w-3" />
              </button>
            );
          })}
        </div>
      )}
      <div className="flex-1" />
      {dropped > 0 && (
        <span className="flex items-center gap-1 text-warning">
          <AlertTriangle className="h-3 w-3" /> {dropped} dropped
        </span>
      )}
      <span className="hidden tabular-nums lg:inline">t = {simTime.toFixed(2)}s</span>
      <span className={cn('tabular-nums', online ? 'text-success' : 'text-warning')}>{online ? 'online' : conn}</span>
    </footer>
  );
}
