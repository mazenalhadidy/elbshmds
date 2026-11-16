// Pure logic of the debt checker (no DOM, no network) — tested in test/core.test.js.

const AR = '٠١٢٣٤٥٦٧٨٩', FA = '۰۱۲۳۴۵۶۷۸۹';
export const digits = s => s.replace(/[٠-٩]/g, d => AR.indexOf(d)).replace(/[۰-۹]/g, d => FA.indexOf(d));
/** Latin digits, no hidden direction marks, normal spaces. */
export const clean = s => digits(s).replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '').replace(/[\u00a0\u202f]/g, ' ');
/** For keyword search: أ=ا، ة=ه، ى=ي, no tashkeel. */
export const norm = s => clean(s).replace(/[ً-ْـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي');
export const num = x => {
  if (typeof x === 'number') return Number.isFinite(x) ? x : null;
  if (x == null) return null;
  const v = parseFloat(digits(String(x)).replace(/[,٬\s]/g, ''));
  return Number.isFinite(v) ? v : null;
};
export const clamp = c => { c = Number(c); return Number.isFinite(c) ? Math.min(1, Math.max(0, c)) : 0.5; };
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const fmt = n => (Math.round((n || 0) * 100) / 100).toLocaleString('en-US');
export const KIND = { sent: 'أرسلنا له', received: 'استلمنا منه', ignore: 'تجاهل' };

const EXT = 'jpe?g|png|webp|heic|gif|opus|ogg|mp3|m4a|aac|mp4|mov|3gp|pdf|vcf|webm';
export const IMG = /\.(jpe?g|png|webp|heic|gif)$/i;
export const MEDIA = new RegExp(`\\.(${EXT})$`, 'i');
const VOICE = /\.(opus|ogg|mp3|m4a|aac)$/i;
const DELETED = /This message was deleted|You deleted this message|تم حذف هذه الرسالة|لقد حذفت هذه الرسالة|هذه الرسالة محذوفة|حذف المشرف هذه الرسالة|was deleted by admin/;
const EDITED = /\s*<(?:This message was edited|تم تعديل هذه الرسالة|تم تعديل الرسالة)>/gi;
const STICKER = /^STK-|\.webp$/i;
const SYSTEM = /end-to-end encrypted|created group|added |removed |left$|joined using|changed (the )?(group|subject|icon)|مشفره|مشفرة|أنشأ المجموعة|انشا المجموعه|أضاف|اضاف|غادر|انضم/i;
const OMIT = /<Media omitted>|<تم استبعاد الوسائط>|image omitted|تم استبعاد الصورة|الوسائط غير مضمنة/i;

/* ---------- WhatsApp export ---------- */
// iPhone:  [15/11/2026, 10:21:33 AM] Name: text        Android:  15/11/2026, 10:21 - Name: text
const RX_IOS = /^\[([^\]]*\d{1,2}:\d{2}[^\]]*)\]\s(.*)$/;
const RX_AND = /^(\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?(?:\s?(?:[AaPp]\.?\s?[Mm]\.?|ص|م))?)\s[-–]\s(.*)$/;

export function parse(txt) {
  const out = []; let cur = null;
  for (const raw of txt.split(/\r?\n/)) {
    const l = clean(raw); let m, ts, rest;
    if ((m = l.match(RX_IOS))) { ts = m[1]; rest = m[2]; }
    else if ((m = l.match(RX_AND))) { ts = m[1] + ' ' + m[2]; rest = m[3]; }
    if (ts !== undefined) {
      const k = rest.indexOf(': '); let sender = null, text = rest;
      if (k > 0 && k < 60) { sender = rest.slice(0, k).trim(); text = rest.slice(k + 2); }
      cur = { i: out.length, ts, sender, text }; out.push(cur);
    } else if (cur) cur.text += '\n' + l;
  }
  for (const m of out) if (m.sender && SYSTEM.test(m.text) && m.text.length < 160 && !/\d{2,}/.test(m.text.replace(/\+?\d[\d\s-]{8,}/g, ''))) m.sys = true;
  return out;
}

