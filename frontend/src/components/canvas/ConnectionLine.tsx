/**
 * ConnectionLine — live bezier preview while dragging a new connection (Figma-style).
 * Dashed stroke with a glow dot at the free end tracks the cursor.
 * Registered via `connectionLineComponent` prop on ReactFlow.
 */
import { getBezierPath, type ConnectionLineComponentProps } from '@xyflow/react';

export function ConnectionLine({
  fromX,
  fromY,
  fromPosition,
  toX,
  toY,
  toPosition,
}: ConnectionLineComponentProps) {
  const [path] = getBezierPath({ sourceX: fromX, sourceY: fromY, sourcePosition: fromPosition, targetX: toX, targetY: toY, targetPosition: toPosition });

  return (
    <g>
      <path
        d={path}
        fill="none"
        stroke="var(--ng-primary, #d97757)"
        strokeWidth={2}
        strokeDasharray="6 4"
        strokeLinecap="round"
        opacity={0.85}
      />
      {/* glow dot at the free end */}
      <circle cx={toX} cy={toY} r={4} fill="var(--ng-primary, #d97757)" opacity={0.9} />
      <circle cx={toX} cy={toY} r={7} fill="var(--ng-primary, #d97757)" opacity={0.25} />
    </g>
  );
}
