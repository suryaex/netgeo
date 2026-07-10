/**
 * Geocoding service — place/address search → lat/lng.
 *
 * Default provider: Nominatim (OpenStreetMap), no API key. To plug in a paid
 * geocoder (Google, Mapbox, …) swap the `provider` const below — the public
 * `geocode()` seam stays the same. Mirrors the pluggable-provider pattern used
 * for elevation (server-side) and tiles (config/mapTiles.ts).
 *
 * Nominatim usage policy (https://operations.osmfoundation.org/policies/nominatim/):
 *  - max 1 request/second         → enforced by MIN_INTERVAL_MS throttle below
 *  - no autocomplete-per-keystroke → callers search on Enter, not on input
 *  - identify the application      → the browser sends Referer automatically;
 *    fetch() cannot set User-Agent from a page, and Referer satisfies the policy.
 */

export interface GeoResult {
  label: string;
  lat: number;
  lng: number;
}

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const MIN_INTERVAL_MS = 1100; // ≥1 req/s per Nominatim policy, with margin
let lastCall = 0;

async function nominatim(q: string, signal?: AbortSignal): Promise<GeoResult[]> {
  const url = `${NOMINATIM_URL}?format=jsonv2&limit=5&addressdetails=0&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Geocoding failed (HTTP ${res.status})`);
  const rows = (await res.json()) as { display_name: string; lat: string; lon: string }[];
  return rows.slice(0, 5).map((r) => ({
    label: r.display_name,
    lat: Number.parseFloat(r.lat),
    lng: Number.parseFloat(r.lon),
  }));
}

/** Default provider. Swap this line to plug in a paid geocoder. */
const provider = nominatim;

/**
 * Look up up to 5 candidate locations for a free-text query. Throttled to the
 * provider's rate limit; returns [] for a blank query.
 */
export async function geocode(q: string, signal?: AbortSignal): Promise<GeoResult[]> {
  const query = q.trim();
  if (!query) return [];
  const wait = MIN_INTERVAL_MS - (Date.now() - lastCall);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
  return provider(query, signal);
}
