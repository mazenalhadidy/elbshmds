/* =====================================================================
   THE SHOP ENGINE — every accounting rule lives here, and ONLY here.
   The same file runs on the server (the truth) and in the browser/phone
   (so the screen updates instantly, even offline). They can never disagree.

   WORDS USED IN THE CODE
   - item   : something with a balance that lives across days:
                wallet   (محفظة)  -> its balance is typed by hand
                client   (عميل)    -> debt the client owes the shop
                debt     (ديون)    -> what the shop owes someone (same rows as a client)
                constant (ثابت)    -> fixed amount subtracted every day
   - book   : everything of ONE day: the day itself, one "row" per item,
              the input/output/sale entries and the manual adjustments.
   - row    : an item's numbers on a given day.
                wallet/constant: value (typed)
                client/debt    : opening (from the day before) + today's change (calculator text) = final
   - op     : one change, e.g. { t:'addEntry', id, kind:'sale', amount:500 }.
              reduce(state, op) applies it. Same op + same state = same result.

   WHAT CARRIES TO THE NEXT DAY: wallets, clients, shop debts, constants.
   WHAT STARTS EMPTY EVERY DAY: inputs/outputs/sales, cash, network, manual adjustments, notes.

   THE NUMBERS (التصفية page)
     تصفية البارحة        opening   = the confirmed real total of the previous day
     ربح اليوم            profit    = inputs + sales - outputs
     التصفية الافتراضية    virtual   = opening + profit
     التصفية الحقيقية      real      = wallets + clients + cash + network
                                      - shop debts - constants ± adjustments
     العجز/الزيادة        diff      = virtual - real   (positive = عجز, negative = زيادة)
   ===================================================================== */
import { r2, parseAmount, evalCalc, toLatinDigits } from './money.js';

export class EngineError extends Error {}
const fail = m => { throw new EngineError(m); };
export const clone = o => JSON.parse(JSON.stringify(o));

export const ITEM_TYPES = { wallet: 'محفظة', client: 'عميل', debt: 'دين على المحل', constant: 'ثابت' };
export const ENTRY_KINDS = { input: 'المدخلات', output: 'المخرجات', sale: 'المبيعات' };
// items whose day value is: what it was yesterday + today's change (the calculator, or the new value typed directly)
const hasCalc = type => type === 'client' || type === 'debt';

/* ---------------------------------------------------------------------
   Building blocks
   --------------------------------------------------------------------- */
/** A brand-new empty day. opening = تصفية البارحة (null only before the very first day is set up). */
export function emptyBook(dayId, opening = null, seq = 1) {
  return {
    day: { id: dayId, seq, date: null, status: 'open', opening, openingManual: false, cash: 0, network: 0, cashChanged: false, networkChanged: false, notes: '', closedAt: null },
    rows: {},      // itemId -> row
    entries: {},   // entryId -> { id, kind, name, amount, createdAt, late? }
    adjs: {},      // adjustmentId -> { id, amount (+ adds, - subtracts), note, createdAt }
    comps: {},     // compensationId -> { id, field, amount, note, createdAt } (saved days, see COMP_FIELDS)
  };
}

/**
 * PEOPLE: one list for العملاء and الديون. A person is a «client» item with ONE balance: positive = he owes the shop
 * (shown in العملاء), negative = the shop owes him (shown in الديون, as a positive amount). At 0 he stays where the day
 * started. Moving from one to the other is just his balance crossing 0.
 */
export function personSide(row) {
  const f = rowFinal(row, 'client');
  return f < 0 || (f === 0 && (row.opening || 0) < 0) ? 'debt' : 'client';
}

/** Two names / numbers are the same item when they read the same: أ/إ/آ=ا، ة=ه، ى=ي، no tashkeel, spaces and dashes ignored, any digits. */
export const sameKey = s => toLatinDigits(String(s ?? '')).trim().toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/[\u064B-\u0652\u0640]/g, '').replace(/[\s\-_.]+/g, '');

