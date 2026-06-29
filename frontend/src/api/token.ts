/**
 * Bearer-token holder for the authenticated session.
 *
 * Kept in its own module (not the auth store) so the REST client (client.ts)
 * and the WebSocket layer (ws.ts) can read the token and react to 401/4401
 * without importing the Zustand store — which would create an import cycle
 * (store → client → store).
 *
 * Storage: in-memory (authoritative) mirrored into sessionStorage so a tab
 * reload restores the session. sessionStorage (not localStorage) per
 * AUTH_CONTRACT §5 — cleared when the tab closes, not readable across origins.
 */
const STORAGE_KEY = 'netgeo.token';

let token: string | null = readInitial();
let onUnauthorized: (() => void) | null = null;

function readInitial(): string | null {
  try {
    return sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function getToken(): string | null {
  return token;
}

export function setToken(next: string | null): void {
  token = next;
  try {
    if (next) sessionStorage.setItem(STORAGE_KEY, next);
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* sessionStorage unavailable (private mode) — in-memory still works */
  }
}

/** Register the handler invoked when a 401/4401 indicates the session is dead. */
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  onUnauthorized = fn;
}

/** Called by the REST client (HTTP 401) and WS layer (close 4401). */
export function notifyUnauthorized(): void {
  onUnauthorized?.();
}
