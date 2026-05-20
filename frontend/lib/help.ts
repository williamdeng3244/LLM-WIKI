// Long-form bilingual help content for the /help docs route.
//
// Each section is a `HelpSection` with an `id` (URL hash) and an array
// of "blocks" — paragraphs, headings, or bullet lists. Blocks are
// bilingual at the leaf level so the sidebar order/structure stays
// identical across languages.
import type { Lang } from './i18n';

export type Block =
  | { kind: 'p'; en: string; zh: string }
  | { kind: 'h3'; en: string; zh: string }
  | { kind: 'ul'; en: string[]; zh: string[] };

export type HelpSection = {
  id: HelpSectionId;
  blocks: Block[];
};

export type HelpSectionId =
  | 'welcome' | 'reading' | 'authoring' | 'reviewing' | 'graph'
  | 'ingest' | 'lint' | 'mcp' | 'shortcuts' | 'themes' | 'faq';

export function blockText(b: Block, lang: Lang): string | string[] {
  if (b.kind === 'ul') return lang === 'zh' ? b.zh : b.en;
  return lang === 'zh' ? b.zh : b.en;
}

export const HELP_SECTIONS: HelpSection[] = [
  // ── Welcome ────────────────────────────────────────────────────────
  {
    id: 'welcome',
    blocks: [
      {
        kind: 'p',
        en: 'Enflame Wiki is the company\'s self-hosted internal knowledge base. It exists to be the single source of truth for engineering documentation, design decisions, operational runbooks, product context, and anything else the team needs to share durably. Unlike a Confluence-style page-tree or a Notion workspace, every change to this wiki passes through an explicit review pipeline before it becomes the new "current" version of a page.',
        zh: 'Enflame Wiki 是公司内部自托管的知识库。它的存在意义是成为工程文档、设计决策、运维手册、产品上下文以及团队任何需要长期共享的内容的"唯一事实来源"。与 Confluence 风格的页面树或 Notion 工作区不同，本维基的每一次改动在成为页面的新"当前版本"之前，都要经过一条明确的审核流程。',
      },
      {
        kind: 'p',
        en: 'The product is built on top of Andrej Karpathy\'s "LLM-Wiki" idea: stop retrieving fragments, start compiling pages. Where a typical RAG system answers a question by stitching together small chunks of text it finds at query time, this wiki invests up front — an AI agent reads raw input documents, proposes structured edits, and humans review them. The result is a curated, deduplicated, cross-linked set of pages that read as a real reference manual instead of search results.',
        zh: '产品基于 Andrej Karpathy 的 "LLM-Wiki" 思路：不要只检索碎片，而是直接编译页面。典型 RAG 系统在用户提问时把找到的文本片段拼接起来回答；本维基则在前端就做投入——AI 智能体阅读原始输入文档、提出结构化的编辑、由人类审核。结果是一组经过精心策划、去重并互相链接的页面，读起来像一本真正的参考手册，而不是搜索结果。',
      },
      {
        kind: 'h3',
        en: 'Who it\'s for',
        zh: '面向的用户',
      },
      {
        kind: 'ul',
        en: [
          'Engineers documenting architecture, conventions, and runbooks they want to outlive the next reorg.',
          'Product / design folks capturing decisions, rationale, and how they map back to user research.',
          'Ops / SRE writing the playbooks they\'ll grab during the next incident at 3 AM.',
          'New hires reading their way into the codebase by following [[wikilinks]] across pages.',
          'External LLM agents (via MCP) that need company context but should still respect human review.',
        ],
        zh: [
          '记录架构、约定与运维手册的工程师——希望这些文档能挺过下一次组织调整。',
          '产品 / 设计同学，记录决策、动机以及它们与用户研究的对应关系。',
          'Ops / SRE 写出半夜三点出事时会立刻翻出来的应急手册。',
          '新人通过 [[wikilinks]] 在页面之间穿梭来熟悉代码库。',
          '通过 MCP 接入的外部大模型——需要公司上下文，但仍受人类审核约束。',
        ],
      },
      {
        kind: 'h3',
        en: 'The three big ideas',
        zh: '三个核心理念',
      },
      {
        kind: 'p',
        en: 'First — compile, don\'t just retrieve. The wiki is structured as long-lived pages, not as a chunk index. The agent\'s job is to maintain those pages: when new information arrives, it figures out which existing pages to edit, which to create, and where to flag a contradiction. The chunk-level vector search still exists, but it\'s a fallback, not the primary interface.',
        zh: '其一——编译而非检索。维基以长期存在的"页面"为组织单位，而不是碎片化的向量索引。智能体的工作是维护这些页面：当新信息到来时，决定要编辑哪些现有页面、新建哪些页面、在哪里标注矛盾。基于片段的向量检索仍然存在，但只是后备方案，而不是主要界面。',
      },
      {
        kind: 'p',
        en: 'Second — humans hold the keys. Every action the agent takes — every page it wants to create or edit — routes through the standard review queue. Editors and admins see the proposed diff before it lands. Stability levels (open / stable / locked) let you tune how aggressively review is enforced per page. The agent never auto-publishes a destructive change.',
        zh: '其二——人类掌握最终决定权。智能体的每一步——它想新建或修改的每一个页面——都会进入标准审核队列。编辑和管理员在改动落地之前会看到提议的差异。稳定度等级（open / stable / locked）允许你按页面调节审核的严格程度。智能体永远不会自动发布破坏性改动。',
      },
      {
        kind: 'p',
        en: 'Third — external LLMs are guests. The wiki ships its own MCP (Model Context Protocol) server. Any MCP-capable client — Claude Desktop, Cursor, custom agents — can attach with a personal token and call tools (search_wiki, get_page, list_backlinks, create_draft, …) as if the wiki were a local extension of the model. Each token authenticates as a specific human, so role and category permissions still apply: an external agent can never do something the human couldn\'t.',
        zh: '其三——外部大模型只是"客人"。维基自带一个 MCP（Model Context Protocol）服务器。任何兼容 MCP 的客户端——Claude Desktop、Cursor、自定义 agent——都可以用个人 Token 接入并调用工具（search_wiki、get_page、list_backlinks、create_draft……），就像维基是模型的本地扩展一样。每个 Token 都以某个具体的人类身份认证，因此角色与分类权限照常生效：外部 agent 永远做不了它对应的人类做不了的事情。',
      },
      {
        kind: 'h3',
        en: 'How content flows in',
        zh: '内容的流入方式',
      },
      {
        kind: 'p',
        en: 'There are three ways content lands in the wiki, and they all converge on the same review queue:',
        zh: '内容进入维基有三种途径，它们最终都汇入同一个审核队列：',
      },
      {
        kind: 'ul',
        en: [
          'A human writes or edits a page directly via the Suggest button. Their draft enters review.',
          'An admin uploads a raw source (PDF, markdown, image) and triggers ingest. The agent proposes a plan; an approver picks which edits to apply; selected edits become drafts.',
          'An external LLM client (via MCP) calls create_draft as the authenticated user. Same review queue.',
        ],
        zh: [
          '人工：用户通过"建议编辑"直接写或修改页面，草稿进入审核。',
          '导入：管理员上传原始资料（PDF、Markdown、图片）并触发 ingest。智能体提出计划，审核者选择要应用的编辑，被选中的编辑成为草稿。',
          '外部接入：经过 MCP 接入的客户端以认证用户身份调用 create_draft，进入同一个审核队列。',
        ],
      },
      {
        kind: 'p',
        en: 'The principle: there\'s exactly one path from "raw information" to "live page", and that path always passes through a human reviewer. Drafts can come from anywhere; the gatekeeper is always a person you trust.',
        zh: '原则是：从"原始信息"到"上线页面"只有一条路径，并且这条路径始终穿过一个人类审核者。草稿可以来自任何地方，但守门人始终是一个你信任的人。',
      },
    ],
  },

  // ── Reading & navigation ───────────────────────────────────────────
  {
    id: 'reading',
    blocks: [
      {
        kind: 'p',
        en: 'The wiki gives you four ways to find content, each tuned for a different intent. The left sidebar is a file tree; the center pane shows page tabs; the top bar has search and quick-switcher; the right pane is an AI chat. Pick the one that fits how much you already know about what you\'re looking for.',
        zh: '维基提供四种查找内容的方式，每一种针对不同意图。左侧栏是文件树；中心区是页面标签页；顶栏有搜索和快速切换；右侧栏是 AI 对话。根据你对目标的了解程度，挑最合适的那种。',
      },
      {
        kind: 'h3',
        en: 'File tree',
        zh: '文件树',
      },
      {
        kind: 'p',
        en: 'The left sidebar lists every page in folder hierarchy, derived from the page\'s path (e.g. engineering/architecture.md sits under "engineering"). Toolbar buttons across the top of the tree let you sort, expand/collapse all, create a new note, or create an empty folder. Right-click any item for a context menu: copy path, reveal in tree, version history, open in new tab (when tabs ship), etc.',
        zh: '左侧栏按文件夹层级列出所有页面，文件夹由页面路径推导而来（例如 engineering/architecture.md 归在 "engineering" 下）。文件树顶部的工具栏按钮可以：排序、全部展开/折叠、新建笔记、新建空文件夹。在任何条目上右键会弹出上下文菜单：复制路径、在文件树中定位、查看版本历史、在新标签页中打开（待标签页功能上线后）等。',
      },
      {
        kind: 'p',
        en: 'Hovering a folder in the tree highlights the matching nodes in the graph view — useful for getting a visual sense of how clustered a topic area is.',
        zh: '在文件树中悬停某个文件夹会高亮图谱视图中对应的节点——便于直观感受某个主题的页面在图谱中聚得有多紧。',
      },
      {
        kind: 'h3',
        en: 'Search (⌘K)',
        zh: '搜索（⌘K）',
      },
      {
        kind: 'p',
        en: 'Press ⌘K (or Ctrl+K) anywhere to focus the search bar in the top bar. As you type, a dropdown appears with matches across the whole wiki. The search runs in two passes: first a vector similarity lookup against chunk embeddings, then a lexical fallback against literal text — so even rare phrases that don\'t embed well still surface results.',
        zh: '在任意位置按 ⌘K（或 Ctrl+K）聚焦顶栏搜索框。开始输入时，下拉列表会显示来自整个维基的匹配项。搜索分两步：先用向量相似度匹配片段嵌入，再用字面文本做词法兜底，所以即使是不太适合向量表示的稀有短语也能找到结果。',
      },
      {
        kind: 'p',
        en: 'Each result shows the page title, path, and a short snippet with the matched fragment. Click a result to navigate there. Search is the right tool when you only remember a phrase, a function name, or a concept — not the page title.',
        zh: '每条结果显示页面标题、路径以及包含匹配片段的简短摘录。点击结果即可跳转。当你只记得一个短语、一个函数名或一个概念，而不是页面标题时，搜索是最合适的工具。',
      },
      {
        kind: 'h3',
        en: 'Quick switcher (⌘O)',
        zh: '快速切换（⌘O）',
      },
      {
        kind: 'p',
        en: 'Press ⌘O for a modal overlay that fuzzy-matches page titles and paths. Recently opened pages surface first; type to filter. Arrow keys + Enter to choose. The quick switcher is faster than search when you already know the page\'s title — it\'s the "I know this page exists, take me there" path.',
        zh: '按 ⌘O 打开模态浮层，对页面标题和路径做模糊匹配。最近打开的页面优先显示，输入文字进行筛选。方向键 + Enter 进行选择。当你已经知道页面名称时，快速切换比搜索更快——是那种"我知道这页存在，直接带我去"的路径。',
      },
      {
        kind: 'h3',
        en: 'Chat panel (right column)',
        zh: '对话面板（右侧栏）',
      },
      {
        kind: 'p',
        en: 'The right column is an AI chat over the wiki. It has two modes, switchable from the panel header:',
        zh: '右侧栏是基于维基的 AI 对话。它有两种模式，可在面板头部切换：',
      },
      {
        kind: 'ul',
        en: [
          'Sources mode — chunk-level RAG. The answer cites individual chunks by [1][2], each with the page path and line range. Best for precise "where is X documented?" questions.',
          'Wiki mode — page-level synthesis. The agent reads whole pages, follows [[wikilinks]] one hop deep to gather related context, then writes a synthesized answer that cites at the page level. Best for "explain this concept" or "what\'s the difference between A and B?".',
        ],
        zh: [
          'Sources 模式——基于片段的 RAG。回答中按 [1][2] 引用具体片段，每个引用附带页面路径和行号范围。适合精确回答"X 在哪里有记录？"这类问题。',
          'Wiki 模式——基于页面的综合。智能体读取整页，按 [[wikilinks]] 跟随一跳收集相关上下文，然后写出综合答案，引用粒度是页面。适合回答"解释这个概念"或"A 和 B 有什么区别？"',
        ],
      },
      {
        kind: 'p',
        en: 'Both modes refuse to invent facts: if the wiki doesn\'t cover something, the chat says so plainly instead of confabulating.',
        zh: '两种模式都不会编造事实：如果维基没有覆盖某个主题，对话会直接说没有，而不是凭空生成。',
      },
      {
        kind: 'h3',
        en: 'Backlinks',
        zh: '反向链接',
      },
      {
        kind: 'p',
        en: 'On any page, open the kebab menu (⋯ at the top of the page) and toggle Backlinks. An inline panel shows every page that wikilinks here, plus a snippet of the linking text. Backlinks are how you discover "everything that depends on / references this concept" without grepping.',
        zh: '在任何页面上打开页面顶部的 ⋯ 菜单并切换"反向链接"。一个内联面板会列出所有链接到本页的页面以及链接处的片段。反向链接让你不用 grep 就能发现"所有依赖 / 引用这个概念的地方"。',
      },
    ],
  },

  // ── Authoring ──────────────────────────────────────────────────────
  {
    id: 'authoring',
    blocks: [
      {
        kind: 'p',
        en: 'Anyone with a role of contributor or above can author content. The path from "I want to add this" to "it\'s live on the wiki" is always: write a draft → submit for review → an editor approves → the change becomes the new current revision of the page. Old revisions are kept in the page\'s version history.',
        zh: '贡献者及以上角色都可以创作内容。从"我想加这一段"到"它出现在维基上"的路径始终是：写草稿 → 提交审核 → 编辑批准 → 改动成为页面的新当前版本。旧版本保留在页面的版本历史中。',
      },
      {
        kind: 'h3',
        en: 'Suggest edit (⌘E)',
        zh: '建议编辑（⌘E）',
      },
      {
        kind: 'p',
        en: 'On any page, press ⌘E (or click Suggest in the top bar) to open the propose dialog. The dialog shows a side-by-side diff between the current revision and your draft, refreshing live as you type. Above the diff is a textarea for your rationale — one or two sentences explaining why this change. The rationale ends up alongside the diff in the reviewer\'s queue, so it pays to be specific.',
        zh: '在任意页面按 ⌘E（或点顶栏的"建议编辑"）打开提议对话框。对话框并排显示当前版本与你的草稿的差异，输入时实时刷新。差异之上有一个文本框写"修改理由"——一两句话解释为什么改。理由会与差异一起出现在审核者的队列里，所以越具体越好。',
      },
      {
        kind: 'p',
        en: 'You can save a draft without submitting (Save draft button), come back to it later from Notifications, or submit it directly for review. The "stability" of the page determines what happens next: pages marked "open" auto-publish; "stable" routes through one reviewer; "locked" requires admin approval, even from editors.',
        zh: '你可以保存草稿但不提交（"保存草稿"按钮），稍后从"通知"中重新打开；也可以直接提交审核。页面的"稳定度"决定后续行为：标为 open 的页面自动发布；stable 页面经一个审核者通过；locked 页面即便编辑提议也需要管理员批准。',
      },
      {
        kind: 'h3',
        en: 'New note',
        zh: '新建笔记',
      },
      {
        kind: 'p',
        en: 'The pencil icon in the file-tree toolbar opens the propose dialog in "create new" mode — even if you have a page open. You set the path (which determines the folder and URL), the title, and the body. The resulting draft routes through review like any other change.',
        zh: '文件树工具栏中的铅笔图标会以"新建"模式打开提议对话框——即便你当前有页面打开。你设定路径（决定文件夹与 URL）、标题、正文。新草稿与其它改动一样走标准审核。',
      },
      {
        kind: 'p',
        en: 'Path conventions: lowercase, hyphen-separated, hierarchical. Examples: engineering/architecture.md, ops/runbooks/postgres-restore.md, design/components.md. The file extension is conventionally .md but the body is rendered as markdown either way.',
        zh: '路径约定：小写、连字符分隔、层级结构。例如：engineering/architecture.md、ops/runbooks/postgres-restore.md、design/components.md。文件后缀按惯例用 .md，但正文无论扩展名如何都按 Markdown 渲染。',
      },
      {
        kind: 'h3',
        en: 'Markdown syntax',
        zh: 'Markdown 语法',
      },
      {
        kind: 'p',
        en: 'The wiki uses CommonMark plus GitHub-flavored extensions plus one wiki-specific construct.',
        zh: '维基使用 CommonMark，加上 GitHub 风味的扩展，再加上一个维基特有的语法。',
      },
      {
        kind: 'ul',
        en: [
          'Headings (# H1, ## H2, …), bold (**), italic (*), inline code (`), blockquote (>), horizontal rule (---).',
          'Fenced code blocks with language tags (```python … ```) — highlighted automatically.',
          'Tables, task lists (- [x]), footnotes, strikethrough — all standard GFM.',
          '[[Page name]] — a wikilink. Internally resolves to the page with the matching title or path. Broken links render in red and are flagged by the lint pass.',
          '[[Page name|alias]] — a wikilink with a custom display label.',
        ],
        zh: [
          '标题（# H1、## H2 …）、粗体（**）、斜体（*）、行内代码（`）、引用（>）、分割线（---）。',
          '带语言标签的代码块（```python … ```）——自动语法高亮。',
          '表格、任务列表（- [x]）、脚注、删除线——都是标准 GFM。',
          '[[页面名]]——wikilink。内部解析为标题或路径匹配的页面。失效链接以红色显示，并会被 lint 标出。',
          '[[页面名|别名]]——带自定义显示文本的 wikilink。',
        ],
      },
      {
        kind: 'h3',
        en: 'Version history',
        zh: '版本历史',
      },
      {
        kind: 'p',
        en: 'Every accepted revision is preserved. Right-click a page in the file tree → Version history, or use the page\'s kebab menu. The dialog lists revisions newest-first with author, timestamp, and rationale; click any pair to see a diff between them. There\'s no destructive history rewrite — once a revision lands, it stays.',
        zh: '所有已通过审核的版本都会保留。在文件树中右键页面 → 版本历史，或者用页面的 ⋯ 菜单。对话框按最新优先列出每个版本，附作者、时间戳、修改理由；点选两个版本可以看它们之间的差异。没有"破坏性历史改写"——版本一旦落地就一直在。',
      },
    ],
  },

  // ── Reviewing ──────────────────────────────────────────────────────
  {
    id: 'reviewing',
    blocks: [
      {
        kind: 'p',
        en: 'Reviewing is the heart of the wiki\'s quality model. Anyone with the editor or admin role sees the Review queue — the inbox icon in the top bar, with a badge showing the number of items waiting on you. Drafts from contributors, agent ingests, and external MCP clients all land in the same queue.',
        zh: '审核是本维基质量模型的核心。任何编辑或管理员角色都能看到审核队列——顶栏的收件箱图标，徽章显示等待你处理的数量。来自贡献者的草稿、智能体 ingest、外部 MCP 客户端的提议都进入同一个队列。',
      },
      {
        kind: 'h3',
        en: 'What the queue shows',
        zh: '队列里看到什么',
      },
      {
        kind: 'p',
        en: 'Each entry shows the page path, the author (human, agent, or external client), a timestamp, the rationale, and a side-by-side diff against the current revision. For new pages, the diff is "nothing → proposed body". For deletes, the body column is empty.',
        zh: '每条审核项展示页面路径、作者（人工、智能体或外部客户端）、时间戳、修改理由，以及与当前版本的并排差异。新建页面时，差异是"空 → 提议正文"；删除时，正文列为空。',
      },
      {
        kind: 'h3',
        en: 'Actions',
        zh: '审核动作',
      },
      {
        kind: 'ul',
        en: [
          'Approve — the draft becomes the new current revision; the old one rolls into version history.',
          'Reject — the draft is dismissed; you provide a short reason. Your reason is stored as provenance and (for agent drafts) fed back to the ingest agent so it can learn from the pattern.',
          'Request changes — leaves the draft as "needs work"; the author sees the feedback in their Notifications and can resubmit.',
          'Edit + approve — you can tweak the draft\'s body directly in the diff view before approving, e.g. to fix a typo without bouncing it back.',
        ],
        zh: [
          '批准——草稿成为新的当前版本；旧版本归入版本历史。',
          '驳回——草稿被驳回，你需要附一句简短理由。理由作为来源信息保存；对于智能体的草稿，理由会反馈给 ingest 智能体，让它从中学习。',
          '请求修改——草稿保留为"需修改"状态；作者会在通知里看到反馈，可以再次提交。',
          '编辑后批准——在差异视图中直接微调正文再批准，例如改个错别字而不必让作者重新提交。',
        ],
      },
      {
        kind: 'h3',
        en: 'Scope: editors vs admins',
        zh: '范围：编辑 vs 管理员',
      },
      {
        kind: 'p',
        en: 'Editors are scoped per category. A "design editor" sees only drafts whose page lives in the design category; they can\'t accidentally approve a database-migration runbook. Admins see everything. This is enforced server-side, not by hiding UI.',
        zh: '编辑按分类划权。"设计编辑"只看到隶属于 design 分类的草稿，不会误批一份数据库迁移手册。管理员看到全部。该范围由服务端强制，不依赖隐藏前端 UI。',
      },
      {
        kind: 'h3',
        en: 'Reviewer-feedback loop',
        zh: '审核反馈闭环',
      },
      {
        kind: 'p',
        en: 'When you reject an agent-authored draft with a rationale, that rationale isn\'t just stored in audit logs — it\'s surfaced to the ingest agent on its next run via a "recent reviewer rejections" prompt section. Concretely: the agent sees aggregated counts by reason category over the last 90 days, plus the most recent verbatim notes. The aim is to stop the same class of bad proposal from recurring.',
        zh: '当你附理由驳回一份智能体草稿时，理由不仅进入审计日志——下一次 ingest 运行时，智能体也会通过"近期审核驳回"提示段落看到它。具体来说：智能体看到过去 90 天按类别聚合的驳回计数，以及最近几条原话。目的是让同一类糟糕提议不再反复出现。',
      },
      {
        kind: 'h3',
        en: 'Stability levels',
        zh: '稳定度等级',
      },
      {
        kind: 'p',
        en: 'Each page has a stability tag that controls how strictly review is enforced for changes to that page. Set it in the page metadata at creation time; admins can change it later.',
        zh: '每个页面都有一个稳定度标签，用来控制该页面修改时审核的严格程度。创建页面时在元数据中设定，事后管理员可以调整。',
      },
      {
        kind: 'ul',
        en: [
          'open — anyone\'s edit auto-publishes with no review. Use for scratch / staging pages where speed matters more than correctness.',
          'stable (default) — edits route through one reviewer. The vast majority of pages should be here.',
          'locked — edits require admin approval, even from editors. Reserve for legally-sensitive or production-critical pages (e.g. security policy, on-call runbooks).',
        ],
        zh: [
          'open——任何人的编辑都自动发布，不需审核。适合速度比正确性更重要的草稿/暂存页面。',
          'stable（默认）——编辑经一个审核者通过。绝大多数页面应该是这个等级。',
          'locked——编辑需要管理员批准，即便是编辑提议也是。保留给法律敏感或生产关键页面（如安全策略、值班手册）。',
        ],
      },
    ],
  },

  // ── Graph view ─────────────────────────────────────────────────────
  {
    id: 'graph',
    blocks: [
      {
        kind: 'p',
        en: 'The graph view visualizes the wiki as a network of nodes and edges. Each node is a page; each edge is a relationship — either an explicit wikilink between two pages, or a synthesized structural edge (pages in the same folder, pages sharing a tag). The view exists to make non-obvious connections visible: which pages cluster, which are orphans, which bridge between otherwise-isolated topic areas.',
        zh: '图谱视图把整个维基可视化为节点与连边的网络。每个节点是一个页面；每条边是一种关系——要么是两个页面间的显式 wikilink，要么是合成的结构连边（同一文件夹、共享标签）。该视图的目的是让不那么显而易见的连接变得可见：哪些页面聚成簇、哪些页面是孤立的、哪些页面在原本分离的主题区之间架桥。',
      },
      {
        kind: 'h3',
        en: 'Opening the graph',
        zh: '打开图谱',
      },
      {
        kind: 'p',
        en: 'Open a New Tab and pick "Graph" instead of "Page". You can have any number of graph tabs open simultaneously, each remembering its own zoom, rotation (in 3D), and node-pin state. Right-click a tab for split / rename options.',
        zh: '新建标签页并选择 "Graph" 而不是 "Page"。可以同时打开任意多个图谱标签页，每个独立记住自己的缩放、旋转（3D 模式下）以及节点固定状态。右键标签页可拆分 / 重命名。',
      },
      {
        kind: 'h3',
        en: '2D vs 3D',
        zh: '2D 与 3D 的差别',
      },
      {
        kind: 'p',
        en: '2D is faster, sharper, and includes the timelapse feature. It uses a force-directed canvas layout — nodes repel each other, edges pull connected nodes together. 3D uses a Three.js scene with orbital camera controls; nodes have a glowing-orb appearance with a colored core (by category) and a halo. 3D is more impressive in demos; 2D is the daily-driver view.',
        zh: '2D 更快、更清晰，并且支持时间回放功能。它使用力导向的 Canvas 布局——节点互相排斥，边把相连的节点拉到一起。3D 使用 Three.js 场景，配合轨道式相机控制；节点呈发光球体外观，核心按分类着色，外层有光晕。3D 在 demo 中更出彩；2D 是日常使用的主力视图。',
      },
      {
        kind: 'h3',
        en: 'Interaction',
        zh: '交互方式',
      },
      {
        kind: 'ul',
        en: [
          'Hover a node — highlights its neighbors and shows the title label.',
          'Click a node — opens that page in a new tab (or your active page tab, depending on settings).',
          'Drag a node — repositions it and pins it in place (Plain release on empty space unpins).',
          'Hover a folder in the file tree — lights up that folder\'s nodes in the active graph.',
          '2D: scroll = zoom, drag empty space = pan.',
          '3D: scroll = zoom, drag empty space = rotate, right-drag = pan.',
        ],
        zh: [
          '悬停节点——高亮其邻居并显示标题。',
          '点击节点——在新标签页（或当前页面标签页，取决于设置）打开该页面。',
          '拖动节点——重新定位并钉住它（拖到空白处松手可取消钉住）。',
          '悬停文件树中的文件夹——在当前图谱中点亮该文件夹的节点。',
          '2D：滚轮 = 缩放，拖空白处 = 平移。',
          '3D：滚轮 = 缩放，拖空白处 = 旋转，右键拖动 = 平移。',
        ],
      },
      {
        kind: 'h3',
        en: 'Settings',
        zh: '图谱设置',
      },
      {
        kind: 'p',
        en: 'The settings panel (slider icon in the graph toolbar) tunes the look without changing the underlying data. You can adjust node size scaling, link strength, repulsion, label visibility threshold, and per-category color. Changes are persisted to localStorage so the graph re-opens the way you left it.',
        zh: '设置面板（图谱工具栏的滑块图标）调整视觉而不改动底层数据。你可以调节节点大小缩放、连边强度、排斥力、标签显示阈值、按分类的颜色。改动会持久化到 localStorage，重新打开图谱时保持上次的样子。',
      },
      {
        kind: 'h3',
        en: 'Timelapse (2D only)',
        zh: '时间回放（仅 2D）',
      },
      {
        kind: 'p',
        en: 'Press the Play button at the bottom of the 2D graph to replay the wiki chronologically — pages appear in the order they were created, with edges connecting in as their target pages exist. Useful for showing how knowledge accreted over time in a stakeholder demo, or for spotting periods of activity vs neglect.',
        zh: '点击 2D 图谱底部的 Play 按钮按时间顺序回放维基——页面按创建顺序逐个出现，边在目标页面存在时连入。适合在 demo 中展示知识如何随时间积累，或者识别活跃期与停滞期。',
      },
    ],
  },

  // ── Raw sources & ingest ───────────────────────────────────────────
  {
    id: 'ingest',
    blocks: [
      {
        kind: 'p',
        en: 'Sources are how you bring external information into the wiki. The Sources panel (files icon in the top bar) lets you upload raw documents — PDFs, markdown, plain text, images — and either reference them as-is or hand them to the AI agent for ingest. Ingest is the agent reading the source, understanding the existing wiki, and proposing a structured plan of edits that merge the new information.',
        zh: 'Sources（原始资料）是把外部信息带进维基的入口。原始资料面板（顶栏文件图标）允许你上传原始文档——PDF、Markdown、纯文本、图片——并选择直接引用或交给 AI 智能体做 ingest（摄入）。Ingest 即智能体阅读资料、理解当前维基，然后提出一份结构化的编辑计划把新信息融入。',
      },
      {
        kind: 'h3',
        en: 'Uploading a source',
        zh: '上传资料',
      },
      {
        kind: 'p',
        en: 'Click "Upload source" in the Sources panel and pick a file. The wiki stores it under raw/ on disk (a bind-mounted directory in the docker-compose setup), and shows it in the panel with its filename, size, MIME type, and ingest status (none / ingesting / done / failed). Optionally add a description — it\'s shown to the agent during ingest, so context like "weekly status memo for the inference team, week of 2026-05-12" pays off.',
        zh: '在 Sources 面板点 "Upload source" 并选择文件。维基把它存到磁盘上的 raw/ 目录（docker-compose 中是绑定挂载的目录），并在面板里展示文件名、大小、MIME 类型与 ingest 状态（未摄入 / 摄入中 / 完成 / 失败）。可选填写一段描述——它会在 ingest 时给到智能体，类似 "Inference 团队 2026-05-12 那一周的周报"这种上下文是有用的。',
      },
      {
        kind: 'h3',
        en: 'The two-phase pipeline',
        zh: '两阶段流程',
      },
      {
        kind: 'p',
        en: 'Ingest is split into Plan and Apply so there\'s always a checkpoint for a human to review what the agent wants to do before any drafts get created.',
        zh: 'Ingest 分成 Plan（规划）和 Apply（落地）两阶段，确保在创建任何草稿之前都有一个让人类确认的检查点。',
      },
      {
        kind: 'ul',
        en: [
          'Plan — agent reads the raw source plus relevant wiki context (retrieved via vector + directory). Returns a JSON plan describing each proposed edit: kind (edit_existing / create_new / source_summary / conflict), path, title, body, tags, rationale, and citations back to the source. No drafts created yet.',
          'Review — you see every proposed edit side-by-side. Approve a subset; skip the rest. Conflicts (when the source disagrees with existing wiki content) are flagged and never overwrite — they\'re raised as a "you decide" decision.',
          'Apply — approved edits open as drafts via the standard workflow. Each draft carries a provenance link back to the source, so the reviewer always knows where the information came from.',
        ],
        zh: [
          'Plan——智能体阅读资料与相关维基上下文（通过向量 + 目录检索）。返回一份 JSON 计划描述每个提议编辑：类型（edit_existing / create_new / source_summary / conflict）、路径、标题、正文、标签、修改理由、对原始资料的引用。此时尚未创建草稿。',
          'Review——并排查看所有提议编辑。勾选要采用的，跳过其余。冲突情况（资料与现有维基不一致）会被特别标出且永不直接覆盖——以"由你决定"形式抛出。',
          'Apply——被批准的编辑以草稿形式进入标准流程。每个草稿带有指向原始资料的来源链路，审核者随时知道信息来自哪里。',
        ],
      },
      {
        kind: 'h3',
        en: 'The agent playbook',
        zh: '智能体手册',
      },
      {
        kind: 'p',
        en: 'The agent\'s behavior during ingest is controlled by a single editable system prompt — the "agent playbook" (book icon in the top bar; admin-only edit). The playbook lives at config/agents.md on disk and is loaded into the system prompt of every ingest run.',
        zh: '智能体在 ingest 时的行为由一个可编辑的系统提示词控制——"智能体手册"（顶栏书本图标；仅管理员可编辑）。手册位于磁盘上 config/agents.md，每次 ingest 运行时都会被加载进系统提示。',
      },
      {
        kind: 'p',
        en: 'Admins edit the playbook to teach the agent your team\'s conventions: how to name new pages, when to flag conflicts instead of overwriting, what citation style to use, which page categories the agent is and isn\'t allowed to create in, when to summarize vs incorporate verbatim. The playbook is the single highest-leverage place to shape agent behavior — much better than trying to fix every bad draft individually.',
        zh: '管理员通过编辑手册来教会智能体你们团队的约定：如何命名新页面、何时应当标注冲突而不是覆盖、用什么引用风格、智能体可以/不可以在哪些分类下新建页面、何时摘要 vs 何时原文引入。手册是塑造智能体行为最高杠杆的地方——比对每个糟糕草稿逐个修补好得多。',
      },
      {
        kind: 'h3',
        en: 'When ingest goes wrong',
        zh: 'Ingest 出错时',
      },
      {
        kind: 'ul',
        en: [
          'Scanned PDFs (image-only, no embedded text layer) degrade poorly. The OpenAI provider falls back to text extraction via pypdf and gets "[no extractable text]"; the Anthropic provider sees the PDF natively. Convert to markdown first for best results.',
          'Very long sources may hit the model\'s context window. Split the source into logical chunks (one per topic) and ingest separately.',
          'Conflicts: if the source disagrees with an existing page, the agent emits a kind=conflict edit instead of overwriting. The review UI surfaces it specially — you choose which side wins.',
        ],
        zh: [
          '纯扫描件 PDF（没有内嵌文字层）效果不好。OpenAI 通道会用 pypdf 兜底提取文字，结果会是 "[no extractable text]"；Anthropic 通道可以原生看到 PDF。先转成 Markdown 通常效果最好。',
          '过长资料可能超过模型上下文窗口。把资料按主题拆成几块分别 ingest。',
          '冲突：当资料与已有页面不一致时，智能体发出 kind=conflict 的编辑而非直接覆盖。审核 UI 会特别显示这种情况，由你决定采用哪一方。',
        ],
      },
    ],
  },

  // ── Wiki lint ──────────────────────────────────────────────────────
  {
    id: 'lint',
    blocks: [
      {
        kind: 'p',
        en: 'Wiki lint (shield icon, admin only) is a read-only scan of the entire wiki by the AI agent. Unlike ingest, lint never proposes edits; it only surfaces a list of issues for humans to act on. Think of it as a code-linter applied to your knowledge base.',
        zh: '维基检查（盾牌图标，仅管理员）是 AI 智能体对整个维基的只读扫描。与 ingest 不同，lint 永远不会提议编辑；它只列出问题，由人类决定怎么处理。可以把它理解为应用到知识库上的"代码风格检查器"。',
      },
      {
        kind: 'h3',
        en: 'What lint looks for',
        zh: 'Lint 找什么',
      },
      {
        kind: 'ul',
        en: [
          'Orphans — pages with no inbound wikilinks. Either the page should be linked from a hub page, or it should be deleted.',
          'Broken wikilinks — [[target]] where the target doesn\'t resolve. The page being linked to either was renamed, deleted, or never existed.',
          'Conflicts — two pages making contradictory factual claims. Lint quotes both, flags the topic, and lets a human decide.',
          'Stale claims — assertions that look outdated based on body content (e.g. "as of 2024…" still in the page in 2026).',
          'Source drift — sources/* summaries whose underlying raw document was removed, or whose summary no longer matches the source.',
          'Other — structural issues per the agent playbook (e.g. "every runbook should have a Rollback section").',
        ],
        zh: [
          '孤立页面——没有任何反向链接的页面。要么从一个枢纽页加上链接，要么直接删除。',
          '失效 wikilink——[[目标]] 解析不到任何页面。要么目标被改名/删除，要么从来就不存在。',
          '冲突——两个页面对同一事实做出相互矛盾的论断。Lint 引用两边、标注主题、留给人类决定。',
          '过时陈述——根据正文判断已经过期的论断（如 2026 年页面里还写着 "as of 2024…"）。',
          '资料漂移——sources/* 摘要对应的原始文档被删除，或摘要已与原始资料不再一致。',
          '其它——按"智能体手册"约定的结构性问题（如"每份 runbook 都应该有 Rollback 一节"）。',
        ],
      },
      {
        kind: 'h3',
        en: 'Findings UI',
        zh: '发现列表',
      },
      {
        kind: 'p',
        en: 'Each finding shows a severity (low / medium / high), a short title, a body explaining the problem with the offending text quoted verbatim, the list of affected page paths, and a suggested action. Severity is the agent\'s calibration: high = correctness or safety risk; medium = quality drag; low = polish.',
        zh: '每条发现展示严重程度（低/中/高）、简短标题、附原文引用的问题说明、受影响的页面路径列表、以及建议动作。严重程度是智能体自评：高 = 正确性或安全风险；中 = 拖累质量；低 = 打磨细节。',
      },
      {
        kind: 'p',
        en: 'Click a finding to open the affected page directly into Suggest-edit mode, with the relevant section scrolled into view. The fix workflow is the same as any other edit — your change still routes through review.',
        zh: '点击某条发现可以直接打开受影响的页面进入"建议编辑"模式，并自动滚动到相关位置。修复流程与其它编辑无异——你的改动仍要经过审核。',
      },
      {
        kind: 'h3',
        en: 'When to run lint',
        zh: '何时跑 lint',
      },
      {
        kind: 'p',
        en: 'Lint is on-demand, not scheduled — costs add up if you run it on every commit. Sensible cadences: weekly, before a knowledge-base demo, after a big ingest batch, or whenever a reviewer notices the same class of mistake recurring. Findings are not auto-dismissed; you triage them down explicitly.',
        zh: 'Lint 按需触发，不自动定期跑——频繁跑会有 token 成本。合理节奏：每周一次、对外演示前、做完大批 ingest 之后，或当审核者注意到同一类问题反复出现时。发现不会自动清除，需要你显式处理 / 标记。',
      },
    ],
  },

  // ── MCP integration ────────────────────────────────────────────────
  {
    id: 'mcp',
    blocks: [
      {
        kind: 'p',
        en: 'MCP (Model Context Protocol) is how external LLM clients talk to this wiki as a tool. The plug icon in the top bar opens the MCP access panel; from there you create personal API tokens that you then paste into your MCP-capable client. Tokens authenticate as you, so your existing role and category permissions still apply — the external agent can do exactly what you can do, no more.',
        zh: 'MCP（Model Context Protocol）让外部大模型客户端把本维基当作工具调用。顶栏插头图标打开 MCP 接入面板；在那里生成个人 API Token，再粘贴到你支持 MCP 的客户端里。Token 以你的身份认证，因此原有的角色与分类权限照常生效——外部 agent 能做的恰好是你自己能做的，不会更多。',
      },
      {
        kind: 'h3',
        en: 'What you can plug it into',
        zh: '可以接入哪些客户端',
      },
      {
        kind: 'ul',
        en: [
          'Claude Desktop (Mac / Windows) — paste the config snippet into claude_desktop_config.json.',
          'Claude Code (CLI) — same JSON-RPC client.',
          'Cursor — Settings → Tools & Integrations → MCP servers.',
          'Custom agents — anything that speaks MCP JSON-RPC 2.0.',
        ],
        zh: [
          'Claude Desktop（Mac / Windows）——把配置片段贴到 claude_desktop_config.json 里。',
          'Claude Code（CLI）——同样的 JSON-RPC 客户端。',
          'Cursor——设置 → Tools & Integrations → MCP servers。',
          '自定义 agent——任何支持 MCP JSON-RPC 2.0 的客户端。',
        ],
      },
      {
        kind: 'h3',
        en: 'The tools exposed',
        zh: '暴露的工具',
      },
      {
        kind: 'ul',
        en: [
          'search_wiki(query) — chunk-level search with citations.',
          'get_page(path) — fetch the full body of a page.',
          'list_backlinks(path) — every page that links here.',
          'list_my_drafts() — drafts you authored that haven\'t shipped.',
          'list_review_queue() — drafts waiting on your review (editors + admins).',
          'create_draft(path, title, body, rationale) — propose an edit; routes through standard review.',
          'list_recent_changes(since) — accepted revisions since a timestamp.',
        ],
        zh: [
          'search_wiki(query)——按片段搜索，附引用。',
          'get_page(path)——获取页面完整正文。',
          'list_backlinks(path)——所有链接到该页面的页面。',
          'list_my_drafts()——你作者的尚未上线的草稿。',
          'list_review_queue()——等待你审核的草稿（编辑 + 管理员）。',
          'create_draft(path, title, body, rationale)——提议一次编辑，走标准审核流程。',
          'list_recent_changes(since)——某时间戳后已通过审核的版本。',
        ],
      },
      {
        kind: 'h3',
        en: 'Creating a token',
        zh: '生成 Token',
      },
      {
        kind: 'p',
        en: 'In the MCP access panel, click Create token, give it a descriptive name (e.g. "Claude Desktop on laptop"), and copy the resulting wt_… token immediately — it\'s shown exactly once. The panel also shows you the ready-to-paste JSON snippet for Claude Desktop\'s config file, with the wiki URL and Authorization header pre-filled.',
        zh: '在 MCP 面板点 Create token，起一个描述性的名字（如 "Claude Desktop on laptop"），立刻复制生成的 wt_… Token——它仅显示一次。面板同时显示可以直接粘贴到 Claude Desktop 配置文件的 JSON 片段，已填好维基 URL 与 Authorization 头。',
      },
      {
        kind: 'p',
        en: 'If you lose the token, you have to revoke it and create a new one. You can revoke any of your tokens from the same panel — useful when a laptop is decommissioned or a token leaks.',
        zh: '如果丢了 Token，只能吊销并重新生成。你可以在同一面板吊销自己的任意 Token——笔记本退役或 Token 泄露时很有用。',
      },
      {
        kind: 'h3',
        en: 'Admin controls',
        zh: '管理员控制',
      },
      {
        kind: 'p',
        en: 'Admins can globally disable MCP by setting MCP_ENABLED=false in the backend\'s .env (immediate kill switch — no token revocation needed). They can also disable MCP per-user from the access panel, which is useful when offboarding or revoking access for a specific person without touching the global switch.',
        zh: '管理员可以通过在后端 .env 中设置 MCP_ENABLED=false 全局关闭 MCP（立即生效的"总闸"，不需要逐个吊销 Token）。也可以在 MCP 面板按用户禁用——给特定人解除接入或离职处理时很有用，且不影响全局开关。',
      },
    ],
  },

  // ── Shortcuts ──────────────────────────────────────────────────────
  {
    id: 'shortcuts',
    blocks: [
      {
        kind: 'p',
        en: 'Press ⌘? (or just ? on its own when nothing is focused) anywhere in the app to pop up the keyboard-shortcut cheat sheet. Below is the full list. On macOS press Cmd; on Windows / Linux press Ctrl.',
        zh: '在应用任意位置按 ⌘?（或在没有输入框聚焦时直接按 ?）弹出键盘快捷键速查表。下面是完整列表。macOS 上按 Cmd，Windows / Linux 上按 Ctrl。',
      },
      {
        kind: 'h3',
        en: 'Global',
        zh: '全局',
      },
      {
        kind: 'ul',
        en: [
          '⌘K — open search',
          '⌘O — open quick switcher',
          '⌘E — suggest edit on current page',
          '⌘? or ? — show this shortcut sheet',
          'Esc — close any popover or dialog',
        ],
        zh: [
          '⌘K——打开搜索',
          '⌘O——打开快速切换',
          '⌘E——对当前页面提出编辑建议',
          '⌘? 或 ?——显示快捷键速查表',
          'Esc——关闭任意悬浮层或对话框',
        ],
      },
      {
        kind: 'h3',
        en: 'Tabs',
        zh: '标签页',
      },
      {
        kind: 'ul',
        en: [
          '⌘T — new tab',
          '⌘W — close current tab',
          '⌘⇧] — next tab',
          '⌘⇧[ — previous tab',
        ],
        zh: [
          '⌘T——新建标签页',
          '⌘W——关闭当前标签页',
          '⌘⇧]——下一个标签页',
          '⌘⇧[——上一个标签页',
        ],
      },
      {
        kind: 'p',
        en: 'Shortcuts don\'t fire while you\'re typing in an input or textarea — so pressing ? mid-sentence in the chat panel won\'t accidentally pop the shortcut sheet.',
        zh: '在输入框 / 文本域里输入时快捷键不会触发——所以在对话面板里写到一半按 ? 不会误开速查表。',
      },
    ],
  },

  // ── Themes & display ───────────────────────────────────────────────
  {
    id: 'themes',
    blocks: [
      {
        kind: 'h3',
        en: 'Dark / light theme',
        zh: '深色 / 浅色主题',
      },
      {
        kind: 'p',
        en: 'The sun/moon icon in the top bar toggles between light and dark themes. Both modes have an animated video background — a deep-space starfield in dark mode, an aurora-like sky in light mode — and there\'s a brief cross-fade video that plays during the transition itself. Your choice is remembered across reloads via localStorage.',
        zh: '顶栏的太阳/月亮图标切换深色与浅色主题。两种模式都有动画视频背景——深色模式是深空星场，浅色模式是极光天空——切换时还会播放一段过渡视频。你的选择通过 localStorage 跨刷新保留。',
      },
      {
        kind: 'h3',
        en: 'Fluid typography',
        zh: '流式排版',
      },
      {
        kind: 'p',
        en: 'The UI uses fluid type sizing — the root font size scales continuously from 15px on small displays to 19px on 4K via CSS clamp(). Every text size in the app is expressed in rem, which means it cascades from that fluid root. So if you bump your browser zoom or change your OS accessibility text size, the whole UI scales together instead of stranding small labels at fixed pixel sizes.',
        zh: '界面使用流式字号——根字号通过 CSS clamp() 从小屏的 15px 平滑缩放到 4K 上的 19px。应用里所有文字尺寸都用 rem，从流式根字号继承。因此当你调大浏览器缩放或操作系统的辅助文字大小时，整个界面同步缩放，不会留下一堆固定像素的小标签。',
      },
      {
        kind: 'h3',
        en: 'Language',
        zh: '语言',
      },
      {
        kind: 'p',
        en: 'The 中 / EN button in the top bar swaps the interface chrome between Mandarin Chinese and English. Choice is persisted in localStorage and shared between the wiki and this help site, so you don\'t have to set it twice. First-time visitors get a default based on their browser language (zh* → Chinese; everything else → English).',
        zh: '顶栏的 中 / EN 按钮在中英文之间切换界面 chrome。选择持久化到 localStorage，并在维基与本帮助站点之间共享，不需要设两次。首次访问时根据浏览器语言决定默认值（zh* → 中文；其它 → 英文）。',
      },
      {
        kind: 'p',
        en: 'Page content (the body of each wiki page) is not auto-translated. If you want bilingual content for a specific page, write it bilingually within the page body, or create two parallel pages (e.g. design/visual-language.md and design/visual-language.zh.md) and link them with wikilinks.',
        zh: '页面正文（每个维基页面的内容）不会被自动翻译。如果你希望某页双语，可以在正文里直接写两份，或者建两个并行页面（如 design/visual-language.md 与 design/visual-language.zh.md）并用 wikilinks 互相链接。',
      },
    ],
  },

  // ── FAQ ────────────────────────────────────────────────────────────
  {
    id: 'faq',
    blocks: [
      {
        kind: 'h3',
        en: 'Why don\'t I see the Review queue?',
        zh: '为什么我看不到审核队列？',
      },
      {
        kind: 'p',
        en: 'The Review queue (inbox icon) only appears for editors and admins. If you\'re a contributor or reader, you won\'t see it. Use the role switcher in the top bar (dev mode only) to verify, or ask an admin to bump your role.',
        zh: '审核队列（收件箱图标）只对编辑和管理员显示。贡献者或只读用户看不到。开发模式下可以用顶栏角色切换器确认，正式环境下让管理员调整你的角色。',
      },
      {
        kind: 'h3',
        en: 'The agent proposed something wrong — can I just edit it?',
        zh: '智能体提议的内容不对——我能直接改吗？',
      },
      {
        kind: 'p',
        en: 'Yes. Agent-authored drafts enter the same Review queue as human drafts. In the diff view you can edit the body directly, then approve — the published version will be your edited form, not the agent\'s original. Your rejection notes (when you reject) are also surfaced to the agent on its next run, so the same class of bad proposal stops recurring.',
        zh: '可以。智能体的草稿与人类草稿一样进入审核队列。在差异视图中可以直接修改正文然后批准——最终发布的是你修改后的版本，而不是智能体原来的。你的驳回理由在智能体下次运行时也会反馈给它，让同一类糟糕提议不再出现。',
      },
      {
        kind: 'h3',
        en: 'I uploaded a PDF but ingest fails',
        zh: '我上传了 PDF 但 ingest 失败',
      },
      {
        kind: 'p',
        en: 'A few common causes: (a) you\'re on the OpenAI provider and the PDF is scanned image-only — text extraction via pypdf returns nothing. Convert to markdown first. (b) The PDF is enormous and overruns the context window — split into smaller documents. (c) Your provider\'s API key is missing or rate-limited — check the backend logs.',
        zh: '常见原因：(a) 使用 OpenAI 通道且 PDF 是纯扫描件——pypdf 提取不到文字。先转成 Markdown。(b) PDF 过大超过上下文窗口——拆成更小的文档。(c) 通道 API Key 缺失或被限速——检查后端日志。',
      },
      {
        kind: 'h3',
        en: 'How is search different from quick switcher?',
        zh: '搜索和快速切换有什么区别？',
      },
      {
        kind: 'p',
        en: 'Quick switcher (⌘O) matches page titles and paths only. Use it when you already know what the page is called. Search (⌘K) matches page contents — it does chunk-level full-text and vector search over the actual body of every page. Use it when you only remember a phrase or concept.',
        zh: '快速切换（⌘O）只匹配页面标题与路径。已经知道页面叫什么时用它。搜索（⌘K）匹配页面内容——对每个页面的正文做基于片段的全文与向量混合检索。只记得一个短语或概念时用它。',
      },
      {
        kind: 'h3',
        en: 'Can I undo a published revision?',
        zh: '已发布的版本能撤销吗？',
      },
      {
        kind: 'p',
        en: 'You don\'t literally rewind history — every revision stays in the version log. But you can revert the page back to a prior revision: open Version history, find the version you want to restore, and click Restore. That action creates a new draft whose body is the old version; the draft routes through review as normal. The "undo" is itself an auditable, reviewable action.',
        zh: '历史并不会被真的回滚——每个版本都留在版本日志里。但你可以把页面回滚到之前的某个版本：打开版本历史，找到想恢复的那个版本，点 Restore。这个动作会创建一份新草稿，正文是旧版本；草稿同样走审核流程。"撤销"本身也是一次可审计、可审核的操作。',
      },
      {
        kind: 'h3',
        en: 'Where does the data live?',
        zh: '数据存在哪里？',
      },
      {
        kind: 'p',
        en: 'Page bodies and revisions live in Postgres (with pgvector for embeddings). Raw uploaded sources live on disk in raw/. The agent playbook lives at config/agents.md. In the docker-compose setup all three are bind-mounted from the host, so backups and inspections are straightforward — no separate object storage to wrangle.',
        zh: '页面正文和版本存在 Postgres（pgvector 存向量）。原始上传资料存在磁盘的 raw/。智能体手册存在 config/agents.md。在 docker-compose 配置中三者都从宿主机绑定挂载，所以备份和检查都很直接——不需要额外对接对象存储。',
      },
    ],
  },
];
