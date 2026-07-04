/**
 * REST client for the NetGeo FastAPI backend (see NetGeo/09_API_STANDARD.md).
 * Thin axios wrapper: single base instance, JSON, error normalization, and
 * typed resource functions. The dev server proxies `/api` to the backend, so
 * we use a same-origin relative baseURL by default.
 */
import axios, { AxiosError, type AxiosRequestConfig } from 'axios';
import type {
  ConfigArtifact,
  HostInterface,
  InternetStatus,
  LinkModel,
  NodeModel,
  Project,
  Scenario,
  SimulateRequest,
  Topology,
} from './types';
import {
  isEnvelope,
  type ApiErrorBody,
  type Page,
  type PageMeta,
  type PageParams,
} from './envelope';
import { getToken, notifyUnauthorized } from './token';

export const API_BASE = import.meta.env.VITE_API_BASE ?? '/api';

export const http = axios.create({
  baseURL: API_BASE,
  headers: { 'Content-Type': 'application/json' },
  timeout: 20_000,
});

/** Normalized error shape surfaced to UI (error states must be first-class). */
export interface ApiError {
  status: number;
  message: string;
  /** Machine-readable code from the envelope `error.code`, when present. */
  code?: string | number;
  detail?: unknown;
}

/**
 * Module-augment AxiosResponse so the unwrapping interceptor can stash the
 * envelope `meta` block (pagination) without a separate request. Read it via
 * {@link fetchPage} rather than reaching for `res.meta` directly.
 */
declare module 'axios' {
  // Type parameters must mirror axios's own `AxiosResponse<T = any, D = any>`
  // declaration verbatim, otherwise TS2428 ("identical type parameters").
  // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any
  interface AxiosResponse<T = any, D = any> {
    /** Envelope meta (NetGeo/09 §Response Format). Undefined for bare bodies. */
    meta?: PageMeta;
  }
}

/**
 * Request interceptor: attach the bearer token (AUTH_CONTRACT §3) to every
 * outgoing request. `/auth/login` runs before a token exists, so the header is
 * simply omitted then.
 */
http.interceptors.request.use((config) => {
  const t = getToken();
  if (t) {
    config.headers = config.headers ?? {};
    (config.headers as Record<string, string>).Authorization = `Bearer ${t}`;
  }
  return config;
});

/**
 * Success interceptor: transparently unwrap the NetGeo envelope.
 *  - `{ success:false, error }` → reject with a normalized {@link ApiError}
 *    even on HTTP 200 (defensive: some gateways wrap errors with a 200).
 *  - `{ success:true, data, meta }` → replace `res.data` with `data`, stash
 *    `meta` on the response so existing `.then(r => r.data)` callers are
 *    untouched.
 *  - bare payloads → passed through verbatim (tolerant migration).
 */
http.interceptors.response.use(
  (res) => {
    if (isEnvelope(res.data)) {
      const env = res.data;
      if (env.success === false) {
        const body = (env.error ?? {}) as ApiErrorBody;
        const apiError: ApiError = {
          status: res.status,
          message: body.message ?? 'Request failed',
          code: body.code,
          detail: body.detail ?? body,
        };
        return Promise.reject(apiError);
      }
      res.meta = env.meta;
      res.data = env.data;
    }
    return res;
  },
  (err: AxiosError<{ detail?: unknown; error?: ApiErrorBody; message?: string }>) => {
    const data = err.response?.data;
    const envError = data?.error;
    // A 401 on an authenticated request means the session is dead (expired or
    // revoked) — tear it down so the app falls back to the login screen. We
    // only fire when a token was actually attached, so a failed login attempt
    // (no token yet) keeps its inline error instead of bouncing the UI.
    // /auth/change-password also 401s on a wrong *current password* — that is
    // an inline form error, not a dead session, so it must not log the user out.
    const url = err.config?.url ?? '';
    if (
      err.response?.status === 401 &&
      getToken() &&
      !url.includes('/auth/login') &&
      !url.includes('/auth/change-password')
    ) {
      notifyUnauthorized();
    }
    const apiError: ApiError = {
      status: err.response?.status ?? 0,
      message:
        envError?.message ||
        (typeof data?.detail === 'string' ? data.detail : undefined) ||
        data?.message ||
        err.message ||
        'Network error',
      code: envError?.code,
      detail: envError?.detail ?? data?.detail ?? data,
    };
    return Promise.reject(apiError);
  },
);

