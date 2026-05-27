'use client';
import { useCallback, useEffect, useState } from 'react';

export type Lang = 'en' | 'zh';

const KEY = 'wiki:lang';

/**
 * Language hook. Persists choice to localStorage, sets <html lang> so
 * screen readers + browser features (hyphenation, spell-check) follow
 * suit, and emits a `lang:change` custom event.
 *
 * Coverage in v1: topbar (search placeholder, button tooltips) and the
 * User Manual. Other panels stay English until separately translated —
 * add a key to MESSAGES below and replace the inline string with t(key).
 */
export function useLanguage(): {
  lang: Lang;
  setLang: (next: Lang) => void;
  toggle: () => void;
  t: (key: keyof Messages) => string;
} {
  const [lang, setLangState] = useState<Lang>('en');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const saved = localStorage.getItem(KEY) as Lang | null;
    let value: Lang = 'en';
    if (saved === 'en' || saved === 'zh') {
      value = saved;
    } else {
      // First visit: take a hint from the browser. Chinese (any region) → zh.
      const nav = (navigator.language || '').toLowerCase();
      if (nav.startsWith('zh')) value = 'zh';
    }
    setLangState(value);
    document.documentElement.setAttribute('lang', value === 'zh' ? 'zh-Hans' : 'en');
  }, []);

  // Every useLanguage() call has its own React state. Without this listener,
  // flipping the topbar toggle would update only the topbar; other consumers
  // (PageView, file/folder context menus, etc.) would render stale strings
  // until their own component happened to re-mount. Subscribe to the
  // `lang:change` event our own setLang fires so every instance syncs.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    function onLangChange(e: Event) {
      const detail = (e as CustomEvent<{ to?: Lang }>).detail;
      if (detail?.to === 'en' || detail?.to === 'zh') {
        setLangState(detail.to);
        document.documentElement.setAttribute(
          'lang',
          detail.to === 'zh' ? 'zh-Hans' : 'en',
        );
      }
    }
    window.addEventListener('lang:change', onLangChange);
    return () => window.removeEventListener('lang:change', onLangChange);
  }, []);

  const setLang = useCallback((next: Lang) => {
    setLangState((prev) => {
      if (prev === next) return prev;
      if (typeof window !== 'undefined') {
        document.documentElement.setAttribute(
          'lang',
          next === 'zh' ? 'zh-Hans' : 'en',
        );
        try { localStorage.setItem(KEY, next); } catch { /* quota */ }
        window.dispatchEvent(new CustomEvent('lang:change', {
          detail: { from: prev, to: next },
        }));
      }
      return next;
    });
  }, []);

  const toggle = useCallback(() => {
    setLang(lang === 'en' ? 'zh' : 'en');
  }, [lang, setLang]);

  const t = useCallback(
    (key: keyof Messages) => MESSAGES[lang][key] ?? MESSAGES.en[key] ?? String(key),
    [lang],
  );

  return { lang, setLang, toggle, t };
}

// ── Dictionary ────────────────────────────────────────────────────────
// Keep this flat so the type system catches typos and missing-key cases.

type Messages = typeof MESSAGES.en;

