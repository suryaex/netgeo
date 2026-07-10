/**
 * ElevationProfilePanel — Phase B1 elevation-profile tool (docs/design/05).
 *
 * Shows the real terrain profile between the two points picked with the map's
 * "Elevation Profile" tool, plus a line-of-sight overlay and a Fresnel/LoS
 * verdict. Terrain + verdict come straight from the backend `los-check`
 * endpoint (which proxies a DEM provider via `app/services/elevation.py`), so
 * no elevation math lives here.
 *
 * The chart is a self-contained inline SVG (no chart dependency): a filled
 * terrain silhouette (area) with a straight TX→RX sight line drawn over it,
 * colored by the verdict. Theme-aware via `fg`/`accent`/status tokens.
 */
import { useEffect, useState } from 'react';
import { Mountain, X, Check, Ban, AlertTriangle, Loader2, RefreshCw } from 'lucide-react';
import { useMapStore, type ProfileData } from '@/store/mapStore';

/* -------------------------------------------------------------------------- */
/* SVG geometry                                                                */
/* -------------------------------------------------------------------------- */
const VB_W = 760;
const VB_H = 200;
const M = { top: 14, right: 14, bottom: 24, left: 46 };
const PLOT_W = VB_W - M.left - M.right;
const PLOT_H = VB_H - M.top - M.bottom;

interface Verdict {
  color: string;   // status token hex (theme-independent, AA on both surfaces)
  dashed: boolean;
  label: string;
  icon: typeof Check;
}

function verdictOf(d: ProfileData): Verdict {
  if (!d.losClear) return { color: '#FF4D4F', dashed: true, label: 'LoS blocked', icon: Ban };
  if (!d.fresnelClear)
    return { color: '#F5A623', dashed: true, label: 'Fresnel partially obstructed', icon: AlertTriangle };
  return { color: '#27C28B', dashed: false, label: 'Line of sight clear', icon: Check };
}

function fmtKm(m: number): string {
  const km = m / 1000;
  return km >= 10 ? `${km.toFixed(1)} km` : `${km.toFixed(2)} km`;
}

