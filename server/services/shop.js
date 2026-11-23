/* =====================================================================
   THE SHOP SERVICE — the server side of every action.
   It keeps the open day in memory, applies changes with the shared engine,
   saves them to the local database (one all-or-nothing transaction each time)
   and answers questions (history, calendar, ربح الكاش ...).
   ===================================================================== */
import crypto from 'node:crypto';
import { emptyBook, summarize, applyAll, nextBook, carry, checkCloseDate, clone, isCashProfit, reduce, EngineError, COMP_FIELDS, notePart, unchecked, rowFinal, sameKey } from '../../shared/engine.js';
import { negateCalc } from '../../shared/money.js';
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
  let late = await loadLate();                   // changes written offline for a day that was closed meanwhile
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
  async function loadLate() {
    return (await db.execute("SELECT op_id, day_id, op, device, at, error FROM late_ops WHERE status='pending' ORDER BY at, op_id")).rows
      .map(r => ({ opId: r.op_id, dayId: r.day_id, op: JSON.parse(r.op), device: r.device, at: r.at, error: r.error || null }));
  }
  const refreshDays = async () => { days = await loadDays(db); };

  /* ---------- what devices receive ---------- */
  function snapshot() {
    return {
      rev, items, book: open, summary: open ? summarize(open, items) : null,
      days: days.filter(d => d.status === 'closed'),
      setupNeeded: !open,
      today: today(),
      late,
    };
  }

  /* ---------- first start: set التصفية of the first day yourself ---------- */
  async function setup({ opening }) {
    return serial(async () => {
      if (open) throw new UserError('تم الإعداد بالفعل');
      const book = emptyBook(uid(), null, 1);
      reduce({ items, book }, { t: 'setOpening', value: opening });
      book.day.orig = { opening: book.day.opening };
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
        const r = await db.execute({ sql: `SELECT op_id FROM op_log WHERE status IN ('ok','late') AND op_id IN (${part.map(() => '?').join(',')})`, args: part });
        for (const row of r.rows) seen.add(row.op_id);
      }
      const closedIds = new Set(days.filter(d => d.status === 'closed').map(d => d.id));
      const isLate = o => o.dayId && o.dayId !== open.day.id && closedIds.has(o.dayId);
      const lateOps = ops.filter(o => !seen.has(o.opId) && isLate(o));
      const fresh = ops.filter(o => !seen.has(o.opId) && !isLate(o));
      if (lateOps.length) {
        await write(async (tx, r) => {
          for (const o of lateOps) {
            const { password, ...clean } = o;
            await upsert(tx, 'late_ops', { op_id: o.opId || uid(), day_id: o.dayId, op: JSON.stringify(clean), device: device || null, at: o.ts || now().toISOString(), status: 'pending', error: null, decided_at: null }, r);
            await upsert(tx, 'op_log', { op_id: o.opId || uid(), at: now().toISOString(), device: device || null, status: 'late', error: null, op: JSON.stringify(clean) }, r);
          }
        });
        late = await loadLate();
        for (const o of lateOps) seen.add(o.opId);
      }
      const state = { items: clone(items), book: clone(open) };
      const { done, rejected } = applyAll(state, fresh.map(fromOld).map(gapCheck));
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
      if (!open.day.cashChanged && !open.day.networkChanged) throw new UserError('لم تُكتب النقدية ولا المكن');
      const left = unchecked(open, items);
      if (left.length) throw new UserError('لم يُكتب تغيير اليوم لكل العملاء والديون (٠ مقبول)');
      try { checkCloseDate(date, today(), closedDates()); } catch (e) { throw new UserError(e.message); }
      const closed = clone(open);
      if (notes !== undefined) closed.day.notes = String(notes);
      closed.day.date = date; closed.day.status = 'closed'; closed.day.closedAt = now().toISOString();
      const sum = summarize(closed, items);
      closed.day.orig = sum;                                           // the values it was closed with (crossed out if changed later)
      const next = nextBook(closed, items, uid());                     // next day: تصفية البارحة = this day's REAL total
      next.day.orig = { opening: next.day.opening };
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
      const fixed = ops.map(fromOld).map(o => { const { gap: _g, ...x } = o; return x.t === 'setOpening' && target.day.seq === 1 ? { ...x, force: true } : x; });
      const { rejected } = applyAll(st, fixed.map(o => ({ ...o, dayId: undefined })));
      if (rejected.length) throw new UserError('تعديل غير صالح: ' + rejected[0].error);
      const { books, changes } = await cascade(target, st);
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

  /**
   * A saved day changed (calendar edit or compensation): let it flow to every later day and the open day,
   * in the order they were worked — each later day's تصفية البارحة = the previous day's (new) real total.
   */
  async function cascade(target, st) {
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
    return { books, changes };
  }

  /**
   * تعويض: a known reason for a saved day's عجز / زيادة. `amount` (signed) is added to ONE category total of that
   * day's summary (the tables stay as they were closed) and flows to every later day like a calendar edit.
   * `notes` = the day's whole note after editing; the part that was added is kept with the compensation.
   */
  async function compensate({ dayId, field, amount, notes }, device) {
    return serial(async () => {
      const target = await loadBook(db, dayId);
      if (!target || target.day.status !== 'closed') throw new UserError('هذا اليوم غير محفوظ');
      if (!COMP_FIELDS[field]) throw new UserError('اختر ما يُضاف إليه المبلغ');
      const value = Math.round(Number(amount) * 100) / 100;
      if (!Number.isFinite(value) || !value || Math.abs(value) > 1e12) throw new UserError('اكتب المبلغ');
      const text = notes === undefined ? target.day.notes || '' : String(notes);
      if (text.length > 5000) throw new UserError('الملاحظة طويلة جدًا');
      const st = { items: clone(items), book: clone(target) };
      const id = uid();
      st.book.comps = { ...(st.book.comps || {}), [id]: { id, field, amount: value, note: notePart(target.day.notes, text), createdAt: now().toISOString(), device: device || null } };
      st.book.day.notes = text;
      const { books, changes } = await cascade(target, st);
      await write(async (tx, r) => {
        for (const { before, after } of books) await saveBook(tx, before, after, summarize(after, st.items), r);
        await logOps(tx, r, [{ opId: 'comp-' + id, t: 'compensate', dayId, field, amount: value }], device, [], []);
      });
      const last = books[books.length - 1].after;
      if (open && last.day.id === open.day.id) open = last;
      await refreshDays();
      return { changes, snapshot: snapshot() };
    });
  }

  /**
   * Late changes: «أضف» = into the saved day they were written for (one calendar edit per day, flows to later days);
   * a change that no longer fits that day stays in the list with the reason. «ارفض» = dropped (kept in the log).
   */
  async function decideLate({ ids, accept }, device) {
    const want = new Set(ids && ids.length ? ids : late.map(x => x.opId));
    const chosen = late.filter(x => want.has(x.opId));
    if (!chosen.length) throw new UserError('لا توجد تغييرات');
    if (!accept) {
      await serial(() => write(async (tx, r) => {
        for (const x of chosen) await upsert(tx, 'late_ops', { op_id: x.opId, day_id: x.dayId, op: JSON.stringify(x.op), device: x.device, at: x.at, status: 'refused', error: null, decided_at: now().toISOString() }, r);
      }));
      late = await loadLate();
      return { accepted: 0, refused: chosen.length, failed: [], snapshot: snapshot() };
    }
    const byDay = new Map();
    for (const x of chosen) { if (!byDay.has(x.dayId)) byDay.set(x.dayId, []); byDay.get(x.dayId).push(x); }
    const order = [...byDay.keys()].sort((a, b) => (days.find(d => d.id === a)?.seq || 0) - (days.find(d => d.id === b)?.seq || 0));
    let accepted = 0; const failed = [];
    for (const dayId of order) {
      const list = byDay.get(dayId);
      // which of them still fit that day (checked on a copy, nothing saved)
      const target = await loadBook(db, dayId);
      const st = { items: clone(items), book: clone(target) };
      const ok = [], bad = [];
      for (const x of list) {
        const { opId, ts, dayId: _d, dayDate, ...op } = x.op;
        const now1 = fromOld({ ...op, ts: x.op.ts });
        try { reduce(st, now1); ok.push({ x, op: { ...now1, opId: x.opId } }); }
        catch (e) { bad.push({ x, error: e.message }); }
      }
      if (ok.length) {
        const devs = [...new Set(ok.map(o => o.x.device).filter(Boolean))].length;
        await editDay({ dayId, ops: ok.map(o => o.op), note: `تغييرات متأخرة (${ok.length})${devs > 1 ? ' من أكثر من جهاز' : ''}` }, device);
        await serial(() => write(async (tx, r) => {
          for (const { x } of ok) await upsert(tx, 'late_ops', { op_id: x.opId, day_id: x.dayId, op: JSON.stringify(x.op), device: x.device, at: x.at, status: 'accepted', error: null, decided_at: now().toISOString() }, r);
        }));
        accepted += ok.length;
      }
      if (bad.length) await serial(() => write(async (tx, r) => {
        for (const { x, error } of bad) await upsert(tx, 'late_ops', { op_id: x.opId, day_id: x.dayId, op: JSON.stringify(x.op), device: x.device, at: x.at, status: 'pending', error, decided_at: null }, r);
      }));
      failed.push(...bad.map(b => ({ opId: b.x.opId, error: b.error })));
    }
    late = await loadLate();
    return { accepted, refused: 0, failed, snapshot: snapshot() };
  }

  /** Delete a تعويض (wrong amount / category): every later day goes back as if it never happened. */
  async function deleteCompensation({ dayId, compId }, device) {
    return serial(async () => {
      const target = await loadBook(db, dayId);
      if (!target || !target.comps?.[compId]) throw new UserError('غير موجود', 404);
      const st = { items: clone(items), book: clone(target) };
      const c = st.book.comps[compId];
      delete st.book.comps[compId];
      const { books, changes } = await cascade(target, st);
      await write(async (tx, r) => {
        for (const { before, after } of books) await saveBook(tx, before, after, summarize(after, st.items), r);
        await logOps(tx, r, [{ opId: 'uncomp-' + compId, t: 'deleteCompensation', dayId, compId, field: c.field, amount: c.amount }], device, [], []);
      });
      const last = books[books.length - 1].after;
      if (open && last.day.id === open.day.id) open = last;
      await refreshDays();
      return { changes, snapshot: snapshot() };
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
    for (const t of ['items', 'days', 'item_days', 'entries', 'adjustments', 'compensations', 'day_edits']) out.tables[t] = (await db.execute(`SELECT * FROM ${t}`)).rows;
    return out;
  }

  /** Reload everything from the database (after a restore from Turso or the old-data import). */
  async function reload() {
    items = await loadItems(db); days = await loadDays(db); rev = Number(await getMeta(db, 'rev', 0)); late = await loadLate();
    const o = days.find(d => d.status === 'open'); open = o ? await loadBook(db, o.id) : null;
  }

  /**
   * ONE-TIME REPAIR (v3.38), at start:
   * 1. Debts typed by hand in v3.26–3.31 (value only, no start / change) become «start + change» with the SAME final.
   * 2. v3.32–3.37 could keep a stale value for a client / debt in the days AFTER an edited day (or a تعويض): those days
   *    are recalculated from the earliest edited day onward — exactly what the edit should have done.
   * Days before the first edit (e.g. imported from the old version) keep everything they hold. Runs once.
   */
  async function repairFlow() {
    if (await getMeta(db, 'repair_flow_v1')) return 0;
    const all = [...days].sort((a, b) => a.seq - b.seq);
    const firstEdited = all.find(d => d.own > 0 && d.status === 'closed')?.seq ?? Infinity;
    const sign = v => (v > 0 ? '+' + v : String(v));
    const books = []; let prev = null, typed = new Set();
    for (const d of all) {
      const before = await loadBook(db, d.id), after = clone(before), nowTyped = new Set();
      for (const [id, r] of Object.entries(after.rows)) {
        if (items[id]?.type !== 'debt' || r.calc || r.opening || !r.value) continue;
        const p = prev?.rows[id];
        if (!p) { r.opening = r.value; nowTyped.add(id); continue; }                  // added as a typed debt
        const pf = rowFinal(p, 'debt');
        // typed (set by hand that day, or carried from a typed day, or unchanged): keep its final value
        if (r.changed || typed.has(id) || r.value === pf) { r.opening = pf; const diff = Math.round((r.value - pf) * 100) / 100; if (diff) r.calc = sign(diff); nowTyped.add(id); }
        // otherwise it is a stale value after an edit: the recalculation below puts it right
      }
      if (prev && d.seq > firstEdited) carry(prev, items, after);
      for (const [id, r] of Object.entries(after.rows)) if (items[id]?.type === 'client' || items[id]?.type === 'debt') r.value = rowFinal(r, items[id].type);
      if (JSON.stringify(before) !== JSON.stringify(after)) books.push({ before, after });
      prev = after; typed = nowTyped;
    }
    await write(async (tx, r) => {
      for (const { before, after } of books) await saveBook(tx, before, after, summarize(after, items), r);
      await tx.execute({ sql: "INSERT INTO meta(key,value) VALUES('repair_flow_v1',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", args: [String(books.length)] });
    });
    if (books.length) console.log(`repair: ${books.length} day(s) recalculated (debts typed by hand / values after an edited day)`);
    await reload();
    return books.length;
  }
  await repairFlow();

  /**
   * ONE LIST OF PEOPLE (v3.38): every «debt» item becomes a person («client» item) with a negative balance — the same
   * totals, every day. A debt with the same name as a client is merged into that client (one balance = what he owes
   * minus what the shop owes him); its old item is removed. Runs at every start (nothing to do once converted).
   * `converted` remembers each old debt id: a change written for it by a phone before the update is translated.
   */
  let converted = JSON.parse((await getMeta(db, 'people_converted')) || '{}');
  async function mergePeople() {
    const debtIds = Object.keys(items).filter(id => items[id].type === 'debt' && !items[id].purged);
    if (!debtIds.length) return 0;
    const at = now().toISOString(), plan = {};
    for (const did of debtIds) {
      const k = sameKey(items[did].name);
      const cid = Object.keys(items).find(id => items[id].type === 'client' && !items[id].purged && sameKey(items[id].name) === k);
      plan[did] = cid || did;
    }
    const newItems = clone(items);
    for (const did of debtIds) { if (plan[did] === did) newItems[did].type = 'client'; else newItems[did].purged = true; }
    const neg = d => ({ ...d, opening: -(d.opening || 0) || 0, calc: negateCalc(d.calc), value: -(d.value || 0) || 0 });
    const join = (a, b) => { const A = String(a || '').trim(), Z = String(b || '').trim(); return !A || A === '0' ? Z || A : !Z || Z === '0' ? A : A + '\n' + Z; };
    const r2 = x => Math.round(x * 100) / 100;
    const books = [];
    for (const d of [...days].sort((a, b) => a.seq - b.seq)) {
      const before = await loadBook(db, d.id), after = clone(before);
      let touched = false;
      for (const did of debtIds) {
        const dr = after.rows[did]; if (!dr) continue;
        touched = true;
        const into = plan[did];
        if (into === did) { after.rows[did] = neg(dr); continue; }
        const c = after.rows[into];
        if (!c || (c.status !== 'active' && dr.status === 'active')) after.rows[into] = { ...neg(dr), active: !!c?.active || dr.active };
        else if (dr.status === 'active') {
          Object.assign(c, { opening: r2(c.opening - (dr.opening || 0)), calc: join(c.calc, negateCalc(dr.calc)), value: r2(c.value - (dr.value || 0)),
            changed: c.changed || dr.changed, schanged: c.schanged || dr.schanged });
        }
        delete after.rows[did];
      }
      if (!touched) continue;
      const a = summarize(before, items), z = summarize(after, newItems);
      // the day's stored totals are kept (imported days hold their own); only what the conversion changed moves them
      const kept = days.find(x => x.id === d.id) || {};
      const shift = k => (kept[k] == null ? z[k] : r2(kept[k] + (z[k] ?? 0) - (a[k] ?? 0)));
      const sum = { ...z, profit: shift('profit'), virtual: shift('virtual'), real: shift('real'), diff: shift('diff') };
      // the day's closing values keep their meaning: only the split between العملاء and الديون may move (a merge)
      if (after.day.orig) {
        after.day.orig = { ...after.day.orig, ...(after.day.orig.clients != null ? { clients: r2(after.day.orig.clients + z.clients - a.clients) } : {}),
          ...(after.day.orig.debts != null ? { debts: r2(after.day.orig.debts + z.debts - a.debts) } : {}) };
      }
      books.push({ before, after, sum });
    }
    converted = { ...converted, ...Object.fromEntries(debtIds.map(did => [did, { into: plan[did], at }])) };
    await write(async (tx, r) => {
      await saveItems(tx, items, newItems, r);
      for (const { before, after, sum } of books) await saveBook(tx, before, after, sum, r);
      await tx.execute({ sql: "INSERT INTO meta(key,value) VALUES('people_converted',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", args: [JSON.stringify(converted)] });
    });
    console.log(`people: ${debtIds.length} debt(s) joined the list of people (${debtIds.filter(d => plan[d] !== d).length} merged with a client of the same name)`);
    await reload();
    return debtIds.length;
  }
  await mergePeople();
  /**
   * «تصفية البارحة» typed by hand on the open day: only when the day before today was NOT saved (the number copied from
   * an older saved day may be wrong). Otherwise the request loses its `gap` and the engine refuses it.
   */
  const gapCheck = o => {
    if (o?.t !== 'setOpening' || !o.gap) return o;
    const t = today(), d = new Date(t + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - 1);
    const yesterday = d.toISOString().slice(0, 10);
    const ok = open && open.day.seq !== 1 && !days.some(x => x.status === 'closed' && x.date === yesterday);
    if (ok) return o;
    const { gap: _g, ...rest } = o; return rest;
  };
  /** A change a phone wrote for an old debt before the update: same person, and its change seen from the other side. */
  const fromOld = o => {
    const c = o && converted[o.id]; if (!c) return o;
    const x = { ...o, id: c.into };
    if (o.t === 'setCalc' && String(o.ts || '') < c.at) x.calc = negateCalc(o.calc);
    return x;
  };

  return {
    snapshot, setup, applyOps, closeDay, getDay, editDay, compensate, deleteCompensation, decideLate, setDayNotes, purgeItem, itemHistory, cashProfitThisMonth, exportAll, reload,
    get rev() { return rev; }, get openDayId() { return open?.day.id; },
  };
}

export { EngineError };
