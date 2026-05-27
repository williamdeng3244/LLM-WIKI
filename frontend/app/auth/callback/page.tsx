'use client';
// Landing page for the OIDC redirect (issue #5). The backend issues a
// session JWT and bounces the user here with `#token=...` so the JWT
// never lands in server logs or referer headers. We pull it off the
// fragment, drop it in localStorage, then bounce to /.
import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';

export default function OidcCallback() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const hash = window.location.hash.replace(/^#/, '');
    const params = new URLSearchParams(hash);
    const token = params.get('token');
    const err = params.get('error');
    if (err) {
      setError(decodeURIComponent(err));
      return;
    }
    if (!token) {
      setError('No token in callback URL.');
      return;
    }
    localStorage.setItem('wiki:jwt', token);
    localStorage.removeItem('wiki:email');
    localStorage.removeItem('wiki:role');
    // Wipe the fragment before the redirect so the JWT doesn't sit in
    // browser history.
    window.history.replaceState(null, '', '/');
    window.location.replace('/');
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg text-ink">
      <div className="text-center space-y-2">
        {error ? (
          <>
            <div className="text-rose-300 text-[0.9286rem]">Sign-in failed</div>
            <div className="text-muted text-[0.8214rem] max-w-md">{error}</div>
            <a href="/" className="btn mt-3 inline-flex">Back to home</a>
          </>
        ) : (
          <div className="flex items-center gap-2 text-muted text-[0.8929rem]">
            <Loader2 size={14} className="animate-spin" /> Completing sign-in…
          </div>
        )}
      </div>
    </div>
  );
}
