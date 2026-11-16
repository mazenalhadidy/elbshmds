// =====================================================================
// Local version: the same tool on your own PC, no Netlify. Start it with start-local.cmd.
// Engines (local/config.json): "anthropic" = Claude (internet, most accurate)
//                              "ollama"    = a model on this PC (100% offline, slower, weaker on blurry receipts)
// Training is saved in local/data/*.json.
// =====================================================================
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { makeClient, runTask, validate, plainPrompt, TASKS, AiError } from '../lib/ai.js';
import { sameKey, STORE_KEYS, STORE_MAX } from '../lib/http.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(HERE, '..', 'public');
const DATA = path.join(HERE, 'data');
const CONFIG_FILE = path.join(HERE, 'config.json');

if (!fs.existsSync(CONFIG_FILE)) fs.copyFileSync(path.join(HERE, 'config.example.json'), CONFIG_FILE);
const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
const PORT = Number(process.env.PORT || cfg.port || 8787);
const ENGINE = cfg.engine === 'ollama' ? 'ollama' : 'anthropic';
const models = { fast: cfg.modelFast || undefined, strong: cfg.modelStrong || undefined };
for (const k of Object.keys(models)) if (!models[k]) delete models[k];
fs.mkdirSync(DATA, { recursive: true });
const claude = cfg.anthropicApiKey ? makeClient(cfg.anthropicApiKey) : null;

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
const HEADERS = { 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; frame-ancestors 'self' http://localhost:* http://127.0.0.1:*" };
const send = (res, status, obj) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(obj)); };
const readBody = (req, limit) => new Promise((ok, bad) => {
  let size = 0; const parts = [];
  req.on('data', c => { size += c.length; if (size > limit) { bad(new AiError('الطلب كبير جدًا', 413)); req.destroy(); } else parts.push(c); });
  req.on('end', () => ok(Buffer.concat(parts).toString('utf8'))); req.on('error', bad);
});

/** Offline engine. Streamed so slow PCs never time out; the schema keeps the answer in shape. */
async function ollama(body) {
  const t = validate(body);
  const model = t.tier === 'strong' ? cfg.ollamaModelStrong || cfg.ollamaModel : cfg.ollamaModel;
  const r = await fetch((cfg.ollamaUrl || 'http://127.0.0.1:11434') + '/api/chat', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, stream: true, format: TASKS[t.task].schema, options: { temperature: 0, num_ctx: 16384 },
      messages: [{ role: 'user', content: plainPrompt(t), ...(t.image ? { images: [t.image] } : {}) }] }),
  });
  if (!r.ok) throw new AiError('Ollama: ' + (await r.text()).slice(0, 200) + ' — هل Ollama يعمل والنموذج مثبت؟');
  let text = '', buf = '';
  const dec = new TextDecoder();
  for await (const chunk of r.body) {
    buf += dec.decode(chunk, { stream: true });
    let n;
    while ((n = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, n).trim(); buf = buf.slice(n + 1);
      if (line) { const j = JSON.parse(line); if (j.error) throw new AiError(j.error); if (j.message?.content) text += j.message.content; }
    }
  }
  return { data: JSON.parse(text), model, cost: 0 };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname.startsWith('/api/')) {
      if (!sameKey(req.headers['x-app-key'], cfg.password)) { await new Promise(r => setTimeout(r, 1000)); return send(res, 401, { error: 'unauthorized' }); }
      if (url.pathname === '/api/analyze' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req, 5_000_000));
        try {
          if (ENGINE === 'ollama') return send(res, 200, await ollama(body));
          if (!claude) throw new AiError('ضع anthropicApiKey في local/config.json', 500);
          return send(res, 200, await runTask(claude, body, { models: { fast: models.fast || 'claude-haiku-5-5', strong: models.strong || 'claude-sonnet-5-5' } }));
        } catch (e) {
          const offline = /fetch failed|ECONNREFUSED|ENOTFOUND|EAI_AGAIN/.test(String(e?.cause?.code || e?.message));
          return send(res, e.status === 400 ? 400 : 502, { error: offline && ENGINE === 'ollama' ? 'Ollama لا يعمل على هذا الجهاز.' : String(e.message || e), code: e.status });
        }
      }
      if (url.pathname === '/api/store') {
        const k = url.searchParams.get('k');
        if (!STORE_KEYS.has(k)) return send(res, 400, { error: 'bad key' });
        const file = path.join(DATA, k + '.json');
        if (req.method === 'GET') return send(res, 200, { value: fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null });
        if (req.method === 'PUT') {
          const text = await readBody(req, STORE_MAX); JSON.parse(text);
          fs.writeFileSync(file + '.tmp', text); fs.renameSync(file + '.tmp', file);   // never a half-written file
          return send(res, 200, { ok: true });
        }
      }
      return send(res, 404, { error: 'not found' });
    }
    const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const file = path.join(PUBLIC, rel);
    if (!file.startsWith(PUBLIC + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', ...HEADERS });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    send(res, e.status || 500, { error: String(e.message || e) });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  const lan = Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
  console.log(`\n  مدقق الديون يعمل (${ENGINE})\n  الحاسوب:  http://localhost:${PORT}`);
  for (const ip of lan) console.log(`  الهاتف (على شبكة الواي فاي نفسها):  http://${ip}:${PORT}`);
  if (!cfg.password || cfg.password === 'change-me') console.log('\n  ⚠ غيّر password في local/config.json');
  console.log('\n  أغلق هذه النافذة لإيقاف الأداة.\n');
});
