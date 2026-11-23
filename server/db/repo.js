/* =====================================================================
   REPOSITORY: turns database rows into the engine's objects (items, books)
   and saves them back. Only the rows that really changed are written.
   Every write gets a new `rev` number (used by the Turso sync).
   ===================================================================== */
import { KEYS } from './schema.js';

const b = v => (v ? 1 : 0);
const same = (a, c) => JSON.stringify(a) === JSON.stringify(c);

/* ---------- reading ---------- */
export async function loadItems(db) {
  const items = {};
  for (const r of (await db.execute('SELECT * FROM items')).rows) items[r.id] = { id: r.id, type: r.type, name: r.name, purged: !!r.purged, createdAt: r.created_at };
  return items;
}

export async function loadDays(db) {
  // own = how many changes were made ON this day afterwards (compensations + calendar edits): its values are shown crossed out
  return (await db.execute(`SELECT id, seq, date, status, opening, profit, virtual_total, real_total, diff, closed_at, notes, orig,
      (SELECT COUNT(*) FROM compensations c WHERE c.day_id = days.id) + (SELECT COUNT(*) FROM day_edits e WHERE e.day_id = days.id) own
    FROM days ORDER BY seq`)).rows
    .map(r => ({ id: r.id, seq: Number(r.seq), date: r.date, status: r.status, opening: r.opening, profit: r.profit, virtual: r.virtual_total, real: r.real_total, diff: r.diff, closedAt: r.closed_at, notes: r.notes, orig: parse(r.orig), own: Number(r.own) }));
}

export async function loadBook(db, dayId) {
  const d = (await db.execute({ sql: 'SELECT * FROM days WHERE id=?', args: [dayId] })).rows[0];
  if (!d) return null;
  const book = {
    day: { id: d.id, seq: Number(d.seq), date: d.date, status: d.status, opening: d.opening, openingManual: !!d.opening_manual, cash: d.cash, network: d.network,
      cashChanged: !!d.cash_changed, networkChanged: !!d.network_changed, notes: d.notes, closedAt: d.closed_at, orig: parse(d.orig) },
    rows: {}, entries: {}, adjs: {}, comps: {},
  };
  for (const r of (await db.execute({ sql: 'SELECT * FROM item_days WHERE day_id=?', args: [dayId] })).rows)
    book.rows[r.item_id] = { opening: r.opening, calc: r.calc, value: r.value, active: !!r.active, status: r.status, changed: !!r.changed, achanged: !!r.achanged, schanged: !!r.schanged };
  for (const r of (await db.execute({ sql: 'SELECT * FROM entries WHERE day_id=? ORDER BY created_at, id', args: [dayId] })).rows)
    book.entries[r.id] = { id: r.id, kind: r.kind, name: r.name, amount: r.amount, createdAt: r.created_at, ...(r.late ? { late: r.late } : {}) };
  for (const r of (await db.execute({ sql: 'SELECT * FROM adjustments WHERE day_id=? ORDER BY created_at, id', args: [dayId] })).rows)
    book.adjs[r.id] = { id: r.id, amount: r.amount, note: r.note, createdAt: r.created_at, ...(r.late ? { late: r.late } : {}) };
  for (const r of (await db.execute({ sql: 'SELECT * FROM compensations WHERE day_id=? ORDER BY created_at, id', args: [dayId] })).rows)
    book.comps[r.id] = { id: r.id, field: r.field, amount: r.amount, note: r.note, createdAt: r.created_at, device: r.device };
  return book;
}
const parse = t => { try { return t ? JSON.parse(t) : null; } catch { return null; } };

