// Bringing data from the OLD version, the Turso online copy, and restoring on a new computer.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createClient } from '@libsql/client';
import { boot, op } from './helpers.js';
import { createSync } from '../server/sync/turso.js';

// A database exactly like the old version made (table kv + days_closed).
async function oldDatabase(file) {
  const db = createClient({ url: 'file:' + file });
  await db.batch([
    'CREATE TABLE kv(k TEXT PRIMARY KEY, v TEXT NOT NULL)',
    'CREATE TABLE days_closed(id TEXT PRIMARY KEY, date TEXT NOT NULL, closed_at TEXT, cash REAL, network REAL, notes TEXT, actual REAL, theoretical REAL, diff REAL, snapshot TEXT NOT NULL)',
  ], 'write');
  const snap1 = {
    summary: { input: 100, sales: 200, output: 50, profit: 250, constants: 40, prev: 2420000, theoretical: 2420250, actual: 2420300, diff: 50 },
    clients: [{ id: 'c1', name: 'أحمد', balance: 1500 }], wallets: [{ id: 'w1', number: '01001234567', balance: 9000, touched: 1 }],
    creditors: [{ id: 'cr1', name: 'تاجر', amount: 500, remaining: 500, completed_day: null }], constants: [{ id: 'k1', name: 'إيجار', amount: 40 }],
    entries: [{ id: 'e1', kind: 'sale', name: 'هاتف', amount: 200, created_at: '2026-11-10T10:00:00Z' }], transactions: [{ id: 't1', method: 'cash', amount: 5 }],
  };
  await db.execute({ sql: 'INSERT INTO days_closed VALUES(?,?,?,?,?,?,?,?,?,?)', args: ['day1', '2026-11-10', '2026-11-10T22:00:00Z', 1000, 200, 'ملاحظة', 2420300, 2420250, 50, JSON.stringify(snap1)] });
  const state = {
    clients: [{ id: 'c1', name: 'أحمد', balance: 1700 }, { id: 'c2', name: 'سمير', balance: 0 }], wallets: [{ id: 'w1', number: '01001234567', balance: 9100, touched: 2 }],
    creditors: [{ id: 'cr1', name: 'تاجر', amount: 500, remaining: 300, completed_day: null }, { id: 'cr2', name: 'مسدد', amount: 10, remaining: 0, completed_day: 'day1' }],
    constants: [{ id: 'k1', name: 'إيجار', amount: 40 }], entries: [{ id: 'e9', kind: 'input', name: 'ربح كاش', amount: 70, created_at: '2026-11-11T09:00:00Z' }],
    transactions: [], lastClosed: '2026-11-10', closedDates: ['2026-11-10'], applied: ['x'],
    day: { id: 'day2', date: '2026-11-11', prev_actual: 2420300, cash: 1100, network: 250, notes: '' },
  };
  await db.execute({ sql: "INSERT INTO kv(k,v) VALUES('state',?)", args: [JSON.stringify(state)] });
  db.close();
}

describe('old data, Turso copy, new computer', () => {
  it('converts the old version data (local file) without losing anything', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'elb-old-'));
    await oldDatabase(path.join(dir, 'shop.db'));
    const s = await boot({ dataDir: dir });
    expect(s.how).toBe('imported');
    const st = (await s.call('GET', '/state')).body;
    expect(st.setupNeeded).toBe(false);
    expect(st.book.day.opening).toBe(2420300);                       // تصفية البارحة as before
    expect(st.book.day.cash).toBe(1100); expect(st.book.day.network).toBe(250);
    const name = id => st.items[id].name;
    expect(name('c_c1')).toBe('أحمد'); expect(st.book.rows.c_c1.value).toBe(1700);
    expect(st.book.rows.w_w1.value).toBe(9100);
    expect(st.book.rows.d_cr1.value).toBe(300); expect(st.book.rows.d_cr2).toBeUndefined();   // finished old debt not carried
    expect(st.book.rows.k_k1.value).toBe(40);
    expect(Object.values(st.book.entries)[0].name).toBe('ربح كاش');
    // the saved day keeps its old numbers (diff sign is now virtual - real)
    expect(st.days).toHaveLength(1);
    expect(st.days[0]).toMatchObject({ date: '2026-11-10', opening: 2420000, real: 2420300, virtual: 2420250, diff: -50 });
    expect(st.days[0].orig).toMatchObject({ real: 2420300, diff: -50 });                // a تعويض on an imported day is crossed out too
    expect(st.book.day.orig).toEqual({ opening: 2420300 });
    const day = (await s.call('GET', '/days/' + st.days[0].id)).body;
    expect(day.book.rows.c_c1.value).toBe(1500); expect(Object.values(day.book.entries)[0].name).toBe('هاتف');
    // the old data is also kept untouched
    expect(Number((await s.local.execute("SELECT COUNT(*) n FROM legacy_archive")).rows[0].n)).toBe(2);
    expect(fs.readdirSync(path.join(dir, 'backups')).some(f => f.startsWith('old-version-data'))).toBe(true);
    // and normal work continues
    const r = await s.call('POST', '/ops', { ops: [op({ t: 'setCalc', id: 'c_c1', calc: '+300' })] });
    expect(r.body.book.rows.c_c1.value).toBe(2000);
    s.close();
  });

  it('old data in Turso is imported, pushed back as new tables, and restored on a new computer', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'elb-turso-'));
    const remoteFile = path.join(dir, 'remote.db');
    await oldDatabase(remoteFile);                                    // "Turso" holding the old version's data
    const remote = createClient({ url: 'file:' + remoteFile });
    const a = await boot({ dataDir: path.join(dir, 'pc1'), remote });
    expect(a.how).toBe('imported');
    await a.call('POST', '/ops', { ops: [op({ t: 'addEntry', id: 'new1', kind: 'sale', amount: 33 })] });
    const sync = createSync(a.local, remote, { log: { warn() {} } });
    await sync.push();
    expect(sync.status.lastError).toBe(null); expect(sync.status.pendingRows).toBe(0);
    // the old tables in Turso are untouched
    expect((await remote.execute("SELECT COUNT(*) n FROM kv")).rows[0].n).toBe(1);
    a.close();
    // a brand-new computer: restores the new tables from Turso
    const b = await boot({ dataDir: path.join(dir, 'pc2'), remote });
    expect(b.how).toBe('restored');
    const st = (await b.call('GET', '/state')).body;
    expect(Object.values(st.book.entries).some(e => e.id === 'new1')).toBe(true);
    expect(st.days).toHaveLength(1);
    b.close(); remote.close();
  });
});
