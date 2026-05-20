// Bundled app version. Bump this manually as part of every release; the
// CI workflow doesn't autopatch it. Format: 'v<semver>' to match git tags.
export const APP_VERSION = 'v0.4.0';

// Where to fetch release history from. Public GitHub API; rate limit is
// 60 req/hour per IP for unauthenticated calls, which is plenty since
// the response is cached in localStorage.
export const RELEASES_URL =
  'https://api.github.com/repos/williamdeng3244/LLM-WIKI/releases?per_page=10';

// Released-bundle list shape (subset of the GitHub Releases API response).
export type GhRelease = {
  tag_name: string;
  name: string | null;
  published_at: string;
  body: string | null;
  html_url: string;
  prerelease: boolean;
  draft: boolean;
};

// Lexically compare two semver-ish strings ('v0.3.0' / '0.3.0' / 'v0.10.2').
// Returns >0 if a > b, <0 if a < b, 0 if equal. Treats missing segments as 0.
export function compareVersions(a: string, b: string): number {
  const norm = (s: string) =>
    s.replace(/^v/, '').split('.').map((p) => parseInt(p, 10) || 0);
  const aa = norm(a);
  const bb = norm(b);
  const n = Math.max(aa.length, bb.length);
  for (let i = 0; i < n; i++) {
    const d = (aa[i] ?? 0) - (bb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}