/**
 * Fetch a paginated resource, returning both the rows and the envelope `meta`
 * (total/limit/offset/cursor). Use this for list views that render pagination;
 * plain list helpers below still return just the rows for convenience.
 */
export async function fetchPage<T>(
  url: string,
  params?: PageParams,
  config?: AxiosRequestConfig,
): Promise<Page<T>> {
  const res = await http.get<T>(url, { ...config, params });
  return { data: res.data, meta: res.meta ?? {} };
}

/* ------------------------------- Auth ------------------------------------ */
/** Login/identity endpoints — see docs/security/AUTH_CONTRACT.md. */
export interface LoginResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}
export interface CurrentUser {
  username: string;
  role: string;
}
export const authApi = {
  login: (username: string, password: string) =>
    http.post<LoginResponse>('/auth/login', { username, password }).then((r) => r.data),
  me: () => http.get<CurrentUser>('/auth/me').then((r) => r.data),
  /** First-run setup: is there no account yet? (public) */
  setupStatus: () =>
    http.get<{ setup_required: boolean }>('/auth/setup').then((r) => r.data),
  /** First-run setup: create the admin account; returns a token (auto-login). */
  setup: (username: string, password: string) =>
    http.post<LoginResponse>('/auth/setup', { username, password }).then((r) => r.data),
  /** Change own password; requires the current password (re-auth). */
  changePassword: (currentPassword: string, newPassword: string) =>
    http
      .post('/auth/change-password', {
        current_password: currentPassword,
        new_password: newPassword,
      })
      .then((r) => r.data),
};

/* ----------------------------- Projects ---------------------------------- */
export const projectsApi = {
  list: (params?: PageParams) =>
    http.get<Project[]>('/projects', { params }).then((r) => r.data),
  /** Paginated variant — returns rows + envelope meta for list views. */
  listPage: (params?: PageParams) => fetchPage<Project[]>('/projects', params),
  get: (id: string) => http.get<Project>(`/projects/${id}`).then((r) => r.data),
  create: (body: Partial<Project>) => http.post<Project>('/projects', body).then((r) => r.data),
  topology: (id: string) =>
    http.get<Topology>(`/projects/${id}/topology`).then((r) => r.data),
};

/* ------------------------------- Nodes ----------------------------------- */
export const nodesApi = {
  create: (body: Partial<NodeModel>) => http.post<NodeModel>('/nodes', body).then((r) => r.data),
  update: (id: string, patch: Partial<NodeModel>) =>
    http.patch<NodeModel>(`/nodes/${id}`, patch).then((r) => r.data),
  remove: (id: string) => http.delete(`/nodes/${id}`).then(() => undefined),
  /** Move is sent debounced from the canvas to avoid request floods. */
  move: (id: string, x: number, y: number) =>
    http.patch<NodeModel>(`/nodes/${id}`, { x, y }).then((r) => r.data),
};

/* ------------------------------- Links ----------------------------------- */
export const linksApi = {
  create: (body: Partial<LinkModel>) => http.post<LinkModel>('/links', body).then((r) => r.data),
  update: (id: string, patch: Partial<LinkModel>) =>
    http.patch<LinkModel>(`/links/${id}`, patch).then((r) => r.data),
  remove: (id: string) => http.delete(`/links/${id}`).then(() => undefined),
};

/* ----------------------------- Scenarios --------------------------------- */
export const scenariosApi = {
  list: (projectId: string) =>
    http.get<Scenario[]>('/scenarios', { params: { project_id: projectId } }).then((r) => r.data),
};

