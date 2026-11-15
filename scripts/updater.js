/* =====================================================================
   THE LAUNCHER + AUTOMATIC UPDATER (runs on the shop computer)
   - starts the server and restarts it if it ever stops
   - every few minutes asks GitHub for the newest version (GITHUB_REPO in .env)
   - when there is one:
       download -> install -> build -> run the tests  (in a separate folder, the shop keeps working)
       wait for a quiet moment (nobody saved anything for 1 minute)
       switch to the new version (the database is backed up automatically at start)
       if the new version does not start correctly within 90 s -> go back to the old one
   - a version whose GitHub checks failed is never installed
   Uses only Node itself (no packages), so it always works.
   Folders:  <install folder>/.env  data/  app/<version>/   (data is shared by all versions)
   ===================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HOME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');   // the install folder
const DATA = path.join(HOME, 'data');
const ACTIVE = path.join(DATA, 'active-version.json');
const STATUS = path.join(DATA, 'update-status.json');
const LOG = path.join(DATA, 'logs', 'launcher.log');
fs.mkdirSync(path.dirname(LOG), { recursive: true });

/* ---------- settings from .env ---------- */
const env = {};
try { for (const l of fs.readFileSync(path.join(HOME, '.env'), 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/); if (m && !l.trim().startsWith('#')) env[m[1]] = m[2].replace(/^["']|["']$/g, ''); } } catch { /* no .env */ }
const PORT = Number(env.PORT) || 3000;
const REPO = env.GITHUB_REPO || '';                       // e.g. mazenalhadidy/elbshmds
const BRANCH = env.GITHUB_BRANCH || 'main';
const TOKEN = env.GITHUB_TOKEN || '';                     // needed only if the repository is private (read-only token)
const EVERY = (Number(env.UPDATE_CHECK_MINUTES) || 10) * 60e3;
const AUTO = (env.AUTO_UPDATE || 'on').toLowerCase() !== 'off';

const log = (...a) => { const line = `[${new Date().toISOString()}] ${a.join(' ')}`; console.log(line); try { if (fs.existsSync(LOG) && fs.statSync(LOG).size > 5e6) fs.renameSync(LOG, LOG + '.old'); fs.appendFileSync(LOG, line + '\n'); } catch { /* ignore */ } };
const readJson = (f, d = null) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const writeJson = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v, null, 1)); };
const status = patch => writeJson(STATUS, { ...readJson(STATUS, {}), ...patch });
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Run a command (npm, tar) in a folder; resolves when it ends successfully. */
function run(cmd, args, cwd, timeoutMs = 15 * 60e3) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd, shell: process.platform === 'win32', env: { ...process.env, SHOP_HOME: HOME } });
    let out = '';
    p.stdout.on('data', d => { out += d; }); p.stderr.on('data', d => { out += d; });
    const t = setTimeout(() => { p.kill(); reject(new Error(`${cmd} ${args.join(' ')}: took too long`)); }, timeoutMs);
    p.on('close', code => { clearTimeout(t); code === 0 ? resolve(out) : reject(new Error(`${cmd} ${args.join(' ')} failed:\n${out.slice(-1500)}`)); });
    p.on('error', e => { clearTimeout(t); reject(e); });
  });
}

/** Make a code folder ready: install packages and build the screens if missing. */
async function prepare(dir, { force = false, test = false } = {}) {
  if (force || !fs.existsSync(path.join(dir, 'node_modules'))) { log('installing packages in', dir); await run('npm', [fs.existsSync(path.join(dir, 'package-lock.json')) ? 'ci' : 'install', '--no-audit', '--no-fund'], dir); }
  if (force || !fs.existsSync(path.join(dir, 'dist', 'index.html'))) { log('building screens in', dir); await run('npm', ['run', 'build'], dir); }
  if (test) { log('running tests in', dir); await run('npm', ['run', 'test:quick'], dir); }
}

