# Frontend Functional Requirements (UI / E2E)

Scope: the Next.js app (`app/page.tsx` shell + `components/*`). Role for tests is
set via stub mode (dev role `<select>` or `dev-login`). `canReview = role in
{admin, editor}`; `canSuggest = role != reader`; `isAdmin = role == admin`.
Conventions in [`README.md`](README.md). Many anchors are text/`aria-label`/`title`
based; see test-id recommendations in [`non-functional-and-gaps.md`](non-functional-and-gaps.md).

---

## FR-UI-SHELL — Top bar & app shell (`app/page.tsx`)

- **FR-UI-SHELL-001** — The top bar renders brand, search box, and the action cluster on load. [component]
- **FR-UI-SHELL-002** — Theme toggle (`[aria-label="Toggle theme"]`) flips light/dark (swaps Sun/Moon icon, flips `<html data-theme>`); when signed in it persists via `savePreferences({appearance})`; a save failure keeps the local change. [E2E]
- **FR-UI-SHELL-003** — Language toggle (`[aria-label="Toggle language"]`) flips en/zh; the button shows the *other* language; UI strings switch. [component]
- **FR-UI-SHELL-004** — Dev role `<select>` writes `wiki:role`/`wiki:email` and reloads; gated buttons appear/disappear accordingly. [E2E]
- **FR-UI-SHELL-005** — "Sign out" (shown only when signed in) clears `wiki:jwt/email/role`, sets `wiki:signed-out=1`, POSTs `/auth/logout`, redirects to `/login` even if logout rejects. [E2E]
- **FR-UI-SHELL-006** — Suggest button visible only for `role != reader`; Review (Inbox) + its amber count badge visible only for `canReview` (badge text == `queue.length`, hidden at 0); Lint (ShieldCheck) visible only for admin. [component]
- **FR-UI-SHELL-007** — Bell toggles the notifications panel; rose badge shows unread count (hidden at 0). Sources/Schema/MCP/Help buttons open their panels; Artifacts (Share2) navigates to `/artifacts`. [E2E]
- **FR-UI-SHELL-008** — `mod+k` focuses+selects the search box and opens its dropdown. [E2E]
- **FR-UI-SHELL-009** — Tree resize gutter (`[aria-label="Resize file tree"]`, role=separator): drag live-resizes (writes `--tree-w`), persists `wiki:tree-width` on mouseup, clamps **180-480px**; double-click resets to **240**; Arrow keys nudge by 16px. [E2E]
- **FR-UI-SHELL-010** — Chat collapse toggle flips the chat column 320/40px and persists `wiki:chat-collapsed`. [E2E]
- **FR-UI-SHELL-011** — Bottom-left corner shows the VersionLog badge + Settings gear (the **only** settings trigger — there is no topbar gear). [component]
- **FR-UI-SHELL-012** — Review queue + notifications auto-refresh on a 30s SWR interval. [E2E-timer/mock]

## FR-UI-PAGE — Page view (`PageView.tsx`, `Markdown.tsx`)

