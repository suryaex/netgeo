/**
 * RfAnalysisPanel — the right dock of the RF workspace (~380px). Summary / Link
 * Budget / Terrain / Fresnel tabs over the last `/api/rf/ptp` result. All figures
 * come straight from the backend response; only the status band, reliability, and
 * capacity are derived client-side (see rfLogic).
 */
import { RadioTower, X, Loader2, AlertTriangle, Radio } from 'lucide-react';
import { useMapStore } from '@/store/mapStore';
import { useRfStore, RF_ANT_GAIN_DBI, type RfTab } from '@/store/rfStore';
import { zc } from '@/theme/z';
import { ProfileChart, type ChartPoint } from '@/components/map/ProfileChart';
import {
  marginStatus,
  reliabilityPct,
  estCapacityMbps,
  STATUS_COLOR,
  STATUS_LABEL,
  fmtKm,
} from './rfLogic';
import type { PtpResult } from '@/api/client';

const TABS: { id: RfTab; label: string }[] = [
  { id: 'summary', label: 'Summary' },
  { id: 'budget', label: 'Link Budget' },
  { id: 'terrain', label: 'Terrain' },
  { id: 'fresnel', label: 'Fresnel' },
];

function chartPoints(res: PtpResult): ChartPoint[] {
  return (res.profile?.points ?? []).map((p) => ({ distance_m: p.distance_m, elevation_m: p.elevation_m }));
}

/* -------------------------------------------------------------------------- */
/* Small building blocks                                                       */
/* -------------------------------------------------------------------------- */
function StatCard({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div
      className={
        'rounded-lg border px-2.5 py-2 ' +
        (highlight ? 'border-accent/40 bg-accent/10' : 'border-fg/10 bg-recess/40')
      }
    >
      <p className="text-[10px] uppercase tracking-wide text-fg/40">{label}</p>
      <p className={'mt-0.5 font-mono text-sm ' + (highlight ? 'text-accent' : 'text-fg/85')}>{value}</p>
    </div>
  );
}

function BudgetRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={'flex items-center justify-between py-1.5 ' + (strong ? 'border-t border-fg/15' : '')}>
      <span className={'text-xs ' + (strong ? 'font-medium text-fg/80' : 'text-fg/55')}>{label}</span>
      <span className={'font-mono text-xs ' + (strong ? 'text-fg/90' : 'text-fg/75')}>{value}</span>
    </div>
  );
}

