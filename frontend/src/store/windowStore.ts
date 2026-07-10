/**
 * Window-manager store — the macOS/Win11-style desktop shell state.
 * Tracks open windows, z-order, focus, minimize/maximize, and geometry.
 * Each "app" (Topology, Properties, Console, Palette, ConfigViewer) is a
 * window keyed by a stable WindowKind so the Dock can toggle them.
 */
import { create } from 'zustand';

export type WindowKind =
  | 'topology'
  | 'palette'
  | 'properties'
  | 'console'
  | 'config'
  | 'scenarios'
  | 'diagnostics'
  | 'ledger'
  | 'racks'
  | 'settings';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface WindowInstance {
  id: string;
  kind: WindowKind;
  title: string;
  rect: Rect;
  z: number;
  minimized: boolean;
  maximized: boolean;
  /** Optional payload, e.g. console window bound to a node id. */
  context?: Record<string, string>;
}

interface WindowState {
  windows: Record<string, WindowInstance>;
  focusedId: string | null;
  topZ: number;

  list: () => WindowInstance[];
  open: (kind: WindowKind, opts?: Partial<WindowInstance>) => string;
  close: (id: string) => void;
  focus: (id: string) => void;
  move: (id: string, x: number, y: number) => void;
  resize: (id: string, rect: Partial<Rect>) => void;
  toggleMinimize: (id: string) => void;
  toggleMaximize: (id: string) => void;
  /** Dock click: focus if open, else open. Returns the window id. */
  toggleApp: (kind: WindowKind, title: string) => string;
}

/**
 * Calculate sensible default rects at the moment a window is opened so they
 * adapt to the actual viewport instead of assuming a fixed 1440px canvas.
 */
function getDefaultRect(kind: WindowKind): Rect {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1440;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 900;
  // Leave room for the 36px MenuBar at the top and ~60px Dock at the bottom.
  const MENU_H = 36;
  const DOCK_H = 60;
  const PAD = 20;
  const SIDE_W = 280;
  const RAIL_W = 64; // AppShell navigation rail

  switch (kind) {
    case 'palette':
      return { x: PAD, y: 150, w: SIDE_W, h: 500 };
    case 'properties':
      return {
        x: Math.max(SIDE_W + PAD * 3, vw - SIDE_W - PAD),
        y: 150,
        w: SIDE_W,
        h: 400,
      };
    case 'topology': {
      const left = SIDE_W + PAD * 2;           // start after palette
      const right = vw - SIDE_W - PAD * 2;      // stop before properties
      return {
        x: left,
        y: MENU_H + PAD,
        w: Math.max(400, right - left),
        h: Math.max(300, vh - MENU_H - DOCK_H - PAD * 2),
      };
    }
    // Console / diagnostics / ledger open as a bottom drawer (design.md §14 /
    // §6.4), not a centered floating window — full width above the dock.
    // Window coords are relative to the workspace area (right of the 64px
    // rail, below the 56px top bar), so x starts at PAD and the vertical
    // offset accounts for top bar + dock + status bar (~150px total chrome).
    case 'console': {
      const h = Math.min(340, Math.round(vh * 0.38));
      return { x: PAD, y: vh - h - 150, w: vw - RAIL_W - PAD * 2, h };
    }
    case 'config':
      return { x: 300, y: 140, w: 680, h: 520 };
    case 'scenarios':
      return { x: 360, y: 180, w: 560, h: 460 };
    case 'diagnostics': {
      const h = Math.min(380, Math.round(vh * 0.42));
      return { x: PAD, y: vh - h - 150, w: vw - RAIL_W - PAD * 2, h };
    }
    case 'ledger': {
      const h = Math.min(300, Math.round(vh * 0.34));
      return { x: PAD, y: vh - h - 150, w: vw - RAIL_W - PAD * 2, h };
    }
    case 'racks':
      return {
        x: Math.max(PAD, (vw - 860) / 2),
        y: MENU_H + PAD,
        w: 860,
        h: Math.max(420, vh - MENU_H - DOCK_H - PAD * 2),
      };
    case 'settings':
      return { x: 240, y: 120, w: 680, h: 500 };
  }
}

let seq = 0;
const nextId = (kind: WindowKind) => `${kind}-${++seq}`;

export const useWindowStore = create<WindowState>((set, get) => ({
  windows: {},
  focusedId: null,
  topZ: 10,

  list: () =>
    Object.values(get().windows).sort((a, b) => a.z - b.z),

  open: (kind, opts) => {
    const id = opts?.id ?? nextId(kind);
    set((s) => {
      const z = s.topZ + 1;
      const win: WindowInstance = {
        id,
        kind,
        title: opts?.title ?? kind,
        rect: opts?.rect ?? getDefaultRect(kind),
        z,
        minimized: false,
        maximized: false,
        context: opts?.context,
      };
      return { windows: { ...s.windows, [id]: win }, focusedId: id, topZ: z };
    });
    return id;
  },

  close: (id) =>
    set((s) => {
      const { [id]: _gone, ...rest } = s.windows;
      void _gone;
      return { windows: rest, focusedId: s.focusedId === id ? null : s.focusedId };
    }),

  focus: (id) =>
    set((s) => {
      const win = s.windows[id];
      if (!win) return {};
      const z = s.topZ + 1;
      return {
        windows: { ...s.windows, [id]: { ...win, z, minimized: false } },
        focusedId: id,
        topZ: z,
      };
    }),

  move: (id, x, y) =>
    set((s) => {
      const win = s.windows[id];
      if (!win) return {};
      return { windows: { ...s.windows, [id]: { ...win, rect: { ...win.rect, x, y } } } };
    }),

  resize: (id, rect) =>
    set((s) => {
      const win = s.windows[id];
      if (!win) return {};
      return { windows: { ...s.windows, [id]: { ...win, rect: { ...win.rect, ...rect } } } };
    }),

  toggleMinimize: (id) =>
    set((s) => {
      const win = s.windows[id];
      if (!win) return {};
      return {
        windows: { ...s.windows, [id]: { ...win, minimized: !win.minimized } },
        focusedId: win.minimized ? id : s.focusedId,
      };
    }),

  toggleMaximize: (id) =>
    set((s) => {
      const win = s.windows[id];
      if (!win) return {};
      return { windows: { ...s.windows, [id]: { ...win, maximized: !win.maximized } } };
    }),

  toggleApp: (kind, title) => {
    const existing = Object.values(get().windows).find((w) => w.kind === kind);
    if (existing) {
      get().focus(existing.id);
      return existing.id;
    }
    return get().open(kind, { title });
  },
}));