/* -------------------------------------------------------------------------- */
/* Chart                                                                       */
/* -------------------------------------------------------------------------- */
function ProfileChart({ data }: { data: ProfileData }) {
  const pts = data.points;
  const total = data.totalDistanceM || pts[pts.length - 1]?.distance_m || 1;
  const { profileTxH, profileRxH } = useMapStore.getState();

  // Antenna tops (metres ASL) anchor the sight line.
  const h1 = (pts[0]?.elevation_m ?? 0) + profileTxH;
  const h2 = (pts[pts.length - 1]?.elevation_m ?? 0) + profileRxH;

  const terrainVals = pts.map((p) => p.elevation_m);
  let yMin = Math.min(...terrainVals);
  let yMax = Math.max(...terrainVals, h1, h2);
  if (yMax - yMin < 1) yMax = yMin + 1; // avoid a zero range on flat terrain
  const pad = (yMax - yMin) * 0.08;
  yMin -= pad;
  yMax += pad;

  const xOf = (d: number) => M.left + (d / total) * PLOT_W;
  const yOf = (v: number) => M.top + (1 - (v - yMin) / (yMax - yMin)) * PLOT_H;
  const baseline = M.top + PLOT_H;

  const terrainLine = pts.map((p) => `${xOf(p.distance_m).toFixed(1)},${yOf(p.elevation_m).toFixed(1)}`).join(' ');
  const terrainArea =
    `M ${xOf(0).toFixed(1)},${baseline.toFixed(1)} ` +
    `L ${terrainLine.split(' ').join(' L ')} ` +
    `L ${xOf(total).toFixed(1)},${baseline.toFixed(1)} Z`;

  const v = verdictOf(data);

  // Axis ticks — endpoints + midpoint keep it readable on small screens.
  const yTicks = [yMin + pad, (yMin + yMax) / 2, yMax - pad];
  const xTicks = [0, total / 2, total];

  return (
    <svg
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      className="h-auto w-full"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={`Elevation profile over ${fmtKm(total)}. ${v.label}. Minimum Fresnel clearance ratio ${data.minClearanceRatio.toFixed(2)}.`}
    >
      {/* Y grid + labels */}
      {yTicks.map((t) => (
        <g key={`y${t}`}>
          <line
            x1={M.left} x2={VB_W - M.right} y1={yOf(t)} y2={yOf(t)}
            className="stroke-fg/10" strokeWidth={1}
          />
          <text
            x={M.left - 6} y={yOf(t) + 3} textAnchor="end"
            className="fill-fg/45" style={{ fontSize: 10 }}
          >
            {Math.round(t)}
          </text>
        </g>
      ))}

      {/* X labels */}
      {xTicks.map((t, i) => (
        <text
          key={`x${t}`} x={xOf(t)} y={VB_H - 8}
          textAnchor={i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'}
          className="fill-fg/45" style={{ fontSize: 10 }}
        >
          {fmtKm(t)}
        </text>
      ))}

      {/* Terrain silhouette */}
      <path d={terrainArea} className="fill-fg/[0.14] stroke-fg/40" strokeWidth={1.5} strokeLinejoin="round" />

      {/* Antenna masts */}
      <line x1={xOf(0)} x2={xOf(0)} y1={yOf(pts[0]?.elevation_m ?? 0)} y2={yOf(h1)} stroke={v.color} strokeWidth={1.5} opacity={0.7} />
      <line x1={xOf(total)} x2={xOf(total)} y1={yOf(pts[pts.length - 1]?.elevation_m ?? 0)} y2={yOf(h2)} stroke={v.color} strokeWidth={1.5} opacity={0.7} />

      {/* Line of sight — ponytail: the Fresnel status is conveyed by the sight-
          line color + verdict chips, not a drawn Fresnel ellipse band. Add the
          ellipse if visual QA wants it. */}
      <line
        x1={xOf(0)} y1={yOf(h1)} x2={xOf(total)} y2={yOf(h2)}
        stroke={v.color} strokeWidth={2}
        strokeDasharray={v.dashed ? '7 5' : undefined}
        strokeLinecap="round"
      />
      {/* Antenna markers */}
      <circle cx={xOf(0)} cy={yOf(h1)} r={4} fill={v.color} />
      <circle cx={xOf(total)} cy={yOf(h2)} r={4} fill={v.color} />
      <text x={xOf(0) + 6} y={yOf(h1) - 6} className="fill-fg/70" style={{ fontSize: 10, fontWeight: 600 }}>TX</text>
      <text x={xOf(total) - 6} y={yOf(h2) - 6} textAnchor="end" className="fill-fg/70" style={{ fontSize: 10, fontWeight: 600 }}>RX</text>
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/* Verdict chips                                                               */
/* -------------------------------------------------------------------------- */
function Chip({ color, icon: Icon, label, value }: { color: string; icon: typeof Check; label: string; value: string }) {
  return (
    <div className="flex items-center gap-1.5 rounded-lg border border-fg/10 bg-recess/40 px-2.5 py-1">
      <Icon className="h-3.5 w-3.5 shrink-0" style={{ color }} />
      <span className="text-[10px] uppercase tracking-wide text-fg/40">{label}</span>
      <span className="ml-auto text-xs font-medium text-fg/80">{value}</span>
    </div>
  );
}

function Summary({ data }: { data: ProfileData }) {
  const v = verdictOf(data);
  return (
    <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
      <Chip color="#5C8AFF" icon={Mountain} label="Distance" value={fmtKm(data.totalDistanceM)} />
      <Chip color={v.color} icon={v.icon} label="Sight line" value={data.losClear ? 'Clear' : 'Blocked'} />
      <Chip
        color={data.fresnelClear ? '#27C28B' : '#F5A623'}
        icon={data.fresnelClear ? Check : AlertTriangle}
        label="Fresnel"
        value={data.fresnelClear ? 'Clear' : 'Obstructed'}
      />
      <Chip
        color={data.worstObstructionM > 0 ? '#F5A623' : '#27C28B'}
        icon={data.worstObstructionM > 0 ? AlertTriangle : Check}
        label="Worst obstr."
        value={data.worstObstructionM > 0 ? `${data.worstObstructionM.toFixed(1)} m` : 'none'}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Link parameter inputs (heights + frequency drive the Fresnel hint)          */
/* -------------------------------------------------------------------------- */
function NumField({
  label, unit, value, step, min, onCommit,
}: {
  label: string; unit: string; value: number; step: number; min: number;
  onCommit: (v: number) => void;
}) {
  const [local, setLocal] = useState(String(value));
  useEffect(() => setLocal(String(value)), [value]);
  const commit = () => {
    const n = Number(local);
    if (Number.isFinite(n) && n >= min) onCommit(n);
    else setLocal(String(value));
  };
  return (
    <label className="flex items-center gap-1.5 text-[10px] text-fg/50">
      <span className="uppercase tracking-wide">{label}</span>
      <input
        type="number" inputMode="decimal" step={step} min={min}
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        aria-label={`${label} (${unit})`}
        className="w-14 rounded-md border border-fg/15 bg-recess/50 px-1.5 py-0.5 text-right font-mono text-xs text-fg/85 focus:border-accent/50 focus:outline-none"
      />
      <span className="text-fg/30">{unit}</span>
    </label>
  );
}

/* -------------------------------------------------------------------------- */
/* Panel                                                                       */
/* -------------------------------------------------------------------------- */
export function ElevationProfilePanel() {
  const pts = useMapStore((s) => s.profilePts);
  const data = useMapStore((s) => s.profileData);
  const loading = useMapStore((s) => s.profileLoading);
  const error = useMapStore((s) => s.profileError);
  const txH = useMapStore((s) => s.profileTxH);
  const rxH = useMapStore((s) => s.profileRxH);
  const freq = useMapStore((s) => s.profileFreq);
  const setParams = useMapStore((s) => s.setProfileParams);
  const runProfile = useMapStore((s) => s.runProfile);
  const clearProfile = useMapStore((s) => s.clearProfile);

  // Escape closes the tool (a11y escape route).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && clearProfile();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [clearProfile]);

  // Stay hidden until both endpoints are picked — a center-bottom panel would
  // otherwise cover the map and swallow the click for the 2nd point.
  if (pts.length < 2) return null;

  return (
    <section
      role="region"
      aria-label="Elevation profile"
      className="pointer-events-auto absolute bottom-4 left-1/2 z-[1000] w-[min(46rem,calc(100%-2rem))] -translate-x-1/2 animate-fade-in"
    >
      <div className="glass-strong rounded-xl border border-fg/15 shadow-glass-lg">
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-fg/10 px-3 py-2">
          <Mountain className="h-4 w-4 text-accent" />
          <h2 className="text-xs font-semibold uppercase tracking-wider text-fg/70">Elevation Profile</h2>
          <div className="ml-auto flex items-center gap-3">
            <NumField label="TX" unit="m" value={txH} step={1} min={0} onCommit={(v) => setParams({ txH: v })} />
            <NumField label="RX" unit="m" value={rxH} step={1} min={0} onCommit={(v) => setParams({ rxH: v })} />
            <NumField label="Freq" unit="GHz" value={freq} step={0.1} min={0.1} onCommit={(v) => setParams({ freq: v })} />
            <button
              onClick={clearProfile}
              aria-label="Close elevation profile"
              className="grid h-6 w-6 place-items-center rounded text-fg/50 hover:bg-fg/10 hover:text-fg"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="px-3 py-2.5">
          {loading ? (
            <div className="grid h-40 place-items-center gap-2 text-xs text-fg/50">
              <Loader2 className="h-5 w-5 animate-spin text-accent" />
              Fetching terrain elevation…
            </div>
          ) : error ? (
            <div className="grid h-40 place-items-center gap-2 text-center text-xs text-fg/60">
              <AlertTriangle className="h-5 w-5 text-warning" />
              <p className="max-w-xs">{error}</p>
              <button
                onClick={() => void runProfile()}
                className="mt-1 flex items-center gap-1.5 rounded-lg border border-fg/15 px-3 py-1.5 text-fg/70 hover:border-accent/40 hover:text-accent"
              >
                <RefreshCw className="h-3.5 w-3.5" /> Retry
              </button>
            </div>
          ) : data ? (
            <div className="space-y-2.5">
              <ProfileChart data={data} />
              <Summary data={data} />
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
