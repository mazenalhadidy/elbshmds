// The accounting rules (shared/engine.js), without server or database.
import { describe, it, expect } from 'vitest';
import { emptyBook, reduce, summarize, nextBook, carry, applyAll, checkCloseDate, isCashProfit, clone, unchecked, rowFinal, sameKey } from '../shared/engine.js';

let n = 0;
const st0 = (opening = 1000) => ({ items: {}, book: emptyBook('d1', opening) });
const go = (st, op) => reduce(st, { opId: 'o' + ++n, ts: '2026-11-15T10:00:00.000Z', ...op });

describe('engine', () => {
  it('computes the settlement numbers exactly as specified', () => {
    const st = st0(1000);
    go(st, { t: 'addEntry', id: 'e1', kind: 'input', amount: '٥٠٠' });
    go(st, { t: 'addEntry', id: 'e2', kind: 'sale', amount: 300, name: 'هاتف' });
    go(st, { t: 'addEntry', id: 'e3', kind: 'output', amount: 100 });
    go(st, { t: 'addItem', id: 'w1', type: 'wallet', name: '0100', amount: 400 });
    go(st, { t: 'addItem', id: 'c1', type: 'client', name: 'أحمد', amount: 600 });
    go(st, { t: 'addItem', id: 'd1', type: 'debt', name: 'تاجر', amount: 200 });
    go(st, { t: 'addItem', id: 'k1', type: 'constant', name: 'إيجار', amount: 50 });
    go(st, { t: 'setCash', value: 900 }); go(st, { t: 'setNetwork', value: 80 });
    go(st, { t: 'addAdj', id: 'a1', amount: -30, note: 'سلفة' });
    const s = summarize(st.book, st.items);
    expect(s.opening).toBe(1000);
    expect(s.profit).toBe(700);                                  // 500 + 300 - 100
    expect(s.virtual).toBe(1700);                                // تصفية البارحة + ربح اليوم
    expect(s.real).toBe(400 + 600 + 900 + 80 - 200 - 50 - 30);   // wallets + clients + cash + network - debts - constants ± adjustments = 1700
    expect(s.diff).toBe(0);                                      // virtual - real
  });

  it('debts are the same as clients: today\'s change, new ones start with change 0, a debt typed by hand keeps its value', () => {
    const st = st0(0);
    go(st, { t: 'addItem', id: 'd1', type: 'debt', name: 'تاجر', amount: 200 });
    expect(st.book.rows.d1.calc).toBe('0');                                        // written today: change 0
    expect(() => go(st, { t: 'setValue', id: 'd1', value: 5 })).toThrow();
    go(st, { t: 'setCalc', id: 'd1', calc: '+150' });
    expect(summarize(st.book, st.items).debts).toBe(350);
    const next = nextBook(st.book, st.items, 'd2');
    expect(next.rows.d1.opening).toBe(350); expect(next.rows.d1.calc).toBe('');
    expect(unchecked(next, st.items)).toEqual(['d1']);                             // a new day: not written yet
    // a debt typed by hand in the older version (value only): same final value, and the change starts from it
    const old = { opening: 0, calc: '', value: 900, active: false, status: 'active' };
    expect(rowFinal(old, 'debt')).toBe(900);
    const st2 = { items: { x: { id: 'x', type: 'debt', name: 'قديم' } }, book: { ...emptyBook('d9', 0), rows: { x: { ...old } } } };
    go(st2, { t: 'setCalc', id: 'x', calc: '-100' });
    expect(rowFinal(st2.book.rows.x, 'debt')).toBe(800);
  });

  it('names and numbers are compared as they read', () => {
    const st = st0(0);
    go(st, { t: 'addItem', id: 'c1', type: 'client', name: 'أحمد', amount: 0 });
    expect(() => go(st, { t: 'addItem', id: 'c2', type: 'client', name: ' احمد ', amount: 0 })).toThrow(/موجود/);
    go(st, { t: 'addItem', id: 'w1', type: 'wallet', name: '0101 988 6531 فودافون', amount: 0 });
    expect(() => go(st, { t: 'addItem', id: 'w2', type: 'wallet', name: '٠١٠١٩٨٨٦٥٣١ فودافون', amount: 0 })).toThrow(/موجود/);
    go(st, { t: 'addItem', id: 'w3', type: 'wallet', name: '01019886531 اتصالات', amount: 0 });   // same number, other text: another wallet
    expect(sameKey('0101-988 6531')).toBe('01019886531');
  });

  it('client calculator: final = opening + result, totals use the final', () => {
    const st = st0(0);
    go(st, { t: 'addItem', id: 'c1', type: 'client', name: 'أحمد', amount: 1000 });
    go(st, { t: 'setCalc', id: 'c1', calc: '746\n+9472\n-200' });
    expect(st.book.rows.c1.value).toBe(1000 + 10018);
    expect(summarize(st.book, st.items).clients).toBe(11018);
    expect(() => go(st, { t: 'setCalc', id: 'c1', calc: 'abc' })).toThrow(/الحساب/);
  });

  it('closing carries balances; the next day starts from the REAL total', () => {
    const st = st0(1000);
    go(st, { t: 'addItem', id: 'w1', type: 'wallet', name: '0100', amount: 400 });
    go(st, { t: 'addItem', id: 'c1', type: 'client', name: 'أحمد', amount: 100 });
    go(st, { t: 'setCalc', id: 'c1', calc: '+50' });
    go(st, { t: 'addEntry', id: 'e1', kind: 'sale', amount: 999 });
    go(st, { t: 'setActive', id: 'w1', active: false });
    const real = summarize(st.book, st.items).real;              // 400 + 150 = 550
    const nb = nextBook(st.book, st.items, 'd2');
    expect(nb.day.opening).toBe(real);
    expect(nb.rows.w1.value).toBe(400); expect(nb.rows.w1.active).toBe(false);
    expect(nb.rows.c1.opening).toBe(150); expect(nb.rows.c1.calc).toBe('');
    expect(Object.keys(nb.entries)).toHaveLength(0);
    expect(nb.day.seq).toBe(2);
    expect(nb.day.cash).toBe(0); expect(nb.day.network).toBe(0); expect(Object.keys(nb.adjs)).toHaveLength(0);   // start empty
  });

  it('deleted items stay listed but stop counting; purged items are not carried', () => {
    const st = st0(0);
    go(st, { t: 'addItem', id: 'w1', type: 'wallet', name: '0100', amount: 400 });
    go(st, { t: 'addItem', id: 'w2', type: 'wallet', name: '0111', amount: 100 });
    go(st, { t: 'delItem', id: 'w1' });
    expect(summarize(st.book, st.items).wallets).toBe(100);
    expect(st.book.rows.w1.status).toBe('deleted');
    st.items.w2.purged = true;
    const nb = nextBook(st.book, st.items, 'd2');
    expect(nb.rows.w1.status).toBe('deleted'); expect(nb.rows.w2).toBeUndefined();
    go({ items: st.items, book: nb }, { t: 'restoreItem', id: 'w1' });
    expect(summarize(nb, st.items).wallets).toBe(400);
  });

  it('editing a past day flows into the following days unless they changed that value', () => {
    const st = st0(1000);
    go(st, { t: 'addItem', id: 'w1', type: 'wallet', name: '0100', amount: 400 });
    go(st, { t: 'addItem', id: 'c1', type: 'client', name: 'أحمد', amount: 100 });
    const day1 = clone(st.book);
    const day2 = nextBook(day1, st.items, 'd2');
    go({ items: st.items, book: day2 }, { t: 'setValue', id: 'w1', value: 700 });      // wallet changed by hand on day 2
    // edit day 1: client +50, wallet 450
    go({ items: st.items, book: day1 }, { t: 'setCalc', id: 'c1', calc: '+50' });
    go({ items: st.items, book: day1 }, { t: 'setValue', id: 'w1', value: 450 });
    carry(day1, st.items, day2);
    expect(day2.rows.c1.opening).toBe(150);                     // flows
    expect(day2.rows.w1.value).toBe(700);                       // kept: it was typed on day 2
    expect(day2.day.opening).toBe(summarize(day1, st.items).real);
  });

  it('rules: duplicates, bad values, first-day opening, late changes, date rules', () => {
    const st = st0(null);
    go(st, { t: 'setOpening', value: '٢٬٤٢٠٬٠٠٠' });
    expect(st.book.day.opening).toBe(2420000);
    go(st, { t: 'addItem', id: 'w1', type: 'wallet', name: '0100', amount: 1 });
    expect(() => go(st, { t: 'addItem', id: 'w2', type: 'wallet', name: '0100', amount: 1 })).toThrow(/موجود/);
    expect(() => go(st, { t: 'addEntry', id: 'e', kind: 'sale', amount: 0 })).toThrow();
    expect(() => go(st, { t: 'addAdj', id: 'a', amount: 5, note: '' })).toThrow(/سبب/);
    // a change written while an older day was open: entries are kept (marked), typed values are refused
    go(st, { t: 'addEntry', id: 'late1', kind: 'sale', amount: 5, dayId: 'old', dayDate: '2026-11-10' });
    expect(st.book.entries.late1.late).toBe('2026-11-10');
    expect(() => go(st, { t: 'setCash', value: 5, dayId: 'old' })).toThrow(/أُغلق/);
    const r = applyAll(st, [{ opId: 'x1', t: 'addEntry', id: 'ok', kind: 'input', amount: 3 }, { opId: 'x2', t: 'nope' }]);
    expect(r.done).toEqual(['x1']); expect(r.rejected[0].opId).toBe('x2');
    expect(() => checkCloseDate('2026-11-16', '2026-11-15', [])).toThrow(/لم يأتِ/);
    expect(() => checkCloseDate('2026-11-10', '2026-11-15', ['2026-11-10'])).toThrow(/بالفعل/);
    expect(() => checkCloseDate('2026-11-01', '2026-11-15', ['2026-11-10'])).not.toThrow();
    expect(isCashProfit('ربح كاش عم محمد')).toBe(true);
    expect(isCashProfit(' ربح الكاش عم محمد')).toBe(true);
    expect(isCashProfit('ربح الكارت')).toBe(false);
  });

  it('compensations: added to one category total; the tables stay; «صفّر الفرق» finds the exact amount', async () => {
    const { compEffect, neutralizing, notePart, compTotals } = await import('../shared/engine.js');
    expect(compEffect('wallets', 100)).toEqual({ virtual: 0, real: 100 });
    expect(compEffect('debts', 100)).toEqual({ virtual: 0, real: -100 });
    expect(compEffect('sale', 100)).toEqual({ virtual: 100, real: 0 });
    expect(compEffect('output', 100)).toEqual({ virtual: -100, real: 0 });
    // diff 11,000 (عجز): +11,000 on wallets, −11,000 on sales, +11,000 on output, −11,000 on debts
    expect([neutralizing('wallets', 11000), neutralizing('sale', 11000), neutralizing('output', 11000), neutralizing('debts', 11000)]).toEqual([11000, -11000, 11000, -11000]);
    expect(neutralizing('cash', -500)).toBe(-500);                                        // زيادة 500: less cash
    expect(notePart('قديمة', 'قديمة\nجديدة')).toBe('جديدة'); expect(notePart('قديمة', 'قديمة')).toBe(''); expect(notePart('أ', 'ب')).toBe('ب');
    expect(compTotals({ a: { field: 'cash', amount: 5 }, b: { field: 'cash', amount: -2 }, c: { field: 'x', amount: 9 } }).cash).toBe(3);
  });

  it('review: a sign line with no number yet counts as nothing (the calculator is not "invalid" after pressing +)', async () => {
    const { evalCalc } = await import('../shared/money.js');
    expect(evalCalc('746\n+')).toBe(746);
    expect(evalCalc('٧٤٦\n−')).toBe(746);
    expect(evalCalc('-')).toBe(0);
    expect(evalCalc('746\n+x')).toBeNaN();                                             // real garbage is still refused
  });

  it('review: renaming or restoring cannot create two active items with the same name', async () => {
    const { reduce, emptyBook } = await import('../shared/engine.js');
    const st = { items: {}, book: emptyBook('d', 0) };
    reduce(st, { t: 'addItem', id: 'a', type: 'wallet', name: '0100', amount: 1 });
    reduce(st, { t: 'addItem', id: 'b', type: 'wallet', name: '0111', amount: 1 });
    expect(() => reduce(st, { t: 'renameItem', id: 'b', name: '٠١٠٠' })).toThrow('موجود');
    reduce(st, { t: 'renameItem', id: 'b', name: '0111' });                               // its own name is fine
    reduce(st, { t: 'delItem', id: 'a' });
    reduce(st, { t: 'addItem', id: 'c', type: 'wallet', name: '0100', amount: 1 });      // the name is free again
    expect(() => reduce(st, { t: 'restoreItem', id: 'a' })).toThrow('موجود');
    // a client and a wallet may share a name (different tables)
    reduce(st, { t: 'addItem', id: 'k', type: 'client', name: '0111', amount: 0 });
  });
});
