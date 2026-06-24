/**
 * App — the NetForge desktop shell composition.
 * Layout: full-viewport "desktop" with a glass MenuBar (top), the floating
 * window manager (WindowHost), and the Dock (bottom). On first mount it:
 *   - applies the persisted theme,
 *   - bootstraps the open project (loads topology snapshot),
 *   - connects the /ws/topology realtime channel,
 *   - opens the default workspace windows (canvas + palette + properties).
 *
 * Real graph/window state lives in Zustand stores; server data is fetched via
 * the typed REST client and reconciled by the realtime channel.
 */
import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MenuBar } from '@/components/shell/MenuBar';
import { Dock } from '@/components/shell/Dock';
import { WindowHost } from '@/components/shell/WindowHost';
import { projectsApi } from '@/api/client';
import { useUiStore } from '@/store/uiStore';
import { useWindowStore } from '@/store/windowStore';
import { useTopologyStore } from '@/store/topologyStore';
import { useTopologyChannel } from '@/hooks/useTopologyChannel';
import { applyTheme } from '@/theme/tokens';

export default function App() {
  const theme = useUiStore((s) => s.theme);
  const projectId = useUiStore((s) => s.projectId);
  const setProject = useUiStore((s) => s.setProject);
  const loadSnapshot = useTopologyStore((s) => s.loadSnapshot);
  const openWindow = useWindowStore((s) => s.open);
  const windowCount = useWindowStore((s) => Object.keys(s.windows).length);

  // Apply persisted theme on mount.
  useEffect(() => applyTheme(theme), [theme]);

  // Bootstrap: pick the first project (placeholder until a project picker
  // exists) and select it as the active workspace.
  const { data: projects } = useQuery({
    queryKey: ['projects'],
    queryFn: projectsApi.list,
    staleTime: 60_000,
    retry: 1,
  });

  useEffect(() => {
    if (!projectId && projects && projects.length > 0) {
      setProject(projects[0]!.id);
    }
  }, [projects, projectId, setProject]);

  // Load the topology snapshot for the active project (initial paint), then
  // realtime keeps it fresh.
  const { data: topology } = useQuery({
    queryKey: ['topology', projectId],
    queryFn: () => projectsApi.topology(projectId!),
    enabled: !!projectId,
  });

  useEffect(() => {
    if (topology) loadSnapshot(topology);
  }, [topology, loadSnapshot]);

  // Realtime channel (auto-reconnect) — only when a project is active.
  const conn = useTopologyChannel(!!projectId);

  // Open the default workspace once.
  useEffect(() => {
    if (windowCount === 0) {
      openWindow('palette', { title: 'Device Palette' });
      openWindow('properties', { title: 'Properties' });
      openWindow('topology', { title: 'Topology' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const projectName =
    projects?.find((p) => p.id === projectId)?.name ?? 'Untitled Project';

  return (
    <div className="relative h-screen w-screen overflow-hidden">
      <MenuBar projectName={projectName} conn={conn} />

      {/* Desktop surface — windows float here, between menu bar and dock. */}
      <main className="absolute inset-x-0 bottom-0 top-9" aria-label="NetForge desktop">
        <WindowHost />
      </main>

      <Dock />
    </div>
  );
}
