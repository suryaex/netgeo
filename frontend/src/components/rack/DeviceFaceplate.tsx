/**
 * DeviceFaceplate — generative 19" rack faceplate for a placed device.
 *
 * No copyrighted product photos: the faceplate is an SVG synthesised from the
 * node's real data — port count/type from `node.interfaces` (kind-based
 * fallback), brand accent + label from `node.nos` (routeros→MikroTik, ios→Cisco,
 * …). Front shows the port field + status LEDs + rack ears; back shows PSUs,
 * a fan grille and rear ports. It fills its container (stretched to the RU
 * block), so a 1U reads short-and-wide like the real thing.
 *
 * ponytail: schematic, not a pixel-exact vendor render — one parametric face
 * covers every kind. Swap for per-model art only if a device library ships it.
 */
import type { NodeModel, NodeKind, Nos } from '@/api/types';

export type Face = 'front' | 'back';

interface Brand {
  name: string;
  accent: string;
}

/** NOS → brand badge + accent stripe (best-effort, purely cosmetic). */
const BRAND: Record<Nos, Brand> = {
  forgeos: { name: 'NetGeo', accent: '#D97757' },
  ios: { name: 'Cisco', accent: '#1BA0D7' },
  iosxr: { name: 'Cisco', accent: '#1BA0D7' },
  nxos: { name: 'Cisco', accent: '#1BA0D7' },
  junos: { name: 'Juniper', accent: '#84B135' },
  eos: { name: 'Arista', accent: '#2A6EBB' },
  routeros: { name: 'MikroTik', accent: '#E4002B' },
  vyos: { name: 'VyOS', accent: '#8A93A6' },
  sros: { name: 'Nokia', accent: '#124191' },
  frr: { name: 'FRR', accent: '#F5A623' },
  vrp: { name: 'Huawei', accent: '#E40521' },
};

interface Ports {
  rj45: number;
  sfp: number;
  pon: number;
}

/** Default port field per kind when a node has no interfaces yet. */
const KIND_PORTS: Record<NodeKind, Ports> = {
  switch: { rj45: 24, sfp: 4, pon: 0 },
  router: { rj45: 8, sfp: 4, pon: 0 },
  olt: { rj45: 0, sfp: 2, pon: 8 },
  firewall: { rj45: 8, sfp: 0, pon: 0 },
  server: { rj45: 2, sfp: 0, pon: 0 },
  host: { rj45: 2, sfp: 0, pon: 0 },
  ap: { rj45: 1, sfp: 0, pon: 0 },
  cpe: { rj45: 1, sfp: 0, pon: 0 },
  cloud: { rj45: 0, sfp: 0, pon: 0 },
};

function portProfile(node: NodeModel): Ports {
  const ifs = node.interfaces ?? [];
  if (ifs.length) {
    const p: Ports = { rj45: 0, sfp: 0, pon: 0 };
    for (const i of ifs) {
      if (i.type === 'eth') p.rj45++;
      else if (i.type === 'gpon') p.pon++;
      else if (i.type === 'wifi') continue;
      else p.sfp++; // sfp / sfp28 / qsfp
    }
    if (p.rj45 + p.sfp + p.pon > 0) return p;
  }
  return KIND_PORTS[node.kind] ?? { rj45: 4, sfp: 0, pon: 0 };
}

/** Lay `count` ports into `rows` even rows across [x0,x1], centred vertically. */
function portRects(
  count: number,
  x0: number,
  x1: number,
  yTop: number,
  yBot: number,
  rows: number,
  gap = 1.5,
) {
  if (count <= 0) return [];
  const perRow = Math.ceil(count / rows);
  const usedRows = Math.min(rows, Math.ceil(count / perRow));
  const cellW = (x1 - x0) / perRow;
  const cellH = (yBot - yTop) / usedRows;
  const w = Math.max(2, cellW - gap);
  const h = Math.max(2, cellH - gap);
  const out: { x: number; y: number; w: number; h: number }[] = [];
  for (let i = 0; i < count; i++) {
    const r = Math.floor(i / perRow);
    const c = i % perRow;
    out.push({ x: x0 + c * cellW, y: yTop + r * cellH, w, h });
  }
  return out;
}

interface Props {
  node: NodeModel;
  span: number;
  face: Face;
}