/* ---------- the server process ---------- */
let child = null, wanted = true;
function startServer(dir) {
  log('starting server from', dir);
  child = spawn(process.execPath, ['server/index.js'], { cwd: dir, env: { ...process.env, SHOP_HOME: HOME }, stdio: ['ignore', 'pipe', 'pipe'] });
  const c = child;
  c.stdout.on('data', d => process.stdout.write(d)); c.stderr.on('data', d => process.stderr.write(d));
  c.on('exit', code => {
    if (c !== child) return;
    child = null;
    if (wanted) { log('server stopped (code ' + code + '), restarting in 5 s'); setTimeout(() => { if (wanted && !child) startServer(active().dir); }, 5000); }
  });
}
function stopServer() {
  return new Promise(res => {
    if (!child) return res();
    const c = child; wanted = false;
    c.once('exit', () => res()); c.kill();
    setTimeout(() => { try { c.kill('SIGKILL'); } catch { /* gone */ } res(); }, 10000);
  }).then(() => { child = null; });
}
async function healthy(ms = 90000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { const r = await fetch(`http://127.0.0.1:${PORT}/api/health`); if (r.ok) return await r.json(); } catch { /* not yet */ } await sleep(1500); }
  return null;
}

/* ---------- versions ---------- */
const active = () => readJson(ACTIVE) || { dir: HOME, sha: (readJson(path.join(HOME, 'version.json')) || {}).sha || 'local' };
const API = env.GITHUB_API || 'https://api.github.com';   // only changed for testing
const gh = (url, raw = false) => fetch(API + url, { headers: { 'User-Agent': 'elbshmds-updater', Accept: raw ? 'application/vnd.github+json' : 'application/vnd.github+json', ...(TOKEN ? { Authorization: 'Bearer ' + TOKEN } : {}) }, signal: AbortSignal.timeout(120000) });

