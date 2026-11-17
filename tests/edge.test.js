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
    const r = await s.call('POST', '/ops', { ops: [op({ t: 'addEntry', id: 'e', kind: 'sale', amount: 300 })] });
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
});
