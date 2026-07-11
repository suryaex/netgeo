/**
 * MapLayerSwitcher — basemap selector (Satellite / Street / Hybrid), bottom-left.
 * Mirrors the UISP Design Center layer toggle. Backed by `mapStore.mapLayer`
 * and the free, key-less providers in `config/mapTiles.ts`.
 */
import { Satellite, Map as MapIcon, Layers, Moon, Mountain } from 'lucide-react';
import { useMapStore } from '@/store/mapStore';
import type { MapTileKey } from '@/config/mapTiles';
import { cn } from '@/lib/cn';
import { zc } from '@/theme/z';

const LAYERS: { key: MapTileKey; label: string; icon: typeof Satellite }[] = [
  { key: 'satellite', label: 'Satellite', icon: Satellite },
  { key: 'street', label: 'Street', icon: MapIcon },
  { key: 'hybrid', label: 'Hybrid', icon: Layers },
  { key: 'dark', label: 'Dark', icon: Moon },
  { key: 'topo', label: 'Topo', icon: Mountain },
];

export function MapLayerSwitcher() {
  const mapLayer = useMapStore((s) => s.mapLayer);
  const setMapLayer = useMapStore((s) => s.setMapLayer);

  return (
    <div className={cn('pointer-events-auto absolute bottom-10 left-4', zc.workspace)}>
      <div
        className="glass-strong flex gap-1 rounded-xl border border-fg/15 p-1 shadow-glass-lg"
        role="group"
        aria-label="Map layer"
      >
        {LAYERS.map(({ key, label, icon: Icon }) => {
          const active = mapLayer === key;
          return (
            <button
              key={key}
              onClick={() => setMapLayer(key)}
              aria-pressed={active}
              className={cn(
                'flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors',
                active ? 'bg-accent/25 text-accent' : 'text-fg/55 hover:bg-fg/10 hover:text-fg',
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