/** The attachment of a message: { file } found in the zip, { file, missing } or null. `has(name)` = is it in the zip. */
export function attachment(m, has) {
  const found = [...m.text.matchAll(new RegExp(`([\\w\\-.]+\\.(?:${EXT}))`, 'gi'))].map(x => x[1]);
  for (const f of found) if (has(f.toLowerCase())) return { file: f };
  if (found.length) return { file: found[0], missing: true };
  if (OMIT.test(m.text)) return { file: '', missing: true };
  return null;
}
/** Message text without the attachment markers. */
export const strip = t => t.replace(new RegExp(`<[^<>]*\\.(?:${EXT})>`, 'gi'), '')
  .replace(new RegExp(`[\\w\\-.]+\\.(?:${EXT})\\s*\\((?:file attached|الملف مرفق|ملف مرفق)\\)`, 'gi'), '')
  .replace(OMIT, '').replace(EDITED, '').trim();

/** First amount after keyword `kw` ("بدايتنا ١٢ الف" -> 12000). */
export function amountAfter(t, kw) {
  const n = norm(t); const at = kw ? n.indexOf(kw) : 0; const s = at >= 0 ? n.slice(at + (kw || '').length) : n;
  const m = s.match(/(\d{1,3}(?:[,٬]\d{3})+|\d+(?:\.\d+)?)\s*(الاف|الف|ك(?![؀-ۿ]))?/);
  if (!m) return null;
  let v = parseFloat(m[1].replace(/[,٬]/g, '')); if (m[2]) v *= 1000; return v;
}

/** Starting points found by keywords only (instant, before the AI answers). */
export function keywordCheckpoints(msgs, keywords) {
  const kws = keywords.map(norm).map(x => x.trim()).filter(Boolean), out = [];
  for (const m of msgs) {
    if (m.sys || !m.sender) continue;
    const t = norm(m.text), k = kws.find(k => t.includes(k));
    if (k) { const a = amountAfter(m.text, k); if (a != null) out.push({ i: m.i, amount: a, dir: 'client_owes', conf: 1, why: 'تحتوي على «' + k + '»' }); }
  }
  return out;
}

/** A message ready for analysis (or already decided: system, deleted, voice, missing media). */
export function prep(m, { shop, has }) {
  const r = { i: m.i, ts: m.ts, sender: m.sender, side: shop.has(m.sender) ? 'shop' : 'client', text: strip(m.text), kind: 'ignore', amount: null, conf: 1, why: '', state: 'pending', flag: false, ai: { kind: 'ignore', amount: null } };
  const done = (why, flag) => { r.state = 'done'; r.why = why; r.flag = !!flag; return r; };
  if (!m.sender || m.sys) { r.sys = true; return done('رسالة نظام'); }
  if (DELETED.test(m.text)) return done('رسالة محذوفة');
  const a = attachment(m, has);
  if (a) {
    r.file = a.file;
    if (a.missing) return done('المرفق غير موجود في الملف. صدّر المحادثة مع «إرفاق الوسائط».', true);
    if (STICKER.test(a.file) && !/^pic-/i.test(a.file)) return done('ملصق: ليس من الحساب.');
    if (/\.gif$/i.test(a.file)) return done('صورة متحركة: ليست من الحساب.');
    if (IMG.test(a.file)) r.img = true;
    else if (VOICE.test(a.file)) return done('رسالة صوتية: استمع إليها وعدّل إن تضمنت مبلغًا.', true);
    else return done('مرفق ليس صورة.');
  }
  return r;
}

/** Apply the AI's answer for one message. */
export function applyAnswer(r, v) {
  r.kind = ['sent', 'received', 'ignore'].includes(v?.kind) ? v.kind : 'ignore';
  r.amount = num(v?.amount); r.conf = clamp(v?.confidence); r.why = String(v?.why || '');
  r.flag = r.conf < 0.75 || (r.kind !== 'ignore' && !(r.amount > 0));
  r.ai = { kind: r.kind, amount: r.amount }; r.state = 'done';
  return r;
}
/** An image answer good enough, or should the strong model look again? */
export const weak = v => !v || v.unclear === true || clamp(v.confidence) < 0.75 || (v.is_transfer && !(num(v.amount) > 0));

/** Two receipts with the same transaction number = one transfer. */
export function dedupeRefs(list) {
  const seen = new Map();
  for (const r of list) if (r.img && r.ref && r.ref.length > 3 && r.kind !== 'ignore') {
    if (seen.has(r.ref)) { r.kind = 'ignore'; r.why += ` (رقم العملية نفسه في #${seen.get(r.ref)})`; }
    else seen.set(r.ref, r.i);
  }
}

