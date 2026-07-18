/**
 * FiberCanvas — the logical GPON path diagram (NOT the Leaflet map). Renders the
 * selected FiberPath as a left→right chain: OLT head, one node per element, ODP
 * tail. Feeder segments (pre-splitter) are solid, distribution (post-splitter)
 * dashed, drop (final hop) dotted — a visual grouping of the real element chain,
 * toggled by the top-left chips. PASS/FAIL comes straight from the path budget.
 */
import { cn } from '@/lib/cn';
import { useFiberStore, type SegKey } from '@/store/fiberStore';
import { KIND_LABEL, elementSummary } from './fiberLogic';
import type { FiberKind } from '@/api/client';

const PAD = 80;
const GAP = 132;
const CY = 150;

type NodeKind = 'olt' | 'odp' | FiberKind;
interface ChainNode {
  key: string;
  kind: NodeKind;
  label: string;
  sub: string;
  seg: SegKey; // group of the segment that LEADS INTO this node
}

/** Classify the segment feeding node index `i` (1-based into the chain). */
function segFor(i: number, firstSplitter: number, last: number): SegKey {
  if (i === last) return 'drop';
  if (firstSplitter >= 0 && i > firstSplitter) return 'distribution';
  return 'feeder';
}

export function FiberCanvas() {
  const path = useFiberStore((s) => s.paths.find((p) => p.id === s.selectedId));
  const budget = useFiberStore((s) => (s.selectedId ? s.budgets[s.selectedId] : undefined));
  const seg = useFiberStore((s) => s.seg);

  // No selected path → render nothing. The single canonical empty-state lives in
  // FiberWorkspace (WorkspaceEmptyState); `load` always auto-selects a path when
  // any exist, so this only fires with zero paths — where showing a second
  // centered message here just overlapped the parent's (carry-over a).
  if (!path) return null;

  const passed = budget?.passed ?? true;
  const firstSplitter = path.elements.findIndex((e) => e.kind === 'splitter'); // -1 if none
  // OLT (node 0) + elements + ODP tail.
  const nodes: ChainNode[] = [
    { key: 'olt', kind: 'olt', label: 'OLT', sub: path.name, seg: 'feeder' },
    ...path.elements.map((el, i) => ({
      key: `e${i}`,
      kind: el.kind,
      label: KIND_LABEL[el.kind],
      sub: elementSummary(el),
      // splitter index in element space maps to node index i+1
      seg: segFor(i + 1, firstSplitter >= 0 ? firstSplitter + 1 : -1, path.elements.length + 1),
    })),
    {
      key: 'odp',
      kind: 'odp',
      label: 'ODP / ONU',
      sub: passed ? 'PASS' : 'FAIL',
      seg: 'drop',
    },
  ];

  const width = PAD * 2 + (nodes.length - 1) * GAP;
  const strokeStatus = passed ? 'stroke-accent' : 'stroke-danger';

  return (
    <div className="absolute inset-0 overflow-auto">
      <div className="flex min-h-full min-w-full items-center px-4 pb-32 pr-[400px] pt-20">
        <svg width={Math.max(width, 320)} height={300} role="img" aria-label={`Fiber path ${path.name}`}>
          {/* Segments (drawn first, under the nodes) */}
          {nodes.slice(1).map((n, idx) => {
            const x1 = PAD + idx * GAP;
            const x2 = PAD + (idx + 1) * GAP;
            const dash = n.seg === 'distribution' ? '7 7' : n.seg === 'drop' ? '2 6' : undefined;
            const dim = !seg[n.seg];
            return (
              <line
                key={`seg-${n.key}`}
                x1={x1}
                y1={CY}
                x2={x2}
                y2={CY}
                strokeDasharray={dash}
                className={cn('stroke-[2.5]', strokeStatus, dim && 'opacity-15')}
              />
            );
          })}

          {/* Nodes */}
          {nodes.map((n, idx) => (
            <NodeGlyph key={n.key} node={n} x={PAD + idx * GAP} passed={passed} dim={!seg[n.seg]} />
          ))}
        </svg>
      </div>
    </div>
  );
}

function NodeGlyph({
  node,
  x,
  passed,
  dim,
}: {
  node: ChainNode;
  x: number;
  passed: boolean;
  dim: boolean;
}) {
  const { kind } = node;
  return (
    <g className={cn(dim && 'opacity-30')}>
      {kind === 'olt' && (
        <rect x={x - 26} y={CY - 16} width={52} height={32} rx={7} className="fill-panel stroke-fg/40" strokeWidth={1.5} />
      )}
      {kind === 'splitter' && (
        <polygon
          points={`${x},${CY - 20} ${x + 20},${CY} ${x},${CY + 20} ${x - 20},${CY}`}
          className={cn('fill-recess', passed ? 'stroke-accent' : 'stroke-danger')}
          strokeWidth={1.75}
        />
      )}
      {kind === 'fiber' && (
        <rect x={x - 24} y={CY - 13} width={48} height={26} rx={13} className="fill-recess stroke-fg/30" strokeWidth={1.5} />
      )}
      {kind === 'connector' && <circle cx={x} cy={CY} r={10} className="fill-recess stroke-fg/45" strokeWidth={1.75} />}
      {kind === 'splice' && (
        <rect x={x - 9} y={CY - 9} width={18} height={18} rx={3} className="fill-recess stroke-fg/45" strokeWidth={1.75} />
      )}
      {kind === 'odp' && (
        <>
          <circle
            cx={x}
            cy={CY}
            r={17}
            className={cn(passed ? 'fill-accent/15 stroke-accent' : 'fill-danger/15 stroke-danger')}
            strokeWidth={2}
          />
          {!passed && (
            <g>
              <rect x={x + 12} y={CY - 30} width={38} height={17} rx={4} className="fill-danger" />
              <text x={x + 31} y={CY - 18} textAnchor="middle" className="fill-white text-[10px] font-bold">
                FAIL
              </text>
            </g>
          )}
        </>
      )}

      {/* Labels */}
      <text x={x} y={CY - 30} textAnchor="middle" className="fill-fg/75 text-[11px] font-medium">
        {node.label}
      </text>
      {node.sub && kind !== 'odp' && (
        <text x={x} y={CY + 38} textAnchor="middle" className="fill-fg/45 font-mono text-[10px]">
          {node.sub}
        </text>
      )}
    </g>
  );
}
