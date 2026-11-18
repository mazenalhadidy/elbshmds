// Adds every Egyptian mobile number found in a WhatsApp chat as a wallet with balance 0.
// Easiest: drag the chat (.zip, .txt or .md) onto add-wallets.cmd while the shop program is running.
//   npm run import-wallets -- chat.zip [more files] [--dry = only list the numbers] [--yes = don't ask]
// It goes through the app itself (POST /api/ops), so the local database, the history and the Turso copy all get it,
// and the same rules apply: a number that already exists (active or deleted) is skipped.
// The new wallets are not ticked ✓ (not used today).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import readline from 'node:readline/promises';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const DIGITS = { '٠': 0, '١': 1, '٢': 2, '٣': 3, '٤': 4, '٥': 5, '٦': 6, '٧': 7, '٨': 8, '٩': 9, '۰': 0, '۱': 1, '۲': 2, '۳': 3, '۴': 4, '۵': 5, '۶': 6, '۷': 7, '۸': 8, '۹': 9 };

/** Egyptian mobiles (010/011/012/015 + 8 digits) in the order they first appear; spaces, dashes, +20 and Arabic digits allowed. */
export function findNumbers(text) {
  const t = String(text).replace(/[٠-٩۰-۹]/g, d => DIGITS[d]);
  const out = new Set();
  for (const m of t.matchAll(/(?<!\d)(?:\+?20[\s-]?)?0?1[0125](?:[\s-]?\d){8}(?!\d)/g)) {
    let d = m[0].replace(/\D/g, '');
    if (d.startsWith('20')) d = d.slice(2);
    if (!d.startsWith('0')) d = '0' + d;
    if (/^01[0125]\d{8}$/.test(d)) out.add(d);
  }
  return [...out];
}

/** The text of a .txt / .md file, or of every .txt / .md inside a .zip. */
function readChat(file) {
  if (!/\.zip$/i.test(file)) return fs.readFileSync(file, 'utf8');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-'));
  try {
    if (process.platform === 'win32') execFileSync('powershell', ['-NoProfile', '-Command', 'Expand-Archive -Force -LiteralPath $env:ZIP -DestinationPath $env:OUT'], { env: { ...process.env, ZIP: path.resolve(file), OUT: dir } });
    else execFileSync('unzip', ['-o', '-q', path.resolve(file), '-d', dir]);
    const texts = [];
    const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (/\.(txt|md)$/i.test(e.name)) texts.push(fs.readFileSync(f, 'utf8')); } };
    walk(dir);
    return texts.join('\n');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

async function main() {
  const args = process.argv.slice(2), dry = args.includes('--dry');
  const files = args.filter(a => !a.startsWith('--'));
  if (!files.length) { console.log('Drag the WhatsApp chat file (.zip or .txt) onto add-wallets.cmd'); process.exit(1); }
  const numbers = findNumbers(files.map(readChat).join('\n'));
  console.log(`${numbers.length} numbers found`);
  if (dry) { console.log(numbers.join('\n')); return; }

  const { getConfig } = await import('../server/config.js');
  const cfg = getConfig();
  const base = process.env.SHOP_URL || `http://localhost:${cfg.port}`;
  const password = process.env.APP_PASSWORD || cfg.password;
  const cid = 'import-' + randomUUID();
  const call = async (method, url, body, token) => {
    const r = await fetch(base + '/api' + url, { method, headers: { 'Content-Type': 'application/json', 'X-Client-Id': cid, ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || r.status);
    return j;
  };
  let token;
  try { ({ token } = await call('POST', '/login', { password })); }
  catch (e) { console.error(e.cause ? 'The shop program is not running. Start it (start-shop.cmd), then try again.' : 'Cannot log in: ' + e.message); process.exit(1); }
  const state = await call('POST', '/lock', { take: true }, token);          // like «تولّي التعديل»
  if (!state.book) { console.error('Finish the first setup in the app first.'); process.exit(1); }
  const have = new Set(Object.values(state.items).filter(i => i.type === 'wallet' && !i.purged).map(i => i.name));
  const todo = numbers.filter(n => !have.has(n));
  console.log(`${numbers.length - todo.length} already in the app, ${todo.length} new`);
  if (!todo.length) { console.log('Nothing to add.'); return; }
  if (!args.includes('--yes') && process.stdin.isTTY) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    await rl.question(`Press Enter to add the ${todo.length} new wallets (or close this window to cancel) `);
    rl.close();
  }
  const ops = [];
  for (const n of todo) {
    const id = randomUUID(), ts = new Date().toISOString();
    ops.push({ opId: randomUUID(), ts, t: 'addItem', id, type: 'wallet', name: n, amount: 0 });
    ops.push({ opId: randomUUID(), ts, t: 'setActive', id, active: false });
  }
  let refused = 0;
  for (let i = 0; i < ops.length; i += 400) {                                 // the server takes up to 500 per request
    const r = await call('POST', '/ops', { ops: ops.slice(i, i + 400) }, token);
    for (const x of r.rejected || []) { refused++; console.log('refused:', x.error); }
  }
  const now = await call('GET', '/state', null, token);
  const added = todo.filter(n => Object.values(now.items).some(i => i.type === 'wallet' && i.name === n)).length;
  console.log(`Done: ${added} wallets added with balance 0${refused ? `, ${refused} refused` : ''}.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(e => { console.error(e.message); process.exit(1); });
