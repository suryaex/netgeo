/**
 * MapOnboardingModal — welcome modal for the satellite map mode.
 * Mirrors the UISP Design Center "Start a network" prompt.
 * Three quickstart options: multi-point AP network, P2P bridge, fiber.
 */
import { Radio, ArrowRightLeft, Cable, X } from 'lucide-react';
import { useMapStore, type MapTool } from '@/store/mapStore';
import { useUiStore } from '@/store/uiStore';
import { cn } from '@/lib/cn';
import { zc } from '@/theme/z';

interface QuickstartOption {
  icon: typeof Radio;
  color: string;
  title: string;
  description: string;
  tool: MapTool;
}

const OPTIONS: QuickstartOption[] = [
  {
    icon: Radio,
    color: '#5856D6',
    title: 'Multi-Point Network',
    description: 'Place an Access Point, then add CPE clients. Links and signal coverage drawn automatically.',
    tool: 'ap',
  },
  {
    icon: ArrowRightLeft,
    color: '#007AFF',
    title: 'Point-to-Point Bridge',
    description: 'Place two Towers for a directional backhaul link with RSSI estimation.',
    tool: 'tower',
  },
  {
    icon: Cable,
    color: '#FF9F0A',
    title: 'Custom Placement',
    description: 'Use the toolbar to freely mix Access Points, CPEs, and Towers on the map.',
    tool: 'select',
  },
];

export function MapOnboardingModal() {
  const markSeen = useMapStore((s) => s.dismissOnboarding);
  const setTool = useMapStore((s) => s.setTool);
  const closeModal = useUiStore((s) => s.closeModal);

  // Dismiss = remember it for the session AND release the shared modal slot.
  const dismiss = () => {
    markSeen();
    closeModal();
  };

  const pick = (opt: QuickstartOption) => {
    setTool(opt.tool);
    dismiss();
  };

  return (
    <div
      className={cn('fixed inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in', zc.modal)}
      onClick={(e) => e.target === e.currentTarget && dismiss()}
    >
      <div className="glass-strong relative w-full max-w-lg overflow-hidden rounded-2xl border border-fg/15 shadow-glass-lg animate-scale-in">
        {/* Close */}
        <button
          onClick={dismiss}
          aria-label="Skip onboarding"
          className="absolute right-4 top-4 grid h-7 w-7 place-items-center rounded-md text-fg/40 hover:bg-fg/10 hover:text-fg"
        >
          <X className="h-4 w-4" />
        </button>

        {/* Header */}
        <div className="border-b border-fg/10 px-8 pb-5 pt-8 text-center">
          <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-xl bg-accent/20 text-accent">
            <Radio className="h-6 w-6" />
          </div>
          <h2 className="text-lg font-semibold text-fg">Start a Network Design</h2>
          <p className="mt-1 text-sm text-fg/55">
            Click the map to place devices. Links and signal coverage are drawn automatically.
          </p>
        </div>

        {/* Options */}
        <div className="grid gap-3 p-6">
          {OPTIONS.map((opt) => {
            const Icon = opt.icon;
            return (
              <button
                key={opt.title}
                onClick={() => pick(opt)}
                className={cn(
                  'group flex items-center gap-4 rounded-xl border border-fg/10 bg-fg/5 p-4 text-left',
                  'transition-all duration-fast hover:border-fg/20 hover:bg-fg/10',
                )}
              >
                <div
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-lg transition-transform group-hover:scale-110"
                  style={{ background: `${opt.color}22`, color: opt.color }}
                >
                  <Icon className="h-5 w-5" />
                </div>
                <div>
                  <p className="font-medium text-fg/90">{opt.title}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-fg/50">{opt.description}</p>
                </div>
              </button>
            );
          })}
        </div>

        <div className="border-t border-fg/10 px-6 py-3 text-center">
          <button
            onClick={dismiss}
            className="text-xs text-fg/35 hover:text-fg/60 transition-colors"
          >
            Skip — I'll explore on my own
          </button>
        </div>
      </div>
    </div>
  );
}
