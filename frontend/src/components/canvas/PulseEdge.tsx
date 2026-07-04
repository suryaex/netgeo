/**
 * PulseEdge — a smoothstep edge that can "carry" a packet (NG-CAP-04 MVP).
 *
 * When the lab store holds a fresh PACKET_TX pulse for this link, a dot runs
 * along the edge path via SMIL animateMotion — direction follows the sending
 * node, so students literally watch the frame travel. Pure SVG: no rAF loop,
 * no per-frame React renders.
 */
import { BaseEdge, getSmoothStepPath, type EdgeProps } from '@xyflow/react';
import type { PacketPulse } from '@/store/labStore';

export interface PulseEdgeData extends Record<string, unknown> {
  pulse?: PacketPulse;
  /** true when the pulse travels target -> source. */
  pulseReverse?: boolean;
}

export function PulseEdge(props: EdgeProps) {
  const [path] = getSmoothStepPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    sourcePosition: props.sourcePosition,
    targetX: props.targetX,
    targetY: props.targetY,
    targetPosition: props.targetPosition,
  });
  const data = (props.data ?? {}) as PulseEdgeData;
  const pulse = data.pulse;

  return (
    <>
      <BaseEdge id={props.id} path={path} style={props.style} />
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
