/* =====================================================================
   THE SHOP SERVICE — the server side of every action.
   It keeps the open day in memory, applies changes with the shared engine,
   saves them to the local database (one all-or-nothing transaction each time)
   and answers questions (history, calendar, ربح الكاش ...).
   ===================================================================== */
import crypto from 'node:crypto';
import { emptyBook, summarize, applyAll, nextBook, carry, checkCloseDate, clone, isCashProfit, reduce, EngineError } from '../../shared/engine.js';
import { describeOp } from '../../shared/describe.js';
import { loadItems, loadDays, loadBook, saveItems, saveBook, nextRev, upsert, getMeta } from '../db/repo.js';

const uid = () => crypto.randomBytes(8).toString('hex');
export class UserError extends Error { constructor(msg, code = 400) { super(msg); this.code = code; } }

export async function createShop(db, { now = () => new Date() } = {}) {
  /* ---------- memory ---------- */
  let items = await loadItems(db);
  let days = await loadDays(db);                   // the list of all days (for the calendar)
  let open = null;                                 // the open day's book
  let rev = Number(await getMeta(db, 'rev', 0));
  const openRow = days.find(d => d.status === 'open');
  if (openRow) open = await loadBook(db, openRow.id);

  const today = () => { const n = now(); return new Date(n.getTime() - n.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };

  // Only one write at a time (a simple queue).
  let chain = Promise.resolve();
  const serial = fn => { const p = chain.then(fn); chain = p.catch(() => {}); return p; };

  /** Run `fn(tx, rev)` in ONE database transaction; nothing is kept in memory unless it commits. */
  async function write(fn) {
    const tx = await db.transaction('write');
    try { const r = await nextRev(tx); const out = await fn(tx, r); await tx.commit(); rev = r; return out; }
    catch (e) { try { await tx.rollback(); } catch { /* already closed */ } throw e; }
  }
  const logOps = async (tx, r, ops, device, done, rejected) => {
    const err = Object.fromEntries(rejected.map(x => [x.opId, x.error]));
    for (const op of ops) {
      const { password, ...clean } = op;          // never store a password
      await upsert(tx, 'op_log', { op_id: op.opId || uid(), at: now().toISOString(), device: device || null, status: err[op.opId] ? 'rejected' : 'ok', error: err[op.opId] || null, op: JSON.stringify(clean) }, r);
    }
  };
  const closedDates = () => days.filter(d => d.status === 'closed' && d.date).map(d => d.date);
  const refreshDays = async () => { days = await loadDays(db); };

  /* ---------- what devices receive ---------- */
  function snapshot() {
    return {
      rev, items, book: open, summary: open ? summarize(open, items) : null,
      days: days.filter(d => d.status === 'closed'),
      setupNeeded: !open,
      today: today(),
    };
  }

  /* ---------- first start: set التصفية of the first day yourself ---------- */
  async function setup({ opening }) {
    return serial(async () => {
      if (open) throw new UserError('تم الإعداد بالفعل');
      const book = emptyBook(uid(), null, 1);
      reduce({ items, book }, { t: 'setOpening', value: opening });
      await write((tx, r) => saveBook(tx, null, book, summarize(book, items), r));
      open = book; await refreshDays();
      return snapshot();
    });
  }

  /* ---------- everyday changes from any device ---------- */
  async function applyOps(ops, device) {
    return serial(async () => {
      if (!open) throw new UserError('اكتب تصفية أول يوم أولًا');
      // a change that was already received (e.g. sent twice after a lost reply) is answered "done" without applying it again
      // one indexed query for the whole batch (not one query per change)
      const ids = [...new Set(ops.map(o => o.opId).filter(Boolean))];
      const seen = new Set();
      for (let i = 0; i < ids.length; i += 500) {
        const part = ids.slice(i, i + 500);
        const r = await db.execute({ sql: `SELECT op_id FROM op_log WHERE status='ok' AND op_id IN (${part.map(() => '?').join(',')})`, args: part });
        for (const row of r.rows) seen.add(row.op_id);
      }
      const fresh = ops.filter(o => !seen.has(o.opId));
      const state = { items: clone(items), book: clone(open) };
      const { done, rejected } = applyAll(state, fresh);
      if (fresh.length) await write(async (tx, r) => {
        await saveItems(tx, items, state.items, r);
        await saveBook(tx, open, state.book, summarize(state.book, state.items), r);
        await logOps(tx, r, fresh, device, done, rejected);
      });
      items = state.items; open = state.book;
      return { done: [...seen, ...done], rejected, snapshot: snapshot() };
    });
  }

  /* ---------- closing the day (password checked by the route) ---------- */
  async function closeDay({ dayId, date, notes }, device) {
    return serial(async () => {
      if (!open) throw new UserError('لا يوجد يوم مفتوح');
      if (dayId && dayId !== open.day.id) throw new UserError('اليوم المفتوح تغيّر — حدّث الصفحة ثم أعد المحاولة');
      try { checkCloseDate(date, today(), closedDates()); } catch (e) { throw new UserError(e.message); }
      const closed = clone(open);
      if (notes !== undefined) closed.day.notes = String(notes);
      closed.day.date = date; closed.day.status = 'closed'; closed.day.closedAt = now().toISOString();
      const sum = summarize(closed, items);
      const next = nextBook(closed, items, uid());                     // next day: تصفية البارحة = this day's REAL total
      await write(async (tx, r) => {
        await saveBook(tx, open, closed, sum, r);
        await saveBook(tx, null, next, summarize(next, items), r);
        await logOps(tx, r, [{ opId: 'close-' + closed.day.id, t: 'closeDay', date, dayId: closed.day.id }], device, [], []);
      });
      open = next; await refreshDays();
      return snapshot();
    });
  }

  /* ---------- a saved day: details, and editing it ---------- */
  async function getDay(dayId) {
    const book = dayId === open?.day.id ? open : await loadBook(db, dayId);
    if (!book) throw new UserError('اليوم غير موجود', 404);
    const edits = (await db.execute({ sql: 'SELECT id, note, changes, created_at, device FROM day_edits WHERE day_id=? ORDER BY created_at', args: [dayId] })).rows
      .map(e => ({ id: e.id, note: e.note, changes: JSON.parse(e.changes), createdAt: e.created_at, device: e.device }));
    return { book, summary: summarize(book, items), edits };
  }

  /**
   * Edit a saved day: apply `ops` to that day, then let the change flow to every later day (and the open day).
   * preview=true only calculates and returns what would change (nothing is saved).
   */
  async function editDay({ dayId, ops, note, preview }, device) {
    return serial(async () => {
      const target = await loadBook(db, dayId);
      if (!target || target.day.status !== 'closed') throw new UserError('هذا اليوم غير محفوظ');
      if (!Array.isArray(ops) || !ops.length) throw new UserError('لا توجد تعديلات');
      if (!preview && !String(note || '').trim()) throw new UserError('اكتب سبب التعديل');
      const st = { items: clone(items), book: clone(target) };
      // the first day's تصفية البارحة can be changed only here
      const fixed = ops.map(o => (o.t === 'setOpening' && target.day.seq === 1 ? { ...o, force: true } : o));
      const { rejected } = applyAll(st, fixed.map(o => ({ ...o, dayId: undefined })));
      if (rejected.length) throw new UserError('تعديل غير صالح: ' + rejected[0].error);
      // cascade: every later day, in the order they were worked
      const later = days.filter(d => d.seq > target.day.seq);
      const books = [{ before: target, after: st.book }];
      let prev = st.book;
      for (const d of later) {
        const before = d.id === open?.day.id ? open : await loadBook(db, d.id);
        const after = carry(prev, st.items, clone(before));
        books.push({ before, after }); prev = after;
      }
      const changes = books.map(({ before, after }) => {
        const a = summarize(before, items), z = summarize(after, st.items);
        return { dayId: after.day.id, date: after.day.date, open: after.day.status === 'open', before: { opening: a.opening, real: a.real, virtual: a.virtual, diff: a.diff }, after: { opening: z.opening, real: z.real, virtual: z.virtual, diff: z.diff } };
      });
      const described = ops.map(o => describeOp(o, st.items));
      if (preview) return { changes, described };
      await write(async (tx, r) => {
        await saveItems(tx, items, st.items, r);
        for (const { before, after } of books) await saveBook(tx, before, after, summarize(after, st.items), r);
        await upsert(tx, 'day_edits', { id: uid(), day_id: dayId, note: String(note).trim(), ops: JSON.stringify(ops.map(({ password, ...o }) => o)), changes: JSON.stringify({ described, changes }), device: device || null, created_at: now().toISOString() }, r);
        await logOps(tx, r, ops.map(o => ({ ...o, opId: (o.opId || uid()) + '@edit-' + dayId })), device, ops.map(o => o.opId), []);
      });
      items = st.items;
      const last = books[books.length - 1].after;
      if (open && last.day.id === open.day.id) open = last;
      await refreshDays();
      return { changes, described, snapshot: snapshot() };
    });
  }

  /* ---------- the note of a day (ملاحظات اليوم), also for a saved day: text only, the numbers never change ---------- */
  async function setDayNotes(dayId, notes, device) {
    return serial(async () => {
      const text = String(notes ?? '');
      if (text.length > 5000) throw new UserError('الملاحظة طويلة جدًا');
      const isOpen = dayId === open?.day.id;
      const before = isOpen ? open : await loadBook(db, dayId);
      if (!before) throw new UserError('اليوم غير موجود', 404);
      if ((before.day.notes || '') === text) return snapshot();
      const after = clone(before); after.day.notes = text;
      await write(async (tx, r) => {
        await saveBook(tx, before, after, summarize(after, items), r);
        await logOps(tx, r, [{ opId: 'notes-' + dayId + '-' + uid(), t: 'setDayNotes', dayId, notes: text }], device, [], []);
      });
      if (isOpen) open = after;
      await refreshDays();
      return snapshot();
    });
  }

  /* ---------- deleting an item with its log (password checked by the route) ---------- */
  async function purgeItem(id, device) {
    return serial(async () => {
      if (!items[id] || items[id].purged) throw new UserError('غير موجود', 404);
      const st = { items: clone(items), book: clone(open) };
      st.items[id].purged = true;
      delete st.book.rows[id];                           // gone from today; the saved days keep it ("what's done is done")
      await write(async (tx, r) => {
        await saveItems(tx, items, st.items, r);
        await saveBook(tx, open, st.book, summarize(st.book, st.items), r);
        await logOps(tx, r, [{ opId: 'purge-' + id + '-' + uid(), t: 'purgeItem', id }], device, [], []);
      });
      items = st.items; open = st.book;
      return snapshot();
    });
  }

  /* ---------- history of one wallet / client / debt / constant ---------- */
  async function itemHistory(id) {
    const it = items[id];
    if (!it || it.purged) throw new UserError('لا يوجد سجل لهذا العنصر', 404);
    const rows = (await db.execute({ sql: 'SELECT d.id day_id, d.seq, d.date, d.status day_status, r.opening, r.calc, r.value, r.active, r.status FROM item_days r JOIN days d ON d.id=r.day_id WHERE r.item_id=? ORDER BY d.seq DESC', args: [id] })).rows;
    return { item: it, rows: rows.map(x => ({ dayId: x.day_id, seq: Number(x.seq), date: x.date, open: x.day_status === 'open', opening: x.opening, calc: x.calc, value: x.value, active: !!x.active, status: x.status })) };
  }

  /* ---------- ربح الكاش من أول الشهر (password checked by the route) ---------- */
  async function cashProfitThisMonth() {
    const from = today().slice(0, 8) + '01';
    const rows = (await db.execute({ sql: "SELECT e.name, e.amount FROM entries e JOIN days d ON d.id=e.day_id WHERE e.kind='input' AND (d.status='open' OR d.date >= ?)", args: [from] })).rows;
    const list = rows.filter(r => isCashProfit(r.name));
    return { from, total: Math.round(list.reduce((a, r) => a + r.amount, 0) * 100) / 100, count: list.length };
  }

  /** Everything, as one JSON file (backup / download). */
  async function exportAll() {
    const out = { exportedAt: now().toISOString(), rev, tables: {} };
    for (const t of ['items', 'days', 'item_days', 'entries', 'adjustments', 'day_edits']) out.tables[t] = (await db.execute(`SELECT * FROM ${t}`)).rows;
    return out;
  }

  /** Reload everything from the database (after a restore from Turso or the old-data import). */
  async function reload() {
    items = await loadItems(db); days = await loadDays(db); rev = Number(await getMeta(db, 'rev', 0));
    const o = days.find(d => d.status === 'open'); open = o ? await loadBook(db, o.id) : null;
  }

  return {
    snapshot, setup, applyOps, closeDay, getDay, editDay, setDayNotes, purgeItem, itemHistory, cashProfitThisMonth, exportAll, reload,
    get rev() { return rev; }, get openDayId() { return open?.day.id; },
  };
}

export { EngineError };
