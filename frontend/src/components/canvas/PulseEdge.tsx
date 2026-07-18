/**
 * PulseEdge — a smoothstep edge that can "carry" a packet (NG-CAP-04 MVP).
 *
 * When the lab store holds a fresh PACKET_TX pulse for this link, a dot runs
 * along the edge path via SMIL animateMotion — direction follows the sending
 * node, so students literally watch the frame travel. Pure SVG: no rAF loop,
 * no per-frame React renders.
 *
 * Edges are floating bezier curves (n8n-style): each end anchors on the border
 * side of its node that faces the other node, so cables leave the nearest port
 * dot instead of a fixed top/bottom handle. One edge type across the canvas.
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

  return (
    <>
      <BaseEdge id={props.id} path={path} style={props.style} />
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
