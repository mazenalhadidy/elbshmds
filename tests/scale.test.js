// Scalability + operations: database settings, indexes, paged sync, batched dedupe, readiness, config checks.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createClient } from '@libsql/client';
import { boot, op } from './helpers.js';
import { migrate, MIGRATIONS } from '../server/db/schema.js';
import { createSync, pages } from '../server/sync/turso.js';
import { checkConfig } from '../server/config.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'elb-scale-'));

describe('database', () => {
  it('local file runs in WAL mode with the tuned settings, on every new connection', async () => {
    const s = await boot();
    const mode = async () => [(await s.local.execute('PRAGMA journal_mode')).rows[0][0], (await s.local.execute('PRAGMA busy_timeout')).rows[0][0]];
    expect(await mode()).toEqual(['wal', 5000]);
    await s.call('POST', '/setup', { opening: 100 });      // a write transaction (libsql opens a new connection after it)
    expect(await mode()).toEqual(['wal', 5000]);
    s.close();
  });

  it('migrations are numbered, run once, and add the indexes the hot queries use', async () => {
    expect(MIGRATIONS.map(m => m.version)).toEqual(MIGRATIONS.map((_, i) => i + 1));
    const s = await boot();
    const idx = (await s.local.execute("SELECT name FROM sqlite_master WHERE type='index'")).rows.map(r => r.name);
    for (const n of ['entries_day_created', 'item_days_item_day', 'entries_kind_day', 'days_status', 'op_log_at']) expect(idx).toContain(n);
    const plan = (await s.local.execute("EXPLAIN QUERY PLAN SELECT * FROM entries WHERE day_id='x' ORDER BY created_at, id")).rows.map(r => r.detail).join(' ');
    expect(plan).toMatch(/entries_day_created/);
    expect(plan).not.toMatch(/TEMP B-TREE/);              // no sort step
    await migrate(s.local);                                // running again changes nothing
    expect((await s.local.execute("SELECT value FROM meta WHERE key='schema_version'")).rows[0].value).toBe(String(MIGRATIONS.length));
    s.close();
  });

  it('a big batch of changes (500) is deduplicated with one query and applied once', async () => {
    const s = await boot();
    await s.call('POST', '/setup', { opening: 0 });
    const ops = Array.from({ length: 500 }, (_, i) => op({ t: 'addEntry', id: 'e' + i, kind: 'sale', amount: 1 }));
    let r = await s.call('POST', '/ops', { ops });
    expect(r.body.done).toHaveLength(500);
    r = await s.call('POST', '/ops', { ops });              // sent again (lost reply): nothing applied twice
    expect(r.body.done).toHaveLength(500);
    expect(r.body.summary.sale).toBe(500);
    s.close();
  });
});

describe('sync', () => {
  it('pages() walks a table in rowid order without loading it all', async () => {
    const db = createClient({ url: 'file:' + path.join(tmp(), 'p.db') });
    await db.execute('CREATE TABLE t(v INTEGER, rev INTEGER)');
    await db.batch(Array.from({ length: 2345 }, (_, i) => ({ sql: 'INSERT INTO t VALUES(?,?)', args: [i, i % 7] })), 'write');
    const seen = [];
    for await (const r of pages(db, 'SELECT rowid AS _rid, v FROM t WHERE rev > ?', [2], 500)) seen.push(Number(r.v));
    expect(seen.length).toBe([...Array(2345).keys()].filter(i => i % 7 > 2).length);
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
    db.close();
  });

  it('pushes every changed row to Turso in batches and clears the tombstones it delivered', async () => {
    const s = await boot();
    await s.call('POST', '/setup', { opening: 0 });
    await s.call('POST', '/ops', { ops: Array.from({ length: 400 }, (_, i) => op({ t: 'addEntry', id: 'e' + i, kind: 'input', amount: 1 })) });
    await s.call('POST', '/ops', { ops: [op({ t: 'delEntry', id: 'e0' })] });
    expect(Number((await s.local.execute('SELECT COUNT(*) n FROM tombstones')).rows[0].n)).toBe(1);
    const remote = createClient({ url: 'file:' + path.join(tmp(), 'remote.db') });   // stands in for Turso
    const batches = [];
    const spy = new Proxy(remote, { get: (t, p) => (p === 'batch' ? (st, m) => { batches.push(st.length); return t.batch(st, m); } : typeof t[p] === 'function' ? t[p].bind(t) : t[p]) });
    const sync = createSync(s.local, spy, { batchSize: 100, log: { warn() {} } });
    await sync.push();
    expect(sync.status.lastError).toBe(null);
    expect(Math.max(...batches.slice(1))).toBeLessThanOrEqual(100);
    expect(Number((await remote.execute('SELECT COUNT(*) n FROM entries')).rows[0].n)).toBe(399);
    expect(Number((await s.local.execute('SELECT COUNT(*) n FROM tombstones')).rows[0].n)).toBe(0);
    expect(sync.status.pendingRows).toBe(0);
    remote.close(); s.close();
  });
});

describe('operations', () => {
  it('readiness checks the database; health keeps the shape the updater reads', async () => {
    const s = await boot();
    const ready = await (await fetch(s.base + '/api/ready')).json();
    expect(ready.ok).toBe(true);
    const r = await fetch(s.base + '/api/health');
    expect(r.headers.get('x-request-id')).toBeTruthy();
    const h = await r.json();
    expect(h).toHaveProperty('idleSeconds'); expect(h).toHaveProperty('version');
    s.close();
  });

  it('big answers are gzip-compressed', async () => {
    const s = await boot();
    await s.call('POST', '/setup', { opening: 0 });
    await s.call('POST', '/ops', { ops: Array.from({ length: 200 }, (_, i) => op({ t: 'addEntry', id: 'g' + i, kind: 'sale', amount: i + 1, name: 'بيع ' + i })) });
    const r = await fetch(s.base + '/api/state', { headers: { Authorization: 'Bearer ' + s.token, 'X-Client-Id': 'A', 'Accept-Encoding': 'gzip' } });
    expect(r.headers.get('content-encoding')).toBe('gzip');
    s.close();
  });

  it('settings are checked before start', () => {
    expect(checkConfig({ password: '', port: 3000 }).errors).toHaveLength(1);
    expect(checkConfig({ password: '1234', port: 3000 }).warnings[0]).toMatch(/weak/);
    expect(checkConfig({ password: 'a-long-password', port: 3000, tursoUrl: 'http://x', tursoToken: 't' })).toEqual({ errors: [], warnings: [] });
    expect(checkConfig({ password: 'a-long-password', port: 3000, tursoUrl: 'turso.io/x', tursoToken: 't' }).errors[0]).toMatch(/libsql/);
  });
});
