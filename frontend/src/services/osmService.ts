/**
 * OSM Service — Overpass API integration for OpenStreetMap data.
 *
 * Fetches real-world telecom infrastructure (towers, BTS, masts) from
 * the OpenStreetMap database via the public Overpass API.
 *
 * No API key required. Rate-limited by Overpass policy (max ~10 req/min).
 * Results are cached per bounding box to avoid duplicate fetches during
 * map pan/zoom.
 *
 * OSM tag references:
 *   https://wiki.openstreetmap.org/wiki/Tag:tower:type%3Dcommunication
 *   https://wiki.openstreetmap.org/wiki/Tag:man_made%3Dmast
 *   https://wiki.openstreetmap.org/wiki/Tag:man_made%3Dtower
 */

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const CACHE = new Map<string, OsmTower[]>();

export interface OsmTower {
  id: number;
  lat: number;
  lng: number;
  /** OSM tags — may be partial depending on contributor detail */
  tags: {
    name?: string;
    'tower:type'?: string;
    'man_made'?: string;
    operator?: string;
    height?: string;
    'communication:mobile_phone'?: string;
    'communication:radio'?: string;
    'communication:microwave'?: string;
    ref?: string;
    note?: string;
  };
}

/** Round bounding box to 2 decimal places (~1 km grid) for cache bucketing. */
function bboxKey(south: number, west: number, north: number, east: number): string {
  const r = (n: number) => Math.round(n * 100) / 100;
  return `${r(south)},${r(west)},${r(north)},${r(east)}`;
}

/**
 * Build an Overpass QL query that fetches telecom towers and communication
 * masts within a bounding box. Combines multiple tag strategies so results
 * include both formally tagged BTS nodes and generic communication towers.
 */
function buildQuery(south: number, west: number, north: number, east: number): string {
  const bbox = `${south},${west},${north},${east}`;
  return `
[out:json][timeout:25];
(
  node["tower:type"="communication"](${bbox});
  node["man_made"="mast"]["communication"](${bbox});
  node["man_made"="tower"]["tower:type"="communication"](${bbox});
  node["man_made"="mast"]["tower:type"="communication"](${bbox});
  node["communication:mobile_phone"="yes"](${bbox});
  node["man_made"="mast"]["operator"](${bbox});
);
out body;
`.trim();
}

interface OverpassElement {
  type: string;
  id: number;
  lat: number;
  lon: number;
  tags?: Record<string, string>;
}

interface OverpassResponse {
  elements: OverpassElement[];
}

/**
 * Fetch telecom towers from OpenStreetMap within the given bounding box.
 *
 * @param south  - southern latitude bound
 * @param west   - western longitude bound
 * @param north  - northern latitude bound
 * @param east   - eastern longitude bound
 * @returns      - array of OsmTower objects (empty on error)
 */
