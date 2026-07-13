/**
 * NetGeo design tokens — single source of truth for the design system.
 *
 * NetGeo's visual identity blends a professional GIS workstation (ArcGIS Pro),
 * a modern IDE (VS Code), and a flexible creative workspace (Figma/Blender).
 * Tokens are exposed three ways so every layer stays in sync:
 *   1. Tailwind (static palette)            → tailwind.config.js
 *   2. TypeScript (canvas / inline styles)  → this module
 *   3. CSS custom properties on <html>      → applyTheme(), drives theming
 *
 * Themes (03_UI_UX_GUIDELINES §Theme): Light · Dark · High Contrast.
 */
import type { NodeKind } from '@/api/types';

export type ThemeMode = 'light' | 'dark' | 'high-contrast';

export const THEME_ORDER: ThemeMode[] = ['dark', 'light', 'high-contrast'];

/**
 * Semantic color tokens (03_UI_UX_GUIDELINES §Color Tokens).
 * Primary/Secondary/Success/Warning/Danger/Info form the accent system; the
 * neutral ramp + surface tokens are theme-dependent (see THEMES below).
 */
export const semantic = {
  // Dual-personality accent (user pick 2026-07-13): dark = macOS Tahoe Apple
  // blue, light = Anthropic clay terracotta. Per-theme values live in THEMES
  // below; these defaults mirror the dark (macOS Tahoe) theme.
  primary: '#409CFF', // Apple systemBlue, brightened so it reads as text on navy AND carries ink on fills (AA)
  secondary: '#5AC8FA', // Apple teal — AI / planning, distinct from the blue primary
  success: '#27C28B',
  warning: '#F5A623',
  danger: '#FF4D4F',
  info: '#27B5C2',
} as const;

/** Node-kind accent colors — mirror tailwind `colors.node` + used by canvas. */
export const nodeColors: Record<NodeKind, string> = {
  router: '#2F6BFF',
  switch: '#27C28B',
  host: '#8A93A6',
  ap: '#7C5CFC',
  olt: '#F5A623',
  firewall: '#FF4D4F',
  server: '#27B5C2',
  cloud: '#3BC9DB',
};

/** Link-status colors for edges (up/down/admin-down/unknown). */
export const linkStatusColors = {
  up: '#27C28B',
  down: '#FF4D4F',
  admin_down: '#F5A623',
  // Physically errored (NG-PH-03): cable over its rated max length. Amber-red
  // to read as a fault distinct from an operator-driven admin_down.
  errored: '#FF7A45',
  unknown: '#8A93A6',
} as const;

/**
 * Per-theme CSS custom properties. Every shell surface reads these (via the
 * Tailwind aliases `surface`, `panel`, `fg`, …) so switching the theme re-skins
 * the whole chrome with zero per-component branching.
 */
type ThemeVars = Record<string, string>;

