// The server: setup, everyday changes, closing, editing a saved day (with cascade), deleting, history, password rules.
import { describe, it, expect } from 'vitest';
import { boot, op } from './helpers.js';

describe('server', () => {
  it('first start asks for the first day; then everyday changes are saved and survive a restart', async () => {
    const s = await boot();
    expect(s.how).toBe('empty');
    expect((await s.call('GET', '/state')).body.setupNeeded).toBe(true);
    let r = await s.call('POST', '/setup', { opening: '٢٬٤٢٠٬٠٠٠' });
    expect(r.body.book.day.opening).toBe(2420000);
    r = await s.call('POST', '/ops', { ops: [op({ t: 'addEntry', id: 'e1', kind: 'sale', amount: 500 }), op({ t: 'addItem', id: 'w1', type: 'wallet', name: '0100', amount: 1000 }), op({ t: 'nope' })] });
    expect(r.body.done).toHaveLength(2); expect(r.body.rejected).toHaveLength(1);
    expect(r.body.summary.virtual).toBe(2420500);
    // the same change sent twice is applied once
    const dup = op({ t: 'addEntry', id: 'e2', kind: 'input', amount: 10 });
    await s.call('POST', '/ops', { ops: [dup] }); r = await s.call('POST', '/ops', { ops: [dup] });
    expect(r.body.summary.input).toBe(10); expect(r.body.done).toContain(dup.opId);
    // "unchanged" answer when nothing changed
    const rev = r.body.rev;
    expect((await s.call('GET', '/state?rev=' + rev)).body.unchanged).toBe(true);
    // another device is view-only
    expect((await s.call('POST', '/ops', { ops: [op({ t: 'addEntry', id: 'x', kind: 'input', amount: 1 })] }, 'B')).status).toBe(403);
    const dir = s.dataDir; s.close();
    const s2 = await boot({ dataDir: dir });
    expect(s2.how).toBe('existing');
    r = await s2.call('GET', '/state');
    expect(Object.keys(r.body.book.entries)).toHaveLength(2); expect(r.body.book.rows.w1.value).toBe(1000);
    s2.close();
  });

  it('closing: password, date rules, next day starts from the REAL total', async () => {
    const s = await boot();
    await s.call('POST', '/setup', { opening: 1000 });
    let r = await s.call('POST', '/ops', { ops: [op({ t: 'addItem', id: 'w1', type: 'wallet', name: '0100', amount: 800 }), op({ t: 'addItem', id: 'c1', type: 'client', name: 'أحمد', amount: 300 }), op({ t: 'setCash', value: 100 })] });
    const { today, book } = r.body;
    expect((await s.call('POST', '/close', { dayId: book.day.id, date: today, password: 'bad' })).status).toBe(401);
    expect((await s.call('POST', '/close', { dayId: book.day.id, date: '2999-01-01', password: 'pw' })).status).toBe(400);
    r = await s.call('POST', '/close', { dayId: book.day.id, date: today, password: 'pw' });
    expect(r.status).toBe(200);
    expect(r.body.book.day.opening).toBe(1200);                 // 800 + 300 + 100 = the real total, confirmed
    expect(r.body.book.rows.c1.opening).toBe(300); expect(r.body.book.day.cash).toBe(0);    // cash does not carry
    expect(r.body.days.map(d => d.date)).toEqual([today]);
    expect((await s.call('POST', '/close', { dayId: r.body.book.day.id, date: today, password: 'pw' })).status).toBe(400);   // same date twice
    s.close();
  });

  it('editing a saved day: preview, note + password, change flows to the following days', async () => {
    const s = await boot();
    await s.call('POST', '/setup', { opening: 1000 });
    let r = await s.call('POST', '/ops', { ops: [op({ t: 'addItem', id: 'c1', type: 'client', name: 'أحمد', amount: 300 })] });
    const d1 = r.body.book.day.id;
    r = await s.call('POST', '/close', { dayId: d1, date: '2026-01-01', password: 'pw' });
    const d2 = r.body.book.day.id;
    await s.call('POST', '/ops', { ops: [op({ t: 'addEntry', id: 'e', kind: 'sale', amount: 50 })] });
    r = await s.call('POST', '/close', { dayId: d2, date: '2026-01-02', password: 'pw' });
    expect(r.body.book.day.opening).toBe(300);
    const ops = [op({ t: 'setCalc', id: 'c1', calc: '+200' }), op({ t: 'addEntry', id: 'late-sale', kind: 'sale', amount: 70, name: 'نسيته' })];
    const pv = await s.call('POST', `/days/${d1}/edit`, { ops, preview: true });
    expect(pv.body.changes).toHaveLength(3);
    expect(pv.body.changes[2].after.opening).toBe(500);          // today's تصفية البارحة: 300 -> 500
    expect((await s.call('POST', `/days/${d1}/edit`, { ops, note: '', password: 'pw' })).status).toBe(400);  // a note is required
    expect((await s.call('POST', `/days/${d1}/edit`, { ops, note: 'نسيت', password: 'bad' })).status).toBe(401);
    r = await s.call('POST', `/days/${d1}/edit`, { ops, note: 'نسيت حساب أحمد', password: 'pw' });
    expect(r.status).toBe(200);
    expect(r.body.snapshot.book.day.opening).toBe(500);
    expect(r.body.snapshot.book.rows.c1.opening).toBe(500);
    const day = (await s.call('GET', '/days/' + d1)).body;
    expect(day.edits[0].note).toBe('نسيت حساب أحمد'); expect(day.summary.sale).toBe(70);
    const hist = (await s.call('GET', '/items/c1/history')).body;
    expect(hist.rows.map(x => x.value)).toEqual([500, 500, 500]);
    s.close();
  });

  it('deleting: normal delete keeps history; delete with logs needs the password and keeps saved days', async () => {
    const s = await boot();
    await s.call('POST', '/setup', { opening: 0 });
    let r = await s.call('POST', '/ops', { ops: [op({ t: 'addItem', id: 'w1', type: 'wallet', name: '0100', amount: 50 })] });
    r = await s.call('POST', '/close', { dayId: r.body.book.day.id, date: '2026-02-01', password: 'pw' });
    const d1 = r.body.days[0].id;
    r = await s.call('POST', '/ops', { ops: [op({ t: 'delItem', id: 'w1' })] });
    expect(r.body.book.rows.w1.status).toBe('deleted'); expect(r.body.summary.wallets).toBe(0);
    expect((await s.call('GET', '/items/w1/history')).status).toBe(200);
    expect((await s.call('POST', '/items/w1/purge', { password: 'x' })).status).toBe(401);
    r = await s.call('POST', '/items/w1/purge', { password: 'pw' });
    expect(r.body.book.rows.w1).toBeUndefined();
    expect((await s.call('GET', '/items/w1/history')).status).toBe(404);
    expect((await s.call('GET', '/days/' + d1)).body.book.rows.w1.value).toBe(50);   // what's done is done
    s.close();
  });

  it('ربح الكاش من أول الشهر needs the password and counts only matching inputs of this month', async () => {
    const s = await boot();
    await s.call('POST', '/setup', { opening: 0 });
    await s.call('POST', '/ops', { ops: [op({ t: 'addEntry', id: 'a', kind: 'input', amount: 100, name: 'ربح كاش عم محمد' }), op({ t: 'addEntry', id: 'b', kind: 'input', amount: 50, name: 'ربح الكاش عم محمد' }), op({ t: 'addEntry', id: 'c', kind: 'input', amount: 7, name: 'شحن' }), op({ t: 'addEntry', id: 'd', kind: 'sale', amount: 9, name: 'ربح كاش' })] });
    expect((await s.call('POST', '/cash-profit', { password: 'no' })).status).toBe(401);
    const r = await s.call('POST', '/cash-profit', { password: 'pw' });
    expect(r.body.total).toBe(150); expect(r.body.count).toBe(2);
    s.close();
  });
});
