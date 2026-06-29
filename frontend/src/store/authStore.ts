/**
 * Auth store — bearer-token session backed by the backend (AUTH_CONTRACT.md).
 *
 * Credentials are verified server-side by POST /api/auth/login; this store only
 * holds the resulting token + identity. There are NO client-side credentials
 * (the old hardcoded user table was RB-02, now removed). The token itself lives
 * in api/token.ts so the REST/WS layers can read it without an import cycle.
 */
import { create } from 'zustand';
import { authApi, type ApiError } from '@/api/client';
import { getToken, setToken, setUnauthorizedHandler } from '@/api/token';

interface AuthState {
  isAuthenticated: boolean;
  username: string | null;
  role: string | null;
  loginError: string | null;
  loggingIn: boolean;

  login: (username: string, password: string) => Promise<boolean>;
  logout: () => void;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  // Optimistically restore: if a token survived in sessionStorage we treat the
  // session as live. If it is stale, the first authenticated request returns
  // 401 and the unauthorized handler (registered below) tears it down.
  isAuthenticated: !!getToken(),
  username: null,
  role: null,
  loginError: null,
  loggingIn: false,

  login: async (username, password) => {
    set({ loggingIn: true, loginError: null });
    try {
      const { access_token } = await authApi.login(username, password);
      setToken(access_token);
      // Resolve identity/role for the UI (non-fatal if it fails).
      let me: { username: string; role: string } | null = null;
      try {
        me = await authApi.me();
      } catch {
        /* identity is best-effort; token is already valid */
      }
      set({
        isAuthenticated: true,
        username: me?.username ?? username,
        role: me?.role ?? null,
        loginError: null,
        loggingIn: false,
      });
      return true;
    } catch (err) {
      const e = err as ApiError;
      const message =
        e.status === 429
          ? 'Too many attempts. Please wait a minute and try again.'
          : e.status === 0
            ? 'Cannot reach the server. Check your connection.'
            : 'Incorrect username or password.';
      setToken(null);
      set({ isAuthenticated: false, username: null, role: null, loginError: message, loggingIn: false });
      return false;
    }
  },

  logout: () => {
    setToken(null);
    set({ isAuthenticated: false, username: null, role: null, loginError: null });
  },

  clearError: () => set({ loginError: null }),
}));

// Wire the transport-layer 401/4401 signal to a session teardown. Registered
// once at module load; the REST client and WS layer call notifyUnauthorized().
setUnauthorizedHandler(() => {
  useAuthStore.getState().logout();
});