- **FR-UI-PAGE-001** — Active page tab with `page===null` shows "Select a page from the tree..."; loaded page renders toolbar + `h1` title (== `page.title`) + metadata strip + body + backlinks + comments. [component]
- **FR-UI-PAGE-002** — Toolbar breadcrumb shows `page.path` with `/` as ` · `; "Suggest edit" visible only `role != reader` -> opens ProposeDialog (edit mode). [component]
- **FR-UI-PAGE-003** — Flag button hover reveals a 3-item submenu (Incorrect/Outdated/Needs source); choosing one prompts for a note and (if non-empty) POSTs `/pages/{path}/flags` with the matching kind; cancel/empty prompt -> no-op. [E2E]
- **FR-UI-PAGE-004** — Lock/Unlock button visible only for admin; click POSTs `/pages/{path}/lock?locked=...`; label/icon reflect `stability==='locked'`. [E2E]
- **FR-UI-PAGE-005** — "More" (kebab) opens the page ContextMenu (portal in body) anchored to the button. [E2E]
- **FR-UI-PAGE-006** — Open-flags banner appears (amber) when >=1 flag has `status==='open'`, showing the count (one/many pluralized) + first flag body + `(+N more)`. [component]
- **FR-UI-PAGE-007** — Metadata strip: "Updated {date}" (locale-formatted, falls back to raw on bad date); "Last edit by {author}" only when a latest accepted/superseded revision exists; stability badge `.badge.{open|stable|locked}`; "{n} revision(s)" button opens version history; up to 8 tags as `#tag` badges (`data-rainbow={i%7}`), hidden when none. [component]
- **FR-UI-PAGE-008** — Body renders GFM markdown with code highlighting (`react-markdown`+`remark-gfm`+`rehype-highlight`). [component]
- **FR-UI-PAGE-009** — Wiki-link `[[Target]]`: resolves via exact path then slug match; **plain click -> new tab**, **Cmd/Ctrl-click -> same tab**, **middle-click -> new tab**; unresolved target gets class `wiki-link broken` and still fires with the raw target. [component]
- **FR-UI-PAGE-010** — `[[path|label]]` shows `label`; `[[path#hash]]` navigates to `path` (hash dropped). [component]
- **FR-UI-PAGE-011** — Backlinks section always shown; header "Backlinks (N)"; empty -> "No pages link here yet"; clicking a backlink navigates (same tab). [component]
- **FR-UI-PAGE-012** — Comments: list renders avatar/name/date/body; empty -> italic empty text; Post is disabled when the input is blank; Enter or Post calls `createComment`, clears the input, and refetches. [E2E]
- **FR-UI-PAGE-013** — Page "More" menu items with gating: Bookmark/Unbookmark (disabled when signed-out), Reveal in tree, Copy path, Version history, Export to PDF (`window.print`), **Rename = always disabled**, Move file (editor/admin only), **Merge = always disabled**, Delete file (admin only, confirm()->DELETE). [component][E2E]

## FR-UI-PROP — Suggest edit / Propose (`ProposeDialog.tsx`)

- **FR-UI-PROP-001** — Opened with an active page -> edit mode prefilled (title/body/tags); opened "as new" (or with no page) -> new mode with Path+Category+Title+Tags inputs. [component]
- **FR-UI-PROP-002** — Stability helper text (edit mode): open->emerald "auto-publishes", stable->amber, locked->rose. [component]
- **FR-UI-PROP-003** — Edit/Preview toggle swaps the textarea for a rendered `<Markdown>`; empty body in preview -> italic empty text. [E2E]
- **FR-UI-PROP-004** — New-mode category dropdown always includes the seed categories (engineering/product/design/operations/research/sources) plus custom folders and path prefixes. [component]
- **FR-UI-PROP-005** — Submit calls `createDraft(...)` then `submitRevision(id)`; the button is disabled while submitting or when title/body (and, in new mode, path) are blank; an API error shows `alert(message)`. [E2E]
- **FR-UI-PROP-006** — Done screen: returned `status==='accepted'` -> "auto-publishes; live" message; `status==='proposed'` -> "an editor/admin will review it." New pages are created with stability `stable` (always reviewed). [component]
- **FR-UI-PROP-007** — Cancel / X / backdrop / `Esc` closes and triggers parent refresh (pages/graph/page/queue/notifs); body scroll is locked while open. [E2E]

## FR-UI-REV — Review queue (`ReviewQueue.tsx`)

