// A change to a saved day must flow to every later day EXACTLY as if the days had been worked that way from the start.
// Random weeks of real activity go through the server; past days are then edited (every kind of change) and given a
// تعويض; after each one every day the server keeps is compared with an independent replay of all the days from scratch.
import { describe, it, expect } from 'vitest';
import { boot } from './helpers.js';
import { emptyBook, nextBook, reduce, summarize, rowFinal, unchecked } from '../shared/engine.js';

/* a small seeded random generator: the same seed always makes the same weeks (a failure can be replayed) */
const rng = seed => () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
let n = 0;
const op = o => ({ opId: 'cx' + ++n, ts: new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString(), ...o });

/** One day of random activity on the current state (only changes the engine accepts are kept). */
function randomDay(rand, st, { allowNew = true } = {}) {
  const pick = a => a[Math.floor(rand() * a.length)];
  const ids = t => Object.keys(st.book.rows).filter(id => st.items[id]?.type === t && !st.items[id].purged);
  const amt = () => pick([0, 50, 300, 1000, 2500, 7000, 12000]);
  const ops = [];
  const tryOp = o => { const x = op(o); try { reduce({ items: structuredClone(st.items), book: structuredClone(st.book) }, x); } catch { return; } reduce(st, x); ops.push(x); };
  const count = 6 + Math.floor(rand() * 10);
  for (let k = 0; k < count; k++) {
    const r = rand();
    if (r < 0.25) { const id = pick([...ids('client'), ...ids('debt')]); if (id) { const f = rowFinal(st.book.rows[id], st.items[id].type); tryOp({ t: 'setCalc', id, calc: pick([`-${f}`, `+${amt()}`, `-${Math.min(f, amt())}`, '0', `${amt()}\n-${amt()}`]) }); } }
    else if (r < 0.35) { const id = pick(ids('wallet')); if (id) tryOp({ t: 'setValue', id, value: amt() }); }
    else if (r < 0.40) { const id = pick(ids('wallet')); if (id) tryOp({ t: 'setActive', id, active: rand() < 0.5 }); }
    else if (r < 0.55) tryOp({ t: 'addEntry', id: 'e' + n, kind: pick(['sale', 'input', 'output']), amount: amt() || 100, name: '' });
    else if (r < 0.60) tryOp({ t: 'addAdj', id: 'a' + n, amount: pick([-500, 200, 1000]), note: 'x' });
    else if (r < 0.66) tryOp({ t: 'setCash', value: amt() });
    else if (r < 0.70) tryOp({ t: 'setNetwork', value: amt() });
    else if (r < 0.74) { const id = pick([...ids('client'), ...ids('debt'), ...ids('wallet')]); if (id) tryOp({ t: st.book.rows[id].status === 'active' ? 'delItem' : 'restoreItem', id }); }
    else if (r < 0.78 && allowNew) tryOp({ t: 'addItem', id: 'n' + n, type: pick(['client', 'debt', 'wallet', 'constant']), name: 'جديد ' + n, amount: amt() });
    else if (r < 0.80) { const id = pick(ids('constant')); if (id) tryOp({ t: 'setValue', id, value: amt() || 10 }); }
  }
  // closing needs cash and every client / debt written (0 counts) — sometimes written as 0, sometimes not at all yet
  if (!st.book.day.cashChanged && !st.book.day.networkChanged) tryOp({ t: 'setCash', value: 0 });
  for (const id of unchecked(st.book, st.items)) tryOp({ t: 'setCalc', id, calc: '0' });
  return ops;
}

/** Replay every day from nothing: day 1 from its opening, each next day = carried from the previous + its own changes. */
function replay(opening, days) {
  const items = {};
  let book = null; const out = [];
  days.forEach((d, i) => {
    book = i === 0 ? emptyBook('g1', opening, 1) : nextBook(book, items, 'g' + (i + 1));
    const st = { items, book };
    for (const o of d.ops) reduce(st, { ...o, dayId: undefined });
    for (const c of d.comps || []) book.comps = { ...book.comps, [c.id]: c };
    out.push(structuredClone(book));
  });
  return { items, books: out };
}

/** What the server keeps for every day (closed days + the open one). */
async function serverDays(s) {
  const state = (await s.call('GET', '/state')).body;
  const out = [];
  for (const d of state.days) out.push((await s.call('GET', '/days/' + d.id)).body.book);
  out.push(state.book);
  return { items: state.items, books: out, days: state.days, open: state.book };
}