function StatusChip({ res }: { res: PtpResult }) {
  const status = marginStatus(res.fade_margin_db);
  const color = STATUS_COLOR[status];
  return (
    <div className="flex items-center justify-between gap-2">
      <span
        className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold"
        style={{ color, backgroundColor: `${color}22` }}
      >
        <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
        {STATUS_LABEL[status]}
      </span>
      <span className="text-xs text-fg/55">
        Reliability: <span className="font-mono text-fg/85">{reliabilityPct(res.fade_margin_db).toFixed(3)}%</span>
      </span>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Tab bodies                                                                  */
/* -------------------------------------------------------------------------- */
function SummaryTab({ res }: { res: PtpResult }) {
  const { freqGhz, bwMhz, aId, bId } = useRfStore();
  const devices = useMapStore((s) => s.devices);
  const a = aId ? devices.get(aId) : undefined;
  const b = bId ? devices.get(bId) : undefined;

  return (
    <div className="space-y-4">
      <StatusChip res={res} />

      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-fg/50">RF Parameters</p>
        <div className="grid grid-cols-2 gap-2">
          <StatCard label="Distance" value={fmtKm(res.distance_m)} />
          <StatCard label="Frequency" value={`${freqGhz} GHz`} />
          <StatCard label="TX Power" value={`${a?.txPower ?? '—'} dBm`} />
          <StatCard label="Antenna Gain" value={`2× ${RF_ANT_GAIN_DBI} dBi`} />
          <StatCard label="Path Loss (FSPL)" value={`${res.path_loss_db.toFixed(1)} dB`} />
          <StatCard label="Received Signal" value={`${res.rssi_dbm.toFixed(1)} dBm`} highlight />
          <StatCard label="Fade Margin" value={`${res.fade_margin_db.toFixed(1)} dB`} />
          <StatCard label="Est. Capacity" value={`${estCapacityMbps(res.rssi_dbm, bwMhz)} Mbps`} />
        </div>
      </div>

      {res.profile && (
        <div>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg/50">Elevation Profile</p>
          <ProfileChart
            points={chartPoints(res)}
            totalDistanceM={res.profile.total_distance_m}
            losClear={res.los_clear}
            fresnelClear={res.fresnel_clear}
            txH={a?.antennaHeight ?? 10}
            rxH={b?.antennaHeight ?? 5}
            freqGhz={freqGhz}
            fresnelBand
          />
          <FresnelLegend />
        </div>
      )}
    </div>
  );
}

function BudgetTab({ res }: { res: PtpResult }) {
  return (
    <div className="rounded-lg border border-fg/10 bg-recess/30 px-3 py-1">
      <BudgetRow label="TX Power" value={`${(res.eirp_dbm - RF_ANT_GAIN_DBI).toFixed(1)} dBm`} />
      <BudgetRow label="TX Antenna Gain" value={`+${RF_ANT_GAIN_DBI.toFixed(1)} dBi`} />
      <BudgetRow label="EIRP" value={`${res.eirp_dbm.toFixed(1)} dBm`} strong />
      <BudgetRow label="RX Antenna Gain" value={`+${RF_ANT_GAIN_DBI.toFixed(1)} dBi`} />
      <BudgetRow label={`Path Loss (${res.model_id})`} value={`−${res.path_loss_db.toFixed(1)} dB`} />
      <BudgetRow label="Received Signal" value={`${res.rssi_dbm.toFixed(1)} dBm`} strong />
      <BudgetRow label="RX Sensitivity" value={`${(res.rssi_dbm - res.fade_margin_db).toFixed(1)} dBm`} />
      <BudgetRow label="Fade Margin" value={`${res.fade_margin_db.toFixed(1)} dB`} strong />
    </div>
  );
}

function VerdictBadge({ ok, okLabel, badLabel }: { ok: boolean; okLabel: string; badLabel: string }) {
  const color = ok ? STATUS_COLOR.excellent : STATUS_COLOR.poor;
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold"
      style={{ color, backgroundColor: `${color}22` }}
    >
      {ok ? okLabel : badLabel}
    </span>
  );
}

function TerrainTab({ res }: { res: PtpResult }) {
  const { freqGhz, aId, bId } = useRfStore();
  const devices = useMapStore((s) => s.devices);
  const a = aId ? devices.get(aId) : undefined;
  const b = bId ? devices.get(bId) : undefined;
  if (!res.profile) return <p className="text-xs text-fg/50">No terrain profile in the last result.</p>;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <VerdictBadge ok={res.los_clear} okLabel="Line of sight clear" badLabel="LoS blocked" />
      </div>
      <ProfileChart
        points={chartPoints(res)}
        totalDistanceM={res.profile.total_distance_m}
        losClear={res.los_clear}
        fresnelClear={res.fresnel_clear}
        txH={a?.antennaHeight ?? 10}
        rxH={b?.antennaHeight ?? 5}
        freqGhz={freqGhz}
        fresnelBand
      />
      <FresnelLegend />
      <div className="grid grid-cols-2 gap-2">
        <StatCard label="Distance" value={fmtKm(res.distance_m)} />
        <StatCard
          label="Worst Obstruction"
          value={res.worst_obstruction_m > 0 ? `${res.worst_obstruction_m.toFixed(1)} m` : 'none'}
        />
      </div>
    </div>
  );
}

function FresnelTab({ res }: { res: PtpResult }) {
  const { freqGhz, aId, bId } = useRfStore();
  const devices = useMapStore((s) => s.devices);
  const a = aId ? devices.get(aId) : undefined;
  const b = bId ? devices.get(bId) : undefined;
  const pct = Math.round(res.min_clearance_ratio * 100);
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between rounded-lg border border-fg/10 bg-recess/40 px-3 py-2.5">
        <div>
          <p className="text-[10px] uppercase tracking-wide text-fg/40">Min Fresnel Clearance</p>
          <p className="mt-0.5 font-mono text-xl text-fg/90">{pct}%</p>
        </div>
        <VerdictBadge ok={res.fresnel_clear} okLabel="Clear" badLabel="Obstructed" />
      </div>
      {res.profile && (
        <>
          <ProfileChart
            points={chartPoints(res)}
            totalDistanceM={res.profile.total_distance_m}
            losClear={res.los_clear}
            fresnelClear={res.fresnel_clear}
            txH={a?.antennaHeight ?? 10}
            rxH={b?.antennaHeight ?? 5}
            freqGhz={freqGhz}
            fresnelBand
          />
          <FresnelLegend />
        </>
      )}
    </div>
  );
}

