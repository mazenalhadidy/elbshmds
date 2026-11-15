/* =====================================================================
   BRINGING YOUR DATA FROM THE OLD VERSION (runs once, on the first start)
   The old version kept everything in one JSON value (table `kv`, key 'state')
   plus one row per saved day (table `days_closed`, with a full snapshot).
   This converts it into the new tables:
     - every saved day keeps its numbers exactly as they were ("what's done is done")
       (only the sign of العجز/الزيادة changes: it is now virtual - real)
     - clients / wallets / shop debts / constants become items with one row per day
     - input / output / sale records keep their name and amount
     - old transfers/transactions are kept untouched in `legacy_archive`
   The old tables are only READ, never changed or deleted.
   ===================================================================== */
import { emptyBook, summarize, r2 } from './legacy-helpers.js';
import { saveItems, saveBook, upsert, nextRev } from '../db/repo.js';

/** Does this database (old local file or Turso) contain data from the old version? */
export async function readLegacy(db) {
  try {
    const kv = await db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='kv'");
    if (!kv.rows.length) return null;
    const st = (await db.execute("SELECT v FROM kv WHERE k='state'")).rows[0];
    if (!st) return null;
    let closed = [];
    const hasDays = (await db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='days_closed'")).rows.length;
    if (hasDays) closed = (await db.execute('SELECT * FROM days_closed ORDER BY closed_at, rowid')).rows.map(r => ({ ...r, snapshot: JSON.parse(r.snapshot) }));
    return { state: JSON.parse(st.v), closed };
  } catch { return null; }
}

/** Turn the old data into rows of the new database. Returns counts for the log. */
export async function importLegacy(local, legacy) {
  const { state, closed } = legacy;
  const items = {};
  const ID = (type, id) => ({ wallet: 'w_', client: 'c_', debt: 'd_', constant: 'k_' }[type] + id);
  const remember = (type, id, name) => { const k = ID(type, id); items[k] = { id: k, type, name: String(name || '').trim() || '—', purged: false, createdAt: null }; return k; };

  // rows of one day from an old snapshot (lists of clients / wallets / creditors / constants)
  const rowsFrom = snap => {
    const rows = {};
    for (const c of snap.clients || []) rows[remember('client', c.id, c.name)] = { opening: r2(c.balance), calc: '', value: r2(c.balance), active: false, status: 'active', changed: false, achanged: false, schanged: false };
    for (const w of snap.wallets || []) rows[remember('wallet', w.id, w.number)] = { opening: 0, calc: '', value: r2(w.balance), active: true, status: 'active', changed: false, achanged: false, schanged: false };
    for (const d of snap.creditors || []) rows[remember('debt', d.id, d.name)] = { opening: r2(d.remaining), calc: '', value: r2(d.remaining), active: false, status: 'active', changed: false, achanged: false, schanged: false };
    for (const k of snap.constants || []) rows[remember('constant', k.id, k.name)] = { opening: 0, calc: '', value: r2(k.amount), active: false, status: 'active', changed: false, achanged: false, schanged: false };
    return rows;
  };
  const entriesFrom = (list) => {
    const out = {};
    for (const e of list || []) if (['input', 'output', 'sale'].includes(e.kind) && e.amount > 0) out[e.id] = { id: e.id, kind: e.kind, name: e.name || '', amount: r2(e.amount), createdAt: e.created_at || e.createdAt || null, ...(e.late ? { late: e.late } : {}) };
    return out;
  };

  const books = [];
  let seq = 0;
  for (const c of closed) {
    const s = c.snapshot || {}, sum = s.summary || {};
    const book = emptyBook(c.id, sum.prev ?? null, ++seq);
    Object.assign(book.day, { date: c.date, status: 'closed', cash: r2(c.cash || 0), network: r2(c.network || 0), notes: c.notes || '', closedAt: c.closed_at || null });
    book.rows = rowsFrom(s); book.entries = entriesFrom(s.entries, c.id);
    // keep the old numbers exactly (diff sign is now virtual - real)
    const stored = { profit: sum.profit ?? null, virtual: sum.theoretical ?? null, real: sum.actual ?? c.actual ?? null, diff: sum.theoretical == null || sum.actual == null ? null : r2(sum.theoretical - sum.actual) };
    books.push({ book, stored, raw: c });
  }
  // the day that was open in the old version
  const d = state.day || {};
  const openBook = emptyBook(d.id && !closed.some(c => c.id === d.id) ? d.id : 'open_' + Date.now().toString(36), d.prev_actual ?? null, ++seq);
  Object.assign(openBook.day, { cash: r2(d.cash || 0), network: r2(d.network || 0), notes: d.notes || '' });
  openBook.rows = rowsFrom(state); openBook.entries = entriesFrom(state.entries, openBook.day.id);
  // old "completed" shop debts were hidden from the next day: keep them only if something is still owed
  for (const cr of state.creditors || []) if (!(cr.remaining > 0)) delete openBook.rows[ID('debt', cr.id)];

  const tx = await local.transaction('write');
  try {
    const r = await nextRev(tx);
    await saveItems(tx, {}, items, r);
    for (const { book, stored, raw } of books) {
      const live = summarize(book, items);
      await saveBook(tx, null, book, { ...live, ...Object.fromEntries(Object.entries(stored).filter(([, v]) => v != null)) }, r);
      await upsert(tx, 'legacy_archive', { id: 'day:' + raw.id, kind: 'day', data: JSON.stringify(raw) }, r);
    }
    await saveBook(tx, null, openBook, summarize(openBook, items), r);
    const { applied, ...rest } = state;                     // `applied` is just a list of ids, not needed
    await upsert(tx, 'legacy_archive', { id: 'state', kind: 'state', data: JSON.stringify(rest) }, r);
    await tx.execute({ sql: "INSERT INTO meta(key,value) VALUES('legacy_imported',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", args: [new Date().toISOString()] });
    await tx.commit();
  } catch (e) { try { await tx.rollback(); } catch { /* ignore */ } throw e; }
  return { closedDays: books.length, items: Object.keys(items).length, openEntries: Object.keys(openBook.entries).length };
}
