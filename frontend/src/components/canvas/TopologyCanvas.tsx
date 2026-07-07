/**
 * TopologyCanvas — the heart of NetGeo's topology workspace. React Flow canvas with:
 *  - drag-drop device creation from the palette (HTML5 DnD)
 *  - link creation by dragging between node handles
 *  - zoom/pan, minimap, snap grid
 *  - selection wired to the shared topology store
 *  - debounced position persistence to the backend (move flood control)
 *
 * Performance: store nodes live in Maps; we derive RF nodes/edges with a
 * memoized projection. `onlyRenderVisibleElements` keeps thousands of nodes
 * cheap. Node moves are committed locally immediately, pushed to the server
 * on drag-stop only (not on every frame).
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  MiniMap,
  Panel,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
  type OnNodeDrag,
  type NodeMouseHandler,
  type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Search, Plus, X } from 'lucide-react';
import { DeviceNode, type DeviceNodeData } from './DeviceNode';
import { PulseEdge } from './PulseEdge';
import { useTopologyStore } from '@/store/topologyStore';
import { useUiStore } from '@/store/uiStore';
import { useLabStore } from '@/store/labStore';
import { useWindowStore } from '@/store/windowStore';
import { nodesApi, linksApi } from '@/api/client';
import { deviceByKey } from '@/data/deviceCatalog';
import { linkStatusColors, nodeColors } from '@/theme/tokens';
import type { LinkType, NodeModel } from '@/api/types';
import { cn } from '@/lib/cn';

const nodeTypes = { device: DeviceNode };
const edgeTypes = { pulse: PulseEdge };

/** Type-aware edge styling: fiber solid+bold, copper solid, wireless/virtual dashed. */
const EDGE_WIDTH: Record<LinkType, number> = { fiber: 2.6, copper: 2, wireless: 2, virtual: 1.6 };
const EDGE_DASH: Record<LinkType, string | undefined> = {
  fiber: undefined,
  copper: undefined,
  wireless: '4 5',
  virtual: '1 6',
};