- **FR-UI-REV-001** — Opens with title "Review (N)"; left list + right detail; reachable only by `canReview`. [component]
- **FR-UI-REV-002** — Empty queue -> list shows empty text; right pane shows "Select a revision to review". [component]
- **FR-UI-REV-003** — Selecting a revision loads detail header "rev #{id}"; auto-selects first (or keeps current) on load. [E2E]
- **FR-UI-REV-004** — Diff tab renders `<Diff>` of parent body vs selected body (`.diff-add`/`.diff-del`/`.diff-ctx`); a new page (no parent) shows all additions. Preview tab renders Markdown; Raw tab shows `<pre>`. [component]
- **FR-UI-REV-005** — Agent-authored revisions show a "Agent authored" badge + edit_kind + confidence badge + conflict notes + expandable source grounding (quotes/locations); human revisions hide these. [component]
- **FR-UI-REV-006** — Agent drafts show reject reason `<select>` + notes; human drafts hide them. [component]
- **FR-UI-REV-007** — Accept / Reject / Request changes each POST `/revisions/{id}/review` with the matching decision (+ optional comment; reject extras only for agent drafts); the item leaves the queue and the topbar badge decrements on refresh. [E2E]
- **FR-UI-REV-008** — Close (X/backdrop/`Esc`) triggers parent refresh. [E2E]

## FR-UI-VER — Version history & log (`VersionHistory.tsx`, `VersionLog.tsx`)

- **FR-UI-VER-001** — VersionHistory lists `listRevisions(path)` with status badge + `rev #id` + datetime + author + title + rationale; empty -> "No revisions yet."; close via X/backdrop/`Esc`. [component]
- **FR-UI-VER-002** — Rows are **non-interactive in the app** (`onOpenRevision` is not wired) — see GAP for the missing diff/restore. [component]
- **FR-UI-VER-003** — VersionLog badge shows `APP_VERSION`; when a newer GitHub release exists (cached 1h) it shows an amber "update available" badge + Sparkles; clicking opens a dropdown of up to 12 releases (loading/error/empty states); release links open in a new tab. [component]

## FR-UI-TREE — File tree (`FileTree.tsx` + tree toolbar)

- **FR-UI-TREE-001** — Tree toolbar: New note (disabled for reader) opens ProposeDialog new mode; New folder inserts an inline focused input row; Sort toggle reverses order + persists `wiki:tree-sort`; Collapse/Expand-all toggles all folders; 2D/3D buttons open the graph tab (active mode highlighted). [E2E]
- **FR-UI-TREE-002** — Inline pending-folder: Enter confirms (adds custom folder), `Esc` cancels, blur settles once (non-empty->confirm). [E2E]
- **FR-UI-TREE-003** — Tree builds from page paths nested by `/`; folders first then alphabetical; files show `page.title`; custom folders appear as empty placeholders. [component]
- **FR-UI-TREE-004** — Click a file -> `onSelect(path)` navigates (replaces active tab) + highlights the row (`data-path` anchor); click a folder -> expand/collapse (chevron rotates). [E2E]
- **FR-UI-TREE-005** — Locked files show a lock icon; hovering a row fires `onHover` (graph highlight bridge); right-click opens the file/folder context menu and suppresses the native menu. [E2E]
- **FR-UI-TREE-006** — Drag-reorder: only top-level folders are draggable (when `onReorderFolders` set); source dims; a drop indicator (accent line) shows above the target; drop persists the new folder order; files are not draggable. [E2E]
- **FR-UI-TREE-007** — Imperative handle: `collapseAll`/`expandAll` (toolbar), `reveal(path)` opens ancestors + scrolls the file into center. [E2E]
- **FR-UI-TREE-008** — Bookmarks section renders above the tree only when >=1 bookmark; click navigates; hover reveals a trash to remove; no bookmarks fetched when signed-out. [component]

## FR-UI-MENU — Context menus (`ContextMenu.tsx`, builders in `app/page.tsx`)

- **FR-UI-MENU-001** — File menu: **Open in new tab** (always; `tabs.openPage(path,true)`), Suggest edit (disabled for reader), Make a copy (disabled for reader; createDraft `-copy`+submit), Copy path, **Publish as gated link** (disabled when signed-out -> opens PublishArtifactModal), Version history, Bookmark/Unbookmark (disabled signed-out), Move file (editor/admin only), Delete file (admin only, danger, confirm->DELETE). [component][E2E]
- **FR-UI-MENU-002** — Folder menu: New note (reader-disabled), New subfolder (prompt), Rename (enabled only for custom folders), Copy path, Delete (enabled only for an **empty custom** folder). [component]
- **FR-UI-MENU-003** — ContextMenu renders in a body portal (min-width 210px); closes on outside click/`Esc`; clicking an enabled item runs its action then closes; disabled items are opacity-dimmed with a `title` hint; the menu clamps to the viewport (shifts up/left near edges); labels re-translate live on language flip. [E2E]

