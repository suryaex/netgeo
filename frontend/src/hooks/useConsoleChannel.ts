/**
 * Per-node console hook. Opens /ws/console/{nodeId}, accumulates output lines
 * (capped to keep memory bounded), and exposes a `send` for keystrokes.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { consoleChannel } from '@/api/ws';
import type { ConnState } from '@/api/ws';
import type { ConsoleEvent } from '@/api/types';

const MAX_LINES = 2_000; // ring buffer cap — keeps long sessions light

export interface ConsoleSession {
  lines: string[];
  prompt: string;
  state: ConnState;
  send: (cmd: string) => void;
}

export function useConsoleChannel(nodeId: string | null): ConsoleSession {
  const [lines, setLines] = useState<string[]>([]);
  const [prompt, setPrompt] = useState<string>('');
  const [state, setState] = useState<ConnState>('connecting');
  const channelRef = useRef<ReturnType<typeof consoleChannel> | null>(null);

  useEffect(() => {
    if (!nodeId) return;
    setLines([]);
    const channel = consoleChannel(nodeId);
    channelRef.current = channel;

    const offMsg = channel.onMessage((ev: ConsoleEvent) => {
      if (ev.type === 'output') {
        setLines((prev) => {
          const next = prev.concat(ev.data.split('\n'));
          return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
        });
      } else if (ev.type === 'prompt') {
        setPrompt(ev.prompt);
      } else if (ev.type === 'closed') {
        setLines((prev) => prev.concat(`\n[session closed${ev.reason ? `: ${ev.reason}` : ''}]`));
      }
    });
    const offState = channel.onState(setState);
    channel.connect();

    return () => {
      offMsg();
      offState();
      channel.close();
      channelRef.current = null;
    };
  }, [nodeId]);

  const send = useCallback((cmd: string) => {
    channelRef.current?.send({ type: 'input', data: cmd });
  }, []);

  return { lines, prompt, state, send };
}