function compare(server, golden, label) {
  expect(server.books.length, label).toBe(golden.books.length);
  server.books.forEach((b, i) => {
    const g = golden.books[i], at = `${label} · day ${i + 1}`;
    const sb = summarize(b, server.items), sg = summarize(g, golden.items);
    for (const k of ['opening', 'profit', 'virtual', 'real', 'wallets', 'clients', 'debts', 'constants', 'diff']) expect(sb[k], `${at} · ${k}`).toBe(sg[k]);
    const ids = new Set([...Object.keys(b.rows), ...Object.keys(g.rows)]);
    for (const id of ids) {
      const r = b.rows[id], q = g.rows[id], t = server.items[id]?.type;
      expect(!!r, `${at} · row ${id} exists`).toBe(!!q);
      if (!r) continue;
      expect(rowFinal(r, t), `${at} · ${t} ${id} final`).toBe(rowFinal(q, t));
      expect(r.opening, `${at} · ${t} ${id} opening`).toBe(q.opening);
      expect(r.calc || '', `${at} · ${t} ${id} change`).toBe(q.calc || '');
      expect(r.status, `${at} · ${t} ${id} status`).toBe(q.status);
      expect(!!r.active, `${at} · ${t} ${id} ✓`).toBe(!!q.active);
      expect(r.value, `${at} · ${t} ${id} stored value`).toBe(t === 'client' || t === 'debt' ? rowFinal(q, t) : q.value);
    }
    expect(Object.keys(b.entries).sort(), `${at} · entries`).toEqual(Object.keys(g.entries).sort());
  });
}

describe('a changed saved day flows to every later day exactly', () => {
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]) {
    it(`random weeks · seed ${seed}`, async () => {
      const rand = rng(seed * 7919);
      const s = await boot();
      const opening = 100000;
      await s.call('POST', '/setup', { opening });
      // day 1: everything starts here (some balances at 0, some not)
      const first = [
        op({ t: 'addItem', id: 'c1', type: 'client', name: 'أحمد', amount: 5000 }), op({ t: 'addItem', id: 'c2', type: 'client', name: 'سامي', amount: 0 }),
        op({ t: 'addItem', id: 'c3', type: 'client', name: 'منى', amount: 12000 }), op({ t: 'addItem', id: 'd1', type: 'debt', name: 'تاجر', amount: 3000 }),
        op({ t: 'addItem', id: 'd2', type: 'debt', name: 'مؤسسة', amount: 0 }), op({ t: 'addItem', id: 'w1', type: 'wallet', name: '0101', amount: 20000 }),
        op({ t: 'addItem', id: 'w2', type: 'wallet', name: '0102', amount: 0 }), op({ t: 'addItem', id: 'k1', type: 'constant', name: 'إيجار', amount: 1500 }),
      ];
      const days = [];
      const st = { items: {}, book: emptyBook('x', opening, 1) };
      for (const o of first) reduce(st, o);
      const d1 = randomDay(rand, st);
      days.push({ ops: [...first, ...d1] });
      // send day 1, close it; then 5 more days (the last one stays open)
      for (let i = 0; i < 6; i++) {
        let r = await s.call('POST', '/ops', { ops: days[i].ops });
        expect(r.body.rejected, `day ${i + 1} sent`).toEqual([]);
        if (i === 5) break;
        r = await s.call('POST', '/close', { dayId: r.body.book.day.id, date: `2026-01-${String(i + 1).padStart(2, '0')}`, password: 'pw' });
        expect(r.status, `day ${i + 1} closed: ${r.body.error || ''}`).toBe(200);
        const g = replay(opening, days); const prev = g.books[g.books.length - 1];
        const nx = { items: g.items, book: nextBook(prev, g.items, 'next') };
        days.push({ ops: randomDay(rand, nx, { allowNew: i < 4 }) });
      }
      compare(await serverDays(s), replay(opening, days), 'before any edit');

      // edit past days, each time with every kind of change, then a تعويض
      for (const k of [1, 3, 0, 4, 2]) {
        const sv = await serverDays(s);
        const g = replay(opening, days);
        const target = { items: structuredClone(g.items), book: structuredClone(g.books[k]) };
        const edit = randomDay(rand, target, { allowNew: true });
        if (!edit.length) continue;
        const r = await s.call('POST', `/days/${sv.days[k].id}/edit`, { ops: edit, note: 'تصحيح', password: 'pw' });
        expect(r.status, `edit day ${k + 1}: ${r.body.error || ''}`).toBe(200);
        days[k].ops.push(...edit);
        compare(await serverDays(s), replay(opening, days), `after editing day ${k + 1}`);
        // the open day still takes new changes on top of the new values
        const after = replay(opening, days), open = after.books[after.books.length - 1];
        const more = randomDay(rand, { items: after.items, book: open }, { allowNew: false });
        if (more.length) { const x = await s.call('POST', '/ops', { ops: more }); expect(x.body.rejected).toEqual([]); days[days.length - 1].ops.push(...more); }
        compare(await serverDays(s), replay(opening, days), `new changes today after editing day ${k + 1}`);
        // a تعويض on another saved day
        const c = (k + 2) % 5, field = ['sale', 'clients', 'debts', 'wallets', 'cash'][k % 5], amount = [1000, -2500, 700][k % 3];
        const cr = await s.call('POST', `/days/${sv.days[c].id}/compensate`, { field, amount, password: 'pw' });
        expect(cr.status, `تعويض day ${c + 1}: ${cr.body.error || ''}`).toBe(200);
        const cid = Object.keys((await s.call('GET', '/days/' + sv.days[c].id)).body.book.comps).find(id => !(days[c].comps || []).some(x => x.id === id));
        days[c].comps = [...(days[c].comps || []), { id: cid, field, amount }];
        compare(await serverDays(s), replay(opening, days), `after تعويض on day ${c + 1}`);
        // every other time the تعويض was a mistake: deleted, the later days go back
        if (k % 2 === 0) {
          const dr = await s.call('POST', `/days/${sv.days[c].id}/compensations/${cid}/delete`, { password: 'pw' });
          expect(dr.status, `delete تعويض: ${dr.body.error || ''}`).toBe(200);
          days[c].comps = days[c].comps.filter(x => x.id !== cid);
          compare(await serverDays(s), replay(opening, days), `after deleting the تعويض on day ${c + 1}`);
        }
      }
      // and everything survives a restart exactly
      const dir = s.dataDir; s.close();
      const s2 = await boot({ dataDir: dir });
      compare(await serverDays(s2), replay(opening, days), 'after a restart');
      s2.close();
    }, 60000);
  }
});

