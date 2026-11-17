/* =====================================================================
   TURSO SYNC — keeps an online copy of the database.
   The shop never waits for it: everything is saved on this computer first,
   then sent to Turso in the background whenever the internet allows.
   - push(): sends every row changed since the last successful push
   - restore(): on a NEW computer (empty local database) copies everything back from Turso
   Slow internet: each request may take up to TURSO_TIMEOUT_SECONDS (default 120 s),
   failures are retried with growing pauses (up to 5 minutes).
   ===================================================================== */
import { createClient } from '@libsql/client';
import { SYNCED_TABLES, KEYS, migrate } from '../db/schema.js';
import { getMeta, setMeta } from '../db/repo.js';

/** A Turso client whose requests give up after `timeoutMs` (instead of hanging forever). */
export function remoteClient(url, authToken, timeoutMs = 120000) {
  const timedFetch = (input, init = {}) => fetch(input, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  return createClient({ url, authToken, fetch: timedFetch });
}

export function createSync(local, remote, { intervalMs = 20000, batchSize = 150, log = console } = {}) {
  const status = { configured: !!remote, lastOkAt: null, lastError: null, lastErrorAt: null, pendingRows: 0, pushing: false };
  let schemaReady = false, timer = null, wait = intervalMs, stopped = false;

  async function pendingCount() {
    const pushed = Number(await getMeta(local, 'turso_pushed_rev', 0));
    let n = 0;
    for (const t of [...SYNCED_TABLES, 'tombstones']) n += Number((await local.execute({ sql: `SELECT COUNT(*) n FROM ${t} WHERE rev > ?`, args: [pushed] })).rows[0].n);
    return n;
  }

  async function push() {
    if (!remote || status.pushing) return;
    status.pushing = true;
    try {
      if (!schemaReady) { await migrate(remote, { remote: true }); schemaReady = true; }
      const pushed = Number(await getMeta(local, 'turso_pushed_rev', 0));
      const top = Number(await getMeta(local, 'rev', 0));
      if (top > pushed) {
        let stmts = [];
        const flush = async () => { if (stmts.length) { await remote.batch(stmts, 'write'); stmts = []; } };
        for (const t of SYNCED_TABLES) {
          // read in pages (keyset on rowid): memory stays flat even when years of rows are pending
          for await (const row of pages(local, `SELECT rowid AS _rid, * FROM ${t} WHERE rev > ? AND rev <= ?`, [pushed, top])) {
            const cols = Object.keys(row).filter(k => k !== '_rid' && isNaN(Number(k)));
            stmts.push({ sql: `INSERT OR REPLACE INTO ${t}(${cols.join(',')}) VALUES(${cols.map(() => '?').join(',')})`, args: cols.map(c => row[c]) });
            if (stmts.length >= batchSize) await flush();
          }
        }
        for (const tb of (await local.execute({ sql: 'SELECT * FROM tombstones WHERE rev > ? AND rev <= ?', args: [pushed, top] })).rows) {
          const keys = KEYS[tb.tbl]; if (!keys) continue;
          stmts.push({ sql: `DELETE FROM ${tb.tbl} WHERE ${keys.map(k => k + '=?').join(' AND ')}`, args: JSON.parse(tb.pk) });
          if (stmts.length >= batchSize) await flush();
        }
        await flush();
        await setMeta(local, 'turso_pushed_rev', top);
        // deletions already applied online are no longer needed locally
        await local.execute({ sql: 'DELETE FROM tombstones WHERE rev <= ?', args: [top] });
      }
      status.lastOkAt = new Date().toISOString(); status.lastError = null; wait = intervalMs;
    } catch (e) {
      status.lastError = e.message; status.lastErrorAt = new Date().toISOString();
      wait = Math.min(wait * 2, 5 * 60000);                     // retry later, waiting longer each time
      log.warn?.('turso sync: ' + e.message);
    } finally {
      status.pushing = false;
      try { status.pendingRows = await pendingCount(); } catch { /* ignore */ }
    }
  }

  function start() {
    if (!remote) return;
    const loop = async () => { if (stopped) return; await push(); timer = setTimeout(loop, wait); };
    timer = setTimeout(loop, 1500);
  }
  /** Ask for a push soon (after a change). */
  let soon = null;
  function poke() { if (!remote || soon) return; soon = setTimeout(() => { soon = null; push(); }, 3000); }
  function stop() { stopped = true; clearTimeout(timer); clearTimeout(soon); }

  return { push, start, stop, poke, status, pendingCount };
}

/** New computer, empty local database: copy everything from Turso (v3 tables). Returns true if something was restored. */
export async function restoreFromRemote(local, remote) {
  const has = await remote.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='days'");
  if (!has.rows.length) return false;
  if (!Number((await remote.execute('SELECT COUNT(*) n FROM days')).rows[0].n)) return false;
  let maxRev = 0;
  // an online copy made by an older version may not have the newest tables yet: skip those
  const remoteTables = new Set((await remote.execute("SELECT name FROM sqlite_master WHERE type='table'")).rows.map(r => r.name));
  for (const t of SYNCED_TABLES) {
    if (!remoteTables.has(t)) continue;
    let stmts = [];
    for await (const row of pages(remote, `SELECT rowid AS _rid, * FROM ${t}`, [])) {
      const cols = Object.keys(row).filter(k => k !== '_rid' && isNaN(Number(k)));
      maxRev = Math.max(maxRev, Number(row.rev) || 0);
      stmts.push({ sql: `INSERT OR REPLACE INTO ${t}(${cols.join(',')}) VALUES(${cols.map(() => '?').join(',')})`, args: cols.map(c => row[c]) });
      if (stmts.length >= 300) { await local.batch(stmts, 'write'); stmts = []; }
    }
    if (stmts.length) await local.batch(stmts, 'write');
  }
  await setMeta(local, 'rev', maxRev);
  await setMeta(local, 'turso_pushed_rev', maxRev);             // it is already in Turso
  return true;
}

/**
 * Read a query in pages of `size` rows, ordered by rowid (keyset pagination: every page is an index seek,
 * unlike OFFSET which gets slower the further it goes). `sql` must select `rowid AS _rid` and may have a WHERE.
 */
export async function* pages(db, sql, args, size = 1000) {
  let last = Number.MIN_SAFE_INTEGER;
  const where = /\bWHERE\b/i.test(sql) ? ' AND' : ' WHERE';
  for (;;) {
    const rows = (await db.execute({ sql: `${sql}${where} rowid > ? ORDER BY rowid LIMIT ${size}`, args: [...args, last] })).rows;
    for (const r of rows) yield r;
    if (rows.length < size) return;
    last = rows[rows.length - 1]._rid;
  }
}
