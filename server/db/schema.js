/* =====================================================================
   DATABASE SCHEMA + MIGRATIONS
   The same tables exist in the local file and in Turso (except `meta`, local only).
   To change the database later: ADD a new entry at the end of MIGRATIONS
   (never edit an old one). Each runs once, in order, and is remembered in `meta`.

   Every synced table has a `rev` column: the number of the change that last wrote
   the row. The Turso sync sends every row whose rev is newer than the last one sent.
   ===================================================================== */

export const SYNCED_TABLES = ['items', 'days', 'item_days', 'entries', 'adjustments', 'day_edits', 'op_log', 'legacy_archive', 'compensations'];

// primary key columns of each synced table (used for upserts and deletes)
export const KEYS = {
  items: ['id'], days: ['id'], item_days: ['day_id', 'item_id'], entries: ['id'], adjustments: ['id'],
  day_edits: ['id'], op_log: ['op_id'], legacy_archive: ['id'], compensations: ['id'],
};

export const MIGRATIONS = [
  {
    version: 1,
    name: 'v3 schema: days, items, per-day values, entries, adjustments, edit notes, op log',
    sql: [
      // one row per business day; exactly one is 'open'. date is set when the day is closed (التصفية)
      `CREATE TABLE IF NOT EXISTS days(
         id TEXT PRIMARY KEY, seq INTEGER NOT NULL, date TEXT, status TEXT NOT NULL CHECK(status IN ('open','closed')),
         opening REAL, cash REAL NOT NULL DEFAULT 0, network REAL NOT NULL DEFAULT 0,
         cash_changed INTEGER NOT NULL DEFAULT 0, network_changed INTEGER NOT NULL DEFAULT 0,
         notes TEXT NOT NULL DEFAULT '', profit REAL, virtual_total REAL, real_total REAL, diff REAL,
         closed_at TEXT, rev INTEGER NOT NULL DEFAULT 0)`,
      'CREATE UNIQUE INDEX IF NOT EXISTS days_seq ON days(seq)',
      'CREATE UNIQUE INDEX IF NOT EXISTS days_date ON days(date)',
      // wallets, clients, shop debts, constants (the type column says which)
      `CREATE TABLE IF NOT EXISTS items(
         id TEXT PRIMARY KEY, type TEXT NOT NULL CHECK(type IN ('wallet','client','debt','constant')),
         name TEXT NOT NULL, purged INTEGER NOT NULL DEFAULT 0, created_at TEXT, rev INTEGER NOT NULL DEFAULT 0)`,
      'CREATE INDEX IF NOT EXISTS items_type ON items(type)',
      // an item's numbers on one day (this is also its history)
      `CREATE TABLE IF NOT EXISTS item_days(
         day_id TEXT NOT NULL, item_id TEXT NOT NULL,
         opening REAL NOT NULL DEFAULT 0, calc TEXT NOT NULL DEFAULT '', value REAL NOT NULL DEFAULT 0,
         active INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','deleted')),
         changed INTEGER NOT NULL DEFAULT 0, achanged INTEGER NOT NULL DEFAULT 0, schanged INTEGER NOT NULL DEFAULT 0,
         rev INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(day_id, item_id))`,
      'CREATE INDEX IF NOT EXISTS item_days_item ON item_days(item_id)',
      // input / output / sale records
      `CREATE TABLE IF NOT EXISTS entries(
         id TEXT PRIMARY KEY, day_id TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('input','output','sale')),
         name TEXT NOT NULL DEFAULT '', amount REAL NOT NULL, late TEXT, created_at TEXT, rev INTEGER NOT NULL DEFAULT 0)`,
      'CREATE INDEX IF NOT EXISTS entries_day ON entries(day_id)',
      // manual + / − on التصفية الحقيقية, with a note
      `CREATE TABLE IF NOT EXISTS adjustments(
         id TEXT PRIMARY KEY, day_id TEXT NOT NULL, amount REAL NOT NULL, note TEXT NOT NULL, late TEXT, created_at TEXT,
         rev INTEGER NOT NULL DEFAULT 0)`,
      'CREATE INDEX IF NOT EXISTS adjustments_day ON adjustments(day_id)',
      // every edit of a saved (closed) day: the note you wrote and exactly what changed
      `CREATE TABLE IF NOT EXISTS day_edits(
         id TEXT PRIMARY KEY, day_id TEXT NOT NULL, note TEXT NOT NULL, ops TEXT NOT NULL, changes TEXT NOT NULL,
         device TEXT, created_at TEXT, rev INTEGER NOT NULL DEFAULT 0)`,
      'CREATE INDEX IF NOT EXISTS day_edits_day ON day_edits(day_id)',
      // every change received from any device (accepted or refused) — never deleted
      `CREATE TABLE IF NOT EXISTS op_log(
         op_id TEXT PRIMARY KEY, at TEXT, device TEXT, status TEXT, error TEXT, op TEXT, rev INTEGER NOT NULL DEFAULT 0)`,
      // the data of the old version, kept exactly as it was
      'CREATE TABLE IF NOT EXISTS legacy_archive(id TEXT PRIMARY KEY, kind TEXT, data TEXT, rev INTEGER NOT NULL DEFAULT 0)',
      // rows deleted locally that must also be deleted in Turso
      'CREATE TABLE IF NOT EXISTS tombstones(tbl TEXT NOT NULL, pk TEXT NOT NULL, rev INTEGER NOT NULL, PRIMARY KEY(tbl, pk))',
      ...['items', 'days', 'item_days', 'entries', 'adjustments', 'day_edits', 'op_log', 'legacy_archive', 'tombstones']
        .map(t => `CREATE INDEX IF NOT EXISTS ${t}_rev ON ${t}(rev)`),
    ],
  },
  {
    version: 2,
    name: 'indexes for years of data: covering indexes for the hot queries',
    sql: [
      // a day's book is read ordered by time (loadBook) -> no sort step, no table scan
      'CREATE INDEX IF NOT EXISTS entries_day_created ON entries(day_id, created_at, id)',
      'DROP INDEX IF EXISTS entries_day',
      'CREATE INDEX IF NOT EXISTS adjustments_day_created ON adjustments(day_id, created_at, id)',
      'DROP INDEX IF EXISTS adjustments_day',
      // one item's history (itemHistory) joins item_days -> days by item
      'CREATE INDEX IF NOT EXISTS item_days_item_day ON item_days(item_id, day_id)',
      'DROP INDEX IF EXISTS item_days_item',
      // ربح الكاش of the month: inputs of the open day + closed days since the 1st
      'CREATE INDEX IF NOT EXISTS entries_kind_day ON entries(kind, day_id)',
      'CREATE INDEX IF NOT EXISTS days_status ON days(status)',
      'CREATE INDEX IF NOT EXISTS day_edits_day_created ON day_edits(day_id, created_at)',
      // the op log grows forever: dedupe lookups use the primary key, audits look by time
      'CREATE INDEX IF NOT EXISTS op_log_at ON op_log(at)',
    ],
  },
  {
    version: 3,
    name: 'compensations (تعويض) of saved days + the values each day was closed with',
    sql: [
      // orig: JSON of the values the day was CLOSED with (open day: its first «تصفية البارحة»). Shown crossed out when changed.
      'ALTER TABLE days ADD COLUMN orig TEXT',
      `CREATE TABLE IF NOT EXISTS compensations(
         id TEXT PRIMARY KEY, day_id TEXT NOT NULL, field TEXT NOT NULL, amount REAL NOT NULL,
         note TEXT NOT NULL DEFAULT '', device TEXT, created_at TEXT, rev INTEGER NOT NULL DEFAULT 0)`,
      'CREATE INDEX IF NOT EXISTS compensations_day ON compensations(day_id, created_at)',
      'CREATE INDEX IF NOT EXISTS compensations_rev ON compensations(rev)',
    ],
  },
  {
    version: 4,
    name: 'originals for days saved before compensations existed',
    sql: [
      // the best record of how an older day was closed is what it shows now
      `UPDATE days SET orig = json_object('opening', opening, 'profit', profit, 'virtual', virtual_total, 'real', real_total, 'diff', diff)
         WHERE orig IS NULL AND status = 'closed'`,
      "UPDATE days SET orig = json_object('opening', opening) WHERE orig IS NULL AND status = 'open'",
    ],
  },
];

/** Connection settings for the LOCAL file (Turso manages its own). WAL = readers never wait for the writer. */
export const LOCAL_PRAGMAS = [
  'PRAGMA journal_mode=WAL',          // persistent in the file: concurrent reads while a change is saved, faster commits
  'PRAGMA synchronous=NORMAL',        // safe with WAL (no corruption on power loss), much fewer disk flushes
  'PRAGMA busy_timeout=5000',         // wait for a lock instead of failing
  'PRAGMA temp_store=MEMORY',
];

/** Run the migrations that have not run yet. `meta` remembers the version. */
export async function migrate(db, { remote = false } = {}) {
  await db.execute('CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT)');
  const key = 'schema_version';
  const cur = Number((await db.execute({ sql: 'SELECT value FROM meta WHERE key=?', args: [key] })).rows[0]?.value || 0);
  for (const m of MIGRATIONS) {
    if (m.version <= cur) continue;
    await db.batch([...m.sql, { sql: "INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", args: [key, String(m.version)] }], 'write');
    if (!remote) console.log(`database: applied migration ${m.version} (${m.name})`);
  }
}
