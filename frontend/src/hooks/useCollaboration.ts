/**
 * useCollaboration — binds the /ws/collab presence channel to collabStore.
 *
 * Scaffolding for multi-user editing (PRD §Workspace → Team Collaboration):
 *  - opens the resilient collab channel for the active project,
 *  - feeds presence/CRDT frames into the store,
 *  - evicts stale peers on an interval,
 *  - returns publishers for the local cursor/selection.
 *
 * Connection is gated behind `VITE_COLLAB=1` so it stays dormant until the
 * backend `/ws/collab` endpoint exists — otherwise the resilient socket would
 * reconnect-loop against a 404. Presence UI still renders (empty) when off, so
 * the feature is wired end-to-end and ready to light up.
 */
import { useEffect, useMemo, useRef } from 'react';
import { collabChannel, type RealtimeChannel } from '@/api/ws';
import type { Peer, PresenceEvent } from '@/api/types';
import { useCollabStore } from '@/store/collabStore';

export interface CollaborationApi {
  enabled: boolean;
  publishCursor: (cursor: Peer['cursor']) => void;
  publishSelection: (selection: string | null) => void;
}

/** Read the collab feature flag. On by default now that the backend
 *  `/ws/collab` presence channel exists; set `VITE_COLLAB=0` to disable. */
function collabEnabled(): boolean {
  const flag = import.meta.env.VITE_COLLAB;
  return flag !== '0' && flag !== 'false';
}

export function useCollaboration(
  authed: boolean,
  projectId?: string | null,
): CollaborationApi {
  const applyEvent = useCollabStore((s) => s.applyEvent);
  const setConnected = useCollabStore((s) => s.setConnected);
  const evictStale = useCollabStore((s) => s.evictStale);
  const reset = useCollabStore((s) => s.reset);

  const channelRef = useRef<RealtimeChannel<PresenceEvent> | null>(null);
  const enabled = collabEnabled() && authed && !!projectId;

  useEffect(() => {
    if (!enabled || !projectId) return;
    const channel = collabChannel(projectId);
    channelRef.current = channel;

    const offMsg = channel.onMessage((ev) => applyEvent(ev));
    const offState = channel.onState((st) => setConnected(st === 'open'));
    channel.connect();

    const evictTimer = setInterval(evictStale, 15_000);

    return () => {
      clearInterval(evictTimer);
      offMsg();
      offState();
      channel.close();
      channelRef.current = null;
      reset();
    };
  }, [enabled, projectId, applyEvent, setConnected, evictStale, reset]);

  return useMemo<CollaborationApi>(
    () => ({
      enabled,
      publishCursor: (cursor) => {
        const id = useCollabStore.getState().selfId ?? 'local';
        channelRef.current?.send({ type: 'presence.cursor', peer_id: id, cursor });
      },
      publishSelection: (selection) => {
        const id = useCollabStore.getState().selfId ?? 'local';
        channelRef.current?.send({ type: 'presence.selection', peer_id: id, selection });
      },
    }),
    [enabled],
  );
}
