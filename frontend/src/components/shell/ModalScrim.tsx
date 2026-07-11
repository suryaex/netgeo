/**
 * ModalScrim — the shared modal backdrop + centered card chrome (design 12-UI
 * §2.3). Glass scrim, click-outside to close, `role="dialog" aria-modal`, and
 * the single modal z-layer. Escape is handled once, globally, in useShortcuts.
 *
 * Used to give bare panels (Settings, Scenarios) modal chrome. Modals that
 * already ship their own full-screen scrim (command palette, device picker,
 * onboarding, import/BOM) keep it — they just derive open from the same
 * uiStore.activeModal slot, so exclusivity still holds.
 */
import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { zc } from '@/theme/z';

export function ModalScrim({
  label,
  onClose,
  children,
  className,
}: {
  label: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn('fixed inset-0 grid place-items-center p-4', zc.modal)}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="absolute inset-0 bg-recess/50 backdrop-blur-sm" aria-hidden />
      <div
        className={cn(
          'glass-strong relative flex max-h-[85vh] w-full flex-col overflow-hidden rounded-xl border border-fg/15 shadow-glass-lg animate-scale-in',
          className,
        )}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 z-10 grid h-7 w-7 place-items-center rounded-md text-fg/45 hover:bg-fg/10 hover:text-fg"
        >
          <X className="h-4 w-4" />
        </button>
        {children}
      </div>
    </div>
  );
}
