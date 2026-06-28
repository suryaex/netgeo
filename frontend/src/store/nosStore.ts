/**
 * NOS store — user-defined custom Network OS entries.
 * Persisted to localStorage so they survive page reloads.
 * Custom NOS keys are injected into the Inspector NOS dropdown alongside
 * the built-in Nos union values.
 */
import { create } from 'zustand';

const STORAGE_KEY = 'netgeo.customNos';

export interface CustomNosEntry {
  /** Unique slug, e.g. "openwrt-23" */
  key: string;
  /** Human-readable label, e.g. "OpenWRT 23.05" */
  label: string;
  /** Optional Docker image or ISO reference */
  dockerImage?: string;
  /** Short description shown in dropdowns */
  description?: string;
  /** Creation timestamp (ISO string) */
  createdAt: string;
}

interface NosState {
  customNos: CustomNosEntry[];
  addNos: (entry: Omit<CustomNosEntry, 'createdAt' | 'key'> & { key?: string }) => void;
  updateNos: (key: string, patch: Partial<Omit<CustomNosEntry, 'key' | 'createdAt'>>) => void;
  removeNos: (key: string) => void;
}

function load(): CustomNosEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as CustomNosEntry[]) : [];
  } catch {
    return [];
  }
}

function save(entries: CustomNosEntry[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

export const useNosStore = create<NosState>((set) => ({
  customNos: load(),

  addNos: (entry) =>
    set((s) => {
      const key = entry.key?.trim()
        ? entry.key.trim().toLowerCase().replace(/\s+/g, '-')
        : `custom-${Date.now()}`;
      if (s.customNos.some((n) => n.key === key)) return {}; // prevent duplicates
      const next: CustomNosEntry = { ...entry, key, createdAt: new Date().toISOString() };
      const updated = [...s.customNos, next];
      save(updated);
      return { customNos: updated };
    }),

  updateNos: (key, patch) =>
    set((s) => {
      const updated = s.customNos.map((n) => (n.key === key ? { ...n, ...patch } : n));
      save(updated);
      return { customNos: updated };
    }),

  removeNos: (key) =>
    set((s) => {
      const updated = s.customNos.filter((n) => n.key !== key);
      save(updated);
      return { customNos: updated };
    }),
}));
