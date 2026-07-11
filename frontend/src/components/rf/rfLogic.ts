/**
 * rfLogic — pure, presentational helpers for the RF PtP workspace.
 *
 * The RF physics (path loss, RSSI, fade margin, LoS/Fresnel verdict) all come
 * from the backend `/api/rf/ptp` + `/api/wireless/los-check` responses — nothing
 * here re-derives it. These are only the thin display mappings the panel/beam
 * need: a status band from the fade margin, a reliability estimate, and an
 * idealised capacity figure. No test runner exists in this package, so each
 * function carries a worked example inline as its unit check.
 */
export type MarginStatus = 'excellent' | 'good' | 'poor';

/**
 * Fade-margin → link status band. Fade margin = RSSI − RX sensitivity (dB).
 * Common PtP practice: ≥20 dB excellent, ≥10 dB good, else poor.
 *   marginStatus(21.3) === 'excellent'
 *   marginStatus(12.0) === 'good'
 *   marginStatus(4.0)  === 'poor'
 */
export function marginStatus(fadeMarginDb: number): MarginStatus {
  if (fadeMarginDb >= 20) return 'excellent';
  if (fadeMarginDb >= 10) return 'good';
  return 'poor';
}

/**
 * Link reliability (%) from a flat Rayleigh-fade outage approximation:
 * P(outage) ≈ 10^(−M/10); reliability = 1 − P(outage), clamped to [0, 100].
 *   reliabilityPct(21.3) ≈ 99.26
 *   reliabilityPct(30.0) ≈ 99.90
 *   reliabilityPct(0)    === 0
 * ponytail: single-parameter fade model — swap for Vigants–Barnett (adds path
 * length / terrain / climate factors) if carrier-grade availability is needed.
 */
export function reliabilityPct(fadeMarginDb: number): number {
  if (fadeMarginDb <= 0) return 0;
  const outage = Math.pow(10, -fadeMarginDb / 10);
  return Math.max(0, Math.min(100, (1 - outage) * 100));
}

/**
 * Idealised single-stream PHY rate (Mbps): an 802.11-style spectral-efficiency
 * ladder (bits/s/Hz) keyed on RSSI × channel bandwidth. Mirrors the backend
 * engine `_MCS_LADDER`; ignores MIMO streams and MAC overhead.
 *   estCapacityMbps(-57, 40) === 267   // 6.67 b/s/Hz × 40 MHz
 *   estCapacityMbps(-90, 40) === 0     // below BPSK floor → no data
 */
const SE_LADDER: readonly [number, number][] = [
  [-57, 6.67], [-59, 6.0], [-64, 5.0], [-65, 4.5], [-66, 4.0],
  [-70, 3.0], [-74, 2.0], [-77, 1.5], [-79, 1.0], [-82, 0.5],
];
export function estCapacityMbps(rssiDbm: number, bandwidthMhz: number): number {
  for (const [floor, se] of SE_LADDER) {
    if (rssiDbm >= floor) return Math.round(se * bandwidthMhz);
  }
  return 0;
}

/** Status → hex color (theme-independent, AA on both surfaces). */
export const STATUS_COLOR: Record<MarginStatus, string> = {
  excellent: '#27C28B',
  good: '#5C8AFF',
  poor: '#FF4D4F',
};

export const STATUS_LABEL: Record<MarginStatus, string> = {
  excellent: 'EXCELLENT MARGIN',
  good: 'GOOD MARGIN',
  poor: 'POOR MARGIN',
};

/** Distance formatter shared with the map beam chip. */
export function fmtKm(m: number): string {
  const km = m / 1000;
  return km >= 10 ? `${km.toFixed(1)} km` : `${km.toFixed(2)} km`;
}
