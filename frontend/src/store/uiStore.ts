/**
 * UI store — global, app-wide UI state that isn't graph or window geometry:
 * theme mode, simulation state, and the currently-open project id.
 * Persists theme to localStorage; everything else is session state.
 */
import { create } from 'zustand';
import { applyTheme, THEME_ORDER, type ThemeMode } from '@/theme/tokens';
import type { SimState } from '@/api/types';

const THEME_KEY = 'netgeo.theme';

export type ViewMode = 'projects' | 'topology' | 'map' | 'twin' | 'rf' | 'fiber' | 'edu' | 'plant' | 'config' | 'problems' | 'reports';

/** Bottom-drawer tabs (design 12-UI §2.1) — each body is an existing panel. */
export type DrawerTab = 'console' | 'diagnostics' | 'ledger' | 'config';

/** The single modal slot (design 12-UI §2.3). Exactly one open at a time. */
export type ModalId =
  | 'command'
  | 'settings'
  | 'scenarios'
  | 'devicePicker'
  | 'importConfig'
  | 'deviceLibrary'
  | 'fiberDetail'
  | 'onboarding'
  | 'mapOnboarding';

function initialTheme(): ThemeMode {
  const saved = localStorage.getItem(THEME_KEY) as ThemeMode | null;
  if (saved === 'light' || saved === 'dark' || saved === 'high-contrast') return saved;
  // Dark-first: the glass shell is built for the dark surface. Light mode isn't
  // at parity yet (many panels hardcode light-on-dark text), so default to dark
  // instead of following the OS — otherwise an OS-light user gets an unreadable
  // white-on-white UI. Users can still pick Light in Settings.
  return 'dark';
}

interface UiState {
  theme: ThemeMode;
  simState: SimState;
  simSpeed: number;
  /** Latest engine virtual-clock time (seconds), from sim.tick telemetry. */
  simTime: number;
  /** Latest engine metrics (delivered/dropped/...), from sim.tick telemetry. */
  simMetrics: Record<string, number> | null;
  projectId: string | null;
  viewMode: ViewMode;

  /** Bottom drawer (design 12-UI §2.1) — renders only in topology/map. Height
   *  is session-persistent (in-memory) and resizable. */
  drawerOpen: boolean;
  drawerTab: DrawerTab;
  drawerHeight: number;

  /** The one open modal, or null. Exclusive by construction (design 12-UI §2.3). */
  activeModal: ModalId | null;

  setTheme: (mode: ThemeMode) => void;
  /** Cycle Dark → Light → High Contrast → Dark. */
  toggleTheme: () => void;
  setSimState: (s: SimState) => void;
  setSimSpeed: (n: number) => void;
  /** Apply authoritative telemetry from a /ws/topology sim.tick event. */
  applySimTick: (
    t: number,
    metrics?: Record<string, number>,
    state?: SimState | 'completed' | 'stopped' | 'error',
  ) => void;
  setProject: (id: string | null) => void;
  setViewMode: (mode: ViewMode) => void;

  /** Open the drawer to a tab (or toggle it closed if that tab is already up). */
  openDrawer: (tab: DrawerTab) => void;
  setDrawerOpen: (open: boolean) => void;
  setDrawerTab: (tab: DrawerTab) => void;
  setDrawerHeight: (h: number) => void;

  openModal: (id: ModalId) => void;
  closeModal: () => void;
}

export const useUiStore = create<UiState>((set, get) => ({
  theme: initialTheme(),
  simState: 'idle',
  simSpeed: 1,
  simTime: 0,
  simMetrics: null,
  projectId: null,
  viewMode: 'topology',
  drawerOpen: false,
  drawerTab: 'console',
  drawerHeight: 320,
  activeModal: null,

  setTheme: (mode) => {
    applyTheme(mode);
    localStorage.setItem(THEME_KEY, mode);
    set({ theme: mode });
  },
  toggleTheme: () => {
    const order = THEME_ORDER;
    const idx = order.indexOf(get().theme);
    get().setTheme(order[(idx + 1) % order.length]!);
  },
  setSimState: (simState) => set({ simState }),
  setSimSpeed: (simSpeed) => set({ simSpeed }),
  applySimTick: (t, metrics, state) =>
    set((s) => {
      // Terminal engine states snap the transport bar back to idle; running and
      // paused are authoritative and override the optimistic local state.
      let next = s.simState;
      if (state === 'completed' || state === 'stopped' || state === 'error') next = 'idle';
      else if (state === 'running' || state === 'paused') next = state;
      return { simTime: t, simMetrics: metrics ?? s.simMetrics, simState: next };
    }),
  setProject: (projectId) => set({ projectId }),
  setViewMode: (viewMode) => set({ viewMode }),

  openDrawer: (tab) =>
    set((s) => (s.drawerOpen && s.drawerTab === tab ? { drawerOpen: false } : { drawerOpen: true, drawerTab: tab })),
  setDrawerOpen: (drawerOpen) => set({ drawerOpen }),
  setDrawerTab: (drawerTab) => set({ drawerTab, drawerOpen: true }),
  setDrawerHeight: (drawerHeight) => set({ drawerHeight: Math.max(160, Math.min(720, drawerHeight)) }),

  // Single slot → opening any modal evicts the previous one; two can never stack.
  openModal: (activeModal) => set({ activeModal }),
  closeModal: () => set({ activeModal: null }),
}));