/* ---------- writing (inside a transaction `tx`, with the change number `rev`) ---------- */
async function del(tx, tbl, pkCols, pkVals, rev) {
  await tx.execute({ sql: `DELETE FROM ${tbl} WHERE ${pkCols.map(c => c + '=?').join(' AND ')}`, args: pkVals });
  await tx.execute({ sql: 'INSERT INTO tombstones(tbl,pk,rev) VALUES(?,?,?) ON CONFLICT(tbl,pk) DO UPDATE SET rev=excluded.rev', args: [tbl, JSON.stringify(pkVals), rev] });
}
export async function upsert(tx, tbl, row, rev) {
  const r = { ...row, rev }, cols = Object.keys(r);
  await tx.execute({ sql: `INSERT OR REPLACE INTO ${tbl}(${cols.join(',')}) VALUES(${cols.map(() => '?').join(',')})`, args: cols.map(c => r[c] ?? null) });
  // a row written again is no longer deleted
  await tx.execute({ sql: 'DELETE FROM tombstones WHERE tbl=? AND pk=?', args: [tbl, JSON.stringify(KEYS[tbl].map(k => r[k]))] });
}

export async function saveItems(tx, before, after, rev) {
  for (const [id, it] of Object.entries(after))
    if (!same(before[id], it)) await upsert(tx, 'items', { id, type: it.type, name: it.name, purged: b(it.purged), created_at: it.createdAt || null }, rev);
}

/** Save `after` (a day book), writing only what differs from `before` (null = write everything). `sum` = summarize() result. */
export async function saveBook(tx, before, after, sum, rev) {
  const d = after.day, closed = d.status === 'closed';
  const dayRow = { id: d.id, seq: d.seq, date: d.date, status: d.status, opening: d.opening, opening_manual: b(d.openingManual), cash: d.cash, network: d.network,
    cash_changed: b(d.cashChanged), network_changed: b(d.networkChanged), notes: d.notes || '',
    profit: sum.profit, virtual_total: sum.virtual, real_total: sum.real, diff: sum.diff, closed_at: closed ? d.closedAt : null,
    orig: d.orig ? JSON.stringify(d.orig) : null };
  await upsert(tx, 'days', dayRow, rev);
  const B = before || { rows: {}, entries: {}, adjs: {} };
  for (const [id, r] of Object.entries(after.rows))
    if (!same(B.rows[id], r)) await upsert(tx, 'item_days', { day_id: d.id, item_id: id, opening: r.opening, calc: r.calc || '', value: r.value, active: b(r.active), status: r.status, changed: b(r.changed), achanged: b(r.achanged), schanged: b(r.schanged) }, rev);
  for (const id of Object.keys(B.rows)) if (!after.rows[id]) await del(tx, 'item_days', ['day_id', 'item_id'], [d.id, id], rev);
  for (const [id, e] of Object.entries(after.entries))
    if (!same(B.entries[id], e)) await upsert(tx, 'entries', { id, day_id: d.id, kind: e.kind, name: e.name || '', amount: e.amount, late: e.late || null, created_at: e.createdAt }, rev);
  for (const id of Object.keys(B.entries)) if (!after.entries[id]) await del(tx, 'entries', ['id'], [id], rev);
  for (const [id, a] of Object.entries(after.adjs))
    if (!same(B.adjs[id], a)) await upsert(tx, 'adjustments', { id, day_id: d.id, amount: a.amount, note: a.note, late: a.late || null, created_at: a.createdAt }, rev);
  for (const id of Object.keys(B.adjs)) if (!after.adjs[id]) await del(tx, 'adjustments', ['id'], [id], rev);
  const BC = B.comps || {};
  for (const [id, c] of Object.entries(after.comps || {}))
    if (!same(BC[id], c)) await upsert(tx, 'compensations', { id, day_id: d.id, field: c.field, amount: c.amount, note: c.note || '', device: c.device || null, created_at: c.createdAt }, rev);
  for (const id of Object.keys(BC)) if (!(after.comps || {})[id]) await del(tx, 'compensations', ['id'], [id], rev);
}

/* ---------- the change counter ---------- */
export async function getMeta(db, key, def = null) { const r = (await db.execute({ sql: 'SELECT value FROM meta WHERE key=?', args: [key] })).rows[0]; return r ? r.value : def; }
export async function setMeta(db, key, value) { await db.execute({ sql: 'INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', args: [key, String(value)] }); }
/** Reserve the next change number (call inside the write transaction). */
export async function nextRev(tx) { const cur = Number(await getMeta(tx, 'rev', 0)); await setMeta(tx, 'rev', cur + 1); return cur + 1; }
