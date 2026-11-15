/* =====================================================================
   START-UP: open the local database, run migrations, and — only when the
   local database is still empty — fill it from (in this order):
     1. Turso, if it already has the new tables (e.g. a second / replacement computer)
     2. the OLD version's data (Turso first, then the old local file data/shop.db)
     3. nothing: the app asks for the first day's التصفية
   A backup copy of the local database is made before any of this.
   ===================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@libsql/client';
import { migrate, LOCAL_PRAGMAS } from '../db/schema.js';
import { readLegacy, importLegacy } from './legacy.js';
import { restoreFromRemote } from '../sync/turso.js';
import { backupNow } from '../services/backups.js';

export async function openLocal(cfg) {
  fs.mkdirSync(cfg.dataDir, { recursive: true });
  const local = tuned(createClient({ url: 'file:' + cfg.dbFile }));
  await local.ready();
  if (fs.existsSync(cfg.dbFile) && fs.statSync(cfg.dbFile).size > 0) await backupNow(local, cfg.dataDir, 'before-start');
  await migrate(local);
  return local;
}

/**
 * The libsql file client opens a NEW connection after every transaction, and per-connection
 * settings (synchronous, busy_timeout) would silently fall back to the defaults. This wrapper
 * re-applies LOCAL_PRAGMAS on the first use of each new connection.
 */
export function tuned(client) {
  let fresh = true;
  const prep = async () => { if (fresh) { fresh = false; for (const p of LOCAL_PRAGMAS) await client.execute(p); } };
  return new Proxy(client, {
    get(target, prop) {
      if (prop === 'ready') return prep;
      if (prop === 'execute' || prop === 'batch') return async (...a) => { await prep(); return target[prop](...a); };
      if (prop === 'transaction') return async (...a) => { await prep(); const tx = await target.transaction(...a); fresh = true; return tx; };
      const v = target[prop];
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
}

export async function fillIfEmpty(local, remote, cfg, log = console) {
  const n = Number((await local.execute('SELECT COUNT(*) n FROM days')).rows[0].n);
  if (n) return 'existing';
  if (remote) {
    try {
      if (await restoreFromRemote(local, remote)) { log.log('database: restored from Turso'); return 'restored'; }
      const legacy = await readLegacy(remote);
      if (legacy) { saveLegacyCopy(cfg, legacy, 'turso'); const r = await importLegacy(local, legacy); log.log('database: imported old data from Turso', r); return 'imported'; }
    } catch (e) {
      // No internet on the very first start: do NOT start empty if old data may exist online.
      log.warn('database: could not reach Turso on first start: ' + e.message);
      throw new Error('أول تشغيل يحتاج اتصالًا بالإنترنت لجلب بياناتك من Turso. تأكد من الاتصال ثم أعد التشغيل.');
    }
  }
  if (fs.existsSync(cfg.legacyDbFile)) {
    const old = createClient({ url: 'file:' + cfg.legacyDbFile });
    const legacy = await readLegacy(old);
    old.close();
    if (legacy) { saveLegacyCopy(cfg, legacy, 'local-file'); const r = await importLegacy(local, legacy); log.log('database: imported old data from ' + cfg.legacyDbFile, r); return 'imported'; }
  }
  return 'empty';
}

/** Keep a plain JSON copy of the old data next to the database, just in case. */
function saveLegacyCopy(cfg, legacy, source) {
  const f = path.join(cfg.dataDir, 'backups', `old-version-data-${source}-${Date.now()}.json`);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(legacy));
}
