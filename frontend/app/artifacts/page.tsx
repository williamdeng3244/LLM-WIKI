'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Share2, Search, Plus, Copy, ExternalLink, Trash2, Upload, Eye,
  Loader2, Check, RefreshCw, Lock, Users, Globe, FileText, FileCode,
  Sun, Moon, LogIn, LogOut, ChevronDown,
} from 'lucide-react';

import PublishArtifactModal from '@/components/artifacts/PublishArtifactModal';
import { copyToClipboard } from '@/lib/clipboard';
import { useTheme } from '@/lib/theme';
import { useLanguage } from '@/lib/i18n';
import {
  api, type ArtifactMeta, type ArtifactVisibility,
  type ArtifactAccessLogEntry, type User,
} from '@/lib/api';

// The three visibility groups, rendered top-to-bottom with a divider
// between each. Labels/blurbs are looked up per-language from STR below;
// VIS_META carries the icon + chip colour only.
const VIS_ORDER: ArtifactVisibility[] = ['private', 'wiki', 'public'];
const VIS_META: Record<ArtifactVisibility, { icon: typeof Lock; cls: string }> = {
  private: { icon: Lock, cls: 'border-amber-500/40 text-amber-300' },
  wiki: { icon: Users, cls: 'border-line text-muted hover:text-ink' },
  public: { icon: Globe, cls: 'border-rose-500/40 text-rose-300' },
};

function mimeIcon(mime: string) {
  return mime === 'text/html' ? FileCode : FileText;
}

// Local translation table (中文 / English). Kept here rather than in the
// shared i18n bundle since these strings are artifacts-page-specific.
type SectionCopy = { label: string; blurb: string };
type Strings = {
  title: string; tagline: string; search: string;
  newArtifact: string; newHint: string;
  yours: string; publicOnly: string;
  bannerPre: string; bannerPublic: string; bannerPost: string;
  signIn: string; lock: (label: string) => string;
  noneYet: string; noMatch: (label: string) => string;
  copy: string; copied: string; open: string; version: string; log: string;
  confirm: string; del: string; changeVis: string; rename: string;
  views: string; exp: string; loading: string;
  accessLog: string; noViews: string; anonymous: string;
  sections: Record<ArtifactVisibility, SectionCopy>;
};
const STR: Record<'en' | 'zh', Strings> = {
  en: {
    title: 'Artifacts', tagline: 'Gated share links', search: 'Search artifacts…',
    newArtifact: 'New artifact', newHint: 'Upload a file, or write HTML / Markdown',
    yours: 'Your artifacts', publicOnly: 'Public artifacts',
    bannerPre: 'You’re signed out — only ', bannerPublic: 'public',
    bannerPost: ' artifacts are shown. Sign in to see your wiki and private artifacts.',
    signIn: 'Sign in', lock: (l) => `Sign in to view your ${l.toLowerCase()} artifacts.`,
    noneYet: 'None yet.', noMatch: (l) => `No matches in ${l}.`,
    copy: 'Copy', copied: 'Copied', open: 'Open', version: 'Version', log: 'Log',
    confirm: 'Confirm?', del: 'Delete artifact', changeVis: 'Change visibility',
    rename: 'Click to rename', views: 'views/7d', exp: 'exp', loading: 'Loading…',
    accessLog: 'Access log', noViews: 'No views yet.', anonymous: '(anonymous)',
    sections: {
      private: { label: 'Private', blurb: 'Only you can open these.' },
      wiki: { label: 'Wiki', blurb: 'Anyone signed in to this wiki can open these.' },
      public: { label: 'Public', blurb: 'Anyone with the link can open these — no login.' },
    },
  },
  zh: {
    title: '制品', tagline: '受控分享链接', search: '搜索制品…',
    newArtifact: '新建制品', newHint: '上传文件，或编写 HTML / Markdown',
    yours: '我的制品', publicOnly: '公开制品',
    bannerPre: '你已退出登录 —— 仅显示', bannerPublic: '公开',
    bannerPost: '制品。登录后可查看你的 Wiki 与私有制品。',
    signIn: '登录', lock: (l) => `登录后可查看你的${l}制品。`,
    noneYet: '暂无。', noMatch: (l) => `${l}中无匹配项。`,
    copy: '复制', copied: '已复制', open: '打开', version: '新版本', log: '记录',
    confirm: '确认？', del: '删除制品', changeVis: '更改可见性',
    rename: '点击重命名', views: '次/7天', exp: '到期', loading: '加载中…',
    accessLog: '访问记录', noViews: '暂无访问。', anonymous: '(匿名)',
    sections: {
      private: { label: '私有', blurb: '仅你本人可打开。' },
      wiki: { label: 'Wiki', blurb: '任何登录本 Wiki 的用户都可打开。' },
      public: { label: '公开', blurb: '任何拿到链接的人都可打开 —— 无需登录。' },
    },
  },
};

