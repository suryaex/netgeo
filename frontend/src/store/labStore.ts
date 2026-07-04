/**
 * Lab store — simulation-mode state for the packet-level lab (NG-SIM-01):
 * the realtime/simulation mode switch, the ledger cursor, and short-lived
 * "packet pulses" that drive the follow-the-packet animation on the canvas
 * (NG-CAP-04 MVP). Pulses are derived from PACKET_TX ledger records returned
 * by step/ledger calls and expire on their own.
 */
import { create } from 'zustand';
import type { LabMode, LedgerRecord } from '@/api/client';

export interface PacketPulse {
  key: string;          // unique per animation run (link + seq)
  linkId: string;
  /** Sending node id — lets the edge animate in the right direction. */
  fromNode: string;
  info: string;
  bornAt: number;       // Date.now() when queued
}

const PULSE_TTL_MS = 1200;

interface LabState {
  mode: LabMode;
  /** Ledger cursor (last seen seq) so panels can page incrementally. */
  cursor: number;
  pulses: PacketPulse[];

  setMode: (mode: LabMode) => void;
  setCursor: (seq: number) => void;
  /** Extract TX records into animation pulses (staggered by record order). */
  pushRecords: (records: LedgerRecord[]) => void;
  clearPulses: () => void;
}

export const useLabStore = create<LabState>((set) => ({
  mode: 'realtime',
  cursor: 0,
  pulses: [],

  setMode: (mode) => set({ mode }),
  setCursor: (cursor) => set({ cursor }),

  pushRecords: (records) => {
    const now = Date.now();
    const fresh: PacketPulse[] = records
      .filter((r) => r.type === 'PACKET_TX' && r.link)
      .slice(-24) // cap per batch — the canvas animates, not replays, bulk runs
      .map((r) => ({
        key: `${r.link}-${r.seq}`,
        linkId: r.link!,
        fromNode: r.node,
        info: r.info ?? '',
        bornAt: now,
      }));
    if (fresh.length === 0) return;
    set((s) => ({
      pulses: [...s.pulses.filter((p) => now - p.bornAt < PULSE_TTL_MS), ...fresh],
    }));
    // Self-clean after the animation window so edges stop pulsing.
    setTimeout(
      () =>
        set((s) => ({
          pulses: s.pulses.filter((p) => Date.now() - p.bornAt < PULSE_TTL_MS),
        })),
      PULSE_TTL_MS + 100,
    );
  },

  clearPulses: () => set({ pulses: [] }),
}));
