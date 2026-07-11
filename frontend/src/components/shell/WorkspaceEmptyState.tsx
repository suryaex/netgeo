/**
 * WorkspaceEmptyState — the shared "this workspace has nothing yet" overlay
 * (design 12-UI §2.6). Pattern lifted from the Twin canvas overlay (v1.2.022):
 * a centered icon + instructive title + optional hint + optional CTA, laid over
 * the full workspace so the canvas never sits empty and passive.
 *
 * Wire into any full-bleed workspace that can be genuinely empty (Fiber, Plant,
 * …). The overlay is pointer-transparent except the CTA, so map/canvas panning
 * underneath still works.
 */
import type { LucideIcon } from 'lucide-react';

export function WorkspaceEmptyState({
  icon: Icon,
  title,
  hint,
  action,
}: {
  icon: LucideIcon;
  title: string;
  hint?: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="pointer-events-none absolute inset-0 grid place-items-center">
      <div className="grid max-w-sm place-items-center gap-3 px-6 text-center">
        <Icon className="h-9 w-9 text-fg/25" aria-hidden />
        <p className="text-sm text-fg/60">{title}</p>
        {hint && <p className="max-w-xs text-xs leading-relaxed text-fg/40">{hint}</p>}
        {action && (
          <button
            onClick={action.onClick}
            className="pointer-events-auto rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-fg hover:bg-accent-soft"
          >
            {action.label}
          </button>
        )}
      </div>
    </div>
  );
}
