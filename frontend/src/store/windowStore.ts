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

const DEFAULT_RECTS: Record<WindowKind, Rect> = {
  topology: { x: 80, y: 64, w: 920, h: 620 },
  palette: { x: 24, y: 96, w: 240, h: 520 },
  properties: { x: 1020, y: 96, w: 340, h: 560 },
  console: { x: 220, y: 380, w: 720, h: 320 },
  config: { x: 300, y: 140, w: 680, h: 520 },
  scenarios: { x: 360, y: 180, w: 560, h: 460 },
  settings: { x: 240, y: 120, w: 680, h: 500 },
};

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
        rect: opts?.rect ?? DEFAULT_RECTS[kind],
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
