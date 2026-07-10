/**
 * AppShell — Phase 1 UX foundation frame (design §3, §27).
 * Composition: TopBar (56px) · NavigationRail (64px) · workspace · StatusBar,
 * with the command palette and global shortcuts mounted once here.
 *
 * Additive by design: it wraps the *existing* workspace surfaces rather than
 * rewriting them. Topology is now full-canvas (the React Flow canvas fills the
 * workspace instead of living in a floating window) with a floating toolbar,
 * on-demand device picker, and a slide-in context inspector. The floating
 * window system (WindowHost + Dock) is retained for secondary tools
 * (Console, Diagnostics, Ledger, Racks, Config, Scenarios, Settings).
 */
import type { ConnState } from '@/api/ws';
import { useUiStore } from '@/store/uiStore';
import { useShortcuts } from '@/hooks/useShortcuts';
import { TopBar } from './TopBar';
import { NavigationRail } from './NavigationRail';
import { StatusBar } from './StatusBar';
import { WindowHost } from './WindowHost';
import { Dock } from './Dock';
import { MapView } from '@/components/map/MapView';
import { TopologyCanvas } from '@/components/canvas/TopologyCanvas';
import { TopologyToolbar } from '@/components/topology/TopologyToolbar';
import { ContextInspector } from '@/components/topology/ContextInspector';
import { DevicePicker } from '@/components/topology/DevicePicker';
import { CommandPalette } from '@/components/CommandPalette';

export function AppShell({ projectName, conn }: { projectName: string; conn: ConnState }) {
  const viewMode = useUiStore((s) => s.viewMode);
  useShortcuts();

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden">
      <TopBar projectName={projectName} conn={conn} />

      <div className="flex min-h-0 flex-1">
        <NavigationRail />

        <main className="relative min-w-0 flex-1 overflow-hidden" aria-label="Workspace">
          {viewMode === 'map' ? (
            <MapView />
          ) : (
            <>
              <div className="absolute inset-0">
                <TopologyCanvas />
              </div>
              <TopologyToolbar />
              <ContextInspector />
              <DevicePicker />
            </>
          )}

          {/* Secondary tools float over any workspace, launched from the Dock. */}
          <WindowHost />
          <Dock />
        </main>
      </div>

      <StatusBar conn={conn} />
      <CommandPalette />
    </div>
  );
}