export function TopologyCanvas() {
  const rfRef = useRef<ReactFlowInstance<Node<DeviceNodeData>, Edge> | null>(null);
  const nodesMap = useTopologyStore((s) => s.nodes);
  const linksMap = useTopologyStore((s) => s.links);
  const selectedNodeId = useTopologyStore((s) => s.selectedNodeId);
  const moveNode = useTopologyStore((s) => s.moveNode);
  const upsertNode = useTopologyStore((s) => s.upsertNode);
  const removeNode = useTopologyStore((s) => s.removeNode);
  const upsertLink = useTopologyStore((s) => s.upsertLink);
  const select = useTopologyStore((s) => s.select);
  const projectId = useUiStore((s) => s.projectId);
  const openApp = useWindowStore((s) => s.toggleApp);

  /** Select a node and pan/zoom the viewport to center it (search "locate"). */
  const locateNode = useCallback(
    (n: NodeModel) => {
      select({ nodeId: n.id });
      rfRef.current?.setCenter(n.x, n.y, { zoom: 1.2, duration: 400 });
    },
    [select],
  );

  // Project store Maps -> React Flow nodes/edges (memoized by identity).
  const rfNodes: Node<DeviceNodeData>[] = useMemo(
    () =>
      Array.from(nodesMap.values()).map((n) => ({
        id: n.id,
        type: 'device',
        position: { x: n.x, y: n.y },
        selected: n.id === selectedNodeId,
        data: {
          name: n.name,
          kind: n.kind,
          nos: n.nos,
          mode: n.mode,
          status: n.status,
          ip: mgmtIp(n),
        },
      })),
    [nodesMap, selectedNodeId],
  );

  // Follow-the-packet animation (NG-CAP-04 MVP): latest fresh pulse per link.
  const pulses = useLabStore((s) => s.pulses);
  const pulseByLink = useMemo(() => {
    const map = new Map<string, (typeof pulses)[number]>();
    for (const p of pulses) map.set(p.linkId, p); // later pulses win
    return map;
  }, [pulses]);

  const rfEdges: Edge[] = useMemo(
    () =>
      Array.from(linksMap.values()).map((l) => {
        const color = linkStatusColors[l.status ?? 'unknown'];
        const source = ifaceNodeId(nodesMap, l.a_iface);
        const target = ifaceNodeId(nodesMap, l.b_iface);
        const pulse = pulseByLink.get(l.id);
        return {
          id: l.id,
          source,
          target,
          type: 'pulse',
          animated: l.type === 'wireless',
          style: {
            stroke: color,
            strokeWidth: EDGE_WIDTH[l.type] ?? 2,
            strokeDasharray: EDGE_DASH[l.type],
          },
          data: {
            type: l.type,
            bandwidth: l.bandwidth,
            pulse,
            pulseReverse: pulse ? pulse.fromNode === target : false,
          },
        } as Edge;
      }),
    [linksMap, nodesMap, pulseByLink],
  );

  /* --- Node drag: local move now, persist on drag-stop --------------------- */
  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      for (const c of changes) {
        if (c.type === 'position' && c.position) {
          moveNode(c.id, c.position.x, c.position.y);
        }
      }
    },
    [moveNode],
  );

  const onNodeDragStop: OnNodeDrag<Node<DeviceNodeData>> = useCallback((_e, node) => {
    void nodesApi.move(node.id, node.position.x, node.position.y).catch(() => {});
  }, []);

  const onSelectionNode: NodeMouseHandler<Node<DeviceNodeData>> = useCallback(
    (_e, node) => select({ nodeId: node.id }),
    [select],
  );

  /* --- Link creation ------------------------------------------------------- */
  const onConnect = useCallback(
    (conn: Connection) => {
      if (!conn.source || !conn.target || !projectId) return;
      const aIface = firstFreeIface(nodesMap.get(conn.source));
      const bIface = firstFreeIface(nodesMap.get(conn.target));
      if (!aIface || !bIface) return;

      // Optimistic local edge; backend assigns the real link id.
      const tempId = `tmp-${conn.source}-${conn.target}-${Date.now()}`;
      upsertLink({
        id: tempId,
        project_id: projectId,
        a_iface: aIface,
        b_iface: bIface,
        type: 'copper',
        bandwidth: 1000,
        delay: 1,
        loss: 0,
        mtu: 1500,
        status: 'up',
      });
      void linksApi
        .create({ project_id: projectId, a_iface: aIface, b_iface: bIface, type: 'copper' })
        .then((real) => upsertLink(real))
        .catch(() => {});
    },
    [nodesMap, upsertLink, projectId],
  );

  /* --- Drag-drop device creation from the palette -------------------------- */
  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      if (!projectId) return;
      const key = e.dataTransfer.getData('application/netgeo-device');
      const tpl = deviceByKey[key];
      if (!tpl || !rfRef.current) return;
      const pos = rfRef.current.screenToFlowPosition({ x: e.clientX, y: e.clientY });

      const tempId = `tmp-node-${Date.now()}`;
      // Suggest a sensible per-device-type default (EdgeRouter1, EdgeRouter2, …)
      // by scanning existing node names — never a global count. The backend is
      // the authority and may rewrite this to break ties; we adopt its result.
      const base = tpl.label.replace(/\s/g, '');
      const draft: NodeModel = {
        id: tempId,
        project_id: projectId,
        name: nextNodeName(nodesMap.values(), base),
        kind: tpl.kind,
        nos: tpl.defaultNos,
        mode: 'sim',
        x: pos.x,
        y: pos.y,
        interfaces: [],
        config_ref: null,
        status: 'stopped',
      };
      upsertNode(draft);
      select({ nodeId: tempId });
      void nodesApi
        .create({ project_id: projectId, name: draft.name, kind: draft.kind, nos: draft.nos, mode: 'sim', x: pos.x, y: pos.y })
        .then((real) => {
          // Replace the optimistic node with the server's authoritative copy.
          // Without removing the temp first, the differing ids would leave two
          // nodes sharing the same name on the canvas.
          removeNode(tempId);
          upsertNode(real);
          select({ nodeId: real.id });
        })
        .catch(() => {});
    },
    [nodesMap, upsertNode, removeNode, select, projectId],
  );

  return (
    <div className="h-full w-full" onDragOver={onDragOver} onDrop={onDrop}>
      <ReactFlow
        onInit={(inst) => (rfRef.current = inst)}
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onNodeDragStop={onNodeDragStop}
        onNodeClick={onSelectionNode}
        onConnect={onConnect}
        onPaneClick={() => select({ nodeId: null, linkId: null })}
        onEdgeClick={(_e, edge) => select({ linkId: edge.id })}
        connectionMode={ConnectionMode.Loose}
        fitView
        snapToGrid
        snapGrid={[16, 16]}
        minZoom={0.2}
        maxZoom={2.5}
        onlyRenderVisibleElements
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{ type: 'smoothstep' }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--ng-border)" />
        <Controls className="!border-fg/10 !bg-fg/5 backdrop-blur" />

        <Panel position="top-left" className="!m-3">
          <CanvasToolbar
            nodes={rfNodes.length}
            allNodes={nodesMap}
            onLocate={locateNode}
            onAddDevice={() => openApp('palette', 'Device Palette')}
          />
        </Panel>

        {/* MiniMap only once there's something to map — no empty gray box. */}
        {rfNodes.length > 0 && (
          <MiniMap
            pannable
            zoomable
            nodeStrokeWidth={0}
            nodeBorderRadius={3}
            offsetScale={4}
            nodeColor={(n) => nodeColors[(n.data as DeviceNodeData).kind] ?? '#888'}
            style={{ width: 168, height: 112 }}
            className="!m-3 !rounded-lg !border !border-fg/10 !bg-surface/70 !shadow-glass backdrop-blur"
          />
        )}
      </ReactFlow>
    </div>
  );
}

