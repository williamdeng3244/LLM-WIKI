'use client';
// Full-page login route — replaces the in-app `<LoginModal>` for the
// "explicit sign-out" flow. After successful authentication we clear
// the `wiki:signed-out` block flag and redirect to `/`. Theme matches
// the rest of the wiki: panel-on-dark, accent glow, video background
// (rendered globally by RootLayout).
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogIn, Loader2, Sun, Moon } from 'lucide-react';
import { api, type AuthConfigDTO } from '@/lib/api';
import { useTheme } from '@/lib/theme';
import { APP_VERSION } from '@/lib/version';

export default function LoginPage() {
  const router = useRouter();
  // Hydrates `data-theme` from localStorage on mount (a fresh full-page
  // load of /login would otherwise have no theme set → always dark).
  const { theme, toggle: toggleTheme } = useTheme();
  const [cfg, setCfg] = useState<AuthConfigDTO | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // `?next=` — where to go after sign-in. Set by the artifact viewer when
  // it bounces an unauthenticated visitor (next=/a/<token>) and by the
  // /artifacts sign-in links (next=/artifacts).
  const [nextPath, setNextPath] = useState('/');
  const cameFromArtifact = nextPath.startsWith('/a/');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const n = new URLSearchParams(window.location.search).get('next');
    // Only honor same-origin path redirects, never absolute URLs.
    if (n && n.startsWith('/') && !n.startsWith('//')) setNextPath(n);
  }, []);

  // After auth, go where the user was headed. /a/<token> is served by the
  // backend (via rewrite), so use a full navigation for those.
  function goNext() {
    if (typeof window !== 'undefined' && (cameFromArtifact || nextPath !== '/')) {
      window.location.href = nextPath;
    } else {
      router.replace('/');
    }
  }

  useEffect(() => {
    api.authConfig().then(setCfg).catch((e) => setError((e as Error).message));
  }, []);

  // If the user lands here already authenticated (e.g. browser back
  // after sign-in), just bounce onward. Skips when explicitly signed-out.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (localStorage.getItem('wiki:signed-out') === '1') return;
    api.whoami().then(() => goNext()).catch(() => { /* stay */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  async function submitLocal(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const r = await api.localLogin(email.trim(), password);
      localStorage.setItem('wiki:jwt', r.token);
      // Clear the sign-out block + the legacy stub-mode headers so
      // /whoami unambiguously resolves via the new JWT.
      localStorage.removeItem('wiki:signed-out');
      localStorage.removeItem('wiki:email');
      localStorage.removeItem('wiki:role');
      goNext();
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <button
        className="btn btn-icon absolute top-4 right-4 z-10"
        onClick={toggleTheme}
        title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        aria-label="Toggle theme"
      >
        {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
      </button>
      <div className="w-[440px] max-w-full">
        <div className="text-center mb-6">
          <div className="text-[0.7143rem] uppercase tracking-[0.18em] text-muted">
            Enflame Wiki
          </div>
          <div className="text-[0.75rem] text-muted/60 mt-0.5 font-mono">
            {APP_VERSION}
          </div>
        </div>

        {/* Why-are-you-here note when bounced from a gated artifact link. */}
        {cameFromArtifact && (
          <div className="mb-4 flex items-start gap-2.5 rounded-lg border border-accent/30 bg-accent/10 px-4 py-3">
            <LogIn size={15} className="text-accent shrink-0 mt-0.5" />
            <div className="text-[0.84rem] text-ink">
              This is a private artifact. <span className="text-muted">Sign in to view it — you’ll be taken straight there.</span>
            </div>
          </div>
        )}

        <div className="bg-panel border border-line rounded-lg shadow-[0_24px_60px_-12px_rgba(0,0,0,0.7),0_0_60px_-20px_rgba(124,156,255,0.20)] backdrop-blur">
          <div className="px-5 py-3 border-b border-black/10 flex items-center gap-2">
            <LogIn size={16} className="text-accent" />
            <h3 className="font-medium text-[1rem]">Sign in</h3>
          </div>

          <div className="px-5 py-5 space-y-4">
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
                  onClick={() => {
                    if (typeof window !== 'undefined') {
                      localStorage.removeItem('wiki:signed-out');
                    }
                  }}
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
                  autoFocus
                />
                <label className="block text-[0.7143rem] uppercase tracking-[0.12em] text-muted mt-2">
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
                  className="btn btn-primary w-full justify-center mt-3"
                  disabled={busy || !email || !password}
                >
                  {busy ? <><Loader2 size={13} className="animate-spin" /> Signing in…</> : 'Sign in as admin'}
                </button>
              </form>
            )}

            {cfg && !cfg.oidc_enabled && !cfg.local_admin_enabled && (
              <div className="text-[0.8929rem] text-rose-300 space-y-2">
                <div>No sign-in method is configured.</div>
                <div className="text-[0.8214rem] text-muted">
                  Set <code className="text-ink/85 bg-white/[0.06] px-1 rounded">ADMIN_EMAIL</code>{' '}
                  and <code className="text-ink/85 bg-white/[0.06] px-1 rounded">ADMIN_PASSWORD</code>{' '}
                  in your <code className="text-ink/85 bg-white/[0.06] px-1 rounded">.env</code> and
                  recreate the backend container:
                  <pre className="bg-black/30 border border-white/[0.06] rounded px-2 py-1.5 mt-1.5 text-[0.7857rem] overflow-x-auto">
docker compose -f docker-compose.yml \\
  -f docker-compose.prod.yml \\
  up -d --force-recreate backend
                  </pre>
                </div>
              </div>
            )}

            {error && (
              <div className="text-[0.8214rem] bg-rose-500/10 border border-rose-500/30 text-rose-300 px-3 py-2 rounded">
                {error}
              </div>
            )}
          </div>
        </div>

        {cfg?.mode === 'stub' && (
          <div className="text-[0.75rem] text-muted/70 mt-4 text-center">
            Running in stub mode — the dev backend will let any{' '}
            <code className="text-ink/70 bg-white/[0.04] px-1 rounded">X-User-Email</code>{' '}
            header through.
          </div>
        )}
      </div>
    </div>
  );
}
