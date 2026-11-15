/* Copies of the local database in data/backups (one per day + one before each start). The last 30 days are kept. */
import fs from 'node:fs';
import path from 'node:path';

export async function backupNow(db, dataDir, label = '') {
  const dir = path.join(dataDir, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const day = new Date().toISOString().slice(0, 10);
  const file = path.join(dir, `shop-${day}${label ? '-' + label : ''}.db`);
  try { fs.rmSync(file, { force: true }); await db.execute({ sql: 'VACUUM INTO ?', args: [file] }); }
  catch (e) { console.warn('backup failed: ' + e.message); return null; }
  // keep 30 days
  const limit = Date.now() - 30 * 864e5;
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (f.startsWith('shop-') && fs.statSync(p).mtimeMs < limit) fs.rmSync(p, { force: true });
  }
  return file;
}

/** A backup once a day while the server runs. */
export function scheduleDailyBackup(db, dataDir) {
  const t = setInterval(() => backupNow(db, dataDir), 6 * 3600e3);   // every 6 hours (same-day file is replaced)
  t.unref?.();
  return () => clearInterval(t);
}