## FR-UI-MOVE — Move page dialog (`MovePageDialog.tsx`)

- **FR-UI-MOVE-001** — Folder-tree picker expands ancestors of the current folder; "(root)" always present; the current folder row is shown muted/non-selectable. [component]
- **FR-UI-MOVE-002** — Selecting a target shows a preview path `target/filename` (filename preserved); Confirm is disabled when the target equals the current folder. [component]
- **FR-UI-MOVE-003** — Confirm calls `movePage` then refetches pages/graph/bookmarks and rewrites open tabs to the new path; an API error shows an inline rose box; busy shows a spinner. [E2E]
- **FR-UI-MOVE-004** — Cancel / X / backdrop / `Esc` closes; body scroll locked while open. [E2E]

## FR-UI-TABS — Tabs (`TabBar.tsx`, `NewTab.tsx`, `lib/tabs.ts`)

- **FR-UI-TABS-001** — Each tab shows a kind icon + label; the active tab is visually distinct; click activates; X (`[aria-label="Close tab"]`) or middle-click closes; "+" (`[aria-label="New tab"]`) appends a "new" tab and activates it. [E2E]
- **FR-UI-TABS-002** — `openPage(path, asNewTab)`: true -> append+activate; false -> replace the active tab's content. `openGraph(mode)` reuses an existing graph tab or changes the active graph's mode. [component]
- **FR-UI-TABS-003** — `closeTab`: if the active tab closes, the previous one activates; **closing the last tab creates a fresh "new" tab** (never zero tabs). [component]
- **FR-UI-TABS-004** — `rewritePagePath(old,new)` updates all page tabs after a move. Tabs persist to `wiki:tabs`; corrupt/empty storage recovers to a single new tab; no SSR hydration mismatch. [component]
- **FR-UI-TABS-005** — NewTab page actions: "Create new note" + `Ctrl+E` (disabled/"Readers cannot create notes" for reader), "Go to file" + `Ctrl+O` (opens QuickSwitcher), "Close" + `Ctrl+W` (closes active tab). [component][E2E]

## FR-UI-QS — Quick switcher (`QuickSwitcher.tsx`)

- **FR-UI-QS-001** — Opens via `mod+o` (or NewTab "Go to file"); input auto-focused; body scroll locked; footer shows nav hints. [E2E]
- **FR-UI-QS-002** — Empty query shows recents first (from `wiki:recent-paths`) then alphabetical pages; typing applies fuzzy scoring (prefix>substring>subsequence, boundary + recent boosts) and sorts desc; no match -> `No pages match "q"`. [component]
- **FR-UI-QS-003** — Arrow up/down moves the active row (scrolls into view); hover sets active; Enter/click navigates and closes; rows show a stability badge only when `!=stable`; list caps at 80. [E2E]
- **FR-UI-QS-004** — `Esc`/backdrop closes. [E2E]

## FR-UI-SEARCH — Topbar search dropdown (`SearchResults.tsx`)

- **FR-UI-SEARCH-001** — Typing debounces **220ms** then calls `search(q)` and shows up to 8 results; empty query renders nothing; loading shows "Searching..."; no results -> `No results for "q"`; a fetch error renders empty. [E2E][component]
- **FR-UI-SEARCH-002** — A result row shows title + path (+ `· L{a}-{b}` only for code chunks) + a 2-line snippet. [component]
- **FR-UI-SEARCH-003** — Arrow up/down highlights; Enter/click navigates and clears the query; `Esc`/outside click closes. [E2E]

