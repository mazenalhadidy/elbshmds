# محل الباشمهندس — Shop finance (v3)

Daily finance program for the shop: اليومية (inputs, outputs, sales), العملاء والمحافظ, الإدارة, التصفية.
Works offline on every device; the shop computer keeps the database; Turso keeps an online copy; it updates itself from GitHub.

| Part | Technology | Folder |
|---|---|---|
| Screens | Vue 3 + Vite + Pinia (Arabic, right-to-left, Hindi digits) | `web/` |
| Accounting rules (used by screens AND server) | plain JavaScript | `shared/` |
| Server | Node.js + Express | `server/` |
| Database | SQLite file on the shop computer (`data/shop-v3.db`) + Turso online copy | `server/db/`, `server/sync/` |
| Launcher + auto-update | Node.js, no packages | `scripts/updater.js` |
| Tests | Vitest (rules, server, scale, old-data import, the real screens) | `tests/` |
| Lint | ESLint (JS + Vue) | `eslint.config.js` |
| CI/CD | GitHub Actions: lint, tests (Node 22 + 24, Windows), Docker image → ghcr.io, release gate | `.github/workflows/ci.yml` |
| Container | Docker (multi-stage, non-root, health check) | `Dockerfile`, `docker-compose.yml` |
| AI debt checker (WhatsApp) | separate app, deployed by Netlify | `ai-tool/` (see its README) |

## Install on the shop computer
See **docs/SETUP-WINDOWS.md** (step by step, nothing to install except Node.js). Phones: **docs/ANDROID.md**.

## For editing the code
    npm install
    npm run dev:server      # the server (needs a .env, see .env.example)
    npm run dev             # the screens with live reload on http://localhost:5173
    npm run lint            # code checks
    npm test                # all tests
    npm run test:ai         # the AI tool's tests
    npm run build           # build the screens into dist/

Where to change things:
- Formulas (التصفية, carry to the next day, date rules): `shared/engine.js` — every rule is explained at the top.
- العجوزات (words, running total, the list): `shared/deficits.js`; the screen: `web/components/DeficitsDialog.vue`.
- Number display / calculator parsing: `shared/money.js`.
- Colors, sizes, fonts: `web/styles/base.css` (all in one place, at the top).
- Page names and order of the menu: `web/router.js`.
- A page: `web/pages/*.vue`. A table: `web/components/EntryTable.vue` (inputs/outputs/sales), `ItemTable.vue` (wallets/clients/debts/constants).
- Database tables: `server/db/schema.js` (add a new migration at the end, never edit an old one).
- API routes: `server/app.js`. Server-side actions: `server/services/shop.js`.

Run in Docker (cloud VM / NAS): `docker compose up -d --build` — see `docker-compose.yml`.

How it is built: **docs/ARCHITECTURE.md**. How updates reach the shop: **docs/UPDATING.md**.
