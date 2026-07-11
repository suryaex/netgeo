/**
 * RfBeamLayer — the PtP beam drawn on the map between the two chosen endpoints.
 * Rendered inside MapView's <MapContainer> (needs the react-leaflet context).
 * Neutral dashed preview until a result exists, then solid + coloured by the
 * fade-margin status, with a midpoint chip "5.8 GHz · 12.4 km".
 *
 * ponytail: chip is a centred (non-rotated) permanent tooltip. Rotating the pill
 * to the beam bearing is cosmetic — add a CSS transform if visual QA wants it.
 */
import { Polyline, CircleMarker, Tooltip } from 'react-leaflet';
import { useMapStore, haversineM, type MapDevice } from '@/store/mapStore';
import { useRfStore } from '@/store/rfStore';
import { marginStatus, STATUS_COLOR, fmtKm } from '@/components/rf/rfLogic';

function EndpointRing({ d, color }: { d: MapDevice; color: string }) {
  return (
    <CircleMarker
      center={[d.lat, d.lng]}
      radius={12}
      pathOptions={{ color, weight: 2.5, fillColor: color, fillOpacity: 0.12, interactive: false }}
    />
  );
}

export function RfBeamLayer() {
  const aId = useRfStore((s) => s.aId);
  const bId = useRfStore((s) => s.bId);
  const result = useRfStore((s) => s.result);
  const freqGhz = useRfStore((s) => s.freqGhz);
  const devices = useMapStore((s) => s.devices);

  const a = aId ? devices.get(aId) : undefined;
  const b = bId ? devices.get(bId) : undefined;

  // One endpoint picked so far — highlight it while the user picks the second.
  if (!a || !b) {
    const one = a ?? b;
    return one ? <EndpointRing d={one} color="#5C8AFF" /> : null;
  }

  const color = result ? STATUS_COLOR[marginStatus(result.fade_margin_db)] : '#5C8AFF';
  const distM = result?.distance_m ?? haversineM(a.lat, a.lng, b.lat, b.lng);

  return (
    <>
      <Polyline
        positions={[
          [a.lat, a.lng],
          [b.lat, b.lng],
        ]}
        pathOptions={{ color, weight: 3, opacity: 0.95, dashArray: result ? undefined : '6 8' }}
      >
        <Tooltip permanent direction="center" className="ng-map-label" opacity={1}>
          <span style={{ color, fontWeight: 700, fontSize: 10 }}>
            {freqGhz} GHz · {fmtKm(distM)}
          </span>
        </Tooltip>
      </Polyline>
      <EndpointRing d={a} color={color} />
      <EndpointRing d={b} color={color} />
    </>
  );
}