describe('the one-time repair at start (data left by v3.26–3.37)', () => {
  async function weekWithEdit() {
    const s = await boot();
    await s.call('POST', '/setup', { opening: 50000 });
    const days = [{ ops: [op({ t: 'addItem', id: 'c1', type: 'client', name: 'أحمد', amount: 4000 }), op({ t: 'addItem', id: 'd1', type: 'debt', name: 'تاجر', amount: 3000 }), op({ t: 'setCash', value: 1000 })] }];
    let r = await s.call('POST', '/ops', { ops: days[0].ops });
    for (let i = 0; i < 4; i++) {
      r = await s.call('POST', '/close', { dayId: r.body.book.day.id, date: `2026-02-0${i + 1}`, password: 'pw' });
      const o = [op({ t: 'setCalc', id: 'c1', calc: i === 1 ? '+500' : '0' }), op({ t: 'setCalc', id: 'd1', calc: '0' }), op({ t: 'addEntry', id: 'x' + i, kind: 'sale', amount: 100 * (i + 1) }), op({ t: 'setCash', value: 2000 })];
      days.push({ ops: o }); r = await s.call('POST', '/ops', { ops: o });
    }
    // day 2: أحمد paid everything (his balance becomes 0 from day 2 on)
    const st = (await s.call('GET', '/state')).body;
    const edit = [op({ t: 'setCalc', id: 'c1', calc: '-4000' })];
    expect((await s.call('POST', `/days/${st.days[1].id}/edit`, { ops: edit, note: 'دفع', password: 'pw' })).status).toBe(200);
    days[1].ops = days[1].ops.filter(o => !(o.t === 'setCalc' && o.id === 'c1')).concat(edit);   // the edit replaces that day's change
    return { s, days, st: (await s.call('GET', '/state')).body };
  }
  const reboot = async (s, sql) => {
    for (const q of sql) await s.local.execute(q);
    await s.local.execute("DELETE FROM meta WHERE key='repair_flow_v1'");
    const dir = s.dataDir; s.close();
    return boot({ dataDir: dir });
  };

  it('stale values left after an edited day are recalculated; the days before it are not touched', async () => {
    const { s, days, st } = await weekWithEdit();
    const good = replay(50000, days);
    compare(await serverDays(s), good, 'before');
    // what v3.32–3.37 left: day 3 kept a stale 4,000 for أحمد (start 0, no change), and it flowed on
    const [, , d3, d4] = st.days;
    const s2 = await reboot(s, [
      { sql: "UPDATE item_days SET value=4000 WHERE day_id=? AND item_id='c1'", args: [d3.id] },
      { sql: "UPDATE item_days SET opening=4000, value=4000 WHERE day_id=? AND item_id='c1'", args: [d4.id] },
      { sql: 'UPDATE days SET opening=opening+4000 WHERE id=?', args: [d4.id] },
    ]);
    compare(await serverDays(s2), good, 'after the repair');
    s2.close();
  });

  it('debts typed by hand become start + change with the same final value every day', async () => {
    const { s, days, st } = await weekWithEdit();
    const good = replay(50000, days);
    const ids = [...st.days.map(d => d.id), st.book.id || st.book.day.id];
    // what v3.26–3.31 stored: value only (3000, 3000, 5000 typed on day 3, then carried)
    const finals = [3000, 3000, 5000, 5000, 5000];
    const s2 = await reboot(s, ids.map((id, k) => ({ sql: "UPDATE item_days SET opening=0, calc='', value=?, changed=? WHERE day_id=? AND item_id='d1'", args: [finals[k], k === 2 ? 1 : 0, id] })));
    const sv = await serverDays(s2);
    expect(sv.books.map(b => rowFinal(b.rows.d1, 'debt'))).toEqual(finals);
    expect(sv.books[2].rows.d1).toMatchObject({ opening: 3000, calc: '+2000', value: 5000 });
    // everything else is exactly as before
    sv.books.forEach((b, i) => expect(rowFinal(b.rows.c1, 'client'), 'client day ' + (i + 1)).toBe(rowFinal(good.books[i].rows.c1, 'client')));
    s2.close();
  });
});