## FR-UI-KEYS — Keyboard shortcuts (`app/page.tsx`, `lib/hotkeys.ts`)

- **FR-UI-KEYS-001** — Implemented global shortcuts: `mod+k` (search), `mod+o` (switcher), `mod+e` (propose; only `role != reader`), `mod+t` (new tab), `mod+w` (close tab), `mod+?`/`mod+/`/bare `?` (shortcut sheet; bare `?` ignored while typing), `Esc` (close active overlay). [E2E]
- **FR-UI-KEYS-002** — Shortcuts are rebindable per-user via Settings -> Hotkeys (`resolveBindings(prefs)`); a rebind persists to the account and displays the new combo. [E2E]
- **FR-UI-KEYS-003** — The ShortcutSheet (`?`) lists all rows (it always shows the default glyphs, not user rebinds). [component]

## FR-UI-SRC — Sources panel (`SourcesPanel.tsx`)

- **FR-UI-SRC-001** — Opens from the Files icon; `canUpload = role != reader`; the list (`raw-sources`) polls every 2500ms while any source is `ingesting`. [component]
- **FR-UI-SRC-002** — File/URL import tabs (default File); drag-drop or "Choose file" uploads each file then refetches; for reader the dropzone is dimmed/disabled with a sign-in hint. [E2E]
- **FR-UI-SRC-003** — URL import: URL + optional title; Import disabled when blank/importing; Enter triggers import; success clears inputs; empty URL -> error. [E2E]
- **FR-UI-SRC-004** — Empty list -> centered empty text; error -> rose banner above the list. [component]
- **FR-UI-SRC-005** — Source row shows mime icon, title, status badge (`done->accepted`, `failed->rejected`, `ingesting->proposed`, else `draft`), `filename · size · mime`, optional source URL, uploader + time, description, last-ingest notes. [component]
- **FR-UI-SRC-006** — "Ingest" (or primary "Retry ingest" when failed) runs the pre-flight: if pending drafts exist it opens a duplicate-warning modal (Cancel/Continue); for PDF/image it opens an external-processing prompt; then `ingestRawSource` opens the plan preview. [E2E]
- **FR-UI-SRC-007** — While ingesting, "Open plan" fetches latest run (no runs -> error). History (clock) toggles the inline `SourceHistory` (run rows, retry, open-plan link; polls 4000ms). Download opens the file. Delete (trash) is admin-only and confirms. [E2E]

## FR-UI-INGP — Ingest plan preview (`IngestPlanPreview.tsx`)

- **FR-UI-INGP-001** — Polls `ingest-run:{id}` (1500ms while planning/applying); mutually-exclusive status screens: loading / planning / failed (+Retry apply) / applying (`{n}/{m}`) / partially_failed (+Retry remaining) / terminal (done/dismissed/superseded) / pending_review (editable). [E2E]
- **FR-UI-INGP-002** — On entering `pending_review` all edits are auto-approved; a counts bar shows proposed/conflict/over-cap + confidence breakdown + "{approved} of {total} approved". [component]
- **FR-UI-INGP-003** — Each edit card: checkbox (disabled unless pending), kind icon+label, path, confidence badge, title, rationale, conflict notes, source refs, and a Show/Hide body (Markdown). [component]
- **FR-UI-INGP-004** — "Approve (N)" sends `null` if all approved else the sorted index array; disabled unless pending + >0 selected; "Dismiss" confirms then dismisses; empty plan -> "Agent proposed no edits". [E2E]
- **FR-UI-INGP-005** — NOTE: copy here is **hardcoded English** (not i18n) — see NFR-I18N. [component]

## FR-UI-SCHEMA — Schema / idea-file editor (`SchemaEditor.tsx`)

