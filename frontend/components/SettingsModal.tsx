'use client';
import { useEffect, useState } from 'react';
import {
  X, SlidersHorizontal, Keyboard, Palette, User as UserIcon, Globe,
  Sun, Moon, LogIn, LogOut, RotateCcw, ExternalLink, Sparkles, Check,
} from 'lucide-react';
import { useLanguage } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';
import { api, type User, type UserPreferences } from '@/lib/api';
import { APP_VERSION, compareVersions } from '@/lib/version';
import {
  HOTKEYS, FIXED_HOTKEYS, resolveBindings, formatCombo, eventToCombo,
  type HotkeyId,
} from '@/lib/hotkeys';
import { THEMES } from '@/lib/themes';

type Tab = 'general' | 'hotkeys' | 'appearance';

// Settings-specific copy (中/EN). Hotkey *action* labels reuse the shared
// i18n keys (shortcuts.action.*) via the t() function.
const STR = {
  en: {
    settings: 'Settings', general: 'General', hotkeys: 'Hotkeys', appearance: 'Appearance',
    version: 'Version', upToDate: 'Up to date', update: 'Update available', releases: 'Releases',
    language: 'Language', account: 'Account', signIn: 'Sign in', signOut: 'Sign out',
    signedOut: 'You are signed out.', signInToEdit: 'Sign in to save custom hotkeys to your account.',
    rebind: 'Rebind', reset: 'Reset', resetAll: 'Reset all', press: 'Press keys…', def: 'default',
    theme: 'Theme', mode: 'Mode', light: 'Light', dark: 'Dark',
    soon: 'Custom themes coming soon',
    soonHint: 'You’ll be able to pick generated backgrounds here.',
  },
  zh: {
    settings: '设置', general: '通用', hotkeys: '快捷键', appearance: '外观',
    version: '版本', upToDate: '已是最新', update: '有可用更新', releases: '版本记录',
    language: '语言', account: '账户', signIn: '登录', signOut: '退出登录',
    signedOut: '你尚未登录。', signInToEdit: '登录后可将自定义快捷键保存到你的账户。',
    rebind: '重设', reset: '重置', resetAll: '全部重置', press: '请按下按键…', def: '默认',
    theme: '主题', mode: '明暗模式', light: '浅色', dark: '深色',
    soon: '自定义主题即将上线',
    soonHint: '届时可在此选择生成的背景主题。',
  },
};

function cachedLatest(): { tag: string; outdated: boolean } | null {
  try {
    const raw = localStorage.getItem('wiki:releases:v1');
    if (!raw) return null;
    const { releases } = JSON.parse(raw) as { releases: { tag_name: string; prerelease: boolean }[] };
    const stable = [...releases].filter((r) => !r.prerelease)
      .sort((a, b) => -compareVersions(a.tag_name, b.tag_name));
    const latest = stable[0] ?? releases[0];
    if (!latest) return null;
    return { tag: latest.tag_name, outdated: compareVersions(latest.tag_name, APP_VERSION) > 0 };
  } catch {
    return null;
  }
}