export default function ArtifactsPage() {
  const { theme, toggle: toggleTheme } = useTheme();
  const { lang, toggle: toggleLang } = useLanguage();
  const s = STR[lang];
  const [items, setItems] = useState<ArtifactMeta[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  // Identity. Viewing wiki/private artifacts requires auth; `user` drives
  // the sign-in vs sign-out control in the header. `null` = signed out.
  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [copiedSid, setCopiedSid] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [accessLogFor, setAccessLogFor] = useState<string | null>(null);
  const [accessLog, setAccessLog] = useState<ArtifactAccessLogEntry[] | null>(null);
  const [visMenuFor, setVisMenuFor] = useState<string | null>(null);

  // Upload modal (reuses the same PublishArtifactModal as the file-tree
  // right-click path). `tick` bumps after a publish so the grid refetches.
  const [showUpload, setShowUpload] = useState(false);
  const [tick, setTick] = useState(0);

  const versionFileInput = useRef<HTMLInputElement | null>(null);
  const versionFor = useRef<string | null>(null);

  // Bump `tick` to re-resolve identity + refetch the right list.
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  // Single source of truth: resolve identity, then load the appropriate
  // list. Signed in → your artifacts (all visibilities). Signed out → the
  // public-only listing (no auth), so public shares stay visible while
  // wiki/private sections lock. Runs on mount and whenever `tick` bumps.
  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError(null);
      let u: User | null = null;
      try { u = await api.whoami(); } catch { u = null; }
      if (!alive) return;
      setUser(u);
      setAuthChecked(true);
      try {
        const resp = u
          ? await api.listMyArtifacts(100, 0)
          : await api.listPublicArtifacts(100, 0);
        if (!alive) return;
        setItems(resp.items);
        setTotal(resp.total);
      } catch (e: unknown) {
        if (!alive) return;
        setError((e as Error).message || 'Failed to load.');
        setItems([]);
        setTotal(0);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [tick]);

  // Sign out WITHOUT leaving the page: clear the session, then refetch.
  // The page stays on /artifacts; wiki/private sections lock and only the
  // public artifacts remain visible (they're public anyway).
  function signOut() {
    if (typeof window === 'undefined') return;
    localStorage.removeItem('wiki:jwt');
    localStorage.removeItem('wiki:email');
    localStorage.removeItem('wiki:role');
    // Block stub-mode auto re-auth so sign-out sticks (mirrors the main app).
    localStorage.setItem('wiki:signed-out', '1');
    setShowUpload(false);
    fetch(`${process.env.NEXT_PUBLIC_API_BASE || '/api'}/auth/logout`, {
      method: 'POST', credentials: 'include',
    }).catch(() => { /* ignore */ }).finally(() => {
      setUser(null);
      refresh();
    });
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (visMenuFor) { setVisMenuFor(null); return; }
        if (accessLogFor) { setAccessLogFor(null); return; }
        if (renaming) { setRenaming(null); return; }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [renaming, accessLogFor, visMenuFor]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (a) => a.name.toLowerCase().includes(q) || a.short_id.toLowerCase().includes(q),
    );
  }, [items, query]);

  async function copyURL(item: ArtifactMeta) {
    const url = `${window.location.origin}/a/${item.short_id}-${item.slug}`;
    if (await copyToClipboard(url)) {
      setCopiedSid(item.short_id);
      window.setTimeout(() => setCopiedSid(null), 1500);
    }
  }

  function openInNewTab(item: ArtifactMeta) {
    window.open(`/a/${item.short_id}-${item.slug}`, '_blank', 'noreferrer');
  }

  async function commitRename(sid: string) {
    const next = renameValue.trim();
    setRenaming(null);
    if (!next) return;
    try {
      await api.patchArtifact(sid, { name: next });
      refresh();
    } catch (e: unknown) {
      setError((e as Error).message);
    }
  }

  async function changeVisibility(item: ArtifactMeta, next: ArtifactVisibility) {
    setVisMenuFor(null);
    if (next === item.visibility) return;
    try {
      await api.patchArtifact(item.short_id, { visibility: next });
      refresh();
    } catch (e: unknown) {
      // Most likely a 403 when switching to `public` on an instance with
      // ARTIFACTS_ALLOW_PUBLIC=false. Surface it; the artifact keeps its
      // previous visibility server-side.
      setError((e as Error).message);
    }
  }

  async function deleteOne(sid: string) {
    try {
      await api.deleteArtifact(sid);
      setConfirmDelete(null);
      refresh();
    } catch (e: unknown) {
      setError((e as Error).message);
    }
  }

  async function uploadVersion(file: File) {
    const sid = versionFor.current;
    if (!sid) return;
    try {
      await api.uploadArtifactVersion(sid, file);
      versionFor.current = null;
      refresh();
    } catch (e: unknown) {
      setError((e as Error).message);
    }
  }

  async function showAccessLog(sid: string) {
    setAccessLogFor(sid);
    setAccessLog(null);
    try {
      const resp = await api.getArtifactAccessLog(sid, 50);
      setAccessLog(resp.items);
    } catch (e: unknown) {
      setError((e as Error).message);
      setAccessLog([]);
    }
  }

  function renderCard(item: ArtifactMeta) {
    const Mime = mimeIcon(item.mime_type);
    const vis = VIS_META[item.visibility] ?? VIS_META.wiki;
    const VisIcon = vis.icon;
    return (
      <div
        key={item.short_id}
        className="flex flex-col min-h-[170px] rounded-xl border border-line bg-panel/60 hover:bg-panel transition-colors p-4"
      >
        {/* Header: mime icon + name */}
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 text-accent shrink-0"><Mime size={18} /></span>
          <div className="min-w-0 flex-1">
            {renaming === item.short_id ? (
              <input
                autoFocus
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={() => commitRename(item.short_id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename(item.short_id);
                  if (e.key === 'Escape') setRenaming(null);
                }}
                className="w-full bg-elev text-ink border border-accent/60 rounded px-2 py-1 text-[0.9286rem] outline-none focus:shadow-[0_0_0_3px_rgba(124,156,255,0.18)]"
              />
            ) : (
              <button
                className="text-left font-medium text-[0.9643rem] hover:text-accent block w-full truncate"
                onClick={() => { setRenaming(item.short_id); setRenameValue(item.name); }}
                title={s.rename}
              >
                {item.name}
              </button>
            )}
            <div className="text-[0.75rem] text-muted mt-0.5 truncate">
              <code>{item.short_id}</code> · v{item.current_version}
            </div>
          </div>
        </div>

        {/* Meta row */}
        <div className="flex items-center flex-wrap gap-2 mt-3 text-[0.75rem] text-muted">
          <div className="relative">
            <button
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border ${vis.cls}`}
              onClick={() => setVisMenuFor(visMenuFor === item.short_id ? null : item.short_id)}
              title={s.changeVis}
            >
              <VisIcon size={11} /> {s.sections[item.visibility].label}
              <ChevronDown size={10} className="opacity-60" />
            </button>
            {visMenuFor === item.short_id && (
              <div
                className="absolute z-30 mt-1 left-0 min-w-[150px] rounded-md border border-line bg-panel shadow-[0_8px_24px_-8px_rgba(0,0,0,0.6)] py-1"
                onMouseLeave={() => setVisMenuFor(null)}
              >
                {VIS_ORDER.map((key) => {
                  const MIcon = VIS_META[key].icon;
                  const active = item.visibility === key;
                  return (
                    <button
                      key={key}
                      className={`flex items-center gap-2 w-full px-3 py-1.5 text-left text-[0.8rem] hover:bg-line/40 ${active ? 'text-accent' : 'text-ink'}`}
                      onClick={() => changeVisibility(item, key)}
                    >
                      <MIcon size={12} /> {s.sections[key].label}
                      {active && <Check size={12} className="ml-auto" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <span>{item.views_7d} {s.views}</span>
          {item.expires_at && (
            <span title="Expiration">
              {s.exp} {new Date(item.expires_at).toLocaleDateString()}
            </span>
          )}
        </div>

        <div className="flex-1" />

        {/* Action row */}
        <div className="flex items-center gap-1 mt-3 -mb-1 flex-wrap text-[0.75rem]">
          <button
            className="px-2 py-1 rounded border border-line hover:bg-line/40 flex items-center gap-1"
            onClick={() => copyURL(item)}
          >
            {copiedSid === item.short_id
              ? <><Check size={11} className="text-accent" /> {s.copied}</>
              : <><Copy size={11} /> {s.copy}</>}
          </button>
          <button
            className="px-2 py-1 rounded border border-line hover:bg-line/40 flex items-center gap-1"
            onClick={() => openInNewTab(item)}
          >
            <ExternalLink size={11} /> {s.open}
          </button>
          <button
            className="px-2 py-1 rounded border border-line hover:bg-line/40 flex items-center gap-1"
            onClick={() => { versionFor.current = item.short_id; versionFileInput.current?.click(); }}
            title={s.version}
          >
            <Upload size={11} /> {s.version}
          </button>
          <button
            className="px-2 py-1 rounded border border-line hover:bg-line/40 flex items-center gap-1"
            onClick={() => showAccessLog(item.short_id)}
          >
            <Eye size={11} /> {s.log}
          </button>
          <div className="flex-1" />
          {confirmDelete === item.short_id ? (
            <button
              className="px-2 py-1 rounded border border-rose-500/40 text-rose-300 hover:bg-rose-500/10"
              onClick={() => deleteOne(item.short_id)}
              onBlur={() => setConfirmDelete(null)}
              autoFocus
            >
              {s.confirm}
            </button>
          ) : (
            <button
              className="px-2 py-1 rounded border border-line hover:bg-rose-500/10 hover:text-rose-300 flex items-center gap-1"
              onClick={() => setConfirmDelete(item.short_id)}
              title={s.del}
            >
              <Trash2 size={11} />
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    // `relative z-10` lifts the page above the fixed VideoBackground that
    // RootLayout mounts on every route (same trick as /help).
    <div className="relative z-10 min-h-screen bg-paper text-ink">
      {/* Top bar — mirrors /help chrome. */}
      <header className="sticky top-0 z-20 border-b border-line bg-panel/85 backdrop-blur">
        <div className="max-w-[1200px] mx-auto px-4 h-14 flex items-center gap-4">
          <Link href="/" className="flex items-center gap-2 text-ink hover:text-accent transition-colors">
            <Share2 size={18} className="text-accent" />
            <span className="font-display font-medium tracking-[0.02em] text-[1.0714rem]">
              {s.title}
            </span>
          </Link>
          <span className="text-[0.8214rem] text-muted hidden md:inline">
            {s.tagline} · {total}
          </span>
          <div className="flex-1" />
          <div className="relative w-[260px] hidden sm:block">
            <input
              className="form-input h-8 pl-3 pr-9 text-[0.9286rem] w-full"
              placeholder={s.search}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
          </div>
          <button
            className="btn btn-icon"
            onClick={refresh}
            aria-label="Refresh"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
          {/* Light / dark toggle — same hook the main app uses, so the
              choice is shared and persisted across both. */}
          <button
            className="btn btn-icon"
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            aria-label="Toggle theme"
          >
            {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
          </button>
          {/* Language toggle (中文 / English) — shares the app-wide hook. */}
          <button
            className="btn btn-icon font-mono text-[0.7857rem] tracking-tight px-1.5"
            onClick={toggleLang}
            title="切换语言 · Switch language"
            aria-label="Toggle language"
          >
            {lang === 'en' ? '中' : 'EN'}
          </button>
          <button
            onClick={() => setShowUpload(true)}
            className="inline-flex items-center gap-1.5 px-3 h-8 rounded-md bg-accent text-paper text-[0.86rem] font-medium hover:opacity-90 transition-opacity"
          >
            <Plus size={15} /> {s.newArtifact}
          </button>
          {/* Sign-in / out. Wiki & private artifacts require auth to view,
              so a signed-out visitor needs an obvious way in. */}
          {authChecked && (user ? (
            <button
              onClick={signOut}
              title={`Sign out (${user.email})`}
              className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md border border-line bg-elev text-muted hover:text-ink text-[0.82rem]"
            >
              <LogOut size={13} />
              <span className="hidden md:inline max-w-[120px] truncate">{user.name || user.email}</span>
            </button>
          ) : (
            <Link
              href="/login?next=/artifacts"
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-accent/50 text-accent hover:bg-accent/10 text-[0.82rem] font-medium"
            >
              <LogIn size={13} /> {s.signIn}
            </Link>
          ))}
          <Link
            href="/"
            className="text-[0.8571rem] text-muted hover:text-ink transition-colors"
          >
            ← Wiki
          </Link>
        </div>
      </header>

      {error && (
        <div className="max-w-[1200px] mx-auto px-4 mt-4">
          <div className="text-[0.86rem] text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded px-3 py-2">
            {error}
          </div>
        </div>
      )}

      {/* Body */}
      <div className="max-w-[1200px] mx-auto px-4 py-8">
        <h2 className="text-[0.7143rem] uppercase tracking-[0.10em] text-muted font-medium mb-3">
          {user ? s.yours : s.publicOnly}{!loading && items.length > 0 ? ` · ${items.length}` : ''}
        </h2>

        {/* Signed-out banner — the page stays usable; gated sections lock. */}
        {authChecked && !user && (
          <div className="mb-6 flex items-center gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3">
            <Lock size={16} className="text-amber-300 shrink-0" />
            <div className="flex-1 text-[0.84rem] text-ink">
              {s.bannerPre}<span className="font-medium">{s.bannerPublic}</span>{s.bannerPost}
            </div>
            <Link
              href="/login?next=/artifacts"
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-accent text-paper text-[0.82rem] font-medium hover:opacity-90 shrink-0"
            >
              <LogIn size={13} /> {s.signIn}
            </Link>
          </div>
        )}

        {/* Create tile — only when signed in (publishing requires auth). */}
        {user && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-10">
            <button
              onClick={() => setShowUpload(true)}
              className="group flex flex-col items-center justify-center gap-2 min-h-[150px] rounded-xl border border-dashed border-line hover:border-accent/60 hover:bg-accent/[0.04] transition-colors text-muted hover:text-ink"
            >
              <span className="flex items-center justify-center w-11 h-11 rounded-full border border-line group-hover:border-accent/60 group-hover:text-accent transition-colors">
                <Plus size={20} />
              </span>
              <span className="text-[0.9286rem] font-medium">{s.newArtifact}</span>
              <span className="text-[0.78rem] text-center px-3">{s.newHint}</span>
            </button>
          </div>
        )}

        {loading && items.length === 0 ? (
          <div className="px-4 py-16 text-center text-muted text-[0.9rem]">
            <Loader2 size={16} className="animate-spin inline mr-1.5" /> {s.loading}
          </div>
        ) : (
          // One labeled section per visibility, with a divider between each.
          // When signed out, the non-public sections lock instead of listing.
          VIS_ORDER.map((key) => {
            const sec = s.sections[key];
            const SIcon = VIS_META[key].icon;
            const locked = !user && key !== 'public';
            const group = filtered.filter((a) => a.visibility === key);
            return (
              <section key={key} className="mb-10">
                <div className="flex items-center gap-2">
                  <SIcon size={14} className="text-muted" />
                  <h3 className="font-display text-[1.0714rem] font-medium text-ink tracking-[-0.005em]">
                    {sec.label}
                  </h3>
                  {!locked && <span className="text-[0.78rem] text-muted">{group.length}</span>}
                  <div className="flex-1 h-px bg-line ml-2" />
                </div>
                <p className="text-[0.78rem] text-muted mt-1 mb-3">{sec.blurb}</p>
                {locked ? (
                  <div className="flex items-center gap-3 rounded-xl border border-dashed border-line px-4 py-6 text-muted">
                    <Lock size={15} className="shrink-0" />
                    <span className="text-[0.84rem]">{s.lock(sec.label)}</span>
                    <Link
                      href="/login?next=/artifacts"
                      className="ml-auto text-[0.82rem] text-accent hover:underline"
                    >
                      {s.signIn}
                    </Link>
                  </div>
                ) : group.length === 0 ? (
                  <p className="text-[0.82rem] text-muted/70 italic py-1">
                    {query ? s.noMatch(sec.label) : s.noneYet}
                  </p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {group.map(renderCard)}
                  </div>
                )}
              </section>
            );
          })
        )}
      </div>

      {/* Hidden file input shared by every card's "Version" button. */}
      <input
        ref={versionFileInput}
        type="file"
        className="hidden"
        accept=".html,.htm,.md,.txt,text/html,text/markdown,text/plain"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) uploadVersion(f);
          e.target.value = '';
        }}
      />

      {/* Upload modal — same component as the file-tree publish flow. */}
      {showUpload && (
        <PublishArtifactModal
          mode={{ kind: 'file' }}
          allowPublic={true}
          onClose={() => setShowUpload(false)}
          onPublished={() => setTick((t) => t + 1)}
        />
      )}

      {/* Access-log overlay. */}
      {accessLogFor && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
          onClick={() => setAccessLogFor(null)}
        >
          <div
            className="bg-panel border border-line rounded-lg w-[520px] max-w-full max-h-[80vh] flex flex-col shadow-[0_24px_60px_-12px_rgba(0,0,0,0.7)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-line flex items-center gap-2">
              <Eye size={14} className="text-accent" />
              <h4 className="font-medium text-[0.95rem] flex-1">
                {s.accessLog} · <code>{accessLogFor}</code>
              </h4>
              <button className="text-muted hover:text-ink" onClick={() => setAccessLogFor(null)}>
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-auto px-4 py-3">
              {accessLog === null ? (
                <div className="text-muted text-[0.86rem]">
                  <Loader2 size={13} className="animate-spin inline mr-1" /> {s.loading}
                </div>
              ) : accessLog.length === 0 ? (
                <div className="text-muted text-[0.86rem]">{s.noViews}</div>
              ) : (
                <ul className="text-[0.82rem] divide-y divide-line">
                  {accessLog.map((row, idx) => (
                    <li key={idx} className="py-1.5">
                      <div>
                        <span className="text-ink">{row.user_email || s.anonymous}</span>
                        <span className="text-muted"> · v{row.version}</span>
                        <span className="text-muted"> · {new Date(row.accessed_at).toLocaleString()}</span>
                      </div>
                      {row.ip && <div className="text-muted text-[0.78rem]">{row.ip}</div>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