- **FR-UI-SCHEMA-001** — Opens from the BookText icon; loads `idea-file`; shows a read-only lock badge when `!can_edit`; intro band under the header. [component]
- **FR-UI-SCHEMA-002** — View toggle edit/split/preview (default split); textarea bound to `draft` (disabled unless editable); preview renders Markdown (empty -> italic). [component]
- **FR-UI-SCHEMA-003** — Dirty indicator (amber) when `draft != content` & editable; Save (admin-only; disabled unless dirty) calls `updateIdeaFile` -> "Just saved"; Reset restores the draft. [E2E]
- **FR-UI-SCHEMA-004** — Footer shows last-saved time and (after save) a just-saved marker. [component]

## FR-UI-LINT — Lint panel (`LintPanel.tsx`)

- **FR-UI-LINT-001** — Opens from the ShieldCheck icon (**admin-only** at the topbar); SWR `lint-reports` polls 2500ms while a report is planning. [component]
- **FR-UI-LINT-002** — "Run lint" (disabled while running) creates+selects a report; meta line shows `Report #id · status · model · finished`. [E2E]
- **FR-UI-LINT-003** — States: no report -> CTA; planning -> spinner; failed -> rose error; zero visible -> CheckCircle + (no issues / all dismissed) text. [component]
- **FR-UI-LINT-004** — Issues grouped by kind in fixed order (orphan/broken_link/conflict/stale/source_drift/other) with per-kind icon + count; each row: severity badge + status badge + title + affected paths; dismissed rows dimmed; "Show dismissed" toggles them. [component]
- **FR-UI-LINT-005** — Expanded issue shows description + suggested action + dismiss note, plus per-path "Open {path}" (marks acted -> navigates + closes) and "Suggest edit" (marks acted -> opens Propose on that page); "Dismiss" prompts for a note -> `dismissLintIssue` (persists, reappears under Show dismissed). [E2E]
- **FR-UI-LINT-006** — When >1 report, a history strip lists up to 12; clicking one loads its issues. [E2E]

## FR-UI-MCP — MCP access panel (`MCPAccessPanel.tsx`)

- **FR-UI-MCP-001** — Opens from the Plug icon; when `mcp_enabled=false` shows a locked "not granted" card and hides token creation. [component]
- **FR-UI-MCP-002** — Create token: name input (Enter submits) + Create (disabled when blank/creating); on success shows the raw token **once** with Copy (-> "Copied" 1.5s) + a config snippet (`url=.../mcp`, `Authorization: Bearer <token>`) + Hide. [E2E]
- **FR-UI-MCP-003** — Token list shows each token (name, created, last-used) with revoke (confirm -> `revokeMcpToken`); empty -> italic text. [E2E]
- **FR-UI-MCP-004** — Admin section lists non-agent users with a per-user MCP grant/revoke toggle (`setUserMcpAccess`); hidden for non-admins. [E2E]

## FR-UI-NOTIF — Notifications panel (`NotificationsPanel.tsx`)

- **FR-UI-NOTIF-001** — Opens from the Bell; closes on outside mousedown; header shows title + unread pill + "Mark all read" (only when unread>0 -> `markAllRead` + refetch). [E2E]
- **FR-UI-NOTIF-002** — Empty -> "all caught up"; each row shows body + relative time (localized), unread rows tinted; "Open" (when `link`) calls `onLink` (routes `/pages/...` to the page, `/review/...` to the review queue); per-row check marks one read. [E2E]

## FR-UI-GRAPH — Graph view (`GraphView.tsx`, `Plexus.tsx`)

- **FR-UI-GRAPH-001** — Rendered when the active tab is a graph; 2D/3D toggle from the toolbar (active mode highlighted); engine lazy-loads with a placeholder; a render crash shows a recover boundary. [E2E][component]
- **FR-UI-GRAPH-002** — Nodes/edges build from `data` plus synthesized folder nodes + parent/folder/tag edges; clicking a non-folder node navigates; folder nodes are click no-ops. [E2E]
- **FR-UI-GRAPH-003** — Hovering a node focuses it + neighbors (others dim); file-tree hover highlights matching nodes (overrides node hover). [E2E]
- **FR-UI-GRAPH-004** — Graph settings panel toggles from a top-right Sliders button (graph tab only); slider changes re-apply d3 forces (throttled reheat) and visual changes mutate meshes without relayout; dragging a node and releasing springs it back. [component][E2E]
- **FR-UI-GRAPH-005** — Timelapse (2D) reveals nodes chronologically with a counter; 3D auto-rotates after idle and pauses on interaction; the background wash flips with light/dark; the debug overlay appears only when `NEXT_PUBLIC_GRAPH_DEBUG=1`. [E2E]