/** Totals + the running balance after each row. `opening` is signed (+ = client owes). Rows up to `fromI` only get checked, not counted. */
export function totals(rows, opening, fromI = -Infinity) {
  let s = 0, rc = 0, rev = 0, ns = 0, nr = 0, run = opening; const bal = new Map();
  const cov = covered(rows);
  for (const r of rows) {
    if (r.state !== 'done') continue;
    if (r.flag && !r.ok) rev++;
    if (r.i <= fromI || cov.has(r.i)) continue;
    if (r.amount > 0) {
      if (r.kind === 'sent') { s += r.amount; run += r.amount; ns++; }
      else if (r.kind === 'received') { rc += r.amount; run -= r.amount; nr++; }
    }
    bal.set(r.i, run);
  }
  return { s, rc, rev, ns, nr, bal, debt: opening + s - rc };
}

const label = r => (r.side === 'shop' ? 'المحل' : 'العميل') + ' (' + r.sender + ')';
/** Text lines sent to the AI for a range of rows (images appear as their analysis, for duplicate detection). */
export const lines = list => list.filter(x => !x.sys).map(x => x.img
  ? `#${x.i} | ${x.ts} | ${label(x)} | [صورة: ${x.calc ? (x.calc.terms.length >= 2 ? 'آلة حاسبة ' + expression(x.calc.terms) + ' = ' + fmt(x.calc.total) : 'ناتج آلة حاسبة ' + fmt(x.calc.total)) : x.state === 'done' ? KIND[x.kind] + ' ' + (x.amount ?? '') + ' — ' + (x.summary || '') : '؟'}]`
  : `#${x.i} | ${x.ts} | ${label(x)} | ${(x.text || '').replace(/\n/g, ' ⏎ ').slice(0, 400)}`).join('\n');
/** 3 messages before and after a row (context for an image). */
export function around(r, list) {
  const k = list.indexOf(r);
  return list.slice(Math.max(0, k - 3), k).concat(list.slice(k + 1, k + 4)).filter(x => !x.sys)
    .map(x => `- ${label(x)}: ${x.img ? '[صورة]' : (x.text || '').slice(0, 140)}`).join('\n') || 'لا يوجد';
}
export const imageInput = (r, list) => `من ${label(r)} الساعة ${r.ts}. ${r.text ? 'التعليق: ' + r.text : 'بدون تعليق.'}\nما حولها:\n${around(r, list)}`;

/** One correction as a line of training. */
export const exampleLine = e => e.auto ? `- درس: ${e.content}`
  : `- ${e.side === 'shop' ? 'من المحل' : 'من العميل'} | ${e.content} | فهمتُها: ${KIND[e.ai?.kind] || '?'} ${e.ai?.amount ?? ''} | الصحيح: ${KIND[e.fix.kind]} ${e.fix.amount ?? ''}${e.note ? ' | السبب: ' + e.note : ''}`;

/** Everything the owner taught (sent as the cached part of the system prompt). Stable during one analysis. */
export function trainingText(settings, examples) {
  const parts = [];
  if (settings.rules.length) parts.push('قواعد:\n' + settings.rules.map((x, k) => `${k + 1}. ${x}`).join('\n'));
  if (settings.learned) parts.push('خلاصة تصحيحات قديمة:\n' + settings.learned);
  const ex = examples.filter(e => !e.merged);
  if (ex.length) parts.push('تصحيحات:\n' + ex.map(exampleLine).join('\n'));
  if (settings.keywords.length) parts.push('كلمات البداية المعتادة: ' + settings.keywords.join('، '));
  return parts.join('\n\n');
}

/** Run `fn` on every item with at most `n` at once. `stop()` = stop taking new items. */
export async function pool(list, n, fn, stop = () => false) {
  let k = 0;
  await Promise.all(Array.from({ length: Math.min(n, list.length) }, async () => { while (k < list.length && !stop()) await fn(list[k++]); }));
}

/* =====================================================================
   The shop's own calculation: "1,171,035+22,150+…−311,000 = 1,857,125"
   - a statement (calculator line) = first number is the previous balance, the rest are the
     transactions (+ sent, − received), the result is the new balance
   - split transfers: several receipts + «تم ٥٠٠٠٠» = ONE term of 50,000
   - a chat export often starts in the middle: statement terms older than the chat are fine
   ===================================================================== */
