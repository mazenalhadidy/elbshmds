/* =====================================================================
   THE WEB SERVER (Express): routes = the API the screens call.
   createApp() builds it without starting anything, so tests can use it.
   ===================================================================== */
import express from 'express';
import compression from 'compression';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import QRCode from 'qrcode';
import { createAuth, createEditorLock } from './services/auth.js';
import { createDevices, lanUrls } from './services/network.js';
import { UserError } from './services/shop.js';

export function createApp({ shop, cfg, sync = null, db = null, log = console }) {
  const app = express();
  const auth = createAuth(cfg.password);
  const lock = createEditorLock();
  const devices = createDevices();
  let lastActivity = Date.now();                        // the updater waits for a quiet moment before restarting

  const cid = req => req.get('x-client-id') || '';
  const send = (res, fn) => Promise.resolve().then(fn).then(out => { if (!res.headersSent) res.json(out); }).catch(e => {
    if (res.headersSent) return console.error(e);
    if (e instanceof UserError) return res.status(e.code).json({ error: e.message });
    console.error(e); res.status(500).json({ error: 'خطأ في البرنامج: ' + e.message });
  });
  /** Password confirmation for sensitive actions (closing a day, editing a saved day, deleting with logs, ...). */
  const needPassword = req => { const e = auth.check(req.ip, req.body?.password); if (e) throw new UserError(e.error, e.code); };
  /** Only the editing device may change things. */
  const needEditor = req => { if (!lock.claim(cid(req))) throw new UserError('وضع المشاهدة فقط: جهاز آخر يقوم بالتعديل الآن', 403); };

  app.set('trust proxy', 'loopback');
  app.disable('x-powered-by');
  // request id + security headers + slow/failed request log (one line each, easy to grep)
  app.use((req, res, next) => {
    const id = req.get('x-request-id') || crypto.randomBytes(6).toString('hex'), t0 = process.hrtime.bigint();
    res.set({ 'X-Request-Id': id, 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer' });
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      if (res.statusCode >= 500 || ms > (cfg.slowMs ?? 1000)) log.warn?.(JSON.stringify({ at: new Date().toISOString(), id, method: req.method, path: req.path, status: res.statusCode, ms: Math.round(ms) }));
    });
    next();
  });
  // gzip: the state snapshot is JSON that shrinks ~10x — matters on phones and slow Wi-Fi
  app.use(compression({ threshold: 1024 }));
  app.use(express.json({ limit: '5mb' }));

  /* ----- open routes ----- */
  // liveness (used by the updater: shape must stay the same)
  app.get('/api/health', (req, res) => res.json({ ok: true, idleSeconds: Math.round((Date.now() - lastActivity) / 1000), version: readVersion(cfg) }));
  // readiness (Docker / load balancers): the database answers
  app.get('/api/ready', async (req, res) => {
    try { if (db) await db.execute('SELECT 1'); res.json({ ok: true, rev: shop.rev, turso: sync ? { lastOkAt: sync.status.lastOkAt, pendingRows: sync.status.pendingRows } : null }); }
    catch (e) { res.status(503).json({ ok: false, error: e.message }); }
  });
  app.post('/api/login', (req, res) => { const e = auth.check(req.ip, req.body?.password); e ? res.status(e.code).json({ error: e.error }) : res.json({ token: auth.makeToken() }); });

  // QR code of a phone address (not secret: it only shows the shop computer's local address)
  app.get('/api/qr', async (req, res) => {
    try { res.type('image/svg+xml').send(await QRCode.toString(String(req.query.text || '').slice(0, 300), { type: 'svg', margin: 1, width: 180 })); }
    catch { res.status(400).end(); }
  });

  /* ----- everything below needs a login ----- */
  app.use('/api', (req, res, next) => {
    if (!auth.validToken((req.get('authorization') || '').replace(/^Bearer /, ''))) return res.status(401).json({ error: 'سجّل الدخول' });
    res.set('Cache-Control', 'no-store');
    devices.seen(cid(req), { name: req.get('x-device-name'), ip: req.ip, ua: req.get('user-agent') });
    if (req.method !== 'GET') lastActivity = Date.now();
    next();
  });

  // current data. ?rev=N -> "unchanged" (a few bytes) when nothing changed since N
  app.get('/api/state', (req, res) => {
    const c = cid(req); lock.claim(c);                   // keep the editor role alive
    if (Number(req.query.rev) === shop.rev && shop.rev > 0) return res.json({ unchanged: true, rev: shop.rev, lock: lock.info(c) });
    res.json({ ...shop.snapshot(), lock: lock.info(c) });
  });
  app.post('/api/lock', (req, res) => { const c = cid(req); lock.claim(c, !!req.body?.take); res.json({ ...shop.snapshot(), lock: lock.info(c) }); });

  app.post('/api/setup', (req, res) => send(res, async () => { needEditor(req); return { ...(await shop.setup({ opening: req.body?.opening })), lock: lock.info(cid(req)) }; }));

  app.post('/api/ops', (req, res) => send(res, async () => {
    const c = cid(req);
    if (!lock.claim(c)) return res.status(403).json({ error: 'وضع المشاهدة فقط: جهاز آخر يقوم بالتعديل الآن', ...shop.snapshot(), lock: lock.info(c) });
    const ops = Array.isArray(req.body?.ops) ? req.body.ops.slice(0, 500) : [];
    const out = await shop.applyOps(ops, c);
    sync?.poke();
    return { done: out.done, rejected: out.rejected, ...out.snapshot, lock: lock.info(c) };
  }));

  app.post('/api/close', (req, res) => send(res, async () => {
    needEditor(req); needPassword(req);
    const snap = await shop.closeDay({ dayId: req.body.dayId, date: req.body.date, notes: req.body.notes }, cid(req));
    sync?.poke();
    return { ...snap, lock: lock.info(cid(req)) };
  }));

  app.get('/api/days/:id', (req, res) => send(res, () => shop.getDay(req.params.id)));
  app.post('/api/days/:id/edit', (req, res) => send(res, async () => {
    needEditor(req);
    if (!req.body?.preview) needPassword(req);
    const out = await shop.editDay({ dayId: req.params.id, ops: req.body.ops, note: req.body.note, preview: !!req.body.preview }, cid(req));
    if (!req.body.preview) sync?.poke();
    return out.snapshot ? { ...out, snapshot: { ...out.snapshot, lock: lock.info(cid(req)) } } : out;
  }));

  // تعويض of a saved day: changes saved numbers (and every later day) -> editing device + password
  app.post('/api/days/:id/compensate', (req, res) => send(res, async () => {
    needEditor(req); needPassword(req);
    const out = await shop.compensate({ dayId: req.params.id, field: req.body?.field, amount: req.body?.amount, notes: req.body?.notes }, cid(req));
    sync?.poke();
    return { ...out, snapshot: { ...out.snapshot, lock: lock.info(cid(req)) } };
  }));

  // the note of any day (open or saved): text only, no password (it changes no number), editing device only
  app.post('/api/days/:id/notes', (req, res) => send(res, async () => {
    needEditor(req);
    const snap = await shop.setDayNotes(req.params.id, req.body?.notes, cid(req)); sync?.poke();
    return { ...snap, lock: lock.info(cid(req)) };
  }));

  app.get('/api/items/:id/history', (req, res) => send(res, () => shop.itemHistory(req.params.id)));
  app.post('/api/items/:id/purge', (req, res) => send(res, async () => {
    needEditor(req); needPassword(req);
    const snap = await shop.purgeItem(req.params.id, cid(req)); sync?.poke();
    return { ...snap, lock: lock.info(cid(req)) };
  }));

  app.post('/api/cash-profit', (req, res) => send(res, async () => { needPassword(req); return shop.cashProfitThisMonth(); }));

  // management page: phones, devices, version, Turso
  app.get('/api/system', (req, res) => send(res, async () => ({
    version: readVersion(cfg), update: readJson(path.join(cfg.dataDir, 'update-status.json')),
    turso: sync ? { ...sync.status } : { configured: false },
    phoneUrls: lanUrls(cfg.port), devices: devices.list(), thisDevice: cid(req), lock: lock.info(cid(req)),
  })));
  app.get('/api/export', (req, res) => send(res, async () => { res.set('Content-Disposition', `attachment; filename="elbshmds-backup-${new Date().toISOString().slice(0, 10)}.json"`); return shop.exportAll(); }));
  app.post('/api/sync-now', (req, res) => send(res, async () => { await sync?.push(); return sync ? { ...sync.status } : { configured: false }; }));

  /* ----- the screens (built Vue app) ----- */
  if (fs.existsSync(cfg.distDir)) {
    app.use(express.static(cfg.distDir, { index: false, setHeaders: (res, p) => { if (/[\\/]assets[\\/]/.test(p)) res.set('Cache-Control', 'public, max-age=31536000, immutable'); } }));
    app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(cfg.distDir, 'index.html')));
  } else {
    app.get('/', (req, res) => res.status(503).send('The screens are not built yet. Run: npm run build'));
  }
  return app;
}

function readJson(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } }
export function readVersion(cfg) { return readJson(path.join(cfg.codeDir, 'version.json')) || { sha: 'local', date: null }; }