export function DeviceFaceplate({ node, span, face }: Props) {
  const brand = BRAND[node.nos] ?? { name: node.kind.toUpperCase(), accent: '#8A93A6' };
  const p = portProfile(node);
  const W = 240;
  const H = Math.max(26, span * 30);
  const rows = span >= 2 || p.rj45 + p.sfp + p.pon > 14 ? 2 : 1;

  const yTop = H * 0.42;
  const yBot = H * 0.86;
  const isServer = node.kind === 'server' || node.kind === 'host';

  // Front port field spans the right ~78%; back has PSU/fan blocks instead.
  const px0 = 46;
  const px1 = W - 14;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="h-full w-full"
      role="img"
      aria-label={`${brand.name} ${node.kind} ${face}`}
    >
      <defs>
        <linearGradient id={`chs-${node.id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3a3a38" />
          <stop offset="0.5" stopColor="#2b2b29" />
          <stop offset="1" stopColor="#232321" />
        </linearGradient>
      </defs>

      {/* chassis */}
      <rect x="0" y="0" width={W} height={H} rx="3" fill={`url(#chs-${node.id})`} stroke="#161615" />
      {/* rack ears with screw holes */}
      {[6, W - 6].map((cx) => (
        <g key={cx}>
          <rect x={cx - 6} y="1" width="12" height={H - 2} rx="1.5" fill="#1c1c1a" />
          <circle cx={cx} cy={H * 0.28} r="1.6" fill="#4a4a46" />
          <circle cx={cx} cy={H * 0.72} r="1.6" fill="#4a4a46" />
        </g>
      ))}
      {/* brand accent stripe + label */}
      <rect x="14" y={H * 0.16} width="3" height={H * 0.68} fill={brand.accent} rx="1.5" />
      <text x="22" y={H * 0.36} fontSize={Math.min(9, H * 0.32)} fontFamily="monospace" fill="#e8e6e0">
        {brand.name}
      </text>
      <text x="22" y={H * 0.7} fontSize={Math.min(8, H * 0.28)} fontFamily="monospace" fill="#9a968e">
        {node.name}
      </text>

      {face === 'front' ? (
        isServer ? (
          // drive-bay grid
          portRects(8, px0, px1, yTop - H * 0.14, yBot + H * 0.06, span >= 2 ? 2 : 1, 2).map((r, i) => (
            <g key={i}>
              <rect x={r.x} y={r.y} width={r.w} height={r.h} rx="1" fill="#111" stroke="#3d3d3a" />
              <rect x={r.x + r.w * 0.12} y={r.y + r.h * 0.35} width={r.w * 0.5} height={r.h * 0.3} fill="#2a2a28" />
              <circle cx={r.x + r.w * 0.82} cy={r.y + r.h * 0.5} r="0.9" fill={i % 4 === 0 ? '#27C28B' : '#3d3d3a'} />
            </g>
          ))
        ) : (
          <>
            {/* RJ45 field */}
            {portRects(p.rj45, px0, p.sfp || p.pon ? px1 - 46 : px1, yTop, yBot, rows).map((r, i) => (
              <g key={`e${i}`}>
                <rect x={r.x} y={r.y} width={r.w} height={r.h} rx="0.8" fill="#141414" stroke="#454542" />
                <rect x={r.x + r.w * 0.28} y={r.y + r.h * 0.62} width={r.w * 0.44} height={r.h * 0.3} fill="#2c2c2a" />
                <circle cx={r.x + r.w * 0.16} cy={r.y + r.h * 0.22} r="0.7" fill={i % 3 === 0 ? '#27C28B' : '#1f6b4a'} />
              </g>
            ))}
            {/* SFP cages (right) */}
            {portRects(p.sfp, px1 - 42, px1, yTop, yBot, rows).map((r, i) => (
              <rect key={`s${i}`} x={r.x} y={r.y} width={r.w} height={r.h} rx="0.6" fill="#0c0c0c" stroke={brand.accent} strokeWidth="0.5" />
            ))}
            {/* PON ports (round SC/APC) */}
            {portRects(p.pon, px0, px1, yTop, yBot, rows).map((r, i) => (
              <circle key={`p${i}`} cx={r.x + r.w / 2} cy={r.y + r.h / 2} r={Math.min(r.w, r.h) * 0.42} fill="#0d1b16" stroke="#2e6" strokeWidth="0.5" />
            ))}
          </>
        )
      ) : (
        // BACK: dual PSU + fan grille + a couple rear ports
        <>
          {[0, 1].map((i) => (
            <rect key={i} x={px0 + i * 58} y={yTop - H * 0.08} width="50" height={yBot - yTop + H * 0.14} rx="2" fill="#1a1a18" stroke="#454542" />
          ))}
          {/* fan grille */}
          {Array.from({ length: 3 }, (_, i) => (
            <circle key={i} cx={W - 60 + i * 18} cy={(yTop + yBot) / 2} r={Math.min(7, H * 0.22)} fill="none" stroke="#3d3d3a" strokeWidth="1" />
          ))}
          {/* ground lug */}
          <rect x={W - 22} y={yBot - 4} width="7" height="5" fill="#b5952f" />
        </>
      )}
    </svg>
  );
}
