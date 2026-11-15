// Test helper: a real server (local database file in a temp folder) and a small API client.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openLocal, fillIfEmpty } from '../server/bootstrap/index.js';
import { createShop } from '../server/services/shop.js';
import { createApp } from '../server/app.js';

export async function boot({ dataDir, remote = null, now } = {}) {
  dataDir = dataDir || fs.mkdtempSync(path.join(os.tmpdir(), 'elb-'));
  const cfg = { password: 'pw', dataDir, dbFile: path.join(dataDir, 'shop-v3.db'), legacyDbFile: path.join(dataDir, 'shop.db'), port: 0, codeDir: process.cwd(), distDir: path.join(dataDir, 'no-dist') };
  const local = await openLocal(cfg);
  const how = await fillIfEmpty(local, remote, cfg, { log() {}, warn() {} });
  const shop = await createShop(local, now ? { now } : {});
  const srv = createApp({ shop, cfg, db: local, log: { warn() {} } }).listen(0);
  const base = 'http://127.0.0.1:' + srv.address().port;
  const { token } = await (await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'pw' }) })).json();
  const call = async (m, u, b, cid = 'A') => {
    const r = await fetch(base + '/api' + u, { method: m, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, 'X-Client-Id': cid }, body: b ? JSON.stringify(b) : undefined });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  return { call, base, token, local, shop, dataDir, how, close: () => { srv.closeAllConnections?.(); srv.close(); local.close(); } };
}
let k = 0;
export const op = o => ({ opId: 'op' + ++k + '-' + Date.now(), ts: new Date().toISOString(), ...o });