/** Clients and debts still without today's change (0 counts): the day cannot be closed before each one is written. */
export function unchecked(book, items) {
  return Object.entries(book.rows).filter(([id, r]) => hasCalc(items[id]?.type) && !items[id].purged && r.status === 'active' && !String(r.calc ?? '').trim()).map(([id]) => id);
}

/** A row's final value on its day. */
export function rowFinal(row, type) {
  if (hasCalc(type)) return r2((row.opening || 0) + (evalCalc(row.calc) || 0));   // ALWAYS: the day's start + today's change
  return r2(row.value || 0);
}

const amountOf = (v, msg = 'القيمة غير صحيحة') => { const n = parseAmount(v); if (!Number.isFinite(n)) fail(msg); return r2(n); };
const positive = (v, msg = 'القيمة غير صحيحة') => { const n = amountOf(v, msg); if (!(n > 0)) fail(msg); return n; };
const text = s => String(s ?? '').trim();

/* ---------------------------------------------------------------------
   The summary of one day (all the numbers of the التصفية page)
   --------------------------------------------------------------------- */
export function summarize(book, items) {
  let wallets = 0, clients = 0, debts = 0, constants = 0, input = 0, output = 0, sale = 0, adjustments = 0;
  const C = compTotals(book.comps);                       // compensations: added to the category totals only
  for (const [id, row] of Object.entries(book.rows)) {
    const it = items[id];
    if (!it || row.status !== 'active') continue;          // deleted items never count
    const v = rowFinal(row, it.type);
    if (it.type === 'wallet') wallets += v;                  // every wallet counts (the ✓ "active" mark is only a visual hint)
    else if (it.type === 'client') { if (v >= 0) clients += v; else debts -= v; }   // one person, one balance: + owes the shop, − the shop owes him
    else if (it.type === 'debt') debts += v;                                        // (older data, converted at start)
    else if (it.type === 'constant') constants += v;
  }
  for (const e of Object.values(book.entries)) { if (e.kind === 'input') input += e.amount; else if (e.kind === 'output') output += e.amount; else sale += e.amount; }
  for (const a of Object.values(book.adjs)) adjustments += a.amount;
  input += C.input; output += C.output; sale += C.sale;
  wallets += C.wallets; clients += C.clients; debts += C.debts; constants += C.constants;
  const d = book.day, cash = d.cash + C.cash, network = d.network + C.network;
  const profit = r2(input + sale - output);
  const opening = d.opening == null ? null : r2(d.opening);
  const virtual = opening == null ? null : r2(opening + profit);
  const real = r2(wallets + clients + cash + network - debts - constants + adjustments);
  const diff = virtual == null ? null : r2(virtual - real);
  return {
    opening, profit, virtual, real, diff,
    input: r2(input), output: r2(output), sale: r2(sale),
    wallets: r2(wallets), clients: r2(clients), debts: r2(debts), constants: r2(constants), adjustments: r2(adjustments),
    cash: r2(cash), network: r2(network),
  };
}

/* ---------------------------------------------------------------------
   COMPENSATIONS (تعويض) on a saved day: a known reason for its عجز / زيادة, e.g. money found later on a wallet.
   The amount is added to ONE category total of the summary (+ more, − less); the day's tables are not changed.
     المبيعات / المدخلات / المخرجات -> ربح اليوم -> التصفية الافتراضية
     المحافظ / العملاء / النقدية / المكن (+) and الديون / الثوابت (−) -> التصفية الحقيقية -> تصفية البارحة of the next day
   --------------------------------------------------------------------- */