const counted = r => r.state === 'done' && r.amount > 0 && (r.kind === 'sent' || r.kind === 'received');

/** Rows that are part of a total stated by another row («تم ٥٠٠٠٠» covering 3 receipts). */
export function covered(rows) {
  const byI = new Map(rows.map(r => [r.i, r])), out = new Set();
  for (const r of rows) if (counted(r) && Array.isArray(r.of)) for (const j of r.of) {
    const p = byI.get(Number(j));
    if (p && p !== r && counted(p) && p.kind === r.kind) out.add(p.i);
  }
  return out;
}

/** Mark the parts of each total; flag a total whose parts don't add up. Call after the analysis. */
export function linkGroups(rows) {
  const byI = new Map(rows.map(r => [r.i, r])), cov = covered(rows);
  for (const r of rows) delete r.partOf;
  for (const r of rows) if (counted(r) && Array.isArray(r.of)) {
    const parts = r.of.map(j => byI.get(Number(j))).filter(p => p && cov.has(p.i) && p.kind === r.kind);
    for (const p of parts) p.partOf = r.i;
    const sum = parts.reduce((a, p) => a + p.amount, 0);
    if (parts.length && Math.abs(sum - r.amount) >= 1) { r.flag = true; r.why += ` (مجموع الإيصالات ${fmt(sum)} وليس ${fmt(r.amount)})`; }
  }
}

/** The transactions as the shop writes them: one signed number per operation, in chat order. */
export function transactions(rows, { after = -Infinity, before = Infinity } = {}) {
  const cov = covered(rows);
  return rows.filter(r => counted(r) && !cov.has(r.i) && r.i > after && r.i < before)
    .map(r => ({ i: r.i, amount: r.kind === 'sent' ? r.amount : -r.amount }));
}

const N = '\\d[\\d,]*(?:\\.\\d+)?';
/** A typed calculator line "1,171,035+22,150-311,000=1,857,125" -> { terms, total }, or null. */
export function parseStatement(text) {
  const t = clean(String(text || '')).replace(/[−–—]/g, '-').replace(/[×x]/g, '*').replace(/٬/g, ',').replace(/\s+/g, '');
  const m = t.match(new RegExp(`(-?${N}(?:[+-]${N}){2,})(?:=(-?${N}))?`));
  if (!m || !m[1].includes('+') || /\*/.test(m[0])) return null;
  const terms = m[1].match(new RegExp(`[+-]?${N}`, 'g')).map(x => Number(x.replace(/,/g, '')));
  if (!terms.some(v => Math.abs(v) >= 100)) return null;
  const sum = terms.reduce((a, v) => a + v, 0);
  return { terms, total: m[2] != null ? Number(m[2].replace(/,/g, '')) : sum };
}

/** Starting points from statements typed in the chat. */
export function statementCheckpoints(msgs) {
  const out = [];
  for (const m of msgs) {
    if (m.sys || !m.sender) continue;
    const st = parseStatement(m.text);
    if (st) out.push(statementCp(m.i, st));
  }
  return out;
}
export const statementCp = (i, st) => ({ i, amount: Math.abs(st.total), dir: st.total < 0 ? 'shop_owes' : 'client_owes', conf: 1, terms: st.terms, stated: st.total, why: 'كشف حساب (آلة حاسبة)' });

/** Merge starting points found in different ways (same message -> the statement wins). */
export function mergeCheckpoints(...lists) {
  const by = new Map();
  for (const c of lists.flat()) { const old = by.get(c.i); if (!old || (c.terms && !old.terms)) by.set(c.i, c); }
  return [...by.values()].sort((a, b) => a.i - b.i);
}

/** "1,171,035+22,150−311,000" (as the shop writes it). */
export function expression(terms) {
  return terms.map((v, k) => (k === 0 ? (v < 0 ? '-' : '') : v < 0 ? '−' : '+') + fmt(Math.abs(v))).join('');
}
/** Final calculation from a starting balance: { terms, total, text } — text is ready to paste in WhatsApp. */
export function equation(base, txs) {
  const terms = [base, ...txs.map(t => t.amount)], total = terms.reduce((a, v) => a + v, 0);
  return { terms, total, text: `${expression(terms)}\n=${fmt(total)}` };
}

