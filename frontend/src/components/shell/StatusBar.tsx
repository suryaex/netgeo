/**
 * StatusBar — thin bottom context strip (design §3, bottom row). Read-only view
 * of the current selection, graph size, simulation state/time and connection.
 * Everything derives from existing stores; no new state, no side effects.
 */
import { AlertTriangle, CircleDot } from 'lucide-react';
import type { ConnState } from '@/api/ws';
import { useUiStore } from '@/store/uiStore';
import { useTopologyStore } from '@/store/topologyStore';
import { cn } from '@/lib/cn';

const SIM_LABEL: Record<string, string> = {
  idle: 'System ready',
  running: 'Simulation running',
  paused: 'Simulation paused',
};

export function StatusBar({ conn }: { conn: ConnState }) {
  const simState = useUiStore((s) => s.simState);
  const simTime = useUiStore((s) => s.simTime);
  const nodeCount = useTopologyStore((s) => s.nodes.size);
  const linkCount = useTopologyStore((s) => s.links.size);
  const selectedNode = useTopologyStore((s) => s.selectedNode());
  const selectedLinkId = useTopologyStore((s) => s.selectedLinkId);
  const dropped = useUiStore((s) => s.simMetrics?.dropped ?? 0);

  const online = conn === 'open';
  const selection = selectedNode ? selectedNode.name : selectedLinkId ? 'Link selected' : 'No selection';

  return (
    <footer className="panel z-[500] flex h-6 shrink-0 items-center gap-4 border-t border-fg/10 px-3 text-[11px] text-fg/50">
      <span className="flex items-center gap-1.5">
        <CircleDot className={cn('h-3 w-3', simState === 'running' ? 'text-success' : 'text-fg/40')} />
        {SIM_LABEL[simState] ?? simState}
      </span>
      <span className="hidden sm:inline">{selection}</span>
      <span className="hidden tabular-nums md:inline">
        {nodeCount} nodes · {linkCount} links
      </span>
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