const THEMES: Record<ThemeMode, ThemeVars> = {
  dark: {
    '--ng-bg-0': '#07111F', // design.md §2.2 App background
    '--ng-bg-1': '#11151F',
    '--ng-surface': 'rgba(20,25,36,0.72)',
    '--ng-surface-2': 'rgba(28,34,48,0.72)',
    '--ng-panel': '#141925',
    '--ng-panel-2': '#1B2030',
    '--ng-border': 'rgba(255,255,255,0.08)',
    '--ng-border-strong': 'rgba(255,255,255,0.16)',
    '--ng-fg': '#EDF0F7',
    '--ng-fg-muted': '#9AA3B5',
    '--ng-fg-subtle': '#5C6577',
    // Alpha-capable channels for the theme-aware `fg`/`recess` Tailwind aliases
    // (replace hardcoded text-white/border-white/bg-white and bg-black wells).
    // Dark keeps pure white/black so `text-fg/NN` is pixel-identical to the old
    // `text-white/NN`; light inverts to ink/slate so the same class stays legible.
    '--ng-fg-rgb': '255 255 255',
    '--ng-recess-rgb': '0 0 0',
    '--ng-glass-bg': 'rgba(20,25,36,0.62)',
    '--ng-glass-border': 'rgba(255,255,255,0.08)',
    '--ng-elevate': '0 16px 50px rgba(0,0,0,0.45)',
    // Accent = macOS Tahoe Apple blue. Bright enough to read as text on navy
    // (6.2:1 on panel) and to carry near-black ink on fills (6.7:1) — one token
    // serves text, icons, and button fills. Channels power `bg-accent/NN` alpha.
    '--ng-accent-rgb': '64 156 255', // #409CFF
    '--ng-accent-soft': '#64B5FF', // lighter hover fill
    '--ng-accent-fg': '#07111F', // near-black ink on the bright accent fill
    '--ng-primary': semantic.primary,
    '--ng-secondary': semantic.secondary,
    '--ng-success': semantic.success,
    '--ng-warning': semantic.warning,
    '--ng-danger': semantic.danger,
    '--ng-info': semantic.info,
  },
  light: {
    // Full Clay Anthropic (user pick 2026-07-13): warm ivory/cream surfaces,
    // ink text, terracotta accent. Three layers read as layers — cream ground
    // (canvas) < ivory panels < white elevated surfaces.
    '--ng-bg-0': '#EFEDE6', // warm cream canvas ground (darkest layer)
    '--ng-bg-1': '#F3F1EA', // radial-gradient partner, a step lighter
    '--ng-surface': 'rgba(255,255,255,0.92)', // elevated glass — white
    '--ng-surface-2': 'rgba(250,249,245,0.94)',
    '--ng-panel': '#FAF9F5', // ivory docked panels
    '--ng-panel-2': '#F0EEE6', // recessed panel
    '--ng-border': 'rgba(20,20,19,0.12)',
    '--ng-border-strong': 'rgba(20,20,19,0.22)',
    '--ng-fg': '#141413', // Anthropic ink
    '--ng-fg-muted': '#6B6862', // warm grey
    '--ng-fg-subtle': '#928E85',
    '--ng-fg-rgb': '20 20 19', // ink — legible foreground/hairline on clay surfaces
    '--ng-recess-rgb': '41 37 36', // warm brown-black recessed wells
    '--ng-glass-bg': 'rgba(255,255,255,0.82)',
    '--ng-glass-border': 'rgba(20,20,19,0.12)',
    '--ng-elevate': '0 12px 34px rgba(80,60,45,0.14)', // warm claymorphism shadow
    // Deep terracotta (not the bright #D97757 fill) so it doubles as text/link
    // on ivory (5.4:1) and carries white on fills (5.7:1). Brand coral #D97757
    // lives in --ng-accent-soft for decorative/hover fills.
    '--ng-accent-rgb': '168 75 42', // #A84B2A
    '--ng-accent-soft': '#D97757', // Anthropic brand coral — hover / soft fills (pair with ink)
    '--ng-accent-fg': '#FFFFFF', // white on the deep terracotta fill
    '--ng-primary': '#A84B2A',
    '--ng-secondary': '#0E7C88', // teal — AI / planning
    '--ng-success': '#15805C',
    '--ng-warning': '#B45309',
    '--ng-danger': '#C0392B',
    '--ng-info': '#0E7C88',
  },
  'high-contrast': {
    '--ng-bg-0': '#000000',
    '--ng-bg-1': '#000000',
    '--ng-surface': '#000000',
    '--ng-surface-2': '#0A0A0A',
    '--ng-panel': '#000000',
    '--ng-panel-2': '#0A0A0A',
    '--ng-border': '#FFFFFF',
    '--ng-border-strong': '#FFFFFF',
    '--ng-fg': '#FFFFFF',
    '--ng-fg-muted': '#E6E6E6',
    '--ng-fg-subtle': '#BFBFBF',
    '--ng-fg-rgb': '255 255 255',
    '--ng-recess-rgb': '0 0 0',
    '--ng-glass-bg': '#000000',
    '--ng-glass-border': '#FFFFFF',
    '--ng-elevate': '0 0 0 1px #FFFFFF',
    '--ng-accent-rgb': '124 192 255', // #7CC0FF — bright blue, huge contrast on black
    '--ng-accent-soft': '#A9D4FF',
    '--ng-accent-fg': '#000000',
    '--ng-primary': '#7CC0FF',
    '--ng-secondary': '#5AC8FA',
    '--ng-success': '#3BE6A0',
    '--ng-warning': '#FFC44D',
    '--ng-danger': '#FF6B6D',
    '--ng-info': '#5BE0EC',
  },
};

/**
 * Apply a theme mode: toggles Tailwind `dark`/`hc` classes and writes the CSS
 * variable set onto <html>. Idempotent — safe to call on every mount/change.
 */
export function applyTheme(mode: ThemeMode): void {
  const root = document.documentElement;
  // Dark utilities should also apply in high-contrast (it's a dark base).
  root.classList.toggle('dark', mode === 'dark' || mode === 'high-contrast');
  root.classList.toggle('hc', mode === 'high-contrast');
  root.dataset.theme = mode;

  const vars = THEMES[mode];
  for (const [key, value] of Object.entries(vars)) {
    root.style.setProperty(key, value);
  }
  root.style.setProperty('color-scheme', mode === 'light' ? 'light' : 'dark');
}