export async function fetchOsmTowers(
  south: number,
  west: number,
  north: number,
  east: number,
): Promise<OsmTower[]> {
  const key = bboxKey(south, west, north, east);
  const cached = CACHE.get(key);
  if (cached !== undefined) return cached;

  try {
    const controller = new AbortController();
    // Abort after 10 s so a slow/unreachable Overpass never hangs the caller's
    // loading state. On abort the fetch rejects, is caught below, and we return
    // [] — the map degrades gracefully (towers shown only when the API succeeds).
    const timeout = setTimeout(() => controller.abort(), 26_000);

    const resp = await fetch(OVERPASS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(buildQuery(south, west, north, east))}`,
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!resp.ok) throw new Error(`Overpass HTTP ${resp.status}`);

    const data = (await resp.json()) as OverpassResponse;

    const towers: OsmTower[] = data.elements
      .filter((el) => el.type === 'node' && el.lat !== undefined && el.lon !== undefined)
      .map((el) => ({
        id: el.id,
        lat: el.lat,
        lng: el.lon,
        tags: (el.tags ?? {}) as OsmTower['tags'],
      }));

    CACHE.set(key, towers);
    return towers;
  } catch {
    // Network error, Overpass timeout, or rate-limit — return empty so the
    // map degrades gracefully without a blocking error.
    return [];
  }
}

/**
 * Derive a human-readable label for a tower from its OSM tags.
 * Falls back to generic "BTS" when tags are sparse.
 */
export function towerLabel(tower: OsmTower): string {
  const { tags } = tower;
  if (tags.name) return tags.name;
  if (tags.ref) return `BTS-${tags.ref}`;
  if (tags.operator) return `${tags.operator} Tower`;
  if (tags['tower:type'] === 'communication') return 'Comm. Tower';
  if (tags['man_made'] === 'mast') return 'Telecom Mast';
  return 'BTS';
}

/**
 * Classify a tower into a display category based on OSM tags.
 */
export type OsmTowerKind = 'bts' | 'mast' | 'microwave' | 'broadcast';

export function towerKind(tower: OsmTower): OsmTowerKind {
  const { tags } = tower;
  if (tags['communication:microwave'] === 'yes') return 'microwave';
  if (tags['communication:mobile_phone'] === 'yes') return 'bts';
  if (tags['communication:radio'] === 'yes') return 'broadcast';
  if (tags['man_made'] === 'mast') return 'mast';
  return 'bts';
}

/** Invalidate the OSM cache (useful for forced refresh). */
export function clearOsmCache(): void {
  CACHE.clear();
  BUILDING_CACHE.clear();
}

/* -------------------------------------------------------------------------- */
/* Building footprints (Phase B2 — population & building density)             */
/* -------------------------------------------------------------------------- */

const BUILDING_CACHE = new Map<string, OsmBuilding[]>();
/** Hard cap so a dense city viewport can't stall Leaflet with 20k polygons. */
const BUILDING_CAP = 4000;

export interface OsmBuilding {
  id: number;
  /** Outer ring as [lat, lng] pairs (Leaflet order). */
  ring: [number, number][];
  /** Footprint centroid (average of ring vertices) for density binning. */
  center: [number, number];
}

/**
 * Fetch OSM building footprints within a bounding box via Overpass `out geom`.
 * Ways only — multipolygon building relations are skipped.
 * ponytail: relations skipped; add member-way stitching if inner courtyards matter.
 */
export async function fetchOsmBuildings(
  south: number,
  west: number,
  north: number,
  east: number,
): Promise<OsmBuilding[]> {
  const key = bboxKey(south, west, north, east);
  const cached = BUILDING_CACHE.get(key);
  if (cached !== undefined) return cached;

  const bbox = `${south},${west},${north},${east}`;
  const query = `[out:json][timeout:25];(way["building"](${bbox}););out geom ${BUILDING_CAP};`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 26_000);
    const resp = await fetch(OVERPASS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(query)}`,
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!resp.ok) throw new Error(`Overpass HTTP ${resp.status}`);

    const data = (await resp.json()) as {
      elements: { type: string; id: number; geometry?: { lat: number; lon: number }[] }[];
    };

    const buildings: OsmBuilding[] = [];
    for (const el of data.elements) {
      const geom = el.geometry;
      if (el.type !== 'way' || !geom || geom.length < 3) continue;
      const ring = geom.map((p) => [p.lat, p.lon] as [number, number]);
      const center: [number, number] = [
        ring.reduce((s, p) => s + p[0], 0) / ring.length,
        ring.reduce((s, p) => s + p[1], 0) / ring.length,
      ];
      buildings.push({ id: el.id, ring, center });
    }

    BUILDING_CACHE.set(key, buildings);
    return buildings;
  } catch {
    return [];
  }
}

/** Population-density ramp: green (sparse) → red (dense), matched to bins below. */
export const DENSITY_RAMP = ['#34C759', '#A3E635', '#FFCC00', '#FF9500', '#FF453A'];

/**
 * Density proxy: bin footprint centroids into ~110 m cells (3-dp rounding) and
 * return one ramp colour per building based on how many buildings share its cell.
 * Pure — no OSM/network — so it is unit-testable.
 * ponytail: OSM-building count is a density *proxy*; swap for a WorldPop/Kontur
 * raster behind the provider layer when true census population is needed.
 */
export function densityColors(centers: [number, number][]): string[] {
  const counts = new Map<string, number>();
  const cellOf = (c: [number, number]) =>
    `${Math.round(c[0] * 1000)},${Math.round(c[1] * 1000)}`;
  for (const c of centers) counts.set(cellOf(c), (counts.get(cellOf(c)) ?? 0) + 1);
  const bin = (n: number) =>
    n <= 2 ? 0 : n <= 5 ? 1 : n <= 10 ? 2 : n <= 20 ? 3 : 4;
  return centers.map((c) => DENSITY_RAMP[bin(counts.get(cellOf(c)) ?? 1)]!);
}