let checking = false, preparing = null;   // preparing = the version being installed (if it fails to install/test, it is never tried again)
async function check() {
  if (checking) return; checking = true;
  try {
    const cur = active();
    const r = await gh(`/repos/${REPO}/commits/${BRANCH}`);
    if (!r.ok) throw new Error('GitHub ' + r.status + (r.status === 404 ? ' (private repository? put GITHUB_TOKEN in .env)' : ''));
    const latest = await r.json(), sha = latest.sha;
    status({ checkedAt: new Date().toISOString(), latest: sha });
    const bad = readJson(path.join(DATA, 'bad-versions.json'), []);
    if (sha === cur.sha) { status({ message: 'البرنامج محدّث', lastError: null }); return; }
    if (bad.includes(sha)) { status({ message: 'آخر إصدار لم يعمل — بقي الإصدار الحالي' }); return; }
    // GitHub checks (CI): never install a version whose tests failed; wait while they still run
    const cr = await gh(`/repos/${REPO}/commits/${sha}/check-runs`);
    if (cr.ok) {
      const all = (await cr.json()).check_runs || [];
      // CI has one "release-gate" job that passes only when every shop check passed. When it exists, it is the only
      // one that counts (so e.g. a Docker publish or the AI tool's checks never hold back the shop's update).
      const gate = all.filter(x => x.name === 'release-gate');
      const runs = gate.length ? gate : all;
      if (runs.some(x => x.status !== 'completed')) { status({ message: 'يوجد تحديث — بانتظار انتهاء الاختبارات على GitHub' }); return; }
      if (runs.some(x => ['failure', 'cancelled', 'timed_out'].includes(x.conclusion))) { status({ message: 'يوجد تحديث لكن اختباراته فشلت — لن يُثبَّت' }); return; }
    }
    log('new version', sha.slice(0, 7), '— downloading');
    status({ message: 'جارٍ تجهيز التحديث ' + sha.slice(0, 7) });
    const dir = path.join(HOME, 'app', sha.slice(0, 12));
    fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
    const tar = await gh(`/repos/${REPO}/tarball/${sha}`);
    if (!tar.ok) throw new Error('download failed: ' + tar.status);
    const file = path.join(HOME, 'app', sha.slice(0, 12) + '.tar.gz');
    fs.writeFileSync(file, Buffer.from(await tar.arrayBuffer()));
    await run('tar', ['-xzf', file, '-C', dir, '--strip-components=1'], HOME);
    fs.rmSync(file, { force: true });
    writeJson(path.join(dir, 'version.json'), { sha, date: latest.commit?.committer?.date || null, message: latest.commit?.message || '' });
    preparing = sha;
    await prepare(dir, { force: true, test: true });
    preparing = null;
    // wait for a quiet minute (nobody saving) — at most 30 minutes
    for (let i = 0; i < 60; i++) { const h = await healthy(5000); if (!h || h.idleSeconds >= 60) break; await sleep(30000); }
    log('switching to', sha.slice(0, 7));
    await stopServer(); wanted = true;
    startServer(dir);
    const h = await healthy();
    if (h && h.version?.sha === sha) {
      writeJson(ACTIVE, { dir, sha, previous: cur });
      status({ message: 'تم التحديث إلى ' + sha.slice(0, 7), updatedAt: new Date().toISOString(), lastError: null });
      log('updated to', sha.slice(0, 7));
      cleanup(dir, cur.dir);
      selfUpdate(dir);
    } else {
      log('new version did not start — going back');
      await stopServer(); wanted = true; startServer(cur.dir);
      writeJson(path.join(DATA, 'bad-versions.json'), [...bad, sha]);
      status({ message: 'التحديث لم يعمل — رجعنا للإصدار السابق', lastError: 'new version did not start' });
    }
  } catch (e) {
    if (preparing) {                                   // the new version could not be installed / its tests failed on this computer
      writeJson(path.join(DATA, 'bad-versions.json'), [...readJson(path.join(DATA, 'bad-versions.json'), []), preparing]);
      fs.rmSync(path.join(HOME, 'app', preparing.slice(0, 12)), { recursive: true, force: true });
      preparing = null;
    }
    log('update check:', e.message);
    status({ lastError: e.message, message: 'تعذّر فحص التحديث (الإنترنت؟) — سيُعاد المحاولة', checkedAt: new Date().toISOString() });
  } finally { checking = false; }
}
/** Keep only the current and the previous version folders. */
function cleanup(keep, prev) {
  const root = path.join(HOME, 'app');
  for (const d of fs.readdirSync(root)) { const p = path.join(root, d); if (p !== keep && p !== prev && fs.statSync(p).isDirectory()) fs.rmSync(p, { recursive: true, force: true }); }
}
/**
 * A newer launcher came with the update: copy it and restart the launcher (run-background.cmd starts it again).
 * The .cmd files are NOT replaced automatically (Windows reads a running .cmd file while it runs; changing it would break it).
 */
function selfUpdate(dir) {
  const from = path.join(dir, 'scripts', 'updater.js'), to = path.join(HOME, 'scripts', 'updater.js');
  if (!fs.existsSync(from) || fs.readFileSync(from).equals(fs.readFileSync(to))) return;
  fs.copyFileSync(from, to);
  log('launcher updated — restarting it');
  stopServer().then(() => process.exit(75));
}

/* ---------- start ---------- */
fs.writeFileSync(path.join(DATA, 'launcher.pid'), String(process.pid));
const stopAll = () => stopServer().then(() => process.exit(0));
process.on('SIGINT', stopAll); process.on('SIGTERM', stopAll);

try {
  const a = active();
  await prepare(a.dir);
  startServer(a.dir);
  if (process.argv.includes('--open')) healthy().then(h => { if (h) spawn(process.platform === 'win32' ? 'cmd' : 'xdg-open', process.platform === 'win32' ? ['/c', 'start', '', `http://localhost:${PORT}`] : [`http://localhost:${PORT}`], { detached: true, stdio: 'ignore' }).unref(); });
  if (AUTO && REPO) { log(`auto-update: checking ${REPO} (${BRANCH}) every ${EVERY / 60e3} minutes`); setTimeout(check, (Number(env.UPDATE_FIRST_CHECK_SECONDS) || 60) * 1000); setInterval(check, EVERY); }
  else { log('auto-update is off (set GITHUB_REPO in .env to turn it on)'); status({ message: 'التحديث التلقائي غير مفعّل' }); }
} catch (e) {
  log('START FAILED: ' + e.message);
  process.exit(1);
}
