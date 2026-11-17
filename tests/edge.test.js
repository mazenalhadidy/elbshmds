// Edge cases found in review: first-day opening, days saved before v3.16, restoring from an older Turso copy.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createClient } from '@libsql/client';
import { boot, op } from './helpers.js';
import { migrate } from '../server/db/schema.js';
import { restoreFromRemote } from '../server/sync/turso.js';

describe('edge cases', () => {
  it('correcting the FIRST day\'s تصفية البارحة is not shown as a change after closing', async () => {
    const s = await boot();
    await s.call('POST', '/setup', { opening: 1000 });
    const r = await s.call('POST', '/ops', { ops: [op({ t: 'setOpening', value: 2500 })] });
    expect(r.body.book.day.opening).toBe(2500);
    expect(r.body.book.day.orig.opening).toBe(2500);                                  // nothing to cross out
    s.close();
  });

  it('days saved before this version get their original values (so a تعويض on them is crossed out)', async () => {
    const s = await boot();
    await s.call('POST', '/setup', { opening: 1000 });
    const r = await s.call('POST', '/ops', { ops: [op({ t: 'addEntry', id: 'e', kind: 'sale', amount: 300 }), op({ t: 'setCash', value: 0 })] });
    await s.call('POST', '/close', { dayId: r.body.book.day.id, date: r.body.today, password: 'pw' });
    // simulate an old database: no originals stored, back to schema version 3
    await s.local.execute('UPDATE days SET orig = NULL');
    await s.local.execute("UPDATE meta SET value='3' WHERE key='schema_version'");
    await migrate(s.local);
    const row = (await s.local.execute("SELECT orig FROM days WHERE status='closed'")).rows[0];
    expect(JSON.parse(row.orig)).toMatchObject({ opening: 1000, profit: 300, virtual: 1300, real: 0, diff: 1300 });
    const open = (await s.local.execute("SELECT orig FROM days WHERE status='open'")).rows[0];
    expect(JSON.parse(open.orig)).toEqual({ opening: 0 });
    s.close();
  });

  it('a new computer restores from a Turso copy made by an older version (no compensations table yet)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'elb-edge-'));
    const remote = createClient({ url: 'file:' + path.join(dir, 'remote.db') });
    await migrate(remote, { remote: true });
    await remote.execute('DROP TABLE compensations');
    await remote.execute("INSERT INTO days(id, seq, status, opening, rev) VALUES('d1', 1, 'open', 500, 1)");
    const local = createClient({ url: 'file:' + path.join(dir, 'local.db') });
    await migrate(local);
    expect(await restoreFromRemote(local, remote)).toBe(true);
    expect(Number((await local.execute('SELECT COUNT(*) n FROM days')).rows[0].n)).toBe(1);
    remote.close(); local.close();
  });

  it('two compensations + a calendar edit on the same day: the first original stays, all three are kept, tables untouched', async () => {
    const s = await boot();
    await s.call('POST', '/setup', { opening: 1000 });
    let r = await s.call('POST', '/ops', { ops: [op({ t: 'addEntry', id: 'e', kind: 'sale', amount: 500 }), op({ t: 'setCash', value: 1000 })] });
    r = await s.call('POST', '/close', { dayId: r.body.book.day.id, date: r.body.today, password: 'pw' });
    const day = r.body.days[0];
    expect(day.diff).toBe(500);                                                          // عجز 500
    await s.call('POST', `/days/${day.id}/compensate`, { field: 'cash', amount: 200, password: 'pw' });
    r = await s.call('POST', `/days/${day.id}/compensate`, { field: 'sale', amount: -300, password: 'pw' });
    let d = r.body.snapshot.days[0];
    expect(d.diff).toBe(0); expect(d.orig.diff).toBe(500); expect(d.own).toBe(2);
    expect(r.body.snapshot.book.day.opening).toBe(1200);                                // only the cash part flows on
    // a calendar edit on top: the compensations stay, the table gets the new sale
    await s.call('POST', `/days/${day.id}/edit`, { ops: [op({ t: 'addEntry', id: 'e2', kind: 'sale', amount: 100 })], note: 'بيع منسي', password: 'pw' });
    const full = (await s.call('GET', '/days/' + day.id)).body;
    expect(Object.keys(full.book.comps)).toHaveLength(2);
    expect(Object.keys(full.book.entries)).toHaveLength(2);                              // 500 + the forgotten 100; the −300 is not in the table
    expect(full.summary.sale).toBe(300);                                                 // 500 + 100 − 300
    expect(full.summary.diff).toBe(100);
    expect(full.book.day.orig.diff).toBe(500);
    d = (await s.call('GET', '/state')).body.days[0];
    expect(d.own).toBe(3);
    s.close();
  });

  it('a day cannot be closed until cash or المكن is typed (typing 0 counts)', async () => {
    const s = await boot();
    await s.call('POST', '/setup', { opening: 1000 });
    let r = await s.call('GET', '/state');
    r = await s.call('POST', '/close', { dayId: r.body.book.day.id, date: r.body.today, password: 'pw' });
    expect(r.status).toBe(400); expect(r.body.error).toContain('النقدية');
    r = await s.call('POST', '/ops', { ops: [op({ t: 'setNetwork', value: 0 })] });
    r = await s.call('POST', '/close', { dayId: r.body.book.day.id, date: r.body.today, password: 'pw' });
    expect(r.status).toBe(200);
    s.close();
  });

  it('late changes: kept silently, the saved day untouched; «أضف» puts them into their day, «ارفض» drops them', async () => {
    const s = await boot();
    await s.call('POST', '/setup', { opening: 1000 });
    let r = await s.call('POST', '/ops', { ops: [op({ t: 'addItem', id: 'w1', type: 'wallet', name: '0100', amount: 1000 }), op({ t: 'setCash', value: 0 })] });
    const d1 = r.body.book.day.id;
    // the phone, offline, writes 3 changes for d1 ... meanwhile the shop computer closes d1
    const offline = [op({ t: 'addEntry', id: 'late-sale', kind: 'sale', amount: 200, dayId: d1 }), op({ t: 'setValue', id: 'w1', value: 1500, dayId: d1 }), op({ t: 'editEntry', id: 'nope', amount: 5, dayId: d1 })];
    r = await s.call('POST', '/close', { dayId: d1, date: '2026-03-01', password: 'pw' });
    const before = r.body.days[0];
    // ... then the phone comes back: answered "done" (no error on the phone), nothing applied, all three in the shared list
    r = await s.call('POST', '/ops', { ops: offline });
    expect(r.body.done).toHaveLength(3); expect(r.body.rejected).toHaveLength(0);
    expect(r.body.late.map(x => x.opId)).toEqual(offline.map(o => o.opId));
    expect(r.body.days[0]).toMatchObject({ virtual: before.virtual, real: before.real });
    expect(Object.keys(r.body.book.entries)).toHaveLength(0);                            // not added to today either
    r = await s.call('POST', '/ops', { ops: offline });                                  // sent twice: still once
    expect(r.body.late).toHaveLength(3);
    // «أضف» needs the password; the one that no longer fits stays with its reason
    expect((await s.call('POST', '/late', { accept: true, ids: [], password: 'bad' })).status).toBe(401);
    r = await s.call('POST', '/late', { accept: true, ids: [], password: 'pw' });
    expect(r.body.accepted).toBe(2); expect(r.body.failed).toHaveLength(1);
    const after = r.body.snapshot.days[0];
    expect(after.virtual).toBe(before.virtual + 200); expect(after.real).toBe(before.real + 500);
    expect(r.body.snapshot.book.day.opening).toBe(after.real);                            // flows to the next day
    expect(r.body.snapshot.late).toHaveLength(1); expect(r.body.snapshot.late[0].error).toBeTruthy();
    // «ارفض» (no password) empties the list
    r = await s.call('POST', '/late', { accept: false, ids: [] });
    expect(r.body.refused).toBe(1); expect(r.body.snapshot.late).toHaveLength(0);
    expect((await s.call('GET', '/state')).body.late).toHaveLength(0);
    s.close();
  });

  it('a wrong تعويض is deleted with the password and every later day goes back', async () => {
    const s = await boot();
    await s.call('POST', '/setup', { opening: 1000 });
    let r = await s.call('POST', '/ops', { ops: [op({ t: 'setCash', value: 1000 })] });
    r = await s.call('POST', '/close', { dayId: r.body.book.day.id, date: '2026-04-01', password: 'pw' });
    const d = r.body.days[0], openingBefore = r.body.book.day.opening;
    r = await s.call('POST', `/days/${d.id}/compensate`, { field: 'wallets', amount: 777, password: 'pw' });
    expect(r.body.snapshot.book.day.opening).toBe(openingBefore + 777);
    const compId = Object.keys((await s.call('GET', '/days/' + d.id)).body.book.comps)[0];
    expect((await s.call('POST', `/days/${d.id}/compensations/${compId}/delete`, { password: 'bad' })).status).toBe(401);
    r = await s.call('POST', `/days/${d.id}/compensations/${compId}/delete`, { password: 'pw' });
    expect(r.status).toBe(200);
    expect(r.body.snapshot.book.day.opening).toBe(openingBefore);
    expect(r.body.snapshot.days[0]).toMatchObject({ real: d.real, diff: d.diff, own: 0 });
    expect((await s.call('POST', `/days/${d.id}/compensations/${compId}/delete`, { password: 'pw' })).status).toBe(404);
    s.close();
  });
});
