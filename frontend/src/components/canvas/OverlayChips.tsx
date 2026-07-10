/**
 * OverlayChips — canvas top-left protocol/layer overlay toggles (design §6.1).
 * OSPF/BGP/VLAN highlight the member nodes (and links between them) and fade the
 * rest; L2/L3 labels links with their capacity. Pure client-side highlight —
 * membership is read from node intent already in the store, no engine call.
 */
import { useTopoUiStore, type OverlayKey } from '@/store/topoUiStore';
import { cn } from '@/lib/cn';

const CHIPS: { key: OverlayKey; label: string; dot: string }[] = [
  { key: 'ospf', label: 'OSPF', dot: 'bg-accent' },
  { key: 'bgp', label: 'BGP', dot: 'bg-warning' },
  { key: 'vlan', label: 'VLAN', dot: 'bg-success' },
  { key: 'l3', label: 'L2/L3', dot: 'bg-fg/40' },
];

export function OverlayChips() {
  const overlays = useTopoUiStore((s) => s.overlays);
  const toggle = useTopoUiStore((s) => s.toggleOverlay);

  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Canvas overlays">
      {CHIPS.map(({ key, label, dot }) => {
        const active = overlays[key];
        return (
          <button
            key={key}
            onClick={() => toggle(key)}
            aria-pressed={active}
            title={`Toggle ${label} overlay`}
            className={cn(
              'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium shadow-glass transition-colors',
              active
                ? 'border-accent/60 bg-accent/20 text-accent'
                : 'glass border-fg/10 text-fg/60 hover:text-fg/90',
            )}
          >
            <span className={cn('h-1.5 w-1.5 rounded-full', active ? dot : 'bg-fg/25')} aria-hidden />
            {label}
            {active && key !== 'l3' && <span className="text-[9px] text-accent/70">Active</span>}
          </button>
        );
      })}
    </div>
  );
}