export const COMP_FIELDS = { sale: 'المبيعات', input: 'المدخلات', output: 'المخرجات', wallets: 'المحافظ', clients: 'العملاء', debts: 'الديون', constants: 'الثوابت', network: 'المكن', cash: 'النقدية' };
export function compTotals(comps) {
  const C = Object.fromEntries(Object.keys(COMP_FIELDS).map(k => [k, 0]));
  for (const c of Object.values(comps || {})) if (c.field in C) C[c.field] += Number(c.amount) || 0;
  return C;
}
/** The change a compensation makes to the day's difference (افتراضي − حقيقي). */
export function compEffect(field, amount) {
  const a = Number(amount) || 0;
  if (field === 'sale' || field === 'input') return { virtual: a, real: 0 };
  if (field === 'output') return { virtual: -a, real: 0 };
  if (field === 'debts' || field === 'constants') return { virtual: 0, real: -a };
  return { virtual: 0, real: a };
}
/** The signed amount on `field` that makes a difference of `diff` exactly 0 («صفّر الفرق»). */
export function neutralizing(field, diff) {
  const e = compEffect(field, 1);                        // effect of +1
  const per = e.virtual - e.real;                        // change of the difference for +1
  return r2(-diff / per);
}
/** The part of a day's note that a change added (the note before -> after): only what is new is listed with the change. */
export function notePart(before, after) {
  const a = String(before || '').trim(), b = String(after || '').trim();
  if (a === b) return '';
  return a && b.startsWith(a) ? b.slice(a.length).trim() : b;
}

/* ---------------------------------------------------------------------
   Carrying values from one day to the next ("like a spreadsheet")
   - client/debt: the next day starts from the previous final (calculator empties).
   - wallet/constant: copied, unless they were changed on that later day.
   - cash, network, adjustments, inputs/outputs/sales: NOT carried (every day starts with its own).
   - status (deleted / active) and the ✓ mark: copied, unless changed on that later day.
   - items deleted for good are not carried into a day that does not hold them already.
   Used when a day is closed (fresh = a brand-new next day) and when a past day is edited
   (the change flows to all the following days).
   --------------------------------------------------------------------- */
export function carry(prev, items, next, prevSummary = summarize(prev, items)) {
  // تصفية البارحة = the confirmed real total — unless it was typed by hand (the day before it was not saved)
  if (!next.day.openingManual) next.day.opening = prevSummary.real;
  for (const [id, pr] of Object.entries(prev.rows)) {
    const it = items[id];
    if (!it) { delete next.rows[id]; continue; }
    // deleted for good: never in a new day, but a saved day that already holds him keeps him (recalculated)
    if (it.purged && !next.rows[id]) continue;
    let r = next.rows[id];
    if (!r) r = next.rows[id] = { opening: 0, calc: '', value: 0, active: !!pr.active, status: pr.status, changed: false, achanged: false, schanged: false };
    if (hasCalc(it.type)) { r.opening = rowFinal(pr, it.type); r.value = rowFinal(r, it.type); }   // today's change (calc) stays
    else if (!r.changed) r.value = pr.value;
    if (!r.achanged) r.active = !!pr.active;
    if (!r.schanged) r.status = pr.status;
  }
  return next;
}

/** The next day after `book` is closed. */
export function nextBook(book, items, newDayId) {
  return carry(book, items, emptyBook(newDayId, null, book.day.seq + 1));
}

/* ---------------------------------------------------------------------
   Applying ONE change.
   state = { items, book }   (book = the day being worked on: the open day, or a past day in edit mode)
   Throws EngineError (with an Arabic message) when the change is not allowed.
   Everything is checked BEFORE anything is changed.
   --------------------------------------------------------------------- */