export default function SettingsModal({
  user, onUserChange, onSignOut, onClose, initialTab = 'general',
}: {
  user: User | null;
  onUserChange: (u: User) => void;
  onSignOut: () => void;
  onClose: () => void;
  initialTab?: Tab;
}) {
  const { lang, toggle: toggleLang, t } = useLanguage();
  const { theme, themeId, setTheme, setThemeId } = useTheme();
  const s = STR[lang];
  const [tab, setTab] = useState<Tab>(initialTab);
  const [recording, setRecording] = useState<HotkeyId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const latest = cachedLatest();

  const overrides = user?.preferences?.hotkeys ?? {};
  const bindings = resolveBindings(user?.preferences);

  async function persist(nextHotkeys: Record<string, string>) {
    const next: UserPreferences = { ...(user?.preferences ?? {}), hotkeys: nextHotkeys };
    try {
      const updated = await api.savePreferences(next);
      onUserChange(updated);
    } catch (e: unknown) {
      setError((e as Error).message);
    }
  }
  const saveBinding = (id: HotkeyId, combo: string) => persist({ ...overrides, [id]: combo });
  function resetBinding(id: HotkeyId) {
    const next = { ...overrides };
    delete next[id];
    return persist(next);
  }

  // Appearance (theme + mode). useTheme handles the DOM + localStorage cache
  // instantly; we also save to the account so the choice syncs on login.
  async function saveAppearance(appearance: { themeId: string; mode: string }) {
    if (!user) return;
    try {
      const updated = await api.savePreferences({ ...(user.preferences ?? {}), appearance });
      onUserChange(updated);
    } catch (e: unknown) {
      setError((e as Error).message);
    }
  }
  function applyTheme(id: string) {
    setThemeId(id);
    void saveAppearance({ themeId: id, mode: theme });
  }
  function applyMode(m: 'light' | 'dark') {
    setTheme(m);
    void saveAppearance({ themeId, mode: m });
  }

  // Esc closes the modal (or cancels a rebind first).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (recording) { e.stopPropagation(); setRecording(null); return; }
        onClose();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, recording]);

  // While recording, capture the next complete key combo (capture phase so
  // it doesn't trigger the app's own shortcuts).
  useEffect(() => {
    if (!recording) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') return; // cancel handled above
      e.preventDefault();
      e.stopPropagation();
      const combo = eventToCombo(e);
      if (!combo) return; // modifier-only; keep waiting
      void saveBinding(recording!, combo);
      setRecording(null);
    }
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording]);

  const NAV: { id: Tab; label: string; icon: typeof Keyboard }[] = [
    { id: 'general', label: s.general, icon: SlidersHorizontal },
    { id: 'hotkeys', label: s.hotkeys, icon: Keyboard },
    { id: 'appearance', label: s.appearance, icon: Palette },
  ];

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/55 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-[min(760px,94vw)] h-[min(560px,88vh)] bg-panel border border-line rounded-xl overflow-hidden shadow-[0_24px_60px_-12px_rgba(0,0,0,0.7)] flex"
        onClick={(e) => e.stopPropagation()}
        role="dialog" aria-modal="true" aria-label={s.settings}
      >
        {/* Left nav */}
        <aside className="w-[180px] shrink-0 border-r border-line bg-bg/40 p-3 flex flex-col">
          <div className="flex items-center gap-2 px-2 py-1.5 mb-2">
            <SlidersHorizontal size={14} className="text-accent" />
            <span className="font-display font-medium text-[0.95rem] text-ink">{s.settings}</span>
          </div>
          <nav className="space-y-0.5">
            {NAV.map((n) => (
              <button
                key={n.id}
                onClick={() => setTab(n.id)}
                className={`flex items-center gap-2 w-full px-2.5 py-1.5 rounded-md text-[0.86rem] text-left transition-colors ${
                  tab === n.id ? 'bg-accent/[0.14] text-ink font-medium' : 'text-muted hover:bg-white/[0.05] hover:text-ink'
                }`}
              >
                <n.icon size={14} /> {n.label}
              </button>
            ))}
          </nav>
        </aside>

        {/* Content */}
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="h-11 shrink-0 border-b border-line flex items-center justify-between px-4">
            <span className="text-[0.92rem] font-medium text-ink">{NAV.find((n) => n.id === tab)?.label}</span>
            <button onClick={onClose} className="w-7 h-7 grid place-items-center rounded text-muted hover:text-ink hover:bg-white/[0.06]" aria-label="Close">
              <X size={15} />
            </button>
          </div>

          {error && (
            <div className="mx-4 mt-3 text-[0.8rem] text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded px-3 py-1.5">{error}</div>
          )}

          <div className="flex-1 overflow-y-auto px-5 py-4">
            {tab === 'general' && (
              <div className="space-y-6 max-w-[460px]">
                <Row icon={Sparkles} label={s.version}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-[0.86rem] text-ink">{APP_VERSION}</span>
                    {latest?.outdated ? (
                      <span className="text-[0.74rem] px-1.5 py-0.5 rounded bg-amber-500/15 border border-amber-500/40 text-amber-200">
                        {s.update} · {latest.tag}
                      </span>
                    ) : (
                      <span className="text-[0.74rem] text-muted">{s.upToDate}</span>
                    )}
                    <a href="https://github.com/williamdeng3244/LLM-WIKI/releases" target="_blank" rel="noreferrer"
                       className="inline-flex items-center gap-1 text-[0.78rem] text-accent hover:underline">
                      {s.releases} <ExternalLink size={11} />
                    </a>
                  </div>
                </Row>

                <Row icon={Globe} label={s.language}>
                  <div className="inline-flex rounded-md border border-line overflow-hidden text-[0.82rem]">
                    {(['en', 'zh'] as const).map((l) => (
                      <button key={l} onClick={() => { if (lang !== l) toggleLang(); }}
                        className={`px-3 py-1 ${lang === l ? 'bg-accent text-paper' : 'bg-panel text-muted hover:text-ink'}`}>
                        {l === 'en' ? 'English' : '中文'}
                      </button>
                    ))}
                  </div>
                </Row>

                <Row icon={UserIcon} label={s.account}>
                  {user ? (
                    <div className="flex items-center gap-3 flex-wrap">
                      <div>
                        <div className="text-[0.88rem] text-ink">{user.name || user.email}</div>
                        <div className="text-[0.76rem] text-muted">{user.email} · {user.role}</div>
                      </div>
                      <button onClick={onSignOut}
                        className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-line bg-elev text-muted hover:text-ink text-[0.82rem]">
                        <LogOut size={13} /> {s.signOut}
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3">
                      <span className="text-[0.84rem] text-muted">{s.signedOut}</span>
                      <a href="/login" className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-accent/50 text-accent hover:bg-accent/10 text-[0.82rem] font-medium">
                        <LogIn size={13} /> {s.signIn}
                      </a>
                    </div>
                  )}
                </Row>
              </div>
            )}

            {tab === 'hotkeys' && (
              <div className="max-w-[520px]">
                {!user && (
                  <div className="mb-4 text-[0.82rem] text-amber-200 bg-amber-500/10 border border-amber-500/30 rounded px-3 py-2">{s.signInToEdit}</div>
                )}
                <div className="flex justify-end mb-2">
                  <button onClick={() => persist({})} disabled={!user || Object.keys(overrides).length === 0}
                    className="inline-flex items-center gap-1.5 text-[0.78rem] text-muted hover:text-ink disabled:opacity-40">
                    <RotateCcw size={12} /> {s.resetAll}
                  </button>
                </div>

                <ul className="divide-y divide-line rounded-lg border border-line overflow-hidden">
                  {HOTKEYS.map((h) => {
                    const isOverridden = !!overrides[h.id];
                    const isRec = recording === h.id;
                    return (
                      <li key={h.id} className="flex items-center gap-3 px-3 py-2.5 bg-panel/50">
                        <div className="flex-1 min-w-0">
                          <div className="text-[0.86rem] text-ink truncate">{t(h.labelKey)}</div>
                          <div className="text-[0.72rem] text-muted">{t(`shortcuts.scope.${h.scope}` as 'shortcuts.scope.global')}</div>
                        </div>
                        <kbd className={`inline-flex items-center min-w-[3.2rem] justify-center px-2 py-1 rounded border font-mono text-[0.78rem] ${
                          isRec ? 'border-accent text-accent animate-pulse' : 'border-line bg-elev text-ink'
                        }`}>
                          {isRec ? s.press : formatCombo(bindings[h.id])}
                        </kbd>
                        <button onClick={() => setRecording(isRec ? null : h.id)} disabled={!user}
                          className="text-[0.78rem] text-accent hover:underline disabled:opacity-40 w-[52px] text-right">
                          {isRec ? '…' : s.rebind}
                        </button>
                        <button onClick={() => resetBinding(h.id)} disabled={!user || !isOverridden} title={s.reset}
                          className="text-muted hover:text-ink disabled:opacity-25">
                          <RotateCcw size={13} />
                        </button>
                      </li>
                    );
                  })}
                  {FIXED_HOTKEYS.map((h) => (
                    <li key={h.labelKey} className="flex items-center gap-3 px-3 py-2.5 bg-panel/30">
                      <div className="flex-1 min-w-0">
                        <div className="text-[0.86rem] text-muted truncate">{t(h.labelKey)}</div>
                        <div className="text-[0.72rem] text-muted/70">{t(`shortcuts.scope.${h.scope}` as 'shortcuts.scope.global')}</div>
                      </div>
                      <kbd className="inline-flex items-center min-w-[3.2rem] justify-center px-2 py-1 rounded border border-line bg-elev/60 text-muted font-mono text-[0.78rem]">
                        {formatCombo(h.keys)}
                      </kbd>
                      <span className="w-[52px] text-right text-[0.72rem] text-muted/50">{s.def}</span>
                      <span className="w-[13px]" />
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {tab === 'appearance' && (
              <div className="max-w-[520px] space-y-6">
                {/* Theme gallery — one card per registered theme. Each card
                    shows a light|dark split preview. Selecting applies the
                    theme (mode unchanged). More themes appear here as they're
                    added to lib/themes.ts. */}
                <div>
                  <div className="flex items-center gap-1.5 text-[0.74rem] uppercase tracking-[0.08em] text-muted mb-2">
                    <Palette size={13} /> {s.theme}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {THEMES.map((th) => {
                      const active = themeId === th.id;
                      return (
                        <button
                          key={th.id}
                          onClick={() => applyTheme(th.id)}
                          className={`rounded-lg border text-left overflow-hidden transition-colors ${
                            active ? 'border-accent ring-1 ring-accent/40' : 'border-line hover:border-line-strong'
                          }`}
                        >
                          <div className="flex h-16">
                            <div className="flex-1 relative" style={{ background: th.preview.light.bg }}>
                              <span className="absolute bottom-1.5 left-1.5 w-3 h-3 rounded-full" style={{ background: th.preview.light.accent }} />
                            </div>
                            <div className="flex-1 relative" style={{ background: th.preview.dark.bg }}>
                              <span className="absolute bottom-1.5 left-1.5 w-3 h-3 rounded-full" style={{ background: th.preview.dark.accent }} />
                            </div>
                          </div>
                          <div className="px-2.5 py-1.5">
                            <div className="flex items-center justify-between">
                              <span className="text-[0.84rem] text-ink font-medium">{th.name}</span>
                              {active && <Check size={13} className="text-accent" />}
                            </div>
                            <div className="text-[0.72rem] text-muted leading-snug mt-0.5">{th.description}</div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Light / Dark mode — applies within the selected theme. */}
                <Row icon={theme === 'dark' ? Moon : Sun} label={s.mode}>
                  <div className="inline-flex rounded-md border border-line overflow-hidden text-[0.82rem]">
                    <button onClick={() => applyMode('light')}
                      className={`inline-flex items-center gap-1.5 px-3 py-1 ${theme === 'light' ? 'bg-accent text-paper' : 'bg-panel text-muted hover:text-ink'}`}>
                      <Sun size={13} /> {s.light}
                    </button>
                    <button onClick={() => applyMode('dark')}
                      className={`inline-flex items-center gap-1.5 px-3 py-1 border-l border-line ${theme === 'dark' ? 'bg-accent text-paper' : 'bg-panel text-muted hover:text-ink'}`}>
                      <Moon size={13} /> {s.dark}
                    </button>
                  </div>
                </Row>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ icon: Icon, label, children }: { icon: typeof Keyboard; label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-[0.74rem] uppercase tracking-[0.08em] text-muted mb-2">
        <Icon size={13} /> {label}
      </div>
      {children}
    </div>
  );
}
