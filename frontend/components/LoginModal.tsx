'use client';
import { useEffect, useState } from 'react';
import { LogIn, Loader2 } from 'lucide-react';
import { api, type AuthConfigDTO } from '@/lib/api';

/** Login modal (issue #5). Shown when the user lands in `oidc` mode
 * with no session JWT. Offers two paths:
 *   - Static admin form (POST /api/auth/login)
 *   - "Sign in with OIDC" → window.location = /api/auth/oidc/login
 * The frontend's /auth/callback page picks up the resulting JWT from
 * the URL fragment and writes it to `wiki:jwt` localStorage. */
export default function LoginModal({
  onAuthed,
}: {
  onAuthed: () => void;
}) {
  const [cfg, setCfg] = useState<AuthConfigDTO | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.authConfig().then(setCfg).catch((e) => setError((e as Error).message));
  }, []);

  async function submitLocal(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const r = await api.localLogin(email.trim(), password);
      localStorage.setItem('wiki:jwt', r.token);
      // The stub fallback headers would otherwise still apply on stale
      // tabs — clear them so /whoami unambiguously resolves via JWT.
      localStorage.removeItem('wiki:email');
      localStorage.removeItem('wiki:role');
      onAuthed();
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center">
      <div className="bg-panel border border-line rounded-lg w-[420px] max-w-[92vw] shadow-[0_24px_60px_-12px_rgba(0,0,0,0.7)]">
        <div className="px-5 py-3 border-b border-black/10 flex items-center gap-2">
          <LogIn size={16} className="text-accent" />
          <h3 className="font-medium text-[1rem]">Sign in</h3>
        </div>

        <div className="px-5 py-4 space-y-4">
          {!cfg && (
            <div className="text-muted text-[0.8929rem] flex items-center gap-2">
              <Loader2 size={14} className="animate-spin" /> Loading auth options…
            </div>
          )}

          {cfg?.oidc_enabled && (
            <div>
              <a
                href={api.oidcLoginUrl()}
                className="btn btn-primary w-full justify-center"
              >
                Sign in with OIDC
              </a>
              <div className="text-[0.7857rem] text-muted mt-1.5 text-center">
                Redirects you to your identity provider.
              </div>
            </div>
          )}

          {cfg?.oidc_enabled && cfg?.local_admin_enabled && (
            <div className="flex items-center gap-2 text-[0.7857rem] text-muted">
              <div className="flex-1 h-px bg-white/[0.08]" />
              <span>or</span>
              <div className="flex-1 h-px bg-white/[0.08]" />
            </div>
          )}

          {cfg?.local_admin_enabled && (
            <form className="space-y-2" onSubmit={submitLocal}>
              <label className="block text-[0.7143rem] uppercase tracking-[0.12em] text-muted">
                Admin email
              </label>
              <input
                className="form-input h-9 w-full text-[0.8929rem]"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={busy}
              />
              <label className="block text-[0.7143rem] uppercase tracking-[0.12em] text-muted">
                Password
              </label>
              <input
                className="form-input h-9 w-full text-[0.8929rem]"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={busy}
              />
              <button
                type="submit"
                className="btn btn-primary w-full justify-center mt-2"
                disabled={busy || !email || !password}
              >
                {busy ? <><Loader2 size={13} className="animate-spin" /> Signing in…</> : 'Sign in as admin'}
              </button>
            </form>
          )}

          {cfg && !cfg.oidc_enabled && !cfg.local_admin_enabled && (
            <div className="text-[0.8929rem] text-rose-300">
              No sign-in method is configured. Set <code>ADMIN_EMAIL</code> /
              <code> ADMIN_PASSWORD</code> in <code>.env</code> (or full OIDC
              credentials) and restart the backend.
            </div>
          )}

          {error && (
            <div className="text-[0.8214rem] bg-rose-500/10 border border-rose-500/30 text-rose-300 px-3 py-2 rounded">
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