/* ----------------------------- Simulation -------------------------------- */
export const simApi = {
  start: (body: SimulateRequest) => http.post('/simulate', body).then((r) => r.data),
  pause: (projectId: string) => http.post(`/simulate/${projectId}/pause`).then((r) => r.data),
  resume: (projectId: string) => http.post(`/simulate/${projectId}/resume`).then((r) => r.data),
  step: (projectId: string) => http.post(`/simulate/${projectId}/step`).then((r) => r.data),
  stop: (projectId: string) => http.post(`/simulate/${projectId}/stop`).then((r) => r.data),
};

/* ------------------------------ Live lab ---------------------------------- */
/**
 * Packet-level diagnostics against the project's living lab (backend
 * `app/api/lab.py`). Ping/traceroute run through the discrete-event engine;
 * captures/tables expose the live per-link frames and per-device state.
 */
export interface PingResult {
  src: string;
  dst: string;
  sent: number;
  received: number;
  loss_pct: number;
  rtts_ms: number[];
  min_ms: number | null;
  avg_ms: number | null;
  max_ms: number | null;
  errors: string[];
  /** Session id + completion flag — in simulation mode results arrive as you step. */
  ident?: number;
  done?: boolean;
  mode?: LabMode;
}

export type LabMode = 'realtime' | 'simulation';

/** One dispatched engine event (NG-SIM-01). PACKET_TX/RX rows carry frame context. */
export interface LedgerRecord {
  seq: number;
  t: number;
  type: string;
  node: string;
  info?: string;
  link?: string;
  iface?: string;
  frame_id?: number;
  size?: number;
}

export interface LedgerResponse {
  hash: string;
  total: number;
  mode: LabMode;
  sim_time: number;
  pending_events: number;
  records: LedgerRecord[];
}

export interface StepResponse {
  project_id: string;
  dispatched: number;
  seq: number;
  sim_time: number;
  pending_events: number;
  records: LedgerRecord[];
}

export interface SeekResponse {
  project_id: string;
  mode: LabMode;
  seq: number;
  hash: string;
  sim_time: number;
  pending_events: number;
}

export interface TracerouteHop {
  hop: number;
  address: string | null;
  rtt_ms: number | null;
}
export interface TracerouteResult {
  src: string;
  dst: string;
  reached: boolean;
  hops: TracerouteHop[];
}

export interface CaptureRecord {
  t: number;
  link_id: string;
  iface: string;
  dir: 'tx' | 'rx' | 'drop';
  frame_id: number;
  size: number;
  info: string;
  layers: Record<string, Record<string, unknown>>;
}

export interface CliResult {
  node: string;
  output: string;
  prompt: string;
}

export const labApi = {
  ping: (projectId: string, src: string, dst: string, count = 4) =>
    http
      .post<PingResult>(`/lab/${projectId}/ping`, { src, dst, count })
      .then((r) => r.data),
  traceroute: (projectId: string, src: string, dst: string) =>
    http
      .post<TracerouteResult>(`/lab/${projectId}/traceroute`, { src, dst })
      .then((r) => r.data),
  cli: (projectId: string, node: string, command: string) =>
    http
      .post<CliResult>(`/lab/${projectId}/cli`, { node, command })
      .then((r) => r.data),
  captures: (projectId: string, linkId?: string, limit = 200) =>
    http
      .get<{ records: CaptureRecord[] }>(`/lab/${projectId}/captures`, {
        params: { link_id: linkId, limit },
      })
      .then((r) => r.data.records),
  tables: (projectId: string, nodeRef: string) =>
    http
      .get<Record<string, unknown>>(`/lab/${projectId}/tables/${nodeRef}`)
      .then((r) => r.data),
  autoAddress: (projectId: string) =>
    http
      .post<{ nodes_updated: number }>(`/lab/${projectId}/auto-address`)
      .then((r) => r.data),
  /* --- Simulation mode (NG-SIM-01) --- */
  mode: (projectId: string, mode: LabMode) =>
    http
      .post<{ mode: LabMode; seq: number }>(`/lab/${projectId}/mode`, { mode })
      .then((r) => r.data),
  step: (projectId: string, body: { events?: number; duration?: number }) =>
    http.post<StepResponse>(`/lab/${projectId}/step`, body).then((r) => r.data),
  seek: (projectId: string, seq: number) =>
    http.post<SeekResponse>(`/lab/${projectId}/seek`, { seq }).then((r) => r.data),
  ledger: (projectId: string, fromSeq = 0, limit = 300) =>
    http
      .get<LedgerResponse>(`/lab/${projectId}/ledger`, {
        params: { from_seq: fromSeq, limit },
      })
      .then((r) => r.data),
};

