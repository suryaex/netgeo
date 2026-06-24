/**
 * ConsolePanel — interactive device terminal bound to /ws/console/{node_id}.
 * Renders the streamed output ring buffer and a command input. Defaults to the
 * currently-selected node but can be pinned to a specific node via window ctx.
 *
 * This is a terminal-style view (not a full xterm) to stay light; it covers
 * line-oriented NOS CLIs. Swap to xterm.js later only if raw TTY control is
 * needed (kept out of the base bundle to protect the RAM budget).
 */
import { useEffect, useRef, useState } from 'react';
import { TerminalSquare } from 'lucide-react';
import { useConsoleChannel } from '@/hooks/useConsoleChannel';
import { useTopologyStore } from '@/store/topologyStore';
import type { WindowInstance } from '@/store/windowStore';

export function ConsolePanel({ win }: { win: WindowInstance }) {
  const selectedId = useTopologyStore((s) => s.selectedNodeId);
  const nodes = useTopologyStore((s) => s.nodes);
  const nodeId = win.context?.nodeId ?? selectedId;
  const node = nodeId ? nodes.get(nodeId) : null;

  const { lines, prompt, state, send } = useConsoleChannel(nodeId);
  const [cmd, setCmd] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new output.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [lines.length]);

  if (!nodeId) {
    return (
      <div className="grid h-full place-items-center text-center text-white/40">
        <div className="space-y-2">
          <TerminalSquare className="mx-auto h-8 w-8" />
          <p className="text-sm">No device console open</p>
          <p className="text-xs">Select a node, then open Console from the dock.</p>
        </div>
      </div>
    );
  }

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!cmd.trim()) return;
    send(cmd);
    setCmd('');
  };

  return (
    <div className="flex h-full flex-col bg-black/40 font-mono text-[12.5px] text-emerald-200/90">
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-1 text-[11px] text-white/50">
        <span>{node?.name ?? nodeId}</span>
        <span className={state === 'open' ? 'text-success' : 'text-warning'}>● {state}</span>
      </div>

      <div ref={scrollRef} className="nf-scroll flex-1 overflow-auto px-3 py-2 leading-relaxed">
        {lines.length === 0 ? (
          <p className="text-white/30">Connecting to {node?.nos.toUpperCase()} console…</p>
        ) : (
          lines.map((l, i) => (
            <div key={i} className="whitespace-pre-wrap break-words">
              {l}
            </div>
          ))
        )}
      </div>

      <form onSubmit={onSubmit} className="flex items-center gap-2 border-t border-white/10 px-3 py-2">
        <span className="shrink-0 text-accent-soft">{prompt || `${node?.name ?? 'device'}>`}</span>
        <input
          value={cmd}
          onChange={(e) => setCmd(e.target.value)}
          autoFocus
          spellCheck={false}
          aria-label="Console command input"
          className="w-full bg-transparent text-emerald-100 outline-none placeholder:text-white/30"
          placeholder="enter command…"
        />
      </form>
    </div>
  );
}