/**
 * Check a statement against the chat. `txs` = the chat's transactions before the statement.
 * Each chat transaction is matched to one term (same amount), or a run of consecutive transactions to one term
 * (receipts not grouped). Terms before the first match are "before the chat" when the export starts mid-way.
 */
export function reconcile(st, txs, { midway = true } = {}) {
  const terms = st.terms.slice(1), used = new Array(terms.length).fill(null), txUsed = new Array(txs.length).fill(false);
  const same = (a, b) => Math.abs(a - b) < 1;
  txs.forEach((t, k) => { const j = terms.findIndex((v, j) => used[j] === null && same(v, t.amount)); if (j >= 0) { used[j] = [t.i]; txUsed[k] = true; } });
  for (let j = 0; j < terms.length; j++) if (used[j] === null) {            // a term = several consecutive transactions
    for (let a = 0; a < txs.length && used[j] === null; a++) {
      let sum = 0;
      for (let b = a; b < Math.min(txs.length, a + 8) && !txUsed[b]; b++) {
        sum += txs[b].amount;
        if (b > a && same(sum, terms[j])) { used[j] = txs.slice(a, b + 1).map(t => t.i); for (let x = a; x <= b; x++) txUsed[x] = true; break; }
      }
    }
  }
  const first = used.findIndex(Boolean);
  const items = terms.map((v, j) => ({ amount: v, found: used[j], status: used[j] ? 'ok' : (midway && (first < 0 || j < first)) ? 'before' : 'missing' }));
  const extra = txs.filter((_, k) => !txUsed[k]);
  const before = items.filter(x => x.status === 'before').map(x => x.amount);
  // the calculation rebuilt from the chat: previous balance + older terms + what the chat shows
  const eq = equation(st.terms[0], [...before.map(amount => ({ amount })), ...txs]);
  const sumTerms = st.terms.reduce((a, v) => a + v, 0);
  return { items, extra, before, eq, stated: st.total, arithmeticOk: same(sumTerms, st.total), matches: same(eq.total, st.total) };
}

/** The calculation for the screen: every number is one piece with its sign (+1,234 / −5,000 / =9,999).
 *  A line may break only BETWEEN pieces, so a number is never cut and its sign starts the new line. */
export function expressionHtml(terms, total) {
  const piece = t => `<span class="t">${t}</span>`;
  const parts = terms.map((v, k) => piece((k === 0 ? (v < 0 ? '-' : '') : v < 0 ? '−' : '+') + fmt(Math.abs(v))));
  return parts.join('<wbr>') + (total == null ? '' : '<br>' + piece('=' + fmt(total)));
}

/* =====================================================================
   "Our start is this message / picture": the user points at the start; it is found searching from the
   LAST message back to the first (the newest match wins).
   ===================================================================== */
const plain = s => norm(String(s || '')).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** The text the user pasted: a copied WhatsApp message (with or without its "[date] name:" header) or any part of it. */
export function markerText(input) {
  const m = parse(String(input || ''));
  return plain(m.length ? m.map(x => x.text).join(' ') : input);
}
/** Index of the newest message whose text contains the marker (or is contained in it), or -1. */
export function findTextMarker(msgs, input) {
  const want = markerText(input);
  if (want.length < 2) return -1;
  for (let k = msgs.length - 1; k >= 0; k--) {
    const have = plain(strip(msgs[k].text));
    if (have && (have.includes(want) || (have.length >= 6 && want.includes(have)))) return msgs[k].i;
  }
  return -1;
}

/** Picture fingerprint: 64-bit difference hash of a 9×8 grey image (`grey` = 72 values, row by row). */
export function dhash(grey) {
  let bits = '';
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += grey[y * 9 + x] > grey[y * 9 + x + 1] ? '1' : '0';
  return bits;
}
/** How different two fingerprints are (0 = same picture; ≤ 10 = the same picture resized / recompressed / forwarded). */
export function hamming(a, b) {
  let d = 0;
  for (let k = 0; k < 64; k++) if (a[k] !== b[k]) d++;
  return d;
}
export const SAME_PICTURE = 10;

/** A row counted in the account (a real transfer or payment). */
export const isTransaction = r => r.state === 'done' && r.amount > 0 && (r.kind === 'sent' || r.kind === 'received');

