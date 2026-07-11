/**
 * AppShell — workspace frame (design §3, §27; rebuild 12-UI §2).
 * Composition: TopBar (56px) · NavigationRail (64px) · workspace · StatusBar.
 * The only cross-mode surfaces are TopBar, rail, StatusBar, ModalLayer and
 * toasts; the BottomDrawer is gated to topology/map and SimulationDock to
 * topology + a running sim. The legacy floating-window shell is gone: secondary
 * tools live in the shared BottomDrawer, and Settings/Scenarios are modals.
 */
import { lazy, Suspense } from 'react';
import { Loader2 } from 'lucide-react';
import type { ConnState } from '@/api/ws';
import { useUiStore } from '@/store/uiStore';
import { useLabStore } from '@/store/labStore';
import { useShortcuts } from '@/hooks/useShortcuts';
import { TopBar } from './TopBar';
import { NavigationRail } from './NavigationRail';
import { StatusBar } from './StatusBar';
import { BottomDrawer } from './BottomDrawer';
import { ModalLayer } from './ModalLayer';
import { MapView } from '@/components/map/MapView';
import { TopologyCanvas } from '@/components/canvas/TopologyCanvas';
import { TopologyToolbar } from '@/components/topology/TopologyToolbar';
import { ContextInspector } from '@/components/topology/ContextInspector';
import { DevicePicker } from '@/components/topology/DevicePicker';
import { CommandPalette } from '@/components/CommandPalette';
import { SimulationDock } from '@/components/SimulationDock';
import { TwinWorkspace } from '@/components/twin/TwinWorkspace';
import { RfWorkspace } from '@/components/rf/RfWorkspace';
import { FiberWorkspace } from '@/components/fiber/FiberWorkspace';
import { PlantWorkspace } from '@/components/plant/PlantWorkspace';

// Education Lab is a self-contained workspace (author editor + student runner);
// lazy so its bundle stays out of the initial load until the module is opened.
const EduWorkspace = lazy(() =>
  import('@/components/edu/EduWorkspace').then((m) => ({ default: m.EduWorkspace })),
);

export function AppShell({ projectName, conn }: { projectName: string; conn: ConnState }) {
  const viewMode = useUiStore((s) => s.viewMode);
  const simMode = useLabStore((s) => s.mode) === 'simulation';
  const drawerHosted = viewMode === 'topology' || viewMode === 'map';
  useShortcuts();

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden">
      <TopBar projectName={projectName} conn={conn} />

      <div className="flex min-h-0 flex-1">
        <NavigationRail />

        <main className="relative min-w-0 flex-1 overflow-hidden" aria-label="Workspace">
          {viewMode === 'map' ? (
            <MapView />
          ) : viewMode === 'twin' ? (
            <TwinWorkspace />
          ) : viewMode === 'rf' ? (
            <RfWorkspace />
          ) : viewMode === 'fiber' ? (
            <FiberWorkspace />
          ) : viewMode === 'plant' ? (
            <PlantWorkspace />
          ) : viewMode === 'edu' ? (
            <Suspense
              fallback={
                <div className="grid h-full place-items-center text-fg/50">
                  <Loader2 className="h-6 w-6 animate-spin text-accent" />
                </div>
              }
            >
              <EduWorkspace />
            </Suspense>
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

          {/* Shared diagnostics drawer — topology/map only; other workspaces own
              their own bottom edge. Simulation transport — topology + running sim. */}
          {drawerHosted && <BottomDrawer />}
          {viewMode === 'topology' && simMode && <SimulationDock />}
        </main>
      </div>

      <StatusBar conn={conn} />
      <CommandPalette />
      <ModalLayer />
    </div>
  );
}