## FR-UI-GSET — Graph settings (`GraphSettings.tsx`)

- **FR-UI-GSET-001** — Persists to **localStorage `wiki:graph-settings:v2` only** (not account-synced). [component]
- **FR-UI-GSET-002** — Display sliders (nodeSize/lineThickness/glow/depthScale), force sliders (center/repel/link/linkDistance), link options (color/style/particles), per-folder color + physics overrides, and Reset-all. [component]

## FR-UI-CHAT — Chat panel (`ChatPanel.tsx`)

- **FR-UI-CHAT-001** — Collapse/expand keeps state mounted; mode toggle (Sources/Wiki, default Sources) persists to `wiki:chat-mode`; empty state shows intro + 3 suggestion buttons (populate input, don't send). [E2E]
- **FR-UI-CHAT-002** — Send (Enter without Shift, or button; disabled while busy or blank) appends the user bubble, calls `chat(text, history, mode)`, shows a 3-dot **busy** indicator (response is awaited then rendered — not token-streamed), and renders the assistant bubble with citation buttons + inline wiki-links (click -> `onCitationClick`). [E2E]
- **FR-UI-CHAT-003** — An API error shows `_Error: ..._`; Clear (when messages exist) wipes history + sessionStorage. History persists per-tab in sessionStorage. [component]

## FR-UI-SET — Settings modal (`SettingsModal.tsx`)

- **FR-UI-SET-001** — Opened from the bottom-left gear; tabs General / Hotkeys / Appearance; `Esc` first cancels an in-progress rebind, else closes. [E2E]
- **FR-UI-SET-002** — General: version row (+update-available), language English/中文 buttons (switch the whole UI), account row (sign out / sign-in link). [E2E]
- **FR-UI-SET-003** — Hotkeys: signed-out -> disabled with a banner; 5 rebindable rows (search/switcher/suggest/newTab/closeTab) each with Rebind (records the next combo, persists) + Reset; Reset-all; fixed rows (help/nextTab/prevTab/Esc) read-only. [E2E]
- **FR-UI-SET-004** — Appearance: theme gallery (**Aurora, Sakura, Slate, Synthwave, Rainbow**) — clicking a card applies the theme (`data-theme-id` + localStorage + account save) with the active card ringed; light/dark segmented control applies the mode; appearance is restored from the account on load. [E2E]

## FR-UI-THEME — Theme system (`lib/theme.ts`, `themes.ts`, background components)

- **FR-UI-THEME-001** — A pre-paint inline script sets `data-theme-id` + `data-theme` before first paint (no flash). [E2E]
- **FR-UI-THEME-002** — Two orthogonal axes persist (`wiki:theme`, `wiki:theme-id`); mode change emits `theme:change`. [component]
- **FR-UI-THEME-003** — `BackgroundLayer` routes `aurora` -> `VideoBackground` (4-clip loop + swirl transition); any other id -> `ThemeBackground` (video/image/CSS, cross-fade on mode flip; Synthwave at 0.6x rate; Slate = CSS-painted). [E2E]
- **FR-UI-THEME-004** — Rainbow theme specials: under `[data-theme-id="rainbow"]` the note title + H1-H6 + tags + file-tree rows render gradient-clipped rainbow text, and chrome buttons (topbar/tree toolbar/note toolbar/new-tab/bottom badge+gear) take rainbow colors; separate dark (Dracula) and light (Alucard) palettes. [E2E]
- **FR-UI-THEME-005** — `getTheme(unknownId)` falls back to Aurora. [component]

## FR-UI-I18N — Language (`lib/i18n.ts`)

- **FR-UI-I18N-001** — The EN/中 toggle (topbar, /help, /artifacts) persists `wiki:lang`, sets `<html lang>`, emits `lang:change`, and every `useLanguage()` consumer updates instantly. [E2E]
- **FR-UI-I18N-002** — First visit with no saved lang auto-detects from `navigator.language` (zh -> Chinese). [component]
- **FR-UI-I18N-003** — Coverage: the panels under FR-UI-* are localized incl. Notifications/Review/Sources/Schema/Lint/MCP (recently added). Known un-localized surfaces are tracked under NFR-I18N/GAP. [component]

## FR-UI-AUTH — Auth UI (`LoginModal.tsx`, `/login`, `/auth/callback`)

- **FR-UI-AUTH-001** — LoginModal (oidc mode, no JWT) loads auth options: OIDC button (-> IdP) and/or local admin form (email+password -> stores JWT, clears stub headers, `onAuthed`); neither configured -> rose instructions; failure -> rose banner. [E2E]
- **FR-UI-AUTH-002** — `/login` page: theme toggle; `?next=` accepts same-origin paths only; already-authed bounce (unless `wiki:signed-out`); a gated-artifact banner when `next` starts `/a/`; successful login clears the sign-out block. [E2E]
- **FR-UI-AUTH-003** — `/auth/callback` captures `#token` -> stores JWT -> wipes the fragment -> redirects to `/`; `#error` shows a failure screen; missing token shows "No token...". [E2E]
- **FR-UI-AUTH-004** — Stub mode auto-admin on fresh load (unless signed-out); sign-out sets `wiki:signed-out=1` and sticks across reload. [E2E]

## FR-UI-HELP — Help & manual (`UserManual.tsx`, `/help`)

- **FR-UI-HELP-001** — The HelpCircle dropdown shows header + an "open full docs" card (-> `/help`) + 7 sectioned legend entries; closes on outside click/`Esc`. [E2E]
- **FR-UI-HELP-002** — `/help` page: sidebar of 11 topics (one section at a time, updates `#hash`, scrolls top), deep-link via hash, search filter (no match text), EN/中 toggle, "<- Wiki" link. [E2E]

## FR-UI-ART — Artifacts SaaS (`app/artifacts/page.tsx`, `artifacts/PublishArtifactModal.tsx`)

- **FR-UI-ART-001** — `/artifacts` resolves identity via whoami -> signed-in lists own artifacts; signed-out lists only public ones (and shows locked cards for private/wiki sections + a signed-out banner). [E2E]
- **FR-UI-ART-002** — Three sections (private->wiki->public) with counts; search filters by name/short_id; Refresh re-fetches; theme + language toggles shared. [E2E]
- **FR-UI-ART-003** — "New artifact" tile/button (signed-in) opens PublishArtifactModal (`mode=file, allowPublic=true`); publishing refetches the grid. [E2E]
- **FR-UI-ART-004** — Card: rename (inline; Enter/blur -> `patchArtifact`), visibility chip cycles private->wiki->public (`patchArtifact`; switching to public may 403 -> error banner, prior visibility kept), `{views}/7d` + optional expiry, Copy link (-> "Copied"), Open (new tab), New version (upload html/htm/md/txt), Access log (modal; empty -> "No views yet."), Delete (Trash -> "Confirm?" -> `deleteArtifact`). [E2E]
- **FR-UI-ART-005** — PublishArtifactModal (page mode from file-tree right-click / page kebab; file mode from /artifacts): source toggle Upload-file vs Write-content (format select + textarea); optional name; visibility radios (Public disabled when `!allowPublic`); expiration (never/7d/30d/custom date); Publish (disabled when no file/content) -> success view with select-on-click URL + Copy + Open; a failure shows a rose error and keeps the modal open. [E2E]
- **FR-UI-ART-006** — Artifact viewer access: a private/wiki link while signed-out bounces to `/login?next=/a/<token>` (banner) and returns to the artifact after login; public links open with no login. [E2E]
