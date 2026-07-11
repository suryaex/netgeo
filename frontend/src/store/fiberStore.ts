/**
 * Fiber store — state for the Fiber/FTTH planner workspace. A project owns a set
 * of GPON distribution paths (`FiberPath`); each path is an ordered OLT→ONU chain
 * of passive elements. All optical physics is server-side — this store only holds
 * the paths, orchestrates CRUD, and caches each path's `/budget` result.
 *
 * ponytail: the backend FiberPath is a SINGLE ordered path, not a tree. The
 * design's fanned-out tree is represented as "selected path = one branch, sibling
 * paths = the other ODPs" — no branching is invented client-side.
 */
import { create } from 'zustand';
import type { StoreApi } from 'zustand';
import {
  fiberApi,
  type FiberElement,
  type FiberPath,
  type FiberPathUpdate,
  type GponClass,
  type LossBudget,
} from '@/api/client';

export type SegKey = 'feeder' | 'distribution' | 'drop';

interface FiberState {
  projectId: string | null;
  paths: FiberPath[];
  /** Budget (loss/margin/checks) per path id — drives PASS/FAIL everywhere. */
  budgets: Record<string, LossBudget>;
  selectedId: string | null;
  search: string;
  /** Segment-group visibility filters (feeder/distribution/drop chips). */
  seg: Record<SegKey, boolean>;
  loading: boolean;
  busy: boolean;
  error: string | null;

  load: (projectId: string) => Promise<void>;
  select: (id: string | null) => void;
  setSearch: (q: string) => void;
  toggleSeg: (k: SegKey) => void;
  createPath: (name: string, gpon: GponClass) => Promise<void>;
  deletePath: (id: string) => Promise<void>;
  setGpon: (gpon: GponClass) => Promise<void>;
  append: (el: FiberElement) => Promise<void>;
  removeElement: (index: number) => Promise<void>;
}

type Set = StoreApi<FiberState>['setState'];

function errMsg(err: unknown, fallback: string): string {
  return (err as { message?: string })?.message ?? fallback;
}

/** PATCH one path, refresh its budget, and merge both back into state. */
async function applyPatch(set: Set, id: string, patch: FiberPathUpdate) {
  set({ busy: true, error: null });
  try {
    const updated = await fiberApi.update(id, patch);
    const budget = await fiberApi.budget(id);
    set((s) => ({
      paths: s.paths.map((p) => (p.id === id ? updated : p)),
      budgets: { ...s.budgets, [id]: budget },
      busy: false,
    }));
  } catch (err) {
    set({ busy: false, error: errMsg(err, 'Update failed.') });
  }
}

export const useFiberStore = create<FiberState>((set, get) => ({
  projectId: null,
  paths: [],
  budgets: {},
  selectedId: null,
  search: '',
  seg: { feeder: true, distribution: true, drop: true },
  loading: false,
  busy: false,
  error: null,

  load: async (projectId) => {
    set({ loading: true, error: null, projectId });
    try {
      const paths = await fiberApi.list(projectId);
      const budgets: Record<string, LossBudget> = {};
      await Promise.all(
        paths.map(async (p) => {
          try {
            budgets[p.id] = await fiberApi.budget(p.id);
          } catch {
            /* a single bad path shouldn't blank the whole workspace */
          }
        }),
      );
      set((s) => ({
        paths,
        budgets,
        loading: false,
        selectedId:
          s.selectedId && paths.some((p) => p.id === s.selectedId)
            ? s.selectedId
            : paths[0]?.id ?? null,
      }));
    } catch (err) {
      set({ loading: false, error: errMsg(err, 'Failed to load fiber paths.') });
    }
  },

  select: (selectedId) => set({ selectedId }),
  setSearch: (search) => set({ search }),
  toggleSeg: (k) => set((s) => ({ seg: { ...s.seg, [k]: !s.seg[k] } })),

  createPath: async (name, gpon) => {
    const projectId = get().projectId;
    if (!projectId) return;
    set({ busy: true, error: null });
    try {
      const path = await fiberApi.create({
        project_id: projectId,
        name,
        gpon_class: gpon,
        elements: [],
      });
      const budget = await fiberApi.budget(path.id);
      set((s) => ({
        paths: [...s.paths, path],
        budgets: { ...s.budgets, [path.id]: budget },
        selectedId: path.id,
        busy: false,
      }));
    } catch (err) {
      set({ busy: false, error: errMsg(err, 'Failed to create path.') });
    }
  },

  deletePath: async (id) => {
    set({ busy: true, error: null });
    try {
      await fiberApi.remove(id);
      set((s) => {
        const paths = s.paths.filter((p) => p.id !== id);
        const budgets = { ...s.budgets };
        delete budgets[id];
        return {
          paths,
          budgets,
          busy: false,
          selectedId: s.selectedId === id ? paths[0]?.id ?? null : s.selectedId,
        };
      });
    } catch (err) {
      set({ busy: false, error: errMsg(err, 'Failed to delete path.') });
    }
  },

  setGpon: async (gpon) => {
    const id = get().selectedId;
    if (id) await applyPatch(set, id, { gpon_class: gpon });
  },

  append: async (el) => {
    const path = get().paths.find((p) => p.id === get().selectedId);
    if (path) await applyPatch(set, path.id, { elements: [...path.elements, el] });
  },

  removeElement: async (index) => {
    const path = get().paths.find((p) => p.id === get().selectedId);
    if (path) {
      await applyPatch(set, path.id, {
        elements: path.elements.filter((_, i) => i !== index),
      });
    }
  },
}));
