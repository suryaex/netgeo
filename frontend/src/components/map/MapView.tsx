/**
 * MapView — satellite map-based network design view (UISP Design Center style).
 *
 * Features:
 *  - Esri World Imagery satellite tiles (free, no key)
 *  - CARTO dark label overlay
 *  - Click-to-place devices (AP, CPE, Tower) with the active tool
 *  - Signal coverage rings (strong→weak gradient via concentric circles)
 *  - Links drawn as polylines colored by RSSI + LOS quality
 *  - Dashed link = blocked LOS, semi-dashed = partial Fresnel obstruction
 *  - Tooltip on hover: RSSI, distance, LOS status, rain attenuation
 *  - Left toolbar (MapToolbar) + right properties panel (MapDevicePanel)
 *  - Welcome onboarding modal (MapOnboardingModal)
 *  - Distance measure tool
 *  - Weather overlay (rain rate indicator)
 *  - LOS checking spinner
 */
import 'leaflet/dist/leaflet.css';
import { useState, useEffect, useRef, useMemo } from 'react';
import {
  MapContainer,
  TileLayer,
  Circle,
  Polygon,
  Polyline,
  CircleMarker,
  Popup,
  Tooltip,
  useMapEvents,
  useMap,
  ZoomControl,
} from 'react-leaflet';
import type { LeafletMouseEvent } from 'leaflet';
import type { NodeModel, LinkModel } from '@/api/types';
import L from 'leaflet';
import {
  useMapStore,
  linkColor,
  haversineM,
  rainRateLabel,
  rssiRampCss,
  coverageGrid,
  type MapDevice,
  type MapLink,
  type MapDeviceKind,
} from '@/store/mapStore';
import { rfApi, type CoverageSite } from '@/api/client';
import {
  fetchOsmTowers,
  towerLabel,
  towerKind,
  fetchOsmBuildings,
  densityColors,
  type OsmTower,
  type OsmBuilding,
} from '@/services/osmService';
import { MAP_TILES, type TileLayerConfig } from '@/config/mapTiles';
import { GIS_LAYERS } from '@/config/gisLayers';
import { MapToolbar } from './MapToolbar';
import { MapDevicePanel } from './MapDevicePanel';
import { MapOnboardingModal } from './MapOnboardingModal';
import { MapLayerSwitcher } from './MapLayerSwitcher';
import { MapSearch } from './MapSearch';
import { GisLayerPanel } from './GisLayerPanel';
import { ElevationProfilePanel } from './ElevationProfilePanel';
import { RfBeamLayer } from './RfBeamLayer';
import { DeviceLibraryModal } from './DeviceLibraryModal';
import { Layers as LayersIcon, AlertTriangle } from 'lucide-react';
import { useUiStore } from '@/store/uiStore';
import { useTopologyStore } from '@/store/topologyStore';
import { cn } from '@/lib/cn';
import { zc } from '@/theme/z';
import { MapDeployMenu } from './MapDeployMenu';

// Prevent default marker icon 404 errors in Vite. We use CircleMarker, not Marker.
delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)['_getIconUrl'];
L.Icon.Default.mergeOptions({ iconUrl: '', iconRetinaUrl: '', shadowUrl: '' });

/* -------------------------------------------------------------------------- */
/* Signal coverage color stops (strong → weak, outermost ring = weakest)      */
/* -------------------------------------------------------------------------- */
const COVERAGE_RINGS = [
  { pct: 0.25, color: '#34C759', opacity: 0.20 }, // strong core
  { pct: 0.5,  color: '#A3E635', opacity: 0.13 },
  { pct: 0.75, color: '#FFCC00', opacity: 0.09 },
  { pct: 1.0,  color: '#FF453A', opacity: 0.05 }, // weak edge
];

/* -------------------------------------------------------------------------- */
/* Device kind display (legacy mapStore devices)                               */
/* -------------------------------------------------------------------------- */
const KIND_COLOR: Record<MapDeviceKind, string> = {
  ap: '#5856D6',
  cpe: '#007AFF',
  tower: '#FF9F0A',
};

const KIND_LABEL: Record<MapDeviceKind, string> = {
  ap: 'AP',
  cpe: 'CPE',
  tower: 'TWR',
};

/* -------------------------------------------------------------------------- */
/* Topology node kind → map color + label (real backend nodes)                 */
/* -------------------------------------------------------------------------- */
const NODE_KIND_COLOR: Record<string, string> = {
  router:   '#2F6BFF',
  switch:   '#27C28B',
  host:     '#8A93A6',
  ap:       '#7C5CFC',
  cpe:      '#007AFF',
  olt:      '#F5A623',
  firewall: '#FF4D4F',
  server:   '#27B5C2',
  cloud:    '#6B7280',
};

const NODE_KIND_LABEL: Record<string, string> = {
  router: 'RTR', switch: 'SW', host: 'HOST',
  ap: 'AP', cpe: 'CPE', olt: 'OLT',
  firewall: 'FW', server: 'SRV', cloud: 'CLD',
};

/* -------------------------------------------------------------------------- */
/* LOS dash pattern                                                            */
/* -------------------------------------------------------------------------- */
function losDashArray(los: MapLink['los']): string {
  if (los === 'blocked') return '8 6';
  if (los === 'partial') return '14 4';
  return '0'; // clear = solid
}

/* -------------------------------------------------------------------------- */
/* OSM tower kind styling                                                       */
/* -------------------------------------------------------------------------- */
const OSM_KIND_COLOR: Record<string, string> = {
  bts:       '#FF6B00', // orange — mobile BTS
  mast:      '#E040FB', // purple — generic mast
  microwave: '#00E5FF', // cyan — microwave link
  broadcast: '#FFD600', // yellow — broadcast tower
};

const OSM_KIND_LABEL: Record<string, string> = {
  bts:       'BTS',
  mast:      'MAST',
  microwave: 'MW',
  broadcast: 'TX',
};

/**
 * OsmTowerLayer — fetches existing telecom towers from OpenStreetMap and
 * renders them as small diamond-shaped markers so they are visually distinct
 * from user-placed devices.
 *
 * Fetches are triggered whenever the map viewport changes (moveend) and the
 * zoom level is >= 12 (avoids fetching too large an area).
 */
