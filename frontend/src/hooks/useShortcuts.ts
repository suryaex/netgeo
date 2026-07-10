/**
 * useShortcuts — global keyboard shortcuts (design §17). Mounted once by
 * AppShell. Disabled while typing in a form field / CLI so it never eats input.
 *
 *   Ctrl/⌘+K  command palette      A  add device      L  link mode
 *   V  select mode                 F  fit canvas       Esc  cancel / close
 *
 * Single-key tool shortcuts (A/L/V/F) apply only in the topology workspace.
 */
import { useEffect } from 'react';
import { useUiStore } from '@/store/uiStore';
import { useTopoUiStore } from '@/store/topoUiStore';
import { useTopologyStore } from '@/store/topologyStore';

function isTypingTarget(el: EventTarget | null): boolean {
  const node = el as HTMLElement | null;
  if (!node) return false;
  const tag = node.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || node.isContentEditable;
}

export function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ui = useUiStore.getState();
      const topo = useTopoUiStore.getState();

      // Command palette: works everywhere, even from a focused field.
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        ui.setCommandOpen(!ui.commandOpen);
        return;
      }

      // Esc: close whatever overlay/selection is active (closes inspector too).
      if (e.key === 'Escape') {
        if (ui.commandOpen) return ui.setCommandOpen(false);
        if (topo.pickerOpen) return topo.closePicker();
        const t = useTopologyStore.getState();
        if (t.selectedNodeId || t.selectedLinkId) t.select({ nodeId: null, linkId: null });
        if (topo.inspectorPinned) topo.togglePin();
        return;
      }

      // Remaining shortcuts are single-key — never fire while typing, and never
      // with a modifier (so Ctrl+A "select all" etc. still work in the browser).
      if (isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (ui.viewMode !== 'topology') return;

      switch (e.key) {
        case 'a':
        case 'A':
          e.preventDefault();
          topo.openPicker();
          break;
        case 'l':
        case 'L':
          topo.setTool('link');
          break;
        case 'v':
        case 'V':
          topo.setTool('select');
          break;
        case 'f':
        case 'F':
          topo.fit?.();
          break;
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
