/**
 * Collaboration store — realtime presence + a CRDT-ready op-log.
 *
 * Scope (Phase 2 scaffolding): hold the set of connected peers, their live
 * cursors/selection, and an append-only op-log carrying Lamport-stamped
 * operations. The transport is the resilient /ws/collab RealtimeChannel
 * (see api/ws.ts); this store is the reducer it feeds.
 *
 * The server remains authoritative for the graph today (via /ws/topology);
 * the op-log is the seam where a real CRDT (Yjs/Automerge) drops in later
 * without touching the UI or transport.
 */
import { create } from 'zustand';
import type { CrdtOp, Peer, PresenceEvent } from '@/api/types';

/** Deterministic avatar/cursor color from a peer id (stable across reconnects). */
export function peerColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 70% 58%)`;
}

/** Peers are evicted if no frame is seen within this window. */
const STALE_MS = 45_000;
/** Op-log is capped to avoid unbounded growth in long sessions. */
const MAX_OPS = 500;

interface CollabState {
  /** Connected peers, keyed by peer id (excludes self). */
  peers: Map<string, Peer>;
  /** This client's identity once joined; null until presence is established. */
  selfId: string | null;
  /** Append-only op-log (most recent last), capped at MAX_OPS. */
  ops: CrdtOp[];
  /** Local Lamport clock — advanced on every local op and incoming op. */
  lamport: number;
  /** Whether the collab channel is currently connected. */
  connected: boolean;

  // selectors
  peerList: () => Peer[];

  // mutations
  setSelfId: (id: string | null) => void;
  setConnected: (v: boolean) => void;
  applyEvent: (ev: PresenceEvent) => void;
  /** Drop peers that have gone silent (call on an interval). */
  evictStale: () => void;
  /** Stamp + record a local op, returning it ready to send over the wire. */
  makeOp: (entity: string, field: string | undefined, value: unknown) => CrdtOp;
  reset: () => void;
}

export const useCollabStore = create<CollabState>((set, get) => ({
  peers: new Map(),
  selfId: null,
  ops: [],
  lamport: 0,
  connected: false,

  peerList: () => Array.from(get().peers.values()),

  setSelfId: (selfId) => set({ selfId }),
  setConnected: (connected) => set({ connected }),

  applyEvent: (ev) =>
    set((s) => {
      switch (ev.type) {
        case 'presence.sync': {
          const peers = new Map<string, Peer>();
          for (const p of ev.peers) {
            if (p.id === s.selfId) continue;
            peers.set(p.id, { ...p, color: p.color || peerColor(p.id), lastSeen: Date.now() });
          }
          return { peers };
        }
        case 'presence.join': {
          if (ev.peer.id === s.selfId) return {};
          const peers = new Map(s.peers);
          peers.set(ev.peer.id, {
            ...ev.peer,
            color: ev.peer.color || peerColor(ev.peer.id),
            lastSeen: Date.now(),
          });
          return { peers };
        }
        case 'presence.leave': {
          if (!s.peers.has(ev.peer_id)) return {};
          const peers = new Map(s.peers);
          peers.delete(ev.peer_id);
          return { peers };
        }
        case 'presence.cursor': {
          const peer = s.peers.get(ev.peer_id);
          if (!peer) return {};
          const peers = new Map(s.peers);
          peers.set(ev.peer_id, { ...peer, cursor: ev.cursor, lastSeen: Date.now() });
          return { peers };
        }
        case 'presence.selection': {
          const peer = s.peers.get(ev.peer_id);
          if (!peer) return {};
          const peers = new Map(s.peers);
          peers.set(ev.peer_id, { ...peer, selection: ev.selection, lastSeen: Date.now() });
          return { peers };
        }
        case 'crdt.op': {
          // Advance Lamport clock past any incoming op (causal ordering).
          const lamport = Math.max(s.lamport, ev.op.lamport) + 1;
          const ops = [...s.ops, ev.op].slice(-MAX_OPS);
          return { ops, lamport };
        }
        default:
          return {};
      }
    }),

  evictStale: () =>
    set((s) => {
      const now = Date.now();
      let changed = false;
      const peers = new Map(s.peers);
      for (const [id, p] of peers) {
        if (now - p.lastSeen > STALE_MS) {
          peers.delete(id);
          changed = true;
        }
      }
      return changed ? { peers } : {};
    }),

  makeOp: (entity, field, value) => {
    const lamport = get().lamport + 1;
    const actor = get().selfId ?? 'local';
    const op: CrdtOp = {
      id: `${actor}-${lamport}`,
      actor,
      lamport,
      entity,
      field,
      value,
      ts: Date.now(),
    };
    set((s) => ({ lamport, ops: [...s.ops, op].slice(-MAX_OPS) }));
    return op;
  },

  reset: () => set({ peers: new Map(), ops: [], lamport: 0, selfId: null, connected: false }),
}));