function OsmTowerLayer() {
  const map = useMap();
  const [towers, setTowers] = useState<OsmTower[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const safetyRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reqSeqRef = useRef(0);

  useEffect(() => {
    let mounted = true;

    const clearSafety = () => {
      if (safetyRef.current) {
        clearTimeout(safetyRef.current);
        safetyRef.current = null;
      }
    };

    const load = () => {
      if (map.getZoom() < 12) {
        setTowers([]);
        setLoading(false);
        clearSafety();
        return;
      }
      if (debounceRef.current) clearTimeout(debounceRef.current);
      // Debounce 600 ms to avoid hammering Overpass during rapid pan
      debounceRef.current = setTimeout(() => {
        const bounds = map.getBounds();
        const seq = ++reqSeqRef.current;
        setLoading(true);

        // Safety net: never let the loading indicator hang. If the request is
        // still pending after 27 s (slow/unreachable Overpass, rate-limit),
        // clear the flag regardless of whether the promise has settled.
        clearSafety();
        safetyRef.current = setTimeout(() => {
          if (mounted) setLoading(false);
        }, 27_000);

        fetchOsmTowers(
          bounds.getSouth(),
          bounds.getWest(),
          bounds.getNorth(),
          bounds.getEast(),
        )
          .then((result) => {
            // Ignore stale responses superseded by a newer pan/zoom.
            if (!mounted || seq !== reqSeqRef.current) return;
            setTowers(result);
          })
          .catch(() => {
            // fetchOsmTowers already degrades to [] on error; this is a final
            // safeguard so a rejection can never leave loading stuck.
            if (!mounted || seq !== reqSeqRef.current) return;
            setTowers([]);
          })
          .finally(() => {
            // Always clear loading for the current request — even on network
            // error, CORS failure, or Overpass rate-limit.
            if (!mounted || seq !== reqSeqRef.current) return;
            clearSafety();
            setLoading(false);
          });
      }, 600);
    };

    map.on('moveend', load);
    map.on('zoomend', load);
    load(); // initial load

    return () => {
      mounted = false;
      map.off('moveend', load);
      map.off('zoomend', load);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      clearSafety();
    };
  }, [map]);

  return (
    <>
      {towers.map((tower) => {
        const kind = towerKind(tower);
        const color = OSM_KIND_COLOR[kind] ?? '#FF6B00';
        const label = OSM_KIND_LABEL[kind] ?? 'BTS';
        const name = towerLabel(tower);

        return (
          <CircleMarker
            key={tower.id}
            center={[tower.lat, tower.lng]}
            radius={6}
            // Reference-only, not a selectable NetGeo endpoint (design 12-UI §3.2):
            // hollow, dashed outline + muted so it reads clearly apart from the
            // solid, filled AP/tower device markers.
            pathOptions={{
              color,
              fillOpacity: 0,
              weight: 1.5,
              opacity: 0.55,
              dashArray: '3 3',
            }}
          >
            <Tooltip
              permanent={false}
              direction="top"
              offset={[0, -8]}
              className="ng-map-label"
            >
              <span style={{ color, fontWeight: 600, fontSize: 10 }}>
                [{label}] {name}
              </span>
            </Tooltip>
            <Popup>
              <div className="min-w-[160px] space-y-1 p-1">
                <p className="text-sm font-bold" style={{ color }}>
                  {name}
                </p>
                <p className="text-xs text-gray-500">
                  OSM ID: {tower.id} · Type: {label}
                </p>
                {tower.tags.operator && (
                  <p className="text-xs text-gray-600">Operator: {tower.tags.operator}</p>
                )}
                {tower.tags.height && (
                  <p className="text-xs text-gray-600">Height: {tower.tags.height} m</p>
                )}
                <p className="font-mono text-[10px] text-gray-400">
                  {tower.lat.toFixed(6)}, {tower.lng.toFixed(6)}
                </p>
                <p className="text-[9px] text-gray-400 italic">
                  Source: OpenStreetMap contributors
                </p>
              </div>
            </Popup>
          </CircleMarker>
        );
      })}

      {/* Loading indicator — small badge top-left */}
      {loading && (
        <div
          style={{
            position: 'absolute',
            top: 8,
            left: 60,
            zIndex: 1001,
            background: 'rgba(0,0,0,0.65)',
            color: '#FF6B00',
            borderRadius: 6,
            padding: '2px 8px',
            fontSize: 10,
            pointerEvents: 'none',
          }}
        >
          Loading OSM towers…
        </div>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* OSM building footprints — Phase B2 population & building density            */
/* -------------------------------------------------------------------------- */
/**
 * OsmBuildingsLayer — fetches OSM building footprints for the viewport and
 * renders them as translucent polygons. When `densityMode` is on the same
 * footprints are shaded on a green→red ramp by local building count, giving a
 * population-density proxy without a second data provider.
 *
 * Only loads at zoom >= 16 (footprints are dense); mirrors the tower layer's
 * debounce + stale-response + safety-timeout handling.
 */
function OsmBuildingsLayer({ densityMode }: { densityMode: boolean }) {
  const map = useMap();
  const [buildings, setBuildings] = useState<OsmBuilding[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const safetyRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reqSeqRef = useRef(0);

  useEffect(() => {
    let mounted = true;
    const clearSafety = () => {
      if (safetyRef.current) {
        clearTimeout(safetyRef.current);
        safetyRef.current = null;
      }
    };

    const load = () => {
      if (map.getZoom() < 16) {
        setBuildings([]);
        setLoading(false);
        clearSafety();
        return;
      }
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        const bounds = map.getBounds();
        const seq = ++reqSeqRef.current;
        setLoading(true);
        clearSafety();
        safetyRef.current = setTimeout(() => {
          if (mounted) setLoading(false);
        }, 27_000);

        fetchOsmBuildings(bounds.getSouth(), bounds.getWest(), bounds.getNorth(), bounds.getEast())
          .then((result) => {
            if (!mounted || seq !== reqSeqRef.current) return;
            setBuildings(result);
          })
          .catch(() => {
            if (!mounted || seq !== reqSeqRef.current) return;
            setBuildings([]);
          })
          .finally(() => {
            if (!mounted || seq !== reqSeqRef.current) return;
            clearSafety();
            setLoading(false);
          });
      }, 600);
    };

    map.on('moveend', load);
    map.on('zoomend', load);
    load();

    return () => {
      mounted = false;
      map.off('moveend', load);
      map.off('zoomend', load);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      clearSafety();
    };
  }, [map]);

  const colors = densityMode ? densityColors(buildings.map((b) => b.center)) : null;

  return (
    <>
      {buildings.map((b, i) => {
        const color = (colors ? colors[i] : null) ?? '#4C9AFF';
        return (
          <Polygon
            key={b.id}
            positions={b.ring}
            pathOptions={{
              color,
              weight: densityMode ? 0.5 : 1,
              fillColor: color,
              fillOpacity: densityMode ? 0.55 : 0.2,
              opacity: densityMode ? 0.5 : 0.6,
            }}
          />
        );
      })}

      {loading && (
        <div
          style={{
            position: 'absolute',
            top: 8,
            left: 60,
            zIndex: 1001,
            background: 'rgba(0,0,0,0.65)',
            color: '#4C9AFF',
            borderRadius: 6,
            padding: '2px 8px',
            fontSize: 10,
            pointerEvents: 'none',
          }}
        >
          {densityMode ? 'Loading density…' : 'Loading buildings…'}
        </div>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* RF coverage raster — Phase B4 best-server RSSI overlay                       */
/* -------------------------------------------------------------------------- */
/**
 * RfCoverageLayer — asks the backend RF engine for a best-server RSSI raster
 * over the current viewport (one transmitter per placed AP/Tower), paints it to
 * an offscreen canvas coloured by the shared RSSI ramp, and drops it on the map
 * as a single translucent `L.imageOverlay`.
 *
 * ponytail: one canvas → one image overlay beats thousands of <Rectangle>s; the
 * browser's bilinear scaling of the tiny cols×rows canvas gives a smooth heat
 * surface for free. Recompute on pan/zoom / device edits; opacity is a cheap
 * setOpacity, never a refetch. Mirrors the tower layer's debounce + stale-guard
 * + safety-timeout so a slow/failed request never wedges the UI.
 */
function RfCoverageLayer() {
  const map = useMap();
  const deviceMap = useMapStore((s) => s.devices);
  const opacity = useMapStore((s) => s.gisLayers['rf-coverage']?.opacity ?? 0.55);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ok' | 'empty' | 'error'>('idle');
  const [siteCount, setSiteCount] = useState(0);
  const overlayRef = useRef<L.ImageOverlay | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const safetyRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reqSeqRef = useRef(0);

  // AP/Tower devices → transmitter sites (device edits change this reference).
  const sites = useMemo<CoverageSite[]>(
    () =>
      Array.from(deviceMap.values())
        .filter((d) => d.kind === 'ap' || d.kind === 'tower')
        .map((d) => ({
          lat: d.lat,
          lon: d.lng,
          height_m: d.antennaHeight,
          tx_power_dbm: d.txPower,
          freq_mhz: d.frequency * 1000, // GHz → MHz
        })),
    [deviceMap],
  );

  // Dedicated pane so the raster sits above the basemap/GIS tiles but below all
  // vector overlays (rings, towers, device dots, links) → devices stay visible.
  useEffect(() => {
    if (!map.getPane('rfCoverage')) {
      const p = map.createPane('rfCoverage');
      p.style.zIndex = '350'; // tilePane=200 < 350 < overlayPane=400
      p.style.pointerEvents = 'none';
    }
  }, [map]);

  useEffect(() => {
    let mounted = true;
    const clearSafety = () => {
      if (safetyRef.current) {
        clearTimeout(safetyRef.current);
        safetyRef.current = null;
      }
    };
    const removeOverlay = () => {
      overlayRef.current?.remove();
      overlayRef.current = null;
    };

    const load = () => {
      setSiteCount(sites.length);
      if (sites.length === 0) {
        removeOverlay();
        setStatus('empty');
        clearSafety();
        return;
      }
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        const b = map.getBounds();
        const south = b.getSouth();
        const west = b.getWest();
        const north = b.getNorth();
        const east = b.getEast();
        const midLat = (south + north) / 2;
        const midLon = (west + east) / 2;
        const widthM = haversineM(midLat, west, midLat, east);
        const heightM = haversineM(south, midLon, north, midLon);
        const { rows, cols } = coverageGrid(widthM / Math.max(heightM, 1e-6));

        const seq = ++reqSeqRef.current;
        setStatus('loading');
        clearSafety();
        safetyRef.current = setTimeout(() => {
          if (mounted && seq === reqSeqRef.current) setStatus('error');
        }, 12_000);

        rfApi
          .coverage({
            sites,
            technology: 'wifi_5ghz',
            model_id: 'fspl',
            rows,
            cols,
            min_lat: south,
            min_lon: west,
            max_lat: north,
            max_lon: east,
            rx_height_m: 1.5,
          })
          .then((res) => {
            if (!mounted || seq !== reqSeqRef.current) return;
            // Paint one pixel per cell; flip vertically (backend row 0 = south,
            // canvas y=0 = north) so the overlay aligns to its bounds.
            const canvas = document.createElement('canvas');
            canvas.width = res.cols;
            canvas.height = res.rows;
            const ctx = canvas.getContext('2d');
            if (!ctx) return;
            for (let y = 0; y < res.rows; y++) {
              const srcRow = res.values[res.rows - 1 - y];
              for (let x = 0; x < res.cols; x++) {
                const dbm = srcRow?.[x] ?? -120;
                // Below usable sensitivity: leave the cell transparent so the
                // overlay reads as a coverage footprint, not a full-map tint.
                if (dbm < -95) continue;
                ctx.fillStyle = rssiRampCss(dbm);
                ctx.fillRect(x, y, 1, 1);
              }
            }
            const url = canvas.toDataURL();
            const imgBounds: [[number, number], [number, number]] = [
              [res.bounds.min_lat, res.bounds.min_lon],
              [res.bounds.max_lat, res.bounds.max_lon],
            ];
            removeOverlay();
            overlayRef.current = L.imageOverlay(url, imgBounds, {
              opacity,
              interactive: false,
              pane: 'rfCoverage',
            }).addTo(map);
            setStatus('ok');
          })
          .catch(() => {
            if (!mounted || seq !== reqSeqRef.current) return;
            removeOverlay();
            setStatus('error');
          })
          .finally(() => {
            if (!mounted || seq !== reqSeqRef.current) return;
            clearSafety();
          });
      }, 600);
    };

    map.on('moveend', load);
    map.on('zoomend', load);
    load();

    return () => {
      mounted = false;
      map.off('moveend', load);
      map.off('zoomend', load);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      clearSafety();
      removeOverlay();
    };
    // opacity intentionally excluded — handled by the setOpacity effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, sites]);

  // Opacity is a cheap live update — never trigger a recompute for it.
  useEffect(() => {
    overlayRef.current?.setOpacity(opacity);
  }, [opacity]);

  return (
    <div className={cn('pointer-events-none absolute bottom-10 left-4', zc.workspace)}>
      <div className="rounded-xl border border-fg/15 bg-recess/60 px-3 py-2 shadow-glass backdrop-blur">
        <p className="mb-1.5 flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-wider text-fg/40">
          RF Coverage
          {status === 'loading' && (
            <span className="inline-block h-2 w-2 animate-spin rounded-full border-2 border-fg/25 border-t-fg/70" />
          )}
        </p>

        {status === 'empty' ? (
          <p className="max-w-[150px] text-[10px] leading-snug text-fg/45">
            Place an AP or Tower to compute best-server coverage.
          </p>
        ) : status === 'error' ? (
          <p className="max-w-[150px] text-[10px] leading-snug text-danger/80">
            Coverage compute failed — pan or retry.
          </p>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-fg/60">−95</span>
              <span
                className="h-2.5 w-24 rounded-full"
                style={{
                  background:
                    'linear-gradient(90deg, #FF453A 0%, #FFCC00 40%, #A3E635 70%, #34C759 100%)',
                }}
              />
              <span className="text-[10px] text-fg/60">−55</span>
            </div>
            <p className="mt-1 text-[9px] text-fg/35">
              dBm · best-server · {siteCount} site{siteCount === 1 ? '' : 's'}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Elevation-profile line — endpoints + connecting line while the tool is used  */
/* -------------------------------------------------------------------------- */
function ProfileLine() {
  const pts = useMapStore((s) => s.profilePts);
  if (pts.length === 0) return null;
  return (
    <>
      {pts.length === 2 && (
        <Polyline
          positions={pts}
          pathOptions={{ color: '#A0785A', weight: 2.5, opacity: 0.9, dashArray: '2 6' }}
        />
      )}
      {pts.map(([lat, lng], i) => (
        <CircleMarker
          key={`${lat},${lng},${i}`}
          center={[lat, lng]}
          radius={6}
          pathOptions={{ color: '#FFFFFF', fillColor: '#A0785A', fillOpacity: 0.95, weight: 2 }}
        >
          <Tooltip permanent direction="top" offset={[0, -8]} className="ng-map-label">
            <span style={{ color: '#C79A73', fontWeight: 700, fontSize: 10 }}>
              {i === 0 ? 'TX' : 'RX'}
            </span>
          </Tooltip>
        </CircleMarker>
      ))}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Map event handler: device placement + distance measure + deploy             */
/* -------------------------------------------------------------------------- */

/** Deploy menu anchor — pixel coords + geo coords of the map click. */
interface DeployAnchor {
  px: { x: number; y: number };
  lat: number;
  lon: number;
}

function MapEventHandler({
  onDeployClick,
}: {
  onDeployClick: (anchor: DeployAnchor) => void;
}) {
  const tool = useMapStore((s) => s.tool);
  const setTool = useMapStore((s) => s.setTool);
  const addDevice = useMapStore((s) => s.addDevice);
  const selectDevice = useMapStore((s) => s.selectDevice);
  const addProfilePoint = useMapStore((s) => s.addProfilePoint);
  const setSearchResult = useMapStore((s) => s.setSearchResult);
  const flashNotice = useMapStore((s) => s.flashNotice);
  const deviceList = useMapStore((s) => s.deviceList());
  // Measure segment: start set on 1st click, end on 2nd (freezes the label).
  const [measure, setMeasure] = useState<
    { start: [number, number]; end: [number, number] | null } | null
  >(null);

  // Leaving the measure tool clears its line.
  useEffect(() => {
    if (tool !== 'measure') setMeasure(null);
  }, [tool]);

  useMapEvents({
    click(e: LeafletMouseEvent) {
      const { lat, lng } = e.latlng;

      // Any map click (outside the pin, which stops propagation) dismisses a
      // lingering geocoding search marker.
      if (useMapStore.getState().searchResult) setSearchResult(null);

      if (tool === 'select') {
        selectDevice(null);
        return;
      }

      if (tool === 'profile') {
        addProfilePoint(lat, lng);
        return;
      }

      if (tool === 'measure') {
        setMeasure((m) =>
          !m || m.end ? { start: [lat, lng], end: null } : { start: m.start, end: [lat, lng] },
        );
        return;
      }

      // Deploy tool: show the popover at the click pixel position
      if (tool === 'deploy') {
        const cp = e.containerPoint;
        onDeployClick({ px: { x: cp.x, y: cp.y }, lat, lon: lng });
        return;
      }

      const kind = tool as MapDeviceKind;

      // Reject stacking a device on top of an existing one (< 5 m): coincident
      // AP/tower/CPE markers hide each other and skew coverage/link math.
      const tooClose = deviceList.find((d) => haversineM(d.lat, d.lng, lat, lng) < 5);
      if (tooClose) {
        flashNotice(`Too close to ${tooClose.name} (< 5 m) — zoom in or pick another spot.`);
        return;
      }

      const count = deviceList.filter((d) => d.kind === kind).length + 1;

      addDevice({
        name: `${KIND_LABEL[kind]}-${count}`,
        kind,
        lat,
        lng,
        txPower: kind === 'tower' ? 27 : 20,
        frequency: 5,
        range: kind === 'tower' ? 2000 : 500,
        antennaHeight: kind === 'tower' ? 30 : 6, // metres AGL
        ip: '',
      });
      // Multi-point flow (UISP-style): after an AP goes down, the natural next
      // step is placing its CPE clients — switch so the hint guides the user.
      if (kind === 'ap') setTool('cpe');
    },
  });

  // In-map measure result: line + glass distance label (non-blocking, replaces
  // the old alert()). Only while the measure tool is active with both endpoints.
  if (tool !== 'measure' || !measure?.end) return null;
  const { start, end } = measure;
  const dist = haversineM(start[0], start[1], end[0], end[1]);
  return (
    <Polyline
      positions={[start, end]}
      pathOptions={{ color: '#2DD4BF', weight: 2.5, opacity: 0.9, dashArray: '4 6' }}
    >
      <Tooltip permanent direction="top" className="ng-map-label">
        <span style={{ fontWeight: 700, fontSize: 10 }}>
          {Math.round(dist).toLocaleString()} m · {(dist / 1000).toFixed(2)} km
        </span>
      </Tooltip>
    </Polyline>
  );
}

/* -------------------------------------------------------------------------- */
/* Device marker: coverage rings + circle marker + tooltip + popup            */
/* -------------------------------------------------------------------------- */
function DeviceMarker({ device }: { device: MapDevice }) {
  const selectDevice = useMapStore((s) => s.selectDevice);
  const selectedId = useMapStore((s) => s.selectedDeviceId);
  const isSelected = selectedId === device.id;
  const color = KIND_COLOR[device.kind];

  return (
    <>
      {/* Coverage gradient rings (AP and Tower only) */}
      {device.kind !== 'cpe' &&
        COVERAGE_RINGS.map((ring) => (
          <Circle
            key={ring.pct}
            center={[device.lat, device.lng]}
            radius={device.range * ring.pct}
            pathOptions={{
              color: ring.color,
              fillColor: ring.color,
              fillOpacity: ring.opacity,
              opacity: ring.opacity * 1.6,
              weight: 1,
              interactive: false,
            }}
          />
        ))}

      {/* Device dot */}
      <CircleMarker
        center={[device.lat, device.lng]}
        radius={isSelected ? 14 : 10}
        pathOptions={{
          color: isSelected ? '#FFFFFF' : color,
          fillColor: color,
          fillOpacity: 0.92,
          weight: isSelected ? 3 : 2,
        }}
        eventHandlers={{
          click: (e) => {
            L.DomEvent.stopPropagation(e);
            selectDevice(device.id);
          },
        }}
      >
        {/* Permanent name label above the dot */}
        <Tooltip permanent direction="top" offset={[0, -14]} className="ng-map-label">
          <span style={{ color, fontWeight: 700, fontSize: 10 }}>
            {device.name}
          </span>
        </Tooltip>

        {/* Click popup with full info */}
        <Popup>
          <div className="min-w-[160px] space-y-1.5 p-1">
            <p className="text-sm font-bold" style={{ color }}>
              {device.name}
            </p>
            <p className="text-xs text-gray-600">
              {device.kind.toUpperCase()} · {device.frequency} GHz · {device.txPower} dBm TX
            </p>
            <p className="text-xs text-gray-500">
              Antenna: {device.antennaHeight} m AGL · Range: {device.range} m
            </p>
            <p className="font-mono text-[10px] text-gray-400">
              {device.lat.toFixed(6)}, {device.lng.toFixed(6)}
            </p>
            {device.ip && (
              <p className="font-mono text-xs font-semibold text-blue-600">{device.ip}</p>
            )}
          </div>
        </Popup>
      </CircleMarker>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Link polyline with LOS-aware styling                                        */
/* -------------------------------------------------------------------------- */
function LinkPolyline({
  link, from, to,
}: {
  link: MapLink;
  from: MapDevice;
  to: MapDevice;
}) {
  const color = linkColor(link);
  const dashArray = losDashArray(link.los);
  const effectiveRssi = link.rssi - link.obstructionDb;

  const losLabel =
    link.los === 'clear' ? 'Line of sight: Clear ✓' :
    link.los === 'partial' ? 'Partial Fresnel obstruction ⚠' :
    link.los === 'blocked' ? 'LOS blocked ✗' :
    'LOS unknown (checking…)';

  return (
    <Polyline
      positions={[
        [from.lat, from.lng],
        [to.lat, to.lng],
      ]}
      pathOptions={{
        color,
        weight: link.los === 'blocked' ? 2 : 2.5,
        opacity: link.los === 'blocked' ? 0.7 : 0.9,
        dashArray,
      }}
    >
      <Popup>
        <div className="min-w-[180px] space-y-1.5 p-1">
          <p className="text-sm font-bold" style={{ color }}>
            RSSI: {effectiveRssi.toFixed(1)} dBm
          </p>
          <div className="text-xs text-gray-600 space-y-0.5">
            <p>Distance: {link.distance.toLocaleString()} m</p>
            <p>FSPL RSSI: {link.rssi.toFixed(1)} dBm</p>
            {link.rainDb > 0 && <p>Rain fade: −{link.rainDb.toFixed(1)} dB</p>}
            {link.obstructionDb > 0 && <p>Terrain loss: −{link.obstructionDb.toFixed(1)} dB</p>}
            <p>Fresnel r₁: {link.fresnelM} m</p>
          </div>
          <p
            className="text-xs font-medium"
            style={{
              color:
                link.los === 'clear' ? '#34C759' :
                link.los === 'partial' ? '#FFCC00' :
                link.los === 'blocked' ? '#FF453A' :
                '#8E8E93',
            }}
          >
            {losLabel}
          </p>
          <p className="text-[10px] text-gray-400">
            {from.name} → {to.name}
          </p>
        </div>
      </Popup>
    </Polyline>
  );
}

/* -------------------------------------------------------------------------- */
/* Topology node marker — renders real backend nodes that have lat/lon         */
/* -------------------------------------------------------------------------- */

function TopologyNodeMarker({ node }: { node: NodeModel }) {
  const select = useTopologyStore((s) => s.select);
  const selectedId = useTopologyStore((s) => s.selectedNodeId);
  const isSelected = selectedId === node.id;
  const color = NODE_KIND_COLOR[node.kind] ?? '#8A93A6';
  const label = NODE_KIND_LABEL[node.kind] ?? node.kind.toUpperCase();

  return (
    <CircleMarker
      center={[node.lat!, node.lon!]}
      radius={isSelected ? 12 : 8}
      pathOptions={{
        color: isSelected ? '#FFFFFF' : color,
        fillColor: color,
        fillOpacity: 0.9,
        weight: isSelected ? 3 : 2,
      }}
      eventHandlers={{
        click: (e) => {
          L.DomEvent.stopPropagation(e);
          select({ nodeId: node.id });
        },
      }}
    >
      <Tooltip permanent direction="top" offset={[0, -12]} className="ng-map-label">
        <span style={{ color, fontWeight: 700, fontSize: 10 }}>
          [{label}] {node.name}
        </span>
      </Tooltip>
      <Popup>
        <div className="min-w-[160px] space-y-1 p-1">
          <p className="text-sm font-bold" style={{ color }}>{node.name}</p>
          <p className="text-xs text-gray-500">{node.kind.toUpperCase()} · {node.status}</p>
          <p className="font-mono text-[10px] text-gray-400">
            {node.lat?.toFixed(6)}, {node.lon?.toFixed(6)}
          </p>
        </div>
      </Popup>
    </CircleMarker>
  );
}

/* -------------------------------------------------------------------------- */
/* Topology link polyline — dashed for wireless, solid cyan for cabled         */
/* -------------------------------------------------------------------------- */
function TopologyLinkLayer({
  links,
  nodeById,
}: {
  links: LinkModel[];
  nodeById: Map<string, NodeModel>;
}) {
  // Resolve node for a link endpoint — endpoint may be a node id or iface id;
  // we look up by finding the node whose ifaces include the endpoint.
  function nodeForEndpoint(ref: string): NodeModel | undefined {
    // Direct node id match (the most common case after auto-mint)
    const direct = nodeById.get(ref);
    if (direct) return direct;
    // Fall back to iface id scan
    for (const n of nodeById.values()) {
      if (n.interfaces.some((i) => i.id === ref)) return n;
    }
    return undefined;
  }

  return (
    <>
      {links.map((link) => {
        const a = nodeForEndpoint(link.a_iface);
        const b = nodeForEndpoint(link.b_iface);
        if (!a || !b) return null;
        if (a.lat == null || a.lon == null || b.lat == null || b.lon == null) return null;

        const isWireless = link.type === 'wireless';
        return (
          <Polyline
            key={link.id}
            positions={[
              [a.lat, a.lon],
              [b.lat, b.lon],
            ]}
            pathOptions={{
              color: isWireless ? '#7C5CFC' : '#27B5C2',
              weight: 2,
              opacity: 0.85,
              dashArray: isWireless ? '6 4' : undefined,
            }}
          >
            <Tooltip direction="center" className="ng-map-label">
              <span style={{ fontSize: 10 }}>
                {a.name} ↔ {b.name} · {link.type}
              </span>
            </Tooltip>
          </Polyline>
        );
      })}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* ResizeObserver: fix tile blank-on-layout-shift by calling invalidateSize    */
/* -------------------------------------------------------------------------- */
function MapResizeWatcher() {
  const map = useMap();
  const containerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const el = map.getContainer();
    containerRef.current = el;

    let timer: ReturnType<typeof setTimeout> | null = null;
    const obs = new ResizeObserver(() => {
      if (timer) clearTimeout(timer);
      // ponytail: 150ms debounce — drawer animation ~180ms, so this fires after settle
      timer = setTimeout(() => map.invalidateSize(), 150);
    });
    obs.observe(el);
    return () => {
      obs.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, [map]);

  return null;
}

/* -------------------------------------------------------------------------- */
/* Signal legend                                                               */
/* -------------------------------------------------------------------------- */
function SignalLegend() {
  const rainRate = useMapStore((s) => s.rainRate);
  const checkingLos = useMapStore((s) => s.checkingLos);
  const triggerLosCheck = useMapStore((s) => s.triggerLosCheck);

  return (
    <div className={cn('pointer-events-auto absolute bottom-10 right-4 space-y-2', zc.workspace)}>
      {/* LOS check button */}
      <button
        onClick={() => void triggerLosCheck()}
        disabled={checkingLos}
        className="glass-strong flex w-full items-center justify-center gap-1.5 rounded-lg border border-fg/15 px-3 py-1.5 text-xs text-fg/80 transition-colors hover:border-accent/40 hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
      >
        {checkingLos ? (
          <>
            <span className="inline-block h-2.5 w-2.5 animate-spin rounded-full border-2 border-fg/30 border-t-fg/80" />
            Checking LOS…
          </>
        ) : (
          'Check Line of Sight'
        )}
      </button>

      {/* Signal legend */}
      <div className="glass-strong rounded-xl border border-fg/15 px-3 py-2 shadow-glass">
        <p className="mb-1.5 text-[9px] font-semibold uppercase tracking-wider text-fg/60">
          Signal Quality
        </p>
        <div className="flex flex-col gap-0.5">
          {[
            { label: 'Strong', color: '#34C759', range: '> −55 dBm' },
            { label: 'Good',   color: '#A3E635', range: '−55 to −70' },
            { label: 'Fair',   color: '#FFCC00', range: '−70 to −80' },
            { label: 'Weak',   color: '#FF453A', range: '< −80 dBm' },
          ].map(({ label, color, range }) => (
            <div key={label} className="flex items-center gap-2">
              <span className="h-2 w-5 rounded-sm" style={{ background: color }} />
              <span className="text-[10px] text-fg/80">{label}</span>
              <span className="ml-auto text-[9px] text-fg/55">{range}</span>
            </div>
          ))}
        </div>

        <div className="my-1.5 border-t border-fg/10" />

        <p className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-fg/60">
          LOS Status
        </p>
        <div className="flex flex-col gap-0.5">
          {[
            { label: 'Clear', dash: 'solid', color: '#34C759' },
            { label: 'Partial', dash: 'dashed', color: '#FFCC00' },
            { label: 'Blocked', dash: 'dotted', color: '#FF453A' },
          ].map(({ label, dash, color }) => (
            <div key={label} className="flex items-center gap-2">
              <span
                className="h-0.5 w-5"
                style={{
                  background: color,
                  borderTop: `2px ${dash} ${color}`,
                  height: 0,
                  display: 'block',
                }}
              />
              <span className="text-[10px] text-fg/80">{label}</span>
            </div>
          ))}
        </div>

        {/* Weather indicator */}
        {rainRate > 0 && (
          <>
            <div className="my-1.5 border-t border-fg/10" />
            <div className="flex items-center gap-1.5">
              <span className="text-xs">🌧</span>
              <span className="text-[10px] text-info">
                {rainRateLabel(rainRate)} ({rainRate} mm/hr)
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Cursor hint strip (bottom center)                                           */
/* -------------------------------------------------------------------------- */
const TOOL_HINTS: Record<string, string> = {
  select: 'Click a device to select it • Delete key removes selected device',
  deploy: 'Click the map to deploy a real device — choose wireless or cabled',
  ap: 'Click the map to place an Access Point (legacy, local-only)',
  cpe: 'Click the map to place a CPE client (legacy, local-only)',
  tower: 'Click the map to place a Tower (legacy, local-only)',
  measure: 'Click two points to measure distance',
  profile: 'Click two points to draw a terrain elevation profile',
};

function ToolHint() {
  const tool = useMapStore((s) => s.tool);
  return (
    <div className={cn('pointer-events-none absolute bottom-6 left-1/2 -translate-x-1/2', zc.workspace)}>
      <div className="rounded-full border border-fg/15 bg-recess/55 px-4 py-1.5 text-xs text-fg/55 shadow-glass backdrop-blur">
        {TOOL_HINTS[tool] ?? ''}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Transient notice (top-center) — non-blocking placement warnings etc.        */
/* -------------------------------------------------------------------------- */
function MapNotice() {
  const notice = useMapStore((s) => s.mapNotice);
  if (!notice) return null;
  return (
    <div className={cn('pointer-events-none absolute left-1/2 top-16 -translate-x-1/2', zc.toast)}>
      <div className="flex items-center gap-2 rounded-full border border-warning/40 bg-recess/80 px-4 py-1.5 text-xs text-fg/85 shadow-glass backdrop-blur animate-fade-in">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning" />
        {notice}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Weather bar (top-center, only when rain > 0)                               */
/* -------------------------------------------------------------------------- */
function WeatherBar() {
  const rainRate = useMapStore((s) => s.rainRate);
  if (rainRate === 0) return null;
  return (
    <div className={cn('pointer-events-none absolute left-1/2 top-4 -translate-x-1/2', zc.workspace)}>
      <div className="flex items-center gap-2 rounded-full border border-blue-400/30 bg-blue-900/60 px-4 py-1.5 text-xs text-blue-200 backdrop-blur">
        <span>🌧</span>
        <span>
          {rainRateLabel(rainRate)} — {rainRate} mm/hr · Rain fade active
        </span>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Geocoding search result — flyTo + temporary marker (Phase B3)               */
/* -------------------------------------------------------------------------- */
function SearchResultLayer() {
  const result = useMapStore((s) => s.searchResult);
  const map = useMap();
  useEffect(() => {
    if (result) map.flyTo([result.lat, result.lng], 16, { duration: 1.2 });
  }, [result, map]);
  if (!result) return null;
  return (
    <CircleMarker
      center={[result.lat, result.lng]}
      radius={9}
      pathOptions={{ color: '#FF9F0A', weight: 3, fillColor: '#FF9F0A', fillOpacity: 0.35 }}
      eventHandlers={{ click: (e) => L.DomEvent.stopPropagation(e) }}
    >
      <Tooltip permanent direction="top" offset={[0, -12]}>
        {result.label}
      </Tooltip>
    </CircleMarker>
  );
}

/* -------------------------------------------------------------------------- */
/* Basemap tiles — layer-aware (Satellite / Street / Hybrid + label overlay)   */
/* -------------------------------------------------------------------------- */
function BaseTiles() {
  const mapLayer = useMapStore((s) => s.mapLayer);
  const cfg: TileLayerConfig = MAP_TILES[mapLayer];
  return (
    <>
      <TileLayer
        key={`base-${mapLayer}`}
        url={cfg.url}
        attribution={cfg.attribution}
        maxZoom={cfg.maxZoom ?? 19}
        {...(cfg.subdomains ? { subdomains: cfg.subdomains } : {})}
      />
      {cfg.overlay && (
        <TileLayer
          key={`overlay-${mapLayer}`}
          url={cfg.overlay.url}
          attribution={cfg.overlay.attribution}
          opacity={cfg.overlay.opacity ?? 1}
          maxZoom={cfg.maxZoom ?? 19}
        />
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* GIS overlay tiles — renders every visible tile-backed GIS layer in order    */
/* -------------------------------------------------------------------------- */
function GisOverlayTiles() {
  const gisLayers = useMapStore((s) => s.gisLayers);
  return (
    <>
      {GIS_LAYERS.filter((l) => l.kind === 'tile').map((layer) => {
        const state = gisLayers[layer.id];
        if (!state?.visible || !layer.tileUrl) return null;
        return (
          <TileLayer
            key={`gis-${layer.id}`}
            url={layer.tileUrl}
            attribution={layer.attribution ?? ''}
            opacity={state.opacity}
            maxZoom={layer.maxZoom ?? 19}
            {...(layer.subdomains ? { subdomains: layer.subdomains } : {})}
          />
        );
      })}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* GIS layer panel toggle (top-right, above the gradient legend)               */
/* -------------------------------------------------------------------------- */
function GisLayerToggle() {
  const open = useMapStore((s) => s.gisPanelOpen);
  const togglePanel = useMapStore((s) => s.toggleGisPanel);
  return (
    <button
      onClick={() => togglePanel()}
      aria-label="Toggle GIS layers"
      aria-pressed={open}
      title="GIS layers"
      className={cn(
        'pointer-events-auto absolute right-4 top-16 grid h-9 w-9 place-items-center rounded-lg border border-fg/15 shadow-glass backdrop-blur transition-colors',
        zc.workspace,
        open ? 'bg-accent/25 text-accent' : 'bg-recess/55 text-fg/70 hover:text-fg',
      )}
    >
      <LayersIcon className="h-4 w-4" />
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* UISP-style Weak↔Strong gradient legend (top-right)                          */
/* -------------------------------------------------------------------------- */
function GradientLegend() {
  return (
    <div className={cn('pointer-events-none absolute right-4 top-3', zc.workspace)}>
      <div className="glass-strong rounded-xl border border-fg/15 px-3 py-2 shadow-glass">
        <p className="mb-1.5 text-[9px] font-semibold uppercase tracking-wider text-fg/60">
          Signal Strength
        </p>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-fg/60">Weak</span>
          <span
            className="h-2.5 w-28 rounded-full"
            style={{
              background:
                'linear-gradient(90deg, #FF453A 0%, #FFCC00 40%, #A3E635 70%, #34C759 100%)',
            }}
          />
          <span className="text-[10px] text-fg/60">Strong</span>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Main MapView                                                                */
/* -------------------------------------------------------------------------- */
export function MapView({ rfMode = false }: { rfMode?: boolean } = {}) {
  const devices = useMapStore((s) => s.deviceList());
  const links = useMapStore((s) => s.linkList());
  const mapCenter = useMapStore((s) => s.mapCenter);
  const mapZoom = useMapStore((s) => s.mapZoom);
  const showOnboarding = useMapStore((s) => s.showOnboarding);
  const activeModal = useUiStore((s) => s.activeModal);
  const openModal = useUiStore((s) => s.openModal);
  const devById = useMapStore((s) => s.devices);

  // Topology nodes/links — the real backend data set rendered as map markers
  const topoNodes = useTopologyStore((s) => s.nodeList());
  const topoLinks = useTopologyStore((s) => s.linkList());
  const topoNodeById = useTopologyStore((s) => s.nodes);

  // Geo-filtered: only nodes with lat+lon appear as map markers
  const geoNodes = useMemo(
    () => topoNodes.filter((n) => n.lat != null && n.lon != null),
    [topoNodes],
  );

  // Deploy menu state
  const [deployAnchor, setDeployAnchor] = useState<{
    px: { x: number; y: number };
    lat: number;
    lon: number;
  } | null>(null);

  // First visit to the standalone map claims the shared modal slot for the
  // quickstart (never in RF, which owns its own chrome). Exclusive by construction.
  useEffect(() => {
    if (rfMode || !showOnboarding) return;
    if (useUiStore.getState().activeModal === null) openModal('mapOnboarding');
  }, [rfMode, showOnboarding, openModal]);
  const towersVisible = useMapStore((s) => s.gisLayers['util-tower']?.visible ?? false);
  const buildingsVisible = useMapStore((s) => s.gisLayers['pop-buildings']?.visible ?? false);
  const densityVisible = useMapStore((s) => s.gisLayers['pop-density']?.visible ?? false);
  const coverageVisible = useMapStore((s) => s.gisLayers['rf-coverage']?.visible ?? false);

  return (
    <div className="relative h-full w-full overflow-hidden">
      <MapContainer
        center={mapCenter}
        zoom={mapZoom}
        zoomControl={false}
        /* isolate: give Leaflet its own stacking context so its internal panes
           and controls (z-index up to 1000) can never leak out and paint over
           the sibling overlay chrome (toolbar / layer switcher / legends at
           zc.workspace=100). Without this, a settled map hides those overlays
           and they only flash back during the transform Leaflet applies while
           zooming — the "controls disappear until you zoom" glitch. */
        className="isolate h-full w-full"
        style={{ background: 'var(--ng-surface, #0d1117)' }}
      >
        {/* Layer-aware basemap — Satellite / Street / Hybrid (see MapLayerSwitcher) */}
        <BaseTiles />

        {/* GIS overlay tiles — terrain/transportation layers stacked on basemap */}
        <GisOverlayTiles />

        <ZoomControl position="bottomright" />

        {/* Fix tile blank on layout resize (drawer open/close, panel resize) */}
        <MapResizeWatcher />

        {/* Map interaction */}
        <MapEventHandler onDeployClick={setDeployAnchor} />

        {/* OSM existing telecom towers — gated by the GIS "Telecom Towers" layer */}
        {towersVisible && <OsmTowerLayer />}

        {/* OSM building footprints / density — one fetch, density shading wins */}
        {(buildingsVisible || densityVisible) && (
          <OsmBuildingsLayer densityMode={densityVisible} />
        )}

        {/* RF coverage raster — best-server RSSI overlay for placed AP/Towers */}
        {coverageVisible && <RfCoverageLayer />}

        {/* Geocoding search — flyTo + temporary marker */}
        <SearchResultLayer />

        {/* Elevation-profile tool line + endpoints */}
        <ProfileLine />

        {/* ------------------------------------------------------------------ */}
        {/* Topology links from backend — drawn before nodes so nodes sit on top */}
        {/* ------------------------------------------------------------------ */}
        <TopologyLinkLayer links={topoLinks} nodeById={topoNodeById} />

        {/* Topology node markers (real backend nodes with geo coords) */}
        {geoNodes.map((node) => (
          <TopologyNodeMarker key={node.id} node={node} />
        ))}

        {/* Legacy mapStore links (RF-only planning, will fade as deploy is adopted) */}
        {links.map((link) => {
          const from = devById.get(link.fromId);
          const to = devById.get(link.toId);
          if (!from || !to) return null;
          return (
            <LinkPolyline key={link.id} link={link} from={from} to={to} />
          );
        })}

        {/* Legacy mapStore device markers — kept for RF planning / coverage rings */}
        {devices.map((dev) => (
          <DeviceMarker key={dev.id} device={dev} />
        ))}

        {/* RF workspace: the PtP beam between the two chosen endpoints */}
        {rfMode && <RfBeamLayer />}
      </MapContainer>

      {/* Overlay UI */}
      <MapSearch />
      <MapToolbar />
      {/* RF mode owns the right dock + bottom bar, so suppress the generic map
          chrome that would collide (device panel, signal legend, tool hint,
          center-bottom elevation panel). */}
      {!rfMode && <MapDevicePanel />}
      {!rfMode && <SignalLegend />}
      {/* Signal-strength gradient only describes the RF coverage raster — show it
          only when that layer is on, so it doesn't float over the top bar/popovers. */}
      {coverageVisible && <GradientLegend />}
      <GisLayerToggle />
      <GisLayerPanel />
      {!rfMode && <ToolHint />}
      <MapNotice />
      <WeatherBar />
      <MapLayerSwitcher />
      {!rfMode && <ElevationProfilePanel />}

      {/* Deploy popover — positioned in absolute px coords over the map */}
      {deployAnchor && (
        <MapDeployMenu
          px={deployAnchor.px}
          lat={deployAnchor.lat}
          lon={deployAnchor.lon}
          onClose={() => setDeployAnchor(null)}
        />
      )}

      {/* First-run + device library — share the single exclusive modal slot. */}
      {activeModal === 'mapOnboarding' && <MapOnboardingModal />}
      {activeModal === 'deviceLibrary' && <DeviceLibraryModal />}
    </div>
  );
}
