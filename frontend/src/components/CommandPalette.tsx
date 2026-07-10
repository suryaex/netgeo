/**
 * CommandPalette — Ctrl/⌘+K launcher (design §16). Fuzzy (subsequence) filter
 * over a static command list plus live device/IP matches from the topology.
 * No new dependencies: the matcher is a ~10-line subsequence scorer. Opens/
 * closes via uiStore.commandOpen (toggled by the global shortcut).
 *
 * Commands cover Phase-1 scope: module navigation, add device, run simulation,
 * open CLI/diagnostics, fit canvas, export config, and jump-to-device.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, CornerDownLeft } from 'lucide-react';
import { useUiStore } from '@/store/uiStore';
import { useWindowStore } from '@/store/windowStore';
import { useTopoUiStore } from '@/store/topoUiStore';
import { useTopologyStore } from '@/store/topologyStore';
import { simApi } from '@/api/client';
import type { NodeModel } from '@/api/types';
import { cn } from '@/lib/cn';

interface Command {
  id: string;
  title: string;
  hint?: string;
  run: () => void;
}

/** Subsequence match: true if every char of `q` appears in order in `text`. */
function subseq(text: string, q: string): boolean {
  if (!q) return true;
  let i = 0;
  for (const ch of text.toLowerCase()) {
    if (ch === q[i]) i++;
    if (i === q.length) return true;
  }
  return i === q.length;
}

function mgmtIp(node: NodeModel): string | undefined {
  return node.interfaces.find((i) => i.ip.length > 0)?.ip[0];
}

export function CommandPalette() {
  const open = useUiStore((s) => s.commandOpen);
  const setOpen = useUiStore((s) => s.setCommandOpen);
  const setViewMode = useUiStore((s) => s.setViewMode);
  const projectId = useUiStore((s) => s.projectId);
  const setSimState = useUiStore((s) => s.setSimState);
  const toggleApp = useWindowStore((s) => s.toggleApp);
  const openPicker = useTopoUiStore((s) => s.openPicker);
  const fit = useTopoUiStore((s) => s.fit);
  const nodes = useTopologyStore((s) => s.nodes);
  const select = useTopologyStore((s) => s.select);

  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQ('');
      setActive(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const close = () => setOpen(false);

  const commands: Command[] = useMemo(() => {
    const nav: Command[] = [
      { id: 'go-topology', title: 'Go to Topology', hint: 'Navigate', run: () => setViewMode('topology') },
      { id: 'go-map', title: 'Go to Map', hint: 'Navigate', run: () => setViewMode('map') },
      { id: 'add-device', title: 'Add device…', hint: 'Action', run: () => openPicker() },
      {
        id: 'run-sim',
        title: 'Run simulation',
        hint: 'Action',
        run: () => {
          if (!projectId) return;
          setSimState('running');
          void simApi.start({ project_id: projectId, realtime: true }).catch(() => setSimState('idle'));
        },
      },
      { id: 'open-cli', title: 'Open CLI / Console', hint: 'Action', run: () => toggleApp('console', 'Console') },
      { id: 'open-diag', title: 'Open Diagnostics', hint: 'Action', run: () => toggleApp('diagnostics', 'Diagnostics') },
      { id: 'open-ledger', title: 'Open Event Ledger', hint: 'Action', run: () => toggleApp('ledger', 'Event Ledger') },
      { id: 'open-racks', title: 'Open Rack Elevation', hint: 'Action', run: () => toggleApp('racks', 'Rack Elevation') },
      { id: 'open-config', title: 'Export / View config', hint: 'Action', run: () => toggleApp('config', 'Config Viewer') },
      { id: 'fit', title: 'Fit topology', hint: 'View', run: () => fit?.() },
      { id: 'settings', title: 'Open Settings', hint: 'Action', run: () => toggleApp('settings', 'Settings') },
    ];

    const query = q.trim().toLowerCase();
    const staticMatches = nav.filter((c) => subseq(c.title, query));

    // Live device/IP jump results (design §16: "Find device/IP").
    const deviceMatches: Command[] = [];
    if (query) {
      for (const n of nodes.values()) {
        const ip = mgmtIp(n);
        if (subseq(n.name, query) || (ip && ip.toLowerCase().includes(query))) {
          deviceMatches.push({
            id: `dev-${n.id}`,
            title: `Go to ${n.name}`,
            hint: ip ?? n.kind,
            run: () => {
              setViewMode('topology');
              select({ nodeId: n.id });
              fit?.();
            },
          });
        }
        if (deviceMatches.length >= 6) break;
      }
    }

    return [...staticMatches, ...deviceMatches];
  }, [q, nodes, setViewMode, openPicker, projectId, setSimState, toggleApp, fit, select]);

  if (!open) return null;

  const run = (c: Command | undefined) => {
    if (!c) return;
    c.run();
    close();
  };

  return (
    <div
      className="fixed inset-0 z-[1300] grid place-items-start justify-center pt-[14vh]"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="absolute inset-0 bg-recess/50 backdrop-blur-sm" aria-hidden />

      <div className="glass-strong relative z-10 flex max-h-[60vh] w-[min(600px,92vw)] flex-col overflow-hidden rounded-xl border border-fg/15 shadow-glass-lg animate-scale-in">
        <div className="flex items-center gap-2 border-b border-fg/10 px-3.5 py-3">
          <Search className="h-4 w-4 shrink-0 text-fg/40" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') close();
              else if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, commands.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                run(commands[active]);
              }
            }}
            placeholder="Type a command or search devices, IPs…"
            aria-label="Command palette input"
            className="w-full bg-transparent text-sm text-fg/90 placeholder:text-fg/35 outline-none"
          />
          <kbd className="hidden shrink-0 rounded border border-fg/15 px-1.5 py-0.5 font-mono text-[10px] text-fg/40 sm:inline">
            ⌘K
          </kbd>
        </div>

        <ul className="ng-scroll flex-1 overflow-auto py-1.5">
          {commands.length === 0 ? (
            <li className="px-4 py-6 text-center text-sm text-fg/40">No matching commands.</li>
          ) : (
            commands.map((c, i) => (
              <li key={c.id}>
                <button
                  onMouseEnter={() => setActive(i)}
                  onClick={() => run(c)}
                  className={cn(
                    'flex w-full items-center justify-between gap-3 px-4 py-2 text-left',
                    i === active ? 'bg-fg/10' : 'hover:bg-fg/6',
                  )}
                >
                  <span className="truncate text-sm text-fg/90">{c.title}</span>
                  <span className="flex shrink-0 items-center gap-2">
                    {c.hint && <span className="font-mono text-[10px] text-fg/40">{c.hint}</span>}
                    {i === active && <CornerDownLeft className="h-3.5 w-3.5 text-fg/30" />}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
