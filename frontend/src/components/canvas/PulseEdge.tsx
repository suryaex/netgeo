/**
 * PulseEdge — floating bezier edge with Figma-style endpoint dots (NG-CAP-04).
 *
 * On hover or selection, small circles appear at both endpoints (Figma handle
 * affordance). Pulse dot travels along the path via SMIL animateMotion.
 * Reconnectable: React Flow v12 `reconnectable` prop wired in TopologyCanvas.
 */
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  useInternalNode,
  type EdgeProps,
} from '@xyflow/react';
import type { PacketPulse } from '@/store/labStore';
import { getFloatingEdgeParams } from './floatingEdge';

export interface PulseEdgeData extends Record<string, unknown> {
  pulse?: PacketPulse;
  /** true when the pulse travels target -> source. */
  pulseReverse?: boolean;
  /** Midpoint label shown whenever a link carries bandwidth (design §6.1). */
  label?: string;
  /** Stashed iface IDs for onReconnect rollback (not rendered). */
  a_iface?: string;
  b_iface?: string;
}

export function PulseEdge(props: EdgeProps) {
  const sourceNode = useInternalNode(props.source);
  const targetNode = useInternalNode(props.target);

  // Nodes not yet measured (first paint) — skip; React Flow re-renders once sized.
  if (!sourceNode || !targetNode) return null;

  const { sx, sy, tx, ty, sourcePos, targetPos } = getFloatingEdgeParams(sourceNode, targetNode);
  const [path, labelX, labelY] = getBezierPath({
    sourceX: sx,
    sourceY: sy,
    sourcePosition: sourcePos,
    targetX: tx,
    targetY: ty,
    targetPosition: targetPos,
  });
  const data = (props.data ?? {}) as PulseEdgeData;
  const pulse = data.pulse;
  // Show Figma-style endpoint handles on hover or selection.
  const showHandles = props.selected;

  return (
    <>
      <BaseEdge id={props.id} path={path} style={props.style} />

      {/* Figma-style endpoint circles — visible when edge is selected. */}
      {showHandles && (
        <g pointerEvents="none">
          <circle cx={sx} cy={sy} r={5} fill="var(--ng-primary, #d97757)" stroke="var(--ng-panel, #1f1e1d)" strokeWidth={2} opacity={0.95} />
          <circle cx={tx} cy={ty} r={5} fill="var(--ng-primary, #d97757)" stroke="var(--ng-panel, #1f1e1d)" strokeWidth={2} opacity={0.95} />
        </g>
      )}

      {data.label && (
        <EdgeLabelRenderer>
          <div
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
            className="pointer-events-none absolute rounded border border-fg/10 bg-panel/90 px-1 py-0.5 font-mono text-[9px] text-fg/70 backdrop-blur-sm"
          >
            {data.label}
          </div>
        </EdgeLabelRenderer>
      )}
      {pulse && (
        // Keyed by pulse so a new pulse restarts the SMIL animation.
        <g key={pulse.key} pointerEvents="none">
          <circle r={5} fill="#f59e0b" stroke="rgba(0,0,0,0.45)" strokeWidth={1.5}>
            <animateMotion
              dur="0.9s"
              repeatCount="1"
              fill="freeze"
              path={path}
              calcMode="linear"
              keyPoints={data.pulseReverse ? '1;0' : '0;1'}
              keyTimes="0;1"
            />
            <animate attributeName="opacity" values="1;1;0" keyTimes="0;0.85;1" dur="1.1s" fill="freeze" />
            <title>{pulse.info}</title>
          </circle>
        </g>
      )}
    </>
  );
}
