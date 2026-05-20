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
  },
} as const;