function FresnelLegend() {
  return (
    <div className="flex items-center gap-4 text-[10px] text-fg/50">
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-0.5 w-4 rounded bg-fg/60" /> LOS Beam
      </span>
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-0.5 w-4 rounded border-t border-dashed border-fg/50" /> 60% Fresnel Clearance
      </span>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Panel shell                                                                 */
/* -------------------------------------------------------------------------- */
export function RfAnalysisPanel() {
  const tab = useRfStore((s) => s.tab);
  const setTab = useRfStore((s) => s.setTab);
  const result = useRfStore((s) => s.result);
  const loading = useRfStore((s) => s.loading);
  const error = useRfStore((s) => s.error);
  const clear = useRfStore((s) => s.clear);
  const endpointCount = useMapStore(
    (s) => s.deviceList().filter((d) => d.kind === 'ap' || d.kind === 'tower').length,
  );

  return (
    <aside
      role="region"
      aria-label="Link Analysis"
      className={`glass-strong pointer-events-auto absolute right-0 top-0 ${zc.workspace} flex h-full w-[380px] max-w-[85vw] flex-col border-l border-fg/12 shadow-glass-lg`}
    >
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-fg/10 px-4 py-3">
        <RadioTower className="h-4 w-4 text-accent" />
        <h2 className="text-sm font-semibold text-fg/85">Link Analysis</h2>
        <button
          onClick={clear}
          aria-label="Clear analysis"
          className="ml-auto grid h-6 w-6 place-items-center rounded text-fg/50 hover:bg-fg/10 hover:text-fg"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Tabs */}
      <div role="tablist" aria-label="Link analysis views" className="flex gap-1 border-b border-fg/10 px-2 py-1.5">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={
              'rounded-md px-2.5 py-1 text-xs transition-colors ' +
              (tab === t.id ? 'bg-accent/20 text-accent' : 'text-fg/55 hover:bg-fg/8 hover:text-fg/85')
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {error ? (
          <div className="grid place-items-center gap-2 py-10 text-center text-xs text-fg/60">
            <AlertTriangle className="h-5 w-5 text-warning" />
            <p className="max-w-[16rem]">{error}</p>
          </div>
        ) : loading ? (
          <div className="grid place-items-center gap-2 py-10 text-xs text-fg/55">
            <Loader2 className="h-5 w-5 animate-spin text-accent" />
            Computing link budget…
          </div>
        ) : !result ? (
          <EmptyState endpointCount={endpointCount} />
        ) : tab === 'summary' ? (
          <SummaryTab res={result} />
        ) : tab === 'budget' ? (
          <BudgetTab res={result} />
        ) : tab === 'terrain' ? (
          <TerrainTab res={result} />
        ) : (
          <FresnelTab res={result} />
        )}
      </div>
    </aside>
  );
}

/** 3-tier honest empty state (design 12-UI §3.3): guide the real next step by
 *  how many selectable NetGeo AP/tower sites actually exist, and state plainly
 *  that OSM reference towers are not selectable when that layer is on. */
function EmptyState({ endpointCount }: { endpointCount: number }) {
  const setTool = useMapStore((s) => s.setTool);
  const towersVisible = useMapStore((s) => s.gisLayers['util-tower']?.visible ?? false);

  return (
    <div className="grid place-items-center gap-3 py-10 text-center">
      <Radio className="h-8 w-8 text-fg/25" />
      {endpointCount === 0 ? (
        <>
          <p className="max-w-[16rem] text-xs leading-relaxed text-fg/55">
            No AP or tower sites in this project yet. Place one on the map to start a point-to-point
            link.
          </p>
          <button
            onClick={() => setTool('ap')}
            className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-fg hover:bg-accent-soft"
          >
            Place an AP site
          </button>
        </>
      ) : endpointCount === 1 ? (
        <p className="max-w-[16rem] text-xs leading-relaxed text-fg/55">
          One site placed. Place or click a second AP/tower site to define the link.
        </p>
      ) : (
        <p className="max-w-[16rem] text-xs leading-relaxed text-fg/55">
          Click two sites on the map (or use the selectors below), then press Calculate.
        </p>
      )}
      {towersVisible && (
        <p className="max-w-[16rem] text-[11px] leading-relaxed text-fg/40">
          Visible OSM towers are reference-only — not selectable as endpoints.
        </p>
      )}
    </div>
  );
}
