# How it is built

## Offline first
Every device keeps the last data it received and a queue of its own changes (saved twice: localStorage + IndexedDB).
Each change is an operation (`{ t: 'addEntry', id, kind, amount }`). The same engine (`shared/engine.js`) applies it on the
device (instant screen) and on the server (the truth). The server answers with what it accepted; refused changes stay on the
device in «لم يُقبل» until you retry or delete them. One device edits at a time (the others look; "تولّي التعديل" switches).

## The numbers (shared/engine.js)
- تصفية البارحة = the confirmed التصفية الحقيقية of the previous day (the first day: typed by you)
- ربح اليوم = inputs + sales − outputs
- التصفية الافتراضية = تصفية البارحة + ربح اليوم
- التصفية الحقيقية = wallets + clients + cash + network − shop debts − constants ± manual adjustments
- العجز/الزيادة = الافتراضي − الحقيقي (positive = عجز, negative = زيادة)
- Closing a day: the real total becomes the next day's تصفية البارحة. Wallets, constants and shop debts carry over
  (clients and debts carry their final value). Inputs/outputs/sales, cash, network, adjustments and notes start empty.
- Editing a saved day: the change flows to every later day (in the order they were worked), unless a later day changed that value itself.

## Database (server/db/schema.js)
| Table | What |
|---|---|
| `days` | one row per day: status (open/closed), date, opening, cash, network, notes, the saved totals |
| `items` | wallets, clients, shop debts, constants (`type`), name, purged |
| `item_days` | an item's numbers on a day (opening, calculator text, value, ✓, deleted) — this is also its history |
| `entries` | inputs / outputs / sales |
| `adjustments` | manual + / − on the real total, with a note |
| `day_edits` | every edit of a saved day: note, operations, effect |
| `op_log` | every change received (accepted or refused), never deleted |
| `legacy_archive` | the old version's data, untouched |
| `tombstones`, `meta` | sync bookkeeping (meta: local only) |
Every synced row has `rev` (the change number that wrote it). The Turso sync sends rows with a newer `rev` in batches,
retrying with growing pauses (slow internet: up to 120 s per request, `TURSO_TIMEOUT_SECONDS`).
Migrations are numbered and run once (`schema_version` in `meta`); a backup copy is made before every start.

## Scaling (what grows, and how it is handled)
| What grows | Handling |
|---|---|
| Years of days / entries | Covering indexes for every hot query (migration 2): a day's book, an item's history, ربح الكاش, the op log. Checked by `tests/scale.test.js` (query plan uses the index, no sort step). |
| Many devices at once | SQLite in **WAL** mode (readers never wait for the writer), `busy_timeout`, writes serialized in one queue, gzip answers, `?rev=` answers "unchanged" in a few bytes. |
| Big batches of offline changes | Duplicate check is one indexed query per 500 changes (not one per change). |
| Turso sync after a long offline time | Rows read in pages of 1000 (keyset on rowid: memory stays flat), sent in batches of 150, tombstones cleared once delivered. |
| A new computer restoring years of data | Same paged reading from Turso. |
| Memory over months of uptime | Login-failure and device lists are pruned. |
| Operations | `/api/health` (liveness, used by the updater), `/api/ready` (database answers), request ids, slow/failed requests logged, graceful stop (last Turso push), settings checked at start. |

The design is deliberately **one shop = one database** (local-first: the shop keeps working without internet).
A second branch = a second install with its own Turso database; nothing in the code assumes a single machine
except the in-memory editor lock, which is per install by design.

## CI/CD
1. Every push / pull request: lint + `npm audit` → tests on Linux (Node 22 and 24) and Windows → build → Docker image built and smoke-tested.
2. **release-gate** passes only when every shop check passed. The shop computer's updater installs a commit only when it passed (`docs/UPDATING.md`).
3. On `main`: the Docker image is published to `ghcr.io/<owner>/elbshmds` (`latest` + commit) for cloud/NAS installs.
4. `ai-tool/` is tested in its own job and deployed by Netlify (only when that folder changed).
5. Dependabot opens weekly update pull requests; each runs the same checks.
