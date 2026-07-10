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
  primary: '#2F6BFF', // NetGeo geospatial blue
  secondary: '#7C5CFC', // violet — AI / planning
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
    '--ng-bg-0': '#0B0E16',
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
    '--ng-primary': semantic.primary,
    '--ng-secondary': semantic.secondary,
    '--ng-success': semantic.success,
    '--ng-warning': semantic.warning,
    '--ng-danger': semantic.danger,
    '--ng-info': semantic.info,
  },
  light: {
    // Layered light (per Stitch light variants): the canvas ground sits a step
    // darker than panels so surfaces read as surfaces instead of one glaring
    // white field; borders are strong enough to carry the hierarchy.
    '--ng-bg-0': '#E7EBF3',
    '--ng-bg-1': '#D6DDEA',
    '--ng-surface': 'rgba(249,250,253,0.88)',
    '--ng-surface-2': 'rgba(242,245,251,0.90)',
    '--ng-panel': '#F7F9FC',
    '--ng-panel-2': '#EDF1F8',
    '--ng-border': 'rgba(15,23,42,0.14)',
    '--ng-border-strong': 'rgba(15,23,42,0.24)',
    '--ng-fg': '#101626',
    '--ng-fg-muted': '#4D5871',
    '--ng-fg-subtle': '#7C8598',
    '--ng-fg-rgb': '16 22 38', // ink — legible foreground/hairline on light surfaces
    '--ng-recess-rgb': '15 23 42', // slate — subtle recessed wells on light surfaces
    '--ng-glass-bg': 'rgba(247,249,252,0.78)',
    '--ng-glass-border': 'rgba(15,23,42,0.14)',
    '--ng-elevate': '0 12px 36px rgba(15,23,42,0.14)',
    '--ng-primary': '#1E5BFF',
    '--ng-secondary': '#6B45F5',
    '--ng-success': '#159E6E',
    '--ng-warning': '#D98410',
    '--ng-danger': '#E23B3D',
    '--ng-info': '#1597A4',
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
    '--ng-primary': '#4DA3FF',
    '--ng-secondary': '#C9A7FF',
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
