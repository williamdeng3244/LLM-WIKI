# E2E tests (Playwright, dockerized)

The WSL2 host lacks chromium system libs (`libnss3`, `libasound2`) and we have no
sudo, so Playwright runs via the **official image** with host networking.

## Prereqs
App up via docker compose (frontend `:3000`, backend in **stub** auth mode):

    docker compose up -d

## Run
From the repo root:

    docker run --rm --network host \
      -e NODE_OPTIONS=--no-network-family-autoselection -e CI=1 \
      -v "$PWD/e2e":/e2e -w /e2e \
      mcr.microsoft.com/playwright:v1.49.0-noble \
      bash -lc "[ -d node_modules ] || npm install --no-audit --no-fund; npx playwright test"

- `node_modules` is cached in `e2e/` after the first run (one-time ~2-min install on the Windows mount).
- HTML report → `e2e/playwright-report/`; traces/screenshots/videos on failure → `e2e/test-results/`.
- Run one file: append e.g. `shell.spec.ts`. No host display, so headed mode isn't available — use the trace/report on failures.

## Auth
Backend is stub mode. `loginAs(page, role)` (`tests/_helpers.ts`) seeds
`wiki:email` / `wiki:role` into `localStorage` **before** navigation so every
request authenticates as that role; a fresh context with nothing set
auto-resolves the seeded admin. Confirmed against `frontend/lib/api.ts::authHeaders`.

## Status (2026-06-10)
Proven green: `smoke.spec.ts` + `shell.spec.ts` — 5 tests (app shell, role gating
reader-vs-contributor, theme toggle, language toggle, new tab). Tests are named by
SRS FR-UI id (`docs/srs/frontend-functional.md`).

## Next (each needs a small `data-testid` pass on the frontend)
- **propose → review → publish** (ProposeDialog + ReviewQueue) — the core workflow.
- quick switcher / topbar search → navigate.
- file-tree create / select / context-menu actions.
- artifacts publish + visibility.

Recommended testids to add first: `propose-path`, `propose-title`, `propose-body`,
`propose-submit` (ProposeDialog); `review-accept` (ReviewQueue); and the icon-only
topbar buttons (Review/Lint/Sources/Schema/MCP). Then these flows select robustly.
