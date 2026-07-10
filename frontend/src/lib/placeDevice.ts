/**
 * placeDevice — the single source of truth for adding a device to the topology.
 * Shared by the drag-drop path (TopologyCanvas.onDrop), the floating device
 * picker, the `A` shortcut, and the command palette so every entry point creates
 * a node identically: optimistic local upsert → API create → adopt the server's
 * authoritative copy (replacing the temp id so names never duplicate).
 */
import { useTopologyStore } from '@/store/topologyStore';
import { nodesApi } from '@/api/client';
import { deviceByKey } from '@/data/deviceCatalog';
import type { NodeModel } from '@/api/types';

/**
 * Suggest the next per-type auto-name ("EdgeRouter1", "EdgeRouter2", …) by
 * scanning current node names. A sensible default only — the backend enforces
 * final uniqueness and returns the real name, which we adopt.
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

/**
 * When the picker has no click position, stagger new nodes off the current
 * count so they don't stack on the origin — the user can drag from there.
 */
function staggeredPos(count: number): { x: number; y: number } {
  return { x: 120 + (count % 6) * 48, y: 120 + (count % 6) * 48 };
}

export function placeDevice(projectId: string, key: string, pos?: { x: number; y: number }): void {
  const tpl = deviceByKey[key];
  if (!tpl) return;
  const { nodes, upsertNode, removeNode, select } = useTopologyStore.getState();
  const { x, y } = pos ?? staggeredPos(nodes.size);

  const tempId = `tmp-node-${Date.now()}`;
  const base = tpl.label.replace(/\s/g, '');
  const draft: NodeModel = {
    id: tempId,
    project_id: projectId,
    name: nextNodeName(nodes.values(), base),
    kind: tpl.kind,
    nos: tpl.defaultNos,
    mode: 'sim',
    x,
    y,
    interfaces: [],
    config_ref: null,
    status: 'stopped',
  };
  upsertNode(draft);
  select({ nodeId: tempId });
  void nodesApi
    .create({ project_id: projectId, name: draft.name, kind: draft.kind, nos: draft.nos, mode: 'sim', x, y })
    .then((real) => {
      removeNode(tempId);
      upsertNode(real);
      select({ nodeId: real.id });
    })
    .catch(() => {});
}
