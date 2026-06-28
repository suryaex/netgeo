/**
 * LoginPage — full-viewport glassmorphism login screen.
 * Matches the NetGeo dark-glass design language: radial gradient background,
 * frosted card, Apple-blue accent. Credentials are validated by authStore.
 */
import { useEffect, useState, useRef } from 'react';
import { Eye, EyeOff, Lock, LogIn, Network, User } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { applyTheme } from '@/theme/tokens';
import { cn } from '@/lib/cn';

export function LoginPage() {
  const login = useAuthStore((s) => s.login);
  const loginError = useAuthStore((s) => s.loginError);
  const clearError = useAuthStore((s) => s.clearError);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const usernameRef = useRef<HTMLInputElement>(null);

  // Always render in dark mode on the login screen.
  useEffect(() => {
    applyTheme('dark');
    usernameRef.current?.focus();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) return;
    setLoading(true);
    // Tiny artificial delay so the button state is visible.
    await new Promise((r) => setTimeout(r, 320));
    login(username.trim(), password);
    setLoading(false);
  };

  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{
        background:
          'radial-gradient(120% 120% at 12% 0%, #141a2e 0%, #0b1020 60%)',
      }}
    >
      {/* Decorative blobs */}
      <div
        className="pointer-events-none absolute left-1/4 top-1/4 h-96 w-96 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-20 blur-3xl"
        style={{ background: 'radial-gradient(circle, #007AFF 0%, transparent 70%)' }}
      />
      <div
        className="pointer-events-none absolute right-1/4 bottom-1/4 h-64 w-64 translate-x-1/2 translate-y-1/2 rounded-full opacity-10 blur-3xl"
        style={{ background: 'radial-gradient(circle, #5856D6 0%, transparent 70%)' }}
      />

      {/* Login card */}
      <div className="relative w-full max-w-sm animate-scale-in px-4">
        <div className="glass-strong overflow-hidden rounded-2xl border border-white/10 shadow-glass-lg">
          {/* Header stripe */}
          <div className="border-b border-white/10 px-8 pb-6 pt-8 text-center">
            <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-accent shadow-lg shadow-accent/40">
              <Network className="h-7 w-7 text-white" />
            </div>
            <h1 className="text-xl font-semibold text-white">NetGeo</h1>
            <p className="mt-1 text-sm text-white/50">Network Simulation Platform</p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4 px-8 py-6">
            {/* Username */}
            <div className="space-y-1.5">
              <label className="block text-xs font-medium uppercase tracking-wide text-white/50">
                Username
              </label>
              <div className="relative">
                <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
                <input
                  ref={usernameRef}
                  type="text"
                  autoComplete="username"
                  value={username}
                  onChange={(e) => { setUsername(e.target.value); clearError(); }}
                  placeholder="admin"
                  className={cn(
                    'w-full rounded-md border bg-black/25 py-2.5 pl-9 pr-3 text-sm text-white/90 outline-none transition-colors placeholder:text-white/25',
                    loginError
                      ? 'border-danger focus:border-danger'
                      : 'border-white/10 focus:border-accent',
                  )}
                />
              </div>
            </div>

            {/* Password */}
            <div className="space-y-1.5">
              <label className="block text-xs font-medium uppercase tracking-wide text-white/50">
                Password
              </label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); clearError(); }}
                  placeholder="••••••••"
                  className={cn(
                    'w-full rounded-md border bg-black/25 py-2.5 pl-9 pr-10 text-sm text-white/90 outline-none transition-colors placeholder:text-white/25',
                    loginError
                      ? 'border-danger focus:border-danger'
                      : 'border-white/10 focus:border-accent',
                  )}
                />
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-white/35 hover:text-white/60"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {/* Error message */}
            {loginError && (
              <p className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
                {loginError}
              </p>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading || !username.trim() || !password}
              className={cn(
                'flex w-full items-center justify-center gap-2 rounded-md py-2.5 text-sm font-semibold text-white transition-all',
                loading || !username.trim() || !password
                  ? 'cursor-not-allowed bg-accent/50'
                  : 'bg-accent hover:bg-accent-soft active:scale-[0.98]',
              )}
            >
              {loading ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              ) : (
                <LogIn className="h-4 w-4" />
              )}
              {loading ? 'Signing in…' : 'Sign in'}
            </button>

            <p className="text-center text-[11px] text-white/25">
              Default credentials: <span className="text-white/40">admin / netgeo</span>
            </p>
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-white/20">
          NetGeo v0.1 &mdash; Network Simulation Platform
        </p>
      </div>
    </div>
  );
}
