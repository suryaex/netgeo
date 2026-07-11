/**
 * Fiber workspace helpers — pure display/format only. Every optical figure comes
 * from the backend `/fiber-paths/{id}/budget` endpoint; nothing here recomputes
 * loss (backend `services/fiber.py` is the single source of truth).
 */
import type { FiberElement, FiberKind, GponClass } from '@/api/client';

export const GPON_LABEL: Record<GponClass, string> = {
  b_plus: 'B+',
  c_plus: 'C+',
  c2: 'C2',
};

export const GPON_OPTIONS: { id: GponClass; label: string }[] = [
  { id: 'b_plus', label: 'B+ · 28 dB' },
  { id: 'c_plus', label: 'C+ · 32 dB' },
  { id: 'c2', label: 'C2 · 32 dB' },
];

/** Common physical/logical split ratios offered by the splitter button. */
export const SPLIT_RATIOS = [2, 4, 8, 16, 32, 64, 128];

export const KIND_LABEL: Record<FiberKind, string> = {
  fiber: 'Fiber',
  splitter: 'Splitter',
  connector: 'Connector',
  splice: 'Splice',
};

export function fmtKm(m: number): string {
  return `${(m / 1000).toFixed(2)} km`;
}

/** Configured-parameter summary for one element (its params, not its loss). */
export function elementSummary(el: FiberElement): string {
  switch (el.kind) {
    case 'fiber':
      return fmtKm(el.length_m ?? 0);
    case 'splitter':
      return `1:${el.split_ratio ?? 32}`;
    case 'connector':
      return 'mated';
    case 'splice':
      return 'fusion';
    default:
      return '';
  }
}
