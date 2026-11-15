/* =====================================================================
   Settings. Everything comes from the ".env" file in the install folder
   (SHOP_HOME) or from real environment variables (they win).
   Copy .env.example to .env and fill it in.
   ===================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CODE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');   // this version's code
// SHOP_HOME = the folder that holds .env and data/. The auto-updater runs newer code from other folders, so it passes this.
export const SHOP_HOME = path.resolve(process.env.SHOP_HOME || CODE_DIR);

/** Read KEY=value lines (no quotes needed). Real environment variables are never overwritten. */
export function loadEnvFile(file = path.join(SHOP_HOME, '.env')) {
  let txt = '';
  try { txt = fs.readFileSync(file, 'utf8'); } catch { return; }
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith('#') || m[1] in process.env) continue;
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

export function getConfig() {
  loadEnvFile();
  const e = process.env;
  const dataDir = path.resolve(SHOP_HOME, e.DATA_DIR || 'data');
  return {
    codeDir: CODE_DIR,
    home: SHOP_HOME,
    dataDir,
    port: Number(e.PORT) || 3000,
    password: e.APP_PASSWORD || '',
    // main database: a file on THIS computer (always available, works without internet)
    dbFile: path.join(dataDir, 'shop-v3.db'),
    // Turso: an online copy, updated in the background whenever there is internet
    tursoUrl: e.TURSO_URL || '',
    tursoToken: e.TURSO_TOKEN || '',
    tursoTimeoutMs: (Number(e.TURSO_TIMEOUT_SECONDS) || 120) * 1000,   // slow internet: wait up to 2 minutes per request
    // the database file of the OLD version (only read once, to bring your data over)
    legacyDbFile: e.LEGACY_DB_FILE ? path.resolve(SHOP_HOME, e.LEGACY_DB_FILE) : path.join(dataDir, 'shop.db'),
    distDir: path.join(CODE_DIR, 'dist'),
    slowMs: Number(e.SLOW_REQUEST_MS) || 1000,                           // requests slower than this are logged
  };
}

/** Problems that should stop the start (errors) or be shown in the log (warnings). */
export function checkConfig(cfg) {
  const errors = [], warnings = [];
  if (!cfg.password) errors.push('APP_PASSWORD is missing: write it in the .env file');
  else if (cfg.password.length < 8 || ['change-me', '1234', '12345678', 'password'].includes(cfg.password)) warnings.push('APP_PASSWORD is weak: use 8+ characters that are not easy to guess');
  if (!Number.isInteger(cfg.port) || cfg.port < 1 || cfg.port > 65535) errors.push('PORT must be a number between 1 and 65535');
  if (cfg.tursoUrl && !cfg.tursoToken) warnings.push('TURSO_URL is set but TURSO_TOKEN is empty');
  if (cfg.tursoUrl && !/^(libsql|https?|wss?):\/\//.test(cfg.tursoUrl)) errors.push('TURSO_URL must start with libsql:// (copy it from the Turso dashboard)');
  return { errors, warnings };
}
