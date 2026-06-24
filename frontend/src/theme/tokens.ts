/**
 * NetForge design tokens — single source for glassmorphism surfaces, the
 * Apple-blue accent, and per-node-kind colors. Tailwind reads the static set
 * via tailwind.config.js; this module exposes the same values to TS (canvas,
 * inline styles, React Flow node renderers) and drives light/dark theming by
 * writing CSS custom properties on <html>.
 */
import type { NodeKind } from '@/api/types';

export type ThemeMode = 'light' | 'dark';

/** Glass surface recipe per mode. Used by the .glass utility + window chrome. */
export const glass = {
  light: {
    bg: 'rgba(255,255,255,0.62)',
    border: 'rgba(255,255,255,0.55)',
    blur: '20px',
  },
  dark: {
    bg: 'rgba(22,27,42,0.55)',
    border: 'rgba(255,255,255,0.08)',
    blur: '20px',
  },
} as const;

/** Canvas backdrop gradient stops per mode (the "desktop wallpaper"). */
export const desktop = {
  light: ['#EEF2FB', '#DCE5F7'],
  dark: ['#0B1020', '#141A2E'],
} as const;

/** Node-kind accent colors — must mirror tailwind `colors.node`. */
export const nodeColors: Record<NodeKind, string> = {
  router: '#007AFF',
  switch: '#34C759',
  host: '#8E8E93',
  ap: '#5856D6',
  olt: '#FF9F0A',
  firewall: '#FF453A',
  server: '#0891B2',
};

/** Link-status colors for edges (up/down/admin-down/unknown). */
export const linkStatusColors = {
  up: '#34C759',
  down: '#FF453A',
  admin_down: '#FF9F0A',
  unknown: '#8E8E93',
} as const;

/** CSS variables injected onto :root so plain CSS / canvas can read tokens. */
const cssVars: Record<ThemeMode, Record<string, string>> = {
  light: {
    '--nf-bg-0': desktop.light[0],
    '--nf-bg-1': desktop.light[1],
    '--nf-glass-bg': glass.light.bg,
    '--nf-glass-border': glass.light.border,
    '--nf-ink': '#111827',
    '--nf-ink-soft': '#6B7280',
    '--nf-accent': nodeColors.router,
  },
  dark: {
    '--nf-bg-0': desktop.dark[0],
    '--nf-bg-1': desktop.dark[1],
    '--nf-glass-bg': glass.dark.bg,
    '--nf-glass-border': glass.dark.border,
    '--nf-ink': '#F3F4F6',
    '--nf-ink-soft': '#9CA3AF',
    '--nf-accent': nodeColors.router,
  },
};

/** Apply a theme mode: toggles the Tailwind `dark` class + writes CSS vars. */
export function applyTheme(mode: ThemeMode): void {
  const root = document.documentElement;
  root.classList.toggle('dark', mode === 'dark');
  const vars = cssVars[mode];
  for (const [key, value] of Object.entries(vars)) {
    root.style.setProperty(key, value);
  }
  root.style.setProperty('color-scheme', mode);
}