export function reduce(state, op) {
  const { items, book } = state;
  const d = book.day;
  // A change written while an EARLIER day was open (offline phone) that arrives after that day was closed.
  const late = op.dayId && op.dayId !== d.id ? (op.dayDate || 'يوم سابق') : null;
  const lateRefuse = () => { if (late) fail('هذا التعديل كُتب ليوم أُغلق بعد ذلك — لم يُطبَّق'); };
  const row = id => book.rows[id] || fail('غير موجود في هذا اليوم');
  const item = id => (items[id] && !items[id].purged ? items[id] : fail('غير موجود'));
  const ts = op.ts || new Date().toISOString();
  // two ACTIVE wallets (or clients, or debts) with the same name/number would be impossible to tell apart
  const noDuplicate = (type, name, except) => {
    const k = sameKey(name), group = t => (t === 'debt' ? 'client' : t);         // العملاء and الديون are ONE list of people
    const same = Object.entries(items).find(([id, it]) => id !== except && group(it.type) === group(type) && !it.purged && sameKey(it.name) === k && book.rows[id]?.status === 'active');
    if (same) fail(type === 'wallet' ? 'هذا الرقم موجود بالفعل' : 'هذا الاسم موجود بالفعل');
  };

  switch (op.t) {
    /* ----- input / output / sale ----- */
    case 'addEntry': {
      if (!ENTRY_KINDS[op.kind] || !op.id) fail('بيانات غير صحيحة');
      if (book.entries[op.id]) return;                                 // already there (repeated op)
      book.entries[op.id] = { id: op.id, kind: op.kind, name: text(op.name), amount: positive(op.amount), createdAt: ts, ...(late ? { late } : {}) };
      return;
    }
    case 'editEntry': {
      const e = book.entries[op.id] || fail('السجل غير موجود في هذا اليوم');
      const amount = op.amount !== undefined ? positive(op.amount) : e.amount;
      e.amount = amount; if (op.name !== undefined) e.name = text(op.name);
      return;
    }
    case 'delEntry': { if (!book.entries[op.id]) fail('السجل غير موجود في هذا اليوم'); delete book.entries[op.id]; return; }

    /* ----- items: wallets, clients, shop debts, constants ----- */
    case 'addItem': {
      if (!ITEM_TYPES[op.type] || !op.id) fail('بيانات غير صحيحة');
      if (items[op.id]) return;                                        // repeated op
      const name = op.type === 'wallet' ? toLatinDigits(text(op.name)) : text(op.name);   // wallet numbers are stored with 0-9
      if (!name && op.type !== 'constant') fail(op.type === 'wallet' ? 'اكتب رقم المحفظة' : 'اكتب الاسم');
      let amount = op.type === 'constant' ? positive(op.amount) : amountOf(op.amount, op.type === 'wallet' ? 'اكتب رصيد المحفظة' : 'اكتب المبلغ');
      if (op.type !== 'constant') noDuplicate(op.type, name);
      // added in الديون: the same person list, with the shop owing him (negative balance)
      const type = op.type === 'debt' ? 'client' : op.type;
      if (op.type === 'debt') amount = -amount || 0;                        // (never −0)
      items[op.id] = { id: op.id, type, name: name || ITEM_TYPES.constant, purged: false, createdAt: ts };
      book.rows[op.id] = hasCalc(type)
        ? { opening: amount, calc: '0', value: amount, active: false, status: 'active', changed: true, achanged: false, schanged: true }   // a new one = written today, change 0
        : { opening: 0, calc: '', value: amount, active: op.type === 'wallet', status: 'active', changed: true, achanged: false, schanged: true };
      return;
    }
    case 'renameItem': {
      const it = item(op.id), name = it.type === 'wallet' ? toLatinDigits(text(op.name)) : text(op.name);
      if (!name) fail('اكتب الاسم');
      if (it.type !== 'constant' && book.rows[op.id]?.status === 'active') noDuplicate(it.type, name, op.id);
      it.name = name; return;
    }
    case 'setValue': {                                                  // wallet balance / constant amount, typed by hand
      lateRefuse();
      const it = item(op.id), r = row(op.id);
      if (hasCalc(it.type)) fail('بيانات غير صحيحة');
      r.value = it.type === 'constant' ? positive(op.value) : amountOf(op.value); r.changed = true; return;
    }
    case 'setActive': { item(op.id); const r = row(op.id); r.active = !!op.active; r.achanged = true; return; }
    case 'setCalc': {                                                   // the calculator of a client / shop debt
      lateRefuse();                                                     // a calculation written for a closed day is kept in "لم يُقبل" for you to redo, never guessed
      const it = item(op.id), r = row(op.id);
      if (!hasCalc(it.type)) fail('بيانات غير صحيحة');
      const calc = String(op.calc ?? '');
      if (!Number.isFinite(evalCalc(calc))) fail('الحساب غير صحيح — استخدم أرقامًا و + و − فقط');
      r.calc = calc; r.value = rowFinal(r, it.type); return;
    }
    case 'delItem': { item(op.id); const r = row(op.id); r.status = 'deleted'; r.schanged = true; return; }   // stays visible (struck), keeps its history
    case 'restoreItem': { const it = item(op.id), r = row(op.id); if (it.type !== 'constant') noDuplicate(it.type, it.name, op.id); r.status = 'active'; r.schanged = true; return; }

    /* ----- the day ----- */
    case 'setCash': lateRefuse(); d.cash = amountOf(op.value); d.cashChanged = true; return;
    case 'setNetwork': lateRefuse(); d.network = amountOf(op.value); d.networkChanged = true; return;
    case 'setNotes': lateRefuse(); d.notes = String(op.notes ?? ''); return;
    case 'setOpening': {
      // the very first day; or a day whose day before was not saved (`gap`, checked by the server: then it is typed by
      // hand and kept when earlier days change); or a past-day edit (`force`, by the server)
      if (!op.force && !op.gap && d.seq !== 1) fail('تصفية البارحة تأتي من اليوم السابق');
      d.opening = amountOf(op.value);
      if (op.gap) d.openingManual = true;
      if (!op.force && d.orig) d.orig = { ...d.orig, opening: d.opening };   // the day's own setting: never shown crossed out
      return;
    }
    case 'addAdj': {                                                    // manual + / − on the real total, with a note
      if (!op.id) fail('بيانات غير صحيحة');
      if (book.adjs[op.id]) return;
      const amount = amountOf(op.amount); if (!amount) fail('اكتب المبلغ');
      if (!text(op.note)) fail('اكتب سبب هذا المبلغ');
      book.adjs[op.id] = { id: op.id, amount, note: text(op.note), createdAt: ts, ...(late ? { late } : {}) };
      return;
    }
    case 'delAdj': { if (!book.adjs[op.id]) fail('غير موجود في هذا اليوم'); delete book.adjs[op.id]; return; }

    default: fail('عملية غير معروفة');
  }
}

