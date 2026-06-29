/**
 * API envelope contract (NetGeo/09_API_STANDARD §Response Format).
 *
 * Every NetGeo endpoint is specified to return a uniform envelope:
 *
 *   { "success": true, "data": {…}, "error": null, "meta": {…} }
 *
 * The transport layer (api/client.ts) unwraps this transparently so callers
 * keep working with the inner `data`, while pagination/`meta` is surfaced via
 * the {@link fetchPage} helper. The unwrapper is *tolerant*: if the backend
 * returns a bare payload (no envelope), it is passed through untouched. This
 * lets the frontend track the spec without a lock-step backend rollout.
 */

/** Pagination/metadata block (§Pagination — limit/offset/cursor). */
export interface PageMeta {
  total?: number;
  limit?: number;
  offset?: number;
  cursor?: string | null;
  next_cursor?: string | null;
  /** Forward-compatible: providers may attach extra meta (timing, request id). */
  [key: string]: unknown;
}

/** Structured error body inside a failed envelope (§Error Codes). */
export interface ApiErrorBody {
  code?: string | number;
  message?: string;
  detail?: unknown;
}

/** The full uniform response envelope. */
export interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  error: ApiErrorBody | null;
  meta?: PageMeta;
}

/** A page of results with its metadata, returned by {@link fetchPage}. */
export interface Page<T> {
  data: T;
  meta: PageMeta;
}

/** Query params common to list endpoints (§Pagination/Filtering/Sorting). */
export interface PageParams {
  limit?: number;
  offset?: number;
  cursor?: string | null;
  /** e.g. "name" or "-created_at" for descending. */
  sort?: string;
  /** Arbitrary filters: ?vendor=…&status=…&protocol=… */
  [filter: string]: string | number | null | undefined;
}

/**
 * Structural type-guard for the response envelope. Intentionally permissive:
 * a `success` flag plus either `data` or `error` is enough to treat the body
 * as an envelope and unwrap it.
 */
export function isEnvelope(value: unknown): value is ApiEnvelope<unknown> {
  return (
    !!value &&
    typeof value === 'object' &&
    'success' in value &&
    ('data' in value || 'error' in value)
  );
}
