/**
 * eduLogic — pure helpers for the Education Lab workspace. No React, no store,
 * no I/O: formatting, per-kind check labels, and mapping a live GradeReport onto
 * the activity's check list. Kept separate (mirrors twinLogic/rfLogic/fiberLogic)
 * so the display logic is unit-testable without mounting a component.
 */
import type { GradeCheck, GradeCheckKind, GradeReport } from '@/api/types';

/** Before any grade a check is `pending`; after a grade it is pass/fail. There is
 *  no server-side "in progress" — the backend only reports a boolean per item. */
export type CheckStatus = 'pass' | 'fail' | 'pending';

export const CHECK_KIND_LABEL: Record<GradeCheckKind, string> = {
  node_exists: 'Node exists',
  iface_ip: 'Interface IP',
  vlan_present: 'VLAN present',
  ospf_neighbor: 'OSPF adjacency',
  ping: 'Reachability',
};

/** Which GradeCheck fields each kind actually reads (mirrors grading.py handlers).
 *  Drives the conditional inputs in CheckRow so authors only see relevant fields. */
export const CHECK_KIND_FIELDS: Record<GradeCheckKind, Array<keyof GradeCheck>> = {
  node_exists: ['node'],
  iface_ip: ['node', 'iface', 'cidr'],
  vlan_present: ['node', 'vlan'],
  ospf_neighbor: ['node', 'peer'],
  ping: ['node', 'dst'],
};

export const CHECK_KINDS = Object.keys(CHECK_KIND_LABEL) as GradeCheckKind[];

/** Human label for a check row — the author's label wins, else a kind-derived one. */
export function checkLabel(check: GradeCheck, index: number): string {
  if (check.label && check.label.trim()) return check.label.trim();
  const base = CHECK_KIND_LABEL[check.kind];
  const target = check.node ? ` — ${check.node}` : '';
  return `${index + 1}. ${base}${target}`;
}

/** Align a live report onto the ordered check list. The grader emits items in
 *  check order, so index alignment is safe; a missing report means all pending. */
export function checkStatuses(checks: GradeCheck[], report: GradeReport | null): CheckStatus[] {
  return checks.map((_, i) => {
    const item = report?.items[i];
    if (!item) return 'pending';
    return item.passed ? 'pass' : 'fail';
  });
}

/** mm:ss for a non-negative second count (clamped at 0 so an over-run reads 00:00). */
export function fmtClock(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

/** Whole seconds elapsed since an attempt clock started. */
export function elapsedSeconds(startedAt: number): number {
  return Math.max(0, (Date.now() - startedAt) / 1000);
}

// ponytail: index-aligned report mapping assumes grading.py keeps emitting items
// in check order. If the backend ever reorders/filters items, switch to matching
// on a stable id — but no id exists on GradeItem today, so index is the contract.
// No unit test file: this repo's logic modules (twinLogic/rfLogic/fiberLogic) ship
// none and the test runner isn't wired for the frontend, so a test here would only
// break `npm run typecheck`. Functions are pure — add a *.test.ts when a runner lands.