/* ----------------------------- Config-gen -------------------------------- */
export const configsApi = {
  generate: (nodeId: string, vendor?: string) =>
    http
      .post<ConfigArtifact>('/configs/generate', { node_id: nodeId, vendor })
      .then((r) => r.data),
  forNode: (nodeId: string) =>
    http.get<ConfigArtifact[]>('/configs', { params: { node_id: nodeId } }).then((r) => r.data),
};

/* --------------------------- Device types -------------------------------- */
/**
 * Device-type registry (MASTER_SPEC §4 / backend `device_types.py`).
 * Powers the map-mode Device Library: built-in catalog + operator-added
 * custom types (manual entry, Docker image, or uploaded appliance image).
 */
export interface DeviceType {
  id: string;
  name: string;
  category: string;
  icon?: string | null;
  description: string;
  builtin: boolean;
}

export interface DeviceTypeCreate {
  name: string;
  category?: string;
  icon?: string | null;
  description?: string;
}

export const deviceTypesApi = {
  list: () => http.get<DeviceType[]>('/device-types').then((r) => r.data),
  create: (body: DeviceTypeCreate) =>
    http.post<DeviceType>('/device-types', body).then((r) => r.data),
  remove: (id: string) => http.delete(`/device-types/${id}`).then(() => undefined),

  /** Register a custom type backed by a Docker image. */
  fromDocker: (image: string, name?: string) =>
    http
      .post<DeviceType>('/device-types', {
        name: name?.trim() || image,
        category: 'docker',
        icon: 'docker',
        description: `Docker image: ${image}`,
      } satisfies DeviceTypeCreate)
      .then((r) => r.data),

  /**
   * Upload an appliance image (ISO/qcow2/img) to register a custom device type.
   * Sent as multipart/form-data to `/device-types/upload`.
   * NOTE: this backend endpoint is a cross-area dependency — see frontend/NEEDS.md.
   */
  uploadImage: (
    file: File,
    opts?: { name?: string; onProgress?: (pct: number) => void },
  ) => {
    const form = new FormData();
    form.append('file', file);
    if (opts?.name) form.append('name', opts.name);
    return http
      .post<DeviceType>('/device-types/upload', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 0, // large uploads: no client timeout
        onUploadProgress: (e) => {
          if (opts?.onProgress && e.total) {
            opts.onProgress(Math.round((e.loaded / e.total) * 100));
          }
        },
      })
      .then((r) => r.data);
  },
};

/* --------------------------- Host system / NICs -------------------------- */
export const systemApi = {
  interfaces: () =>
    http.get<{ interfaces: HostInterface[] }>('/system/interfaces').then((r) => r.data.interfaces),
  internet: () => http.get<InternetStatus>('/system/internet').then((r) => r.data),
};

/* ----------------------------- Self-update ------------------------------- */
export interface UpdateCheck {
  current: string;
  latest: string | null;
  update_available: boolean;
  notes?: string;
  url?: string;
  published_at?: string;
  checked_at: number;
  can_apply?: boolean;
  /** True when the backend has UPDATE_TOKEN configured — apply() must then
   *  send the matching X-Update-Token header on top of the admin session. */
  token_required?: boolean;
  error?: string;
}
export interface UpdateStatus {
  state:
    | 'idle'
    | 'queued'
    | 'updating'
    | 'rebuilding'
    | 'restarting'
    | 'done'
    | 'up-to-date'
    | 'error';
  message?: string;
  at?: number;
}
export const updateApi = {
  check: () => http.get<UpdateCheck>('/update/check').then((r) => r.data),
  status: () => http.get<UpdateStatus>('/update/status').then((r) => r.data),
  apply: (token?: string) =>
    http
      .post<UpdateStatus>('/update/apply', null, {
        headers: token ? { 'X-Update-Token': token } : undefined,
      })
      .then((r) => r.data),
};