/* --------------------------- Canvas toolbar ------------------------------- */
/**
 * Slim floating toolbar (UISP-style): a device "locate" search that centers the
 * viewport on a matched node, plus an add-device shortcut that opens the palette.
 * ponytail: pan/zoom/fit live in React Flow's <Controls>; we don't duplicate
 * them here, and modal select/link/measure "modes" are direct-manipulation
 * already (drag a handle to link, drag from palette to add) — no dead buttons.
 */
function CanvasToolbar({
  nodes,
  allNodes,
  onLocate,
  onAddDevice,
}: {
  nodes: number;
  allNodes: Map<string, NodeModel>;
  onLocate: (n: NodeModel) => void;
  onAddDevice: () => void;
}) {
  const [q, setQ] = useState('');
  const query = q.trim().toLowerCase();

  const matches = useMemo(() => {
    if (!query) return [];
    const out: NodeModel[] = [];
    for (const n of allNodes.values()) {
      if (n.name.toLowerCase().includes(query) || mgmtIp(n)?.toLowerCase().includes(query)) {
        out.push(n);
        if (out.length >= 6) break;
      }
    }
    return out;
  }, [allNodes, query]);

  const pick = (n: NodeModel) => {
    onLocate(n);
    setQ('');
  };

  return (
    <div className="w-64">
      <div className="glass flex items-center gap-2 rounded-lg border border-fg/10 px-2.5 py-1.5 shadow-glass">
        <Search className="h-3.5 w-3.5 shrink-0 text-fg/40" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && matches[0]) pick(matches[0]);
            if (e.key === 'Escape') setQ('');
          }}
          placeholder={nodes ? 'Find device or IP…' : 'No devices yet'}
          aria-label="Find device on canvas"
          className="w-full bg-transparent text-xs text-fg/90 placeholder:text-fg/35 outline-none"
        />
        {q ? (
          <button
            onClick={() => setQ('')}
            aria-label="Clear search"
            className="grid h-5 w-5 shrink-0 place-items-center rounded text-fg/40 hover:bg-fg/10 hover:text-fg/70"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : (
          <button
            onClick={onAddDevice}
            aria-label="Add device"
            title="Add device"
            className="grid h-5 w-5 shrink-0 place-items-center rounded text-fg/50 hover:bg-fg/10 hover:text-fg/90"
          >
            <Plus className="h-4 w-4" />
          </button>
        )}
      </div>

      {query && (
        <ul className="glass mt-1.5 max-h-56 overflow-auto rounded-lg border border-fg/10 py-1 shadow-glass ng-scroll">
          {matches.length === 0 ? (
            <li className="px-3 py-2 text-xs text-fg/40">No match for “{q}”</li>
          ) : (
            matches.map((n) => (
              <li key={n.id}>
                <button
                  onClick={() => pick(n)}
                  className={cn(
                    'flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left',
                    'hover:bg-fg/8',
                  )}
                >
                  <span className="truncate text-xs font-medium text-fg/90">{n.name}</span>
                  <span className="shrink-0 font-mono text-[10px] text-fg/45">
                    {mgmtIp(n) ?? n.kind}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

/* ----------------------------- helpers ----------------------------------- */
/**
 * Suggest the next auto-name for a device type by finding the highest existing
 * "<base><n>" suffix among current nodes and incrementing it. Purely a sensible
 * default — the backend enforces final uniqueness and returns the real name.
 */
function nextNodeName(nodes: Iterable<NodeModel>, base: string): string {
  const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^${escaped}(\\d+)$`);
  let highest = 0;
  for (const n of nodes) {
    const m = re.exec(n.name);
    if (m) highest = Math.max(highest, Number(m[1]));
  }
  return `${base}${highest + 1}`;
}

/** First configured interface address — the device's management IP for the card. */
function mgmtIp(node: NodeModel): string | undefined {
  return node.interfaces.find((i) => i.ip.length > 0)?.ip[0];
}

function ifaceNodeId(nodes: Map<string, NodeModel>, ifaceId: string): string {
  for (const n of nodes.values()) {
    if (n.interfaces.some((i) => i.id === ifaceId)) return n.id;
  }
  // Fallback for optimistic temp links keyed by node id directly.
  return ifaceId;
}

function firstFreeIface(node?: NodeModel): string | null {
  if (!node) return null;
  const free = node.interfaces.find((i) => i.peer_link_id == null);
  // If no modeled interfaces yet (fresh node), use node id as a stand-in so the
  // optimistic edge renders; backend resolves the real interface on create.
  return free?.id ?? node.id;
}