export const MESSAGES = {
  en: {
    // Topbar
    'topbar.brand': 'Enflame Wiki',
    'topbar.search.placeholder': 'Search pages, content, code…',
    'topbar.theme.toLight': 'Switch to light theme',
    'topbar.theme.toDark': 'Switch to dark theme',
    'topbar.lang.toggle.title': 'Switch language · 切换语言',
    'topbar.role.title': 'View as role (dev only)',
    'topbar.role.reader': 'Reader',
    'topbar.role.contributor': 'Contributor',
    'topbar.role.editor': 'Editor',
    'topbar.role.admin': 'Admin',
    'topbar.suggest': 'Suggest',
    'topbar.suggest.title': 'Suggest edit (⌘E)',
    'topbar.review.title': 'Review queue',
    'topbar.notifications.title': 'Notifications',
    'topbar.sources.title': 'Raw sources',
    'topbar.schema.title': 'Agent playbook (schema)',
    'topbar.lint.title': 'Wiki lint (admin)',
    'topbar.mcp.title': 'MCP access — connect external LLM clients',
    'topbar.manual.title': 'User manual — what each icon does',
    'topbar.manual.ariaLabel': 'Open user manual',

    // User manual chrome
    'manual.header': 'User manual',
    'manual.subtitle': 'What does each icon do?',
    'manual.cta.title': 'Open the full help docs',
    'manual.cta.subtitle': 'Detailed user guide · opens in a new tab',
    'manual.cta.action': 'Open',
    'manual.footer.prefix': 'More detail in the ',
    'manual.footer.link': 'project README',
    'manual.footer.suffix': '.',
    'manual.shortcuts.hint': 'Tip: press ⌘? for the keyboard-shortcut sheet.',

    // Shortcut sheet
    'shortcuts.title': 'Keyboard shortcuts',
    'shortcuts.subtitle': 'Hold ⌘ on macOS, Ctrl elsewhere.',
    'shortcuts.col.shortcut': 'Shortcut',
    'shortcuts.col.action': 'Action',
    'shortcuts.col.scope': 'Scope',
    'shortcuts.scope.global': 'Global',
    'shortcuts.scope.tabs': 'Tabs',
    'shortcuts.scope.dialog': 'Dialogs',
    'shortcuts.action.search': 'Open search',
    'shortcuts.action.switcher': 'Open quick switcher',
    'shortcuts.action.suggest': 'Suggest edit on current page',
    'shortcuts.action.newTab': 'New tab',
    'shortcuts.action.closeTab': 'Close current tab',
    'shortcuts.action.nextTab': 'Next tab',
    'shortcuts.action.prevTab': 'Previous tab',
    'shortcuts.action.escape': 'Close popover / dialog',
    'shortcuts.action.help': 'Show this sheet',
    'shortcuts.footer': 'Bracket-style shortcuts (⌘+key) on Mac use the Command key; Windows/Linux use Ctrl.',

    // Help page chrome
    'help.title': 'Enflame Wiki — Help',
    'help.subtitle': 'User guide',
    'help.brand.tagline': 'Internal knowledge base · LLM-Wiki',
    'help.nav.heading': 'Topics',
    'help.toc.heading': 'On this page',
    'help.search.placeholder': 'Search the docs…',
    'help.search.noResults': 'No matches.',
    'help.footer.repo': 'View the source on GitHub',
    'help.footer.copyright': '© Enflame Wiki — built on the LLM-Wiki idea.',
    'help.nav.welcome': 'Welcome',
    'help.nav.reading': 'Reading & navigation',
    'help.nav.authoring': 'Authoring',
    'help.nav.reviewing': 'Reviewing',
    'help.nav.graph': 'Graph view',
    'help.nav.ingest': 'Raw sources & ingest',
    'help.nav.lint': 'Wiki lint',
    'help.nav.mcp': 'MCP integration',
    'help.nav.shortcuts': 'Keyboard shortcuts',
    'help.nav.themes': 'Themes & display',
    'help.nav.faq': 'FAQ',

    // Version log (bottom-left badge)
    'version.label': 'Version',
    'version.upToDate': 'Up to date',
    'version.update.available': 'Update available',
    'version.update.cta': 'View on GitHub →',
    'version.panel.title': 'Release history',
    'version.panel.recent': 'Recent releases',
    'version.panel.empty': 'No releases found.',
    'version.panel.loading': 'Loading…',
    'version.panel.checkFailed': 'Could not reach GitHub. Showing the bundled version only.',

    // File tree toolbar (above the file list)
    'tree.newNote': 'New note',
    'tree.newFolder': 'New folder',
    'tree.sort.asc': 'Sort: A → Z',
    'tree.sort.desc': 'Sort: Z → A',
    'tree.collapseAll': 'Collapse all',
    'tree.expandAll': 'Expand all',
    'tree.graph2d': 'Graph (2D)',
    'tree.graph3d': 'Graph (3D)',

    // File right-click context menu
    'menu.file.openNewTab': 'Open in new tab',
    'menu.file.suggest': 'Suggest edit',
    'menu.file.suggest.disabled': 'Readers cannot suggest edits',
    'menu.file.copy': 'Make a copy',
    'menu.file.copy.disabled': 'Readers cannot create drafts',
    'menu.file.copyPath': 'Copy path',
    'menu.file.history': 'Open version history',
    'menu.file.bookmark': 'Bookmark…',
    'menu.file.bookmark.disabled': 'Coming soon',
    'menu.file.move': 'Move file to…',
    'menu.file.delete': 'Delete',
    'menu.file.backendNotWired': 'Backend support not yet wired',

    // Folder right-click context menu
    'menu.folder.newNote': 'New note in folder',
    'menu.folder.rename': 'Rename folder…',
    'menu.folder.rename.disabled': 'Only user-created folders can be renamed',
    'menu.folder.rename.prompt': 'Rename folder:',
    'menu.folder.copyPath': 'Copy folder path',
    'menu.folder.delete': 'Delete folder',
    'menu.folder.delete.notCustom': 'Only user-created folders can be deleted',
    'menu.folder.delete.notEmpty': 'Folder contains pages — move or delete them first',

    // PageView toolbar (top of every page tab)
    'page.toolbar.suggest': 'Suggest edit',
    'page.toolbar.flag': 'Flag',
    'page.toolbar.lock': 'Lock',
    'page.toolbar.unlock': 'Unlock',
    'page.toolbar.more': 'More actions',
    'page.flag.incorrect': 'Incorrect',
    'page.flag.outdated': 'Outdated',
    'page.flag.needsSource': 'Needs source',
    'page.flag.promptIncorrect': 'Why is this incorrect?',
    'page.flag.promptOutdated': 'Why is this outdated?',
    'page.flag.promptNeedsSource': 'What source is needed?',

    // PageView kebab "More actions" menu items
    'menu.page.readingView': 'Reading view',
    'menu.page.readingView.hint': 'Inline editing is not available yet — pages always render in reading view',
    'menu.page.rename': 'Rename…',
    'menu.page.move': 'Move file to…',
    'menu.page.bookmark': 'Bookmark…',
    'menu.page.bookmark.hint': 'Coming soon',
    'menu.page.merge': 'Merge entire file with…',
    'menu.page.merge.hint': 'Not yet implemented',
    'menu.page.addProp': 'Add file property',
    'menu.page.addProp.hint': 'Use the tags field in Suggest edit for now',
    'menu.page.export': 'Export to PDF…',
    'menu.page.find': 'Find…',
    'menu.page.find.hint': 'Use Ctrl+F (browser find) for now',
    'menu.page.replace': 'Replace…',
    'menu.page.replace.hint': 'No editor available yet',
    'menu.page.copyPath': 'Copy path',
    'menu.page.history': 'Open version history',
    'menu.page.linked': 'Open linked view',
    'menu.page.linked.hint': 'Outline panel not yet implemented',
    'menu.page.reveal': 'Reveal file in navigation',
    'menu.page.delete': 'Delete file',
    'menu.page.backendNotWired': 'Backend support not yet wired',

    // PageView metadata strip + body
    'page.meta.updated': 'Updated',
    'page.meta.lastEditBy': 'Last edit by',
    'page.meta.revisions.one': '{n} revision',
    'page.meta.revisions.many': '{n} revisions',
    'page.meta.historyTitle': 'Open version history',
    'page.backlinks.title': 'Backlinks',
    'page.backlinks.empty': 'No backlinks yet.',
    'page.comments.title': 'Comments',
    'page.comments.empty': 'No comments yet.',
    'page.comments.placeholder': 'Comment…',
    'page.comments.post': 'Post',
    'page.flags.banner.one': 'open flag',
    'page.flags.banner.many': 'open flags',
    'page.flags.banner.more': 'more',

    // Chat panel
    'chat.assistant': 'Assistant',
    'chat.intro': 'Ask anything about the wiki. Answers cite only published content.',
    'chat.intro.wiki': 'Wiki mode: synthesizes across full pages and follows [[wikilinks]]. Best for "explain this concept" questions.',
    'chat.intro.sources': 'Sources mode: chunk-level retrieval with line-range citations. Best for "where is X documented" questions.',
    'chat.clear': 'Clear chat',
    'chat.collapse': 'Collapse chat panel',
    'chat.expand': 'Expand chat panel',
    'chat.input.placeholder': 'Ask the wiki…',
    'chat.send': 'Send',
    'chat.mode.sources': 'Sources mode — chunk-level RAG with line-range citations',
    'chat.mode.wiki': 'Wiki mode — synthesize from full pages, follow [[wikilinks]]',

    // Graph view buttons + timelapse
    'graph.timelapse.play': 'Play timelapse — watch the wiki grow chronologically',
    'graph.timelapse.stop': 'Stop timelapse',
    'graph.timelapse.counter': '{current} / {total} pages',

    // Graph settings panel
    'graphSettings.title': 'Graph Settings',
    'graphSettings.section.display': 'Display',
    'graphSettings.section.forces': 'Forces',
    'graphSettings.section.colors': 'Colors',
    'graphSettings.nodeSize': 'Node size',
    'graphSettings.lineThickness': 'Line thickness',
    'graphSettings.glow': 'Glow',
    'graphSettings.centerForce': 'Center force',
    'graphSettings.repelForce': 'Repel force',
    'graphSettings.linkForce': 'Link force',
    'graphSettings.linkDistance': 'Link distance',
    'graphSettings.bgMotion': 'Background motion',
    'graphSettings.reset': 'Reset',
    'graphSettings.resetTitle': 'Reset all graph settings',

    // Sources panel
    'sources.title': 'Raw sources',
    'sources.dropHere': 'Drop files here, or',
    'sources.browse': 'browse',
    'sources.signInToUpload': 'Sign in as contributor or higher to upload.',
    'sources.openLatest': 'Open the latest plan / run',
    'sources.ingestTitle': 'Plan an ingest — agent reads the source, you review proposed edits before any drafts are created.',
    'sources.ingest': 'Ingest',
    'sources.history': 'Show ingest history',
    'sources.download': 'Download',
    'sources.empty': 'No sources uploaded yet.',

    // Schema editor (agent playbook)
    'schema.title': 'Agent playbook',
    'schema.discard': 'Discard local edits',
    'schema.save': 'Save',
    'schema.saved': 'Saved',
    'schema.unsaved': 'Unsaved changes',
    'schema.adminOnly': 'Admin only — this is the system prompt the ingest agent follows.',

    // Lint panel
    'lint.title': 'Wiki lint',
    'lint.runLint': 'Run lint',
    'lint.runLintTitle': 'Queue a new lint pass',
    'lint.empty': 'No lint reports yet. Click {action} to start one.',
    'lint.dismissNote': 'Dismiss note',
    'lint.openPage': 'Open this page',
    'lint.suggestEdit': 'Open Suggest edit on this page',

    // MCP access panel
    'mcp.title': 'MCP access',
    'mcp.tokenCopy': 'Copy',
    'mcp.tokenCopied': 'Copied',
    'mcp.tokenSavedHint': 'Save this token now — it won\'t be shown again.',
    'mcp.tokenDismiss': 'Dismiss',
    'mcp.namePlaceholder': "Token name (e.g. 'Claude Desktop on laptop')",
    'mcp.create': 'Create token',
    'mcp.creating': 'Creating…',
    'mcp.activeNone': 'No active tokens.',
    'mcp.revoke': 'Revoke',

    // Propose dialog
    'propose.title.new': 'Propose a new page',
    'propose.title.edit': 'Suggest edit',
    'propose.edit': 'Edit',
    'propose.split': 'Split',
    'propose.preview': 'Preview',
    'propose.close': 'Close',
    'propose.submit': 'Submit for review',
    'propose.saveDraft': 'Save draft',
    'propose.stability.open': 'Open page — auto-publishes on submit.',
    'propose.stability.stable': 'Stable page — goes to the review queue.',
    'propose.stability.locked': 'Locked page — admin review required.',

    // Propose dialog form fields
    'propose.field.path': 'Path',
    'propose.field.path.placeholder': 'engineering/new-thing',
    'propose.field.category': 'Category',
    'propose.field.title': 'Title',
    'propose.field.tags': 'Tags (comma-separated)',
    'propose.field.tags.placeholder': 'architecture, database',
    'propose.field.rationale.placeholder': 'Rationale — why are you proposing this change?',
    'propose.markdown': 'Markdown',
    'propose.preview.empty': 'Nothing to preview yet.',
    'propose.cancel': 'Cancel',
    'propose.submit.action': 'Submit for review',
    'propose.submitting': 'Submitting…',
    'propose.body.placeholder': '# Your page title\n\nWrite in markdown. Use [[wiki-links]] to link to other pages.',
    'propose.category.engineering': 'Engineering',
    'propose.category.product': 'Product',
    'propose.category.design': 'Design',
    'propose.category.operations': 'Operations',
    'propose.category.research': 'Research',
    'propose.category.sources': 'Sources',

    // Review queue
    'review.title': 'Review queue',
    'review.empty': 'No revisions awaiting review.',
    'review.rev': 'rev',
    'review.byAuthor': 'by',
    'review.tab.diff': 'Diff',
    'review.tab.preview': 'Preview',
    'review.tab.raw': 'Raw',
    'review.agentAuthored': 'Agent-authored',
    'review.conflict': 'Conflict',
    'review.sourceGrounding': 'Source grounding',
    'review.sourceGrounding.count': '{n} citation(s)',
    'review.sourceGrounding.expand': 'Show source grounding',
    'review.sourceGrounding.collapse': 'Hide source grounding',
    'review.confidence': 'confidence',
    'review.feedback.heading': 'Reviewer feedback (optional, agent drafts only)',
    'review.feedback.reason.placeholder': '— Reject reason —',
    'review.feedback.reason.wrong_page': 'Wrong page',
    'review.feedback.reason.unsupported_claim': 'Unsupported claim',
    'review.feedback.reason.bad_summary': 'Bad summary',
    'review.feedback.reason.duplicate': 'Duplicate',
    'review.feedback.reason.wrong_tags': 'Wrong tags',
    'review.feedback.reason.too_broad': 'Too broad',
    'review.feedback.reason.too_speculative': 'Too speculative',
    'review.feedback.reason.permission_concern': 'Permission concern',
    'review.feedback.reason.formatting_issue': 'Formatting issue',
    'review.feedback.reason.other': 'Other',
    'review.feedback.notes.placeholder': 'Notes (consumed by future ingest prompts)',
    'review.decision.comment.placeholder': 'Comment (optional, shown to the author)',
    'review.decision.reject': 'Reject',
    'review.decision.reject.title': 'Reject this proposal',
    'review.decision.requestChanges': 'Request changes',
    'review.decision.requestChanges.title': 'Send back to author',
    'review.decision.accept': 'Accept and publish',
    'review.decision.accept.title': 'Accept and publish',

    // Section headings
    'manual.section.reading': 'Reading & search',
    'manual.section.authoring': 'Authoring',
    'manual.section.reviewing': 'Reviewing (editors & admins)',
    'manual.section.graph': 'Graph view',
    'manual.section.ingest': 'Ingest & lint',
    'manual.section.integration': 'Integration',
    'manual.section.chrome': 'Chrome',

    // Item titles
    'manual.search.title': 'Search',
    'manual.search.body':
      'Chunk-level full-text + vector search across published pages. Results show snippets with the matched page path; click to navigate. Best for finding "where is X documented?".',
    'manual.switcher.title': 'Quick switcher',
    'manual.switcher.body':
      'Fuzzy-find any page by title or path. Recently opened pages surface first. Faster than the file tree when you already know the title.',
    'manual.chat.title': 'Chat panel',
    'manual.chat.body':
      'Right column. Two modes: Sources cites individual chunks with line ranges (precise "where is X" answers); Wiki synthesizes from full pages and follows [[wikilinks]] (good for "explain this concept" questions).',

    'manual.suggest.title': 'Suggest edit',
    'manual.suggest.body':
      'Opens the propose dialog. Your draft enters the review pipeline; an editor approves or rejects it before it lands on the live page. Available to contributors and above.',
    'manual.newNote.title': 'New note',
    'manual.newNote.body':
      'In the file-tree toolbar. Opens the propose dialog in "create new" mode — even if you have a page open, it starts fresh instead of editing the current page.',
    'manual.newFolder.title': 'New folder',
    'manual.newFolder.body':
      'Inline-creates an empty folder in the tree. Used to organize where new notes live; pages with paths under that folder appear nested inside it.',
    'manual.history.title': 'Version history',
    'manual.history.body':
      'Right-click any page in the tree → Version history (or the kebab menu on the page itself). Shows every accepted revision with diffs.',

    'manual.review.title': 'Review queue',
    'manual.review.body':
      'Lists every proposed revision waiting on you. Side-by-side diff, accept or reject with a reason. Editors only see queues for their assigned categories; admins see everything. Badge shows count.',

    'manual.graph.title': '2D / 3D graph',
    'manual.graph.body':
      'Visualizes the wiki as nodes (pages) and edges (links). Switch between flat 2D and orbital 3D from the toolbar. Hovering a node highlights its neighbors; hovering a folder in the tree lights up its pages.',
    'manual.timelapse.title': 'Timelapse',
    'manual.timelapse.body':
      '2D-only. Plays the graph back chronologically, page by page, in order of creation. Watch the wiki grow.',

    'manual.sources.title': 'Sources panel',
    'manual.sources.body':
      'Upload raw input documents (PDF, markdown, images). Each source can be ingested by the AI agent, which proposes structured edits to merge that source into the wiki. Edits route through normal review.',
    'manual.playbook.title': 'Agent playbook',
    'manual.playbook.body':
      'The system prompt the ingest agent follows when merging raw sources. Admins edit this to change ingest behavior — e.g. "always cite the original page numbers" or "never create top-level pages".',
    'manual.lint.title': 'Wiki lint (admin)',
    'manual.lint.body':
      'Asks the agent to scan the entire wiki for orphans, broken wikilinks, contradictions, and stale claims. Read-only — surfaces findings as a list of actionable issues; no auto-edits.',

    'manual.mcp.title': 'MCP access',
    'manual.mcp.body':
      'Create a personal API token to plug the wiki into MCP-capable LLM clients (Claude Desktop, Cursor, etc.) as if it were a tool. The token authenticates as you, so your existing role/permissions still apply.',

    'manual.theme.title': 'Theme toggle',
    'manual.theme.body':
      'Switch between dark and light themes. Background videos cross-fade smoothly between modes. Preference is remembered across reloads.',
    'manual.notif.title': 'Notifications',
    'manual.notif.body':
      'Toast log for review outcomes, comments, and mentions. Badge shows unread count. Click an entry to jump to the relevant page or queue.',
    'manual.tabs.title': 'Tabs',
    'manual.tabs.body':
      'Open multiple pages or graph views in tabs at the top of the center pane. Right-click a tab for split / reveal / close options. Tabs persist across reloads.',
    'manual.chatCollapse.title': 'Collapsible chat panel',
    'manual.chatCollapse.body':
      'Click the panel-close icon in the chat header to collapse the assistant into a thin 40 px rail; click again to expand. State persists across reloads. Conversation history, mode (Sources/Wiki), and any draft input are preserved while collapsed — nothing is reset.',
    'manual.pageLayout.title': 'Page layout',
    'manual.pageLayout.body':
      'Pages render Obsidian-style: a slim toolbar at the top (path + actions), the title scrolling with the body, a metadata strip under the title (Updated · Last edit by · stability · revisions · tags), the markdown body, and backlinks at the bottom. Reading column caps at ~820 px and centers — collapse the chat panel for a roomier reading view.',
    'manual.versionLog.title': 'Version log',
    'manual.versionLog.body':
      'Bottom-left badge showing the running version (e.g. v0.5.0). Click for a compact list of recent releases — each row jumps to the GitHub release page. Polls the Releases API hourly; when a newer tag exists, the badge turns amber.',
    'manual.langToggle.title': 'Language toggle',
    'manual.langToggle.body':
      '中/EN button in the top bar. Switches the entire chrome — topbar, menus, prompts, kebabs, panels, manual, and /help docs — between Mandarin and English instantly. Choice is shared across the wiki and the help site via localStorage.',
  },

  zh: {
    // Topbar
    'topbar.brand': 'Enflame Wiki',
    'topbar.search.placeholder': '搜索页面、内容、代码…',
    'topbar.theme.toLight': '切换到浅色主题',
    'topbar.theme.toDark': '切换到深色主题',
    'topbar.lang.toggle.title': '切换语言 · Switch language',
    'topbar.role.title': '以指定身份查看（仅开发环境）',
    'topbar.role.reader': '只读',
    'topbar.role.contributor': '贡献者',
    'topbar.role.editor': '编辑',
    'topbar.role.admin': '管理员',
    'topbar.suggest': '建议编辑',
    'topbar.suggest.title': '建议编辑（⌘E）',
    'topbar.review.title': '审核队列',
    'topbar.notifications.title': '通知',
    'topbar.sources.title': '原始资料',
    'topbar.schema.title': '智能体手册（Schema）',
    'topbar.lint.title': '维基检查（管理员）',
    'topbar.mcp.title': 'MCP 接入——连接外部大模型客户端',
    'topbar.manual.title': '用户手册——每个图标的功能',
    'topbar.manual.ariaLabel': '打开用户手册',

    // User manual chrome
    'manual.header': '用户手册',
    'manual.subtitle': '每个图标分别做什么？',
    'manual.cta.title': '打开完整帮助文档',
    'manual.cta.subtitle': '详细使用说明 · 在新标签页中打开',
    'manual.cta.action': '打开',
    'manual.footer.prefix': '更多细节请参见 ',
    'manual.footer.link': '项目 README',
    'manual.footer.suffix': '。',
    'manual.shortcuts.hint': '提示：按 ⌘? 打开快捷键速查表。',

    // Shortcut sheet
    'shortcuts.title': '键盘快捷键',
    'shortcuts.subtitle': 'macOS 上按住 ⌘，其它平台按 Ctrl。',
    'shortcuts.col.shortcut': '快捷键',
    'shortcuts.col.action': '功能',
    'shortcuts.col.scope': '范围',
    'shortcuts.scope.global': '全局',
    'shortcuts.scope.tabs': '标签页',
    'shortcuts.scope.dialog': '对话框',
    'shortcuts.action.search': '打开搜索',
    'shortcuts.action.switcher': '打开快速切换',
    'shortcuts.action.suggest': '对当前页面提出编辑建议',
    'shortcuts.action.newTab': '新建标签页',
    'shortcuts.action.closeTab': '关闭当前标签页',
    'shortcuts.action.nextTab': '下一个标签页',
    'shortcuts.action.prevTab': '上一个标签页',
    'shortcuts.action.escape': '关闭悬浮层 / 对话框',
    'shortcuts.action.help': '显示本快捷键表',
    'shortcuts.footer': 'Mac 上 ⌘+键 使用 Command 键；Windows/Linux 上使用 Ctrl。',

    // Help page chrome
    'help.title': 'Enflame Wiki — 帮助',
    'help.subtitle': '用户指南',
    'help.brand.tagline': '内部知识库 · LLM-Wiki',
    'help.nav.heading': '主题',
    'help.toc.heading': '本页目录',
    'help.search.placeholder': '搜索文档…',
    'help.search.noResults': '无匹配项。',
    'help.footer.repo': '在 GitHub 上查看源代码',
    'help.footer.copyright': '© Enflame Wiki — 基于 LLM-Wiki 思路构建。',
    'help.nav.welcome': '欢迎',
    'help.nav.reading': '阅读与导航',
    'help.nav.authoring': '内容创作',
    'help.nav.reviewing': '审核流程',
    'help.nav.graph': '图谱视图',
    'help.nav.ingest': '原始资料与导入',
    'help.nav.lint': '维基检查',
    'help.nav.mcp': 'MCP 集成',
    'help.nav.shortcuts': '键盘快捷键',
    'help.nav.themes': '主题与显示',
    'help.nav.faq': '常见问题',

    // Version log (bottom-left badge)
    'version.label': '版本',
    'version.upToDate': '已是最新',
    'version.update.available': '有新版本',
    'version.update.cta': '在 GitHub 上查看 →',
    'version.panel.title': '版本历史',
    'version.panel.recent': '近期发布',
    'version.panel.empty': '暂无发布版本。',
    'version.panel.loading': '加载中…',
    'version.panel.checkFailed': '无法连接 GitHub，仅显示当前打包版本。',

    // File tree toolbar (above the file list)
    'tree.newNote': '新建笔记',
    'tree.newFolder': '新建文件夹',
    'tree.sort.asc': '排序：A → Z',
    'tree.sort.desc': '排序：Z → A',
    'tree.collapseAll': '全部折叠',
    'tree.expandAll': '全部展开',
    'tree.graph2d': '图谱（2D）',
    'tree.graph3d': '图谱（3D）',

    // File right-click context menu
    'menu.file.openNewTab': '在新标签页打开',
    'menu.file.suggest': '建议编辑',
    'menu.file.suggest.disabled': '只读用户无法建议编辑',
    'menu.file.copy': '创建副本',
    'menu.file.copy.disabled': '只读用户无法创建草稿',
    'menu.file.copyPath': '复制路径',
    'menu.file.history': '查看版本历史',
    'menu.file.bookmark': '收藏…',
    'menu.file.bookmark.disabled': '即将推出',
    'menu.file.move': '移动到…',
    'menu.file.delete': '删除',
    'menu.file.backendNotWired': '后端尚未实现',

    // Folder right-click context menu
    'menu.folder.newNote': '在此文件夹中新建笔记',
    'menu.folder.rename': '重命名文件夹…',
    'menu.folder.rename.disabled': '仅可重命名用户创建的文件夹',
    'menu.folder.rename.prompt': '重命名文件夹：',
    'menu.folder.copyPath': '复制文件夹路径',
    'menu.folder.delete': '删除文件夹',
    'menu.folder.delete.notCustom': '仅可删除用户创建的文件夹',
    'menu.folder.delete.notEmpty': '文件夹中含有页面——请先移走或删除',

    // PageView toolbar (top of every page tab)
    'page.toolbar.suggest': '建议编辑',
    'page.toolbar.flag': '标记',
    'page.toolbar.lock': '锁定',
    'page.toolbar.unlock': '解锁',
    'page.toolbar.more': '更多操作',
    'page.flag.incorrect': '内容有误',
    'page.flag.outdated': '已过期',
    'page.flag.needsSource': '需要来源',
    'page.flag.promptIncorrect': '请说明哪里有误：',
    'page.flag.promptOutdated': '请说明哪里过期：',
    'page.flag.promptNeedsSource': '需要什么来源？',

    // PageView kebab "More actions" menu items
    'menu.page.readingView': '阅读模式',
    'menu.page.readingView.hint': '当前尚未支持行内编辑——页面始终以阅读模式渲染',
    'menu.page.rename': '重命名…',
    'menu.page.move': '移动到…',
    'menu.page.bookmark': '收藏…',
    'menu.page.bookmark.hint': '即将推出',
    'menu.page.merge': '合并到另一文件…',
    'menu.page.merge.hint': '尚未实现',
    'menu.page.addProp': '添加文件属性',
    'menu.page.addProp.hint': '请暂用"建议编辑"中的 tags 字段',
    'menu.page.export': '导出为 PDF…',
    'menu.page.find': '查找…',
    'menu.page.find.hint': '请暂用浏览器的 Ctrl+F',
    'menu.page.replace': '替换…',
    'menu.page.replace.hint': '暂无可用编辑器',
    'menu.page.copyPath': '复制路径',
    'menu.page.history': '查看版本历史',
    'menu.page.linked': '打开关联视图',
    'menu.page.linked.hint': '大纲面板尚未实现',
    'menu.page.reveal': '在导航中定位',
    'menu.page.delete': '删除文件',
    'menu.page.backendNotWired': '后端尚未实现',

    // PageView metadata strip + body
    'page.meta.updated': '更新于',
    'page.meta.lastEditBy': '最近编辑者',
    'page.meta.revisions.one': '{n} 次修订',
    'page.meta.revisions.many': '{n} 次修订',
    'page.meta.historyTitle': '查看版本历史',
    'page.backlinks.title': '反向链接',
    'page.backlinks.empty': '暂无反向链接。',
    'page.comments.title': '评论',
    'page.comments.empty': '暂无评论。',
    'page.comments.placeholder': '评论…',
    'page.comments.post': '发布',
    'page.flags.banner.one': '个未处理标记',
    'page.flags.banner.many': '个未处理标记',
    'page.flags.banner.more': '更多',

    // Chat panel
    'chat.assistant': 'AI 助手',
    'chat.intro': '关于维基的任何问题都可以提问。回答只会引用已发布的内容。',
    'chat.intro.wiki': 'Wiki 模式：综合整页内容并跟随 [[wikilinks]]。适合"解释这个概念"类问题。',
    'chat.intro.sources': 'Sources 模式：按片段检索，附带行号引用。适合"X 在哪里有记录"类问题。',
    'chat.clear': '清空对话',
    'chat.collapse': '收起对话面板',
    'chat.expand': '展开对话面板',
    'chat.input.placeholder': '向维基提问…',
    'chat.send': '发送',
    'chat.mode.sources': 'Sources 模式 — 按片段检索，附带行号引用',
    'chat.mode.wiki': 'Wiki 模式 — 综合整页内容，跟随 [[wikilinks]]',

    // Graph view buttons + timelapse
    'graph.timelapse.play': '播放时间回放 — 按时间顺序观看维基的成长',
    'graph.timelapse.stop': '停止时间回放',
    'graph.timelapse.counter': '{current} / {total} 个页面',

    // Graph settings panel
    'graphSettings.title': '图谱设置',
    'graphSettings.section.display': '显示',
    'graphSettings.section.forces': '力学参数',
    'graphSettings.section.colors': '颜色',
    'graphSettings.nodeSize': '节点大小',
    'graphSettings.lineThickness': '连线粗细',
    'graphSettings.glow': '辉光',
    'graphSettings.centerForce': '中心力',
    'graphSettings.repelForce': '排斥力',
    'graphSettings.linkForce': '连接力',
    'graphSettings.linkDistance': '连线距离',
    'graphSettings.bgMotion': '背景动效',
    'graphSettings.reset': '重置',
    'graphSettings.resetTitle': '重置所有图谱设置',

    // Sources panel
    'sources.title': '原始资料',
    'sources.dropHere': '将文件拖到这里，或',
    'sources.browse': '浏览',
    'sources.signInToUpload': '请以贡献者及以上身份登录后再上传。',
    'sources.openLatest': '打开最新的计划 / 运行记录',
    'sources.ingestTitle': '触发 ingest — 智能体阅读资料并提出建议编辑，需经你审核后才会生成草稿。',
    'sources.ingest': '导入',
    'sources.history': '查看 ingest 历史',
    'sources.download': '下载',
    'sources.empty': '尚未上传任何资料。',

    // Schema editor (agent playbook)
    'schema.title': '智能体手册',
    'schema.discard': '放弃本地修改',
    'schema.save': '保存',
    'schema.saved': '已保存',
    'schema.unsaved': '有未保存的修改',
    'schema.adminOnly': '仅管理员可见 — 此为 ingest 智能体所遵循的系统提示词。',

    // Lint panel
    'lint.title': '维基检查',
    'lint.runLint': '运行检查',
    'lint.runLintTitle': '触发一次新的 lint 扫描',
    'lint.empty': '暂无 lint 报告。点击 {action} 触发一次。',
    'lint.dismissNote': '驳回理由',
    'lint.openPage': '打开此页面',
    'lint.suggestEdit': '在此页面打开「建议编辑」',

    // MCP access panel
    'mcp.title': 'MCP 接入',
    'mcp.tokenCopy': '复制',
    'mcp.tokenCopied': '已复制',
    'mcp.tokenSavedHint': '请立即保存 Token——它仅显示这一次。',
    'mcp.tokenDismiss': '关闭',
    'mcp.namePlaceholder': 'Token 名称（如 "Claude Desktop on laptop"）',
    'mcp.create': '创建 Token',
    'mcp.creating': '创建中…',
    'mcp.activeNone': '当前没有可用的 Token。',
    'mcp.revoke': '吊销',

    // Propose dialog
    'propose.title.new': '提议新页面',
    'propose.title.edit': '建议编辑',
    'propose.edit': '编辑',
    'propose.split': '分屏',
    'propose.preview': '预览',
    'propose.close': '关闭',
    'propose.submit': '提交审核',
    'propose.saveDraft': '保存草稿',
    'propose.stability.open': 'Open 页面 — 提交后自动发布。',
    'propose.stability.stable': 'Stable 页面 — 提交进入审核队列。',
    'propose.stability.locked': 'Locked 页面 — 需要管理员审核。',

    // Propose dialog form fields
    'propose.field.path': '路径',
    'propose.field.path.placeholder': 'engineering/new-thing',
    'propose.field.category': '分类',
    'propose.field.title': '标题',
    'propose.field.tags': '标签（用逗号分隔）',
    'propose.field.tags.placeholder': 'architecture, database',
    'propose.field.rationale.placeholder': '修改理由——为什么要做这个改动？',
    'propose.markdown': 'Markdown',
    'propose.preview.empty': '暂无可预览的内容。',
    'propose.cancel': '取消',
    'propose.submit.action': '提交审核',
    'propose.submitting': '提交中…',
    'propose.body.placeholder': '# 你的页面标题\n\n用 Markdown 撰写。可用 [[wiki-links]] 链接到其它页面。',
    'propose.category.engineering': '工程',
    'propose.category.product': '产品',
    'propose.category.design': '设计',
    'propose.category.operations': '运营',
    'propose.category.research': '研究',
    'propose.category.sources': '资料',

    // Review queue
    'review.title': '审核队列',
    'review.empty': '当前没有待审核的版本。',
    'review.rev': '版本',
    'review.byAuthor': '作者',
    'review.tab.diff': '差异',
    'review.tab.preview': '预览',
    'review.tab.raw': '原文',
    'review.agentAuthored': '智能体生成',
    'review.conflict': '冲突',
    'review.sourceGrounding': '原文出处',
    'review.sourceGrounding.count': '{n} 条引用',
    'review.sourceGrounding.expand': '展开原文出处',
    'review.sourceGrounding.collapse': '收起原文出处',
    'review.confidence': '置信度',
    'review.feedback.heading': '审核反馈（可选，仅对智能体草稿）',
    'review.feedback.reason.placeholder': '— 选择驳回理由 —',
    'review.feedback.reason.wrong_page': '页面不对',
    'review.feedback.reason.unsupported_claim': '论断无据',
    'review.feedback.reason.bad_summary': '摘要质量差',
    'review.feedback.reason.duplicate': '重复',
    'review.feedback.reason.wrong_tags': '标签不当',
    'review.feedback.reason.too_broad': '范围过大',
    'review.feedback.reason.too_speculative': '过于臆测',
    'review.feedback.reason.permission_concern': '权限问题',
    'review.feedback.reason.formatting_issue': '排版问题',
    'review.feedback.reason.other': '其它',
    'review.feedback.notes.placeholder': '说明（会反馈给后续 ingest 智能体）',
    'review.decision.comment.placeholder': '评论（可选，作者可见）',
    'review.decision.reject': '驳回',
    'review.decision.reject.title': '驳回此提议',
    'review.decision.requestChanges': '请求修改',
    'review.decision.requestChanges.title': '退回给作者修改',
    'review.decision.accept': '通过并发布',
    'review.decision.accept.title': '通过并发布',

    // Section headings
    'manual.section.reading': '阅读与检索',
    'manual.section.authoring': '内容创作',
    'manual.section.reviewing': '审核（编辑与管理员）',
    'manual.section.graph': '图谱视图',
    'manual.section.ingest': '资料导入与检查',
    'manual.section.integration': '外部接入',
    'manual.section.chrome': '界面通用',

    // Item titles
    'manual.search.title': '搜索',
    'manual.search.body':
      '基于片段（chunk）的全文与向量混合检索，覆盖所有已发布页面。结果带页面路径与摘录，点击即可跳转。适合回答"X 在哪里有记录？"这类问题。',
    'manual.switcher.title': '快速切换',
    'manual.switcher.body':
      '通过标题或路径模糊匹配任意页面，最近打开的优先显示。在你已经知道标题时，比文件树更快。',
    'manual.chat.title': '对话面板',
    'manual.chat.body':
      '位于右侧栏。两种模式：Sources 模式按片段引用、附带行号（精确回答"X 在哪里"）；Wiki 模式综合整页内容并跟随 [[wikilinks]]（适合"解释这个概念"类问题）。',

    'manual.suggest.title': '建议编辑',
    'manual.suggest.body':
      '打开提议对话框。你的草稿进入审核流程，由编辑批准或驳回，然后才会落到正式页面上。贡献者及以上角色可用。',
    'manual.newNote.title': '新建笔记',
    'manual.newNote.body':
      '位于文件树工具栏。以"新建"模式打开提议对话框——即使当前有页面打开，也会从空白开始，而不是编辑当前页面。',
    'manual.newFolder.title': '新建文件夹',
    'manual.newFolder.body':
      '在文件树中就地创建一个空文件夹，用于组织新笔记的位置；路径位于该文件夹下的页面会自动嵌套显示。',
    'manual.history.title': '版本历史',
    'manual.history.body':
      '在文件树中右键任意页面 → 版本历史（或页面顶部的菜单）。列出每一次已接受的修订及其差异。',

    'manual.review.title': '审核队列',
    'manual.review.body':
      '列出所有等待你审核的提案修订。提供并排差异视图，可附理由通过或驳回。编辑只看到自己分类下的队列，管理员看到全部。徽章显示未处理数量。',

    'manual.graph.title': '2D / 3D 图谱',
    'manual.graph.body':
      '将整个维基可视化为节点（页面）与连边（链接）。工具栏可在平面 2D 与轨道式 3D 间切换。悬停节点高亮邻居；悬停文件树中的文件夹会点亮对应的页面节点。',
    'manual.timelapse.title': '时间回放',
    'manual.timelapse.body':
      '仅在 2D 模式下可用。按创建顺序逐页回放，看维基是如何随时间生长出来的。',

    'manual.sources.title': '原始资料面板',
    'manual.sources.body':
      '上传原始输入文档（PDF、Markdown、图片）。每份资料都可以交给 AI 智能体进行 ingest（摄入），智能体会提出结构化编辑，把资料合并进维基。所有编辑仍需走正常审核流程。',
    'manual.playbook.title': '智能体手册',
    'manual.playbook.body':
      'ingest 智能体在合并原始资料时所遵循的系统提示词。管理员可以编辑它来改变摄入行为，例如"始终标注原文页码"或"不要新建顶级页面"。',
    'manual.lint.title': '维基检查（管理员）',
    'manual.lint.body':
      '让智能体扫描整个维基，寻找孤立页面、失效 wikilink、互相矛盾的论断、过时陈述等。只读——把发现列成可操作的清单，不会自动改动。',

    'manual.mcp.title': 'MCP 接入',
    'manual.mcp.body':
      '生成个人 API Token，把维基挂接给支持 MCP 的大模型客户端（Claude Desktop、Cursor 等）当作工具调用。Token 以你的身份认证，因此原有的角色与权限照常生效。',

    'manual.theme.title': '主题切换',
    'manual.theme.body':
      '在深色与浅色主题间切换。两个模式之间会有背景视频的平滑过渡，选择会跨刷新保留。',
    'manual.notif.title': '通知',
    'manual.notif.body':
      '记录审核结果、评论、@提及。徽章显示未读数。点击某条可直接跳转到对应页面或队列。',
    'manual.tabs.title': '标签页',
    'manual.tabs.body':
      '在中心区域顶部以标签页形式打开多个页面或图谱视图。右键标签提供拆分、定位、关闭等选项。标签页跨刷新保留。',
    'manual.chatCollapse.title': '可折叠的对话面板',
    'manual.chatCollapse.body':
      '点击对话面板头部的折叠图标，可把 AI 助手收成一条 40 像素宽的窄栏；再点一次展开。状态跨刷新保留。折叠时对话记录、当前模式（Sources/Wiki）以及未发送的输入都不会丢失。',
    'manual.pageLayout.title': '页面排版',
    'manual.pageLayout.body':
      '页面采用 Obsidian 风格排版：顶部一条细长工具栏（路径 + 操作），标题与正文一起滚动；标题下方有信息条（更新时间 · 最近编辑者 · 稳定度 · 修订数 · 标签），正文 markdown 居中，反向链接位于页面底部。阅读列宽 ~820px 居中显示——折叠对话面板可获得更宽裕的阅读区。',
    'manual.versionLog.title': '版本徽章',
    'manual.versionLog.body':
      '左下角小徽章显示当前运行的版本（如 v0.5.0）。点击展开近期 release 列表，每行可直接跳转 GitHub release 页面。每小时轮询一次 Releases API；当远端有新版本时徽章变琥珀色提示。',
    'manual.langToggle.title': '语言切换',
    'manual.langToggle.body':
      '顶栏 中/EN 按钮。可瞬间切换整个界面 chrome —— 顶栏、菜单、提示、kebab、面板、用户手册、/help 文档 —— 中英文。维基和帮助站点通过 localStorage 共享语言偏好。',
  },
} as const;