/* =====================================================================
   Who represents the shop: learned from your answers, then guessed by the AI for new names.
   stats = { name: { shop: n, client: n } } — how many times you confirmed each answer.
   ===================================================================== */
export const ROLE_MIN = 2, ROLE_SHARE = 0.8;

/** 'shop' / 'client' when your past answers agree enough, else null (still unsure). */
export function roleFromHistory(stats, name) {
  const s = stats?.[name]; if (!s) return null;
  const total = (s.shop || 0) + (s.client || 0);
  if (total < ROLE_MIN) return null;
  if ((s.shop || 0) / total >= ROLE_SHARE) return 'shop';
  if ((s.client || 0) / total >= ROLE_SHARE) return 'client';
  return null;
}
/** Remember the answer used for this analysis (the user saw it and ran with it). */
export function recordRoles(stats, senders, shopSet) {
  const out = { ...stats };
  for (const n of senders) { const s = { shop: 0, client: 0, ...out[n] }; s[shopSet.has(n) ? 'shop' : 'client']++; out[n] = s; }
  return out;
}
/** Older versions kept only a list of shop names: count each as already confirmed twice. */
export function seedStats(stats, shopNames = []) {
  const out = { ...stats };
  for (const n of shopNames) if (!out[n]) out[n] = { shop: ROLE_MIN, client: 0 };
  return out;
}
/** What the AI reads to decide who is who: a sample of each unknown sender's messages. */
export function rolesInput(msgs, names, { chat = '', known = [], history = {} } = {}) {
  const parts = [`اسم المحادثة: ${chat || '—'}`];
  if (known.length) parts.push('أسماء عُرف سابقًا أنها من المحل: ' + known.join('، '));
  for (const n of names) {
    const h = history[n];
    const mine = msgs.filter(m => m.sender === n && !m.sys);
    const pics = mine.filter(m => new RegExp(`\\.(${EXT})`, 'i').test(m.text)).length;
    const texts = mine.map(m => strip(m.text)).filter(Boolean);
    const sample = [...texts.slice(0, 6), ...texts.slice(-8)].filter((t, k, a) => a.indexOf(t) === k).map(t => '- ' + t.replace(/\n/g, ' ⏎ ').slice(0, 160));
    const past = h ? `، سابقًا: محل ×${h.shop || 0} وعميل ×${h.client || 0}` : '، اسم جديد';
    parts.push(`المرسل: ${n} (${mine.length} رسالة، ${pics} مرفق${past})\n${sample.join('\n') || '- (مرفقات فقط)'}`);
  }
  return parts.join('\n\n');
}

/**
 * Decide every sender's side for THIS chat. Names can change (the shop may write from a new name or number,
 * a name may now belong to someone else), so the AI judges every sender from what they write, every time;
 * your past answers are evidence, not a rule.
 *   - AI and history agree               -> decided
 *   - only one of them                   -> decided if the AI is confident (≥ 0.8) / history is clear
 *   - they disagree                      -> the clearer one wins, but you are asked to check (never silent)
 * Returns { shop: Set, why: Map, sure: boolean, changed: [{ name, was, now }] }.
 */
export function decideRoles(names, history, ai, { always = [] } = {}) {
  const shop = new Set(), why = new Map(), changed = [];
  let sure = true;
  for (const n of names) {
    if (always.includes(n)) { shop.add(n); why.set(n, 'صور ملصقة'); continue; }
    const h = roleFromHistory(history, n), a = ai?.get(n), conf = a ? clamp(a.confidence) : 0;
    let side;
    if (a && h && a.side === h) { side = h; why.set(n, `${a.why || ''} (ويوافق إجاباتك السابقة)`.trim()); }
    else if (a && h) {
      side = conf >= 0.9 ? a.side : h; sure = false;
      changed.push({ name: n, was: h, now: a.side });
      why.set(n, `كان ${h === 'shop' ? 'من المحل' : 'عميلًا'} سابقًا، والآن يبدو ${a.side === 'shop' ? 'من المحل' : 'عميلًا'}: ${a.why || ''}`);
    } else if (a) { side = a.side; if (conf < 0.8) sure = false; why.set(n, a.why || ''); }
    else if (h) { side = h; why.set(n, 'من إجاباتك السابقة'); }
    else { side = 'client'; sure = false; why.set(n, 'غير معروف'); }
    if (side === 'shop') shop.add(n);
  }
  return { shop, why, sure, changed };
}
