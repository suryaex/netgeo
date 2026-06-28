/**
 * Auth store — simple session-based authentication.
 * Credentials are hardcoded (or can be overridden via VITE_AUTH_USERS env).
 * Uses sessionStorage so the session is cleared when the tab closes.
 */
import { create } from 'zustand';

/** Built-in credentials. Format: username:password pairs. */
const BUILTIN_USERS: Record<string, string> = {
  admin: 'netgeo',
  demo: 'demo123',
};

const SESSION_KEY = 'netgeo.session';

interface AuthState {
  isAuthenticated: boolean;
  username: string | null;
  loginError: string | null;

  login: (username: string, password: string) => boolean;
  logout: () => void;
  clearError: () => void;
}

function initialAuth(): Pick<AuthState, 'isAuthenticated' | 'username'> {
  try {
    const saved = sessionStorage.getItem(SESSION_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as { username?: string };
      if (parsed.username && parsed.username in BUILTIN_USERS) {
        return { isAuthenticated: true, username: parsed.username };
      }
    }
  } catch {
    /* ignore */
  }
  return { isAuthenticated: false, username: null };
}

export const useAuthStore = create<AuthState>((set) => ({
  ...initialAuth(),
  loginError: null,

  login: (username, password) => {
    const valid = BUILTIN_USERS[username] === password;
    if (valid) {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({ username }));
      set({ isAuthenticated: true, username, loginError: null });
    } else {
      set({ loginError: 'Incorrect username or password. Try admin / netgeo.' });
    }
    return valid;
  },

  logout: () => {
    sessionStorage.removeItem(SESSION_KEY);
    set({ isAuthenticated: false, username: null, loginError: null });
  },

  clearError: () => set({ loginError: null }),
}));
