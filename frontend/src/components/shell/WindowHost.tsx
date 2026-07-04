/**
 * WindowHost — renders all open windows from the windowStore, wiring each
 * WindowKind to its content component. This is the desktop "compositor": it
 * owns nothing about geometry/focus (that's Window + windowStore), it only
 * maps kind -> body. Keeping the mapping here means new apps are one line.
 */
import { Window } from './Window';
import { useWindowStore, type WindowInstance } from '@/store/windowStore';
import { TopologyCanvas } from '@/components/canvas/TopologyCanvas';
import { NodePalette } from '@/components/NodePalette';
import { PropertiesPanel } from '@/components/PropertiesPanel';
import { ConsolePanel } from '@/components/ConsolePanel';
import { ConfigViewer } from '@/components/ConfigViewer';
import { DiagnosticsPanel } from '@/components/DiagnosticsPanel';
import { EventLedgerPanel } from '@/components/EventLedgerPanel';
import { ScenariosPanel } from '@/components/ScenariosPanel';
import { SettingsPanel } from '@/components/SettingsPanel';

function WindowBody({ win }: { win: WindowInstance }) {
  switch (win.kind) {
    case 'topology':
      return <TopologyCanvas />;
    case 'palette':
      return <NodePalette />;
    case 'properties':
      return <PropertiesPanel />;
    case 'console':
      return <ConsolePanel win={win} />;
    case 'config':
      return <ConfigViewer win={win} />;
    case 'scenarios':
      return <ScenariosPanel />;
    case 'diagnostics':
      return <DiagnosticsPanel />;
    case 'ledger':
      return <EventLedgerPanel />;
    case 'settings':
      return <SettingsPanel />;
    default:
      return null;
  }
}

export function WindowHost() {
  const list = useWindowStore((s) => s.list());

  return (
    <>
      {list.map((win) => (
        <Window key={win.id} win={win}>
          <WindowBody win={win} />
        </Window>
      ))}
    </>
  );
}