/** Apply many ops; each one is all-or-nothing. Returns { done:[opId], rejected:[{opId,error}] }. */
export function applyAll(state, ops) {
  const done = [], rejected = [];
  for (const op of ops) {
    const snap = clone(state);
    try { reduce(state, op); done.push(op.opId); }
    catch (e) {
      if (!(e instanceof EngineError)) throw e;
      state.items = snap.items; state.book = snap.book;                 // undo a half-applied op
      rejected.push({ opId: op.opId, error: e.message });
    }
  }
  return { done, rejected };
}

/* ---------------------------------------------------------------------
   Date rules for closing a day
   - any date up to today that has no saved day yet
   --------------------------------------------------------------------- */
export function checkCloseDate(date, today, closedDates) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) fail('اختر تاريخًا');
  if (closedDates.includes(date)) fail('يوجد يوم محفوظ بهذا التاريخ بالفعل');
  if (today && date > today) fail('لا يمكن حفظ يوم بتاريخ لم يأتِ بعد');
}

/* ---------------------------------------------------------------------
   "ربح الكاش من أول الشهر": inputs whose name starts with ربح كاش / ربح الكاش
   --------------------------------------------------------------------- */
export const isCashProfit = name => /^\s*ربح\s+(ال)?كاش/.test(String(name || ''));
