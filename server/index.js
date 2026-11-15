/* =====================================================================
   ENTRY POINT: `node server/index.js` (or `npm start`)
   1. read settings (.env)       2. open the local database (+ backup, migrations)
   3. fill it if empty (Turso / old data)   4. start the Turso background sync
   5. start the web server on PORT (default 3000), reachable from phones on the same Wi-Fi
   ===================================================================== */
process.env.TZ = process.env.TZ || 'Africa/Cairo';     // "today" follows Cairo time
import { getConfig, checkConfig } from './config.js';
import { openLocal, fillIfEmpty } from './bootstrap/index.js';
import { remoteClient, createSync } from './sync/turso.js';
import { createShop } from './services/shop.js';
import { createApp } from './app.js';
import { lanUrls } from './services/network.js';
import { scheduleDailyBackup } from './services/backups.js';

// One unexpected error must never stop the shop: log it and keep running.
process.on('uncaughtException', e => console.error('uncaught:', e));
process.on('unhandledRejection', e => console.error('unhandled:', e));

const cfg = getConfig();
const { errors, warnings } = checkConfig(cfg);
for (const w of warnings) console.warn('WARNING: ' + w);
if (errors.length) { for (const e of errors) console.error('SETTINGS ERROR: ' + e); process.exit(1); }

try {
  const local = await openLocal(cfg);
  const remote = cfg.tursoUrl ? remoteClient(cfg.tursoUrl, cfg.tursoToken, cfg.tursoTimeoutMs) : null;
  const how = await fillIfEmpty(local, remote, cfg);
  const shop = await createShop(local);
  const sync = createSync(local, remote);
  sync.start();
  scheduleDailyBackup(local, cfg.dataDir);
  const app = createApp({ shop, cfg, sync, db: local });
  const server = app.listen(cfg.port, '0.0.0.0', () => {
    console.log(`\nREADY (${how}). This computer: http://localhost:${cfg.port}`);
    const lan = lanUrls(cfg.port);
    if (lan.length) console.log('Phones on the same Wi-Fi: ' + lan.join('  or  ') + '\n(if phones cannot open it, run allow-phones.cmd once as administrator)');
    console.log(remote ? 'Turso: the online copy is updated in the background.' : 'Turso: not configured (TURSO_URL is empty) — data is only on this computer.');
  });
  server.keepAliveTimeout = 65000;            // longer than typical proxy idle timeouts (no random 502s behind a proxy)
  // Graceful stop (Docker, systemd, the updater): finish requests, try one last Turso push, close the database.
  let stopping = false;
  const shutdown = async sig => {
    if (stopping) return; stopping = true;
    console.log(`${sig}: stopping…`);
    const force = setTimeout(() => process.exit(0), 10000); force.unref();
    server.close();
    sync.stop();
    try { await Promise.race([sync.push(), new Promise(r => setTimeout(r, 5000))]); } catch { /* next start retries */ }
    try { local.close(); } catch { /* already closed */ }
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
} catch (e) {
  console.error('\nSTART-UP FAILED: ' + e.message);
  process.exit(1);
}
