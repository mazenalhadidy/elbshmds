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
const DELETED = /This message was deleted|You deleted this message|تم حذف هذه الرسالة|لقد حذفت هذه الرسالة/;
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
  .replace(OMIT, '').trim();

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
    if (k) { const a = amountAfter(m.text, k); if (a != null) out.push({ i: m.i, amount: a, dir: 'client_owes', conf: 1, why: 'فيها «' + k + '»' }); }
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
    if (a.missing) return done('المرفق مش في الملف. صدّر مع «إرفاق الوسائط».', true);
    if (IMG.test(a.file)) r.img = true;
    else if (VOICE.test(a.file)) return done('رسالة صوتية: اسمعها وعدّل لو فيها مبلغ.', true);
    else return done('مرفق مش صورة.');
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
    if (seen.has(r.ref)) { r.kind = 'ignore'; r.why += ` (نفس رقم العملية في #${seen.get(r.ref)})`; }
    else seen.set(r.ref, r.i);
  }
}

/** Totals + the running balance after each row. `opening` is signed (+ = client owes). */
export function totals(rows, opening) {
  let s = 0, rc = 0, rev = 0, ns = 0, nr = 0, run = opening; const bal = new Map();
  for (const r of rows) {
    if (r.state !== 'done') continue;
    if (r.flag && !r.ok) rev++;
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
  ? `#${x.i} | ${x.ts} | ${label(x)} | [صورة: ${x.state === 'done' ? KIND[x.kind] + ' ' + (x.amount ?? '') + ' — ' + (x.summary || '') : '؟'}]`
  : `#${x.i} | ${x.ts} | ${label(x)} | ${(x.text || '').replace(/\n/g, ' ⏎ ').slice(0, 400)}`).join('\n');
/** 3 messages before and after a row (context for an image). */
export function around(r, list) {
  const k = list.indexOf(r);
  return list.slice(Math.max(0, k - 3), k).concat(list.slice(k + 1, k + 4)).filter(x => !x.sys)
    .map(x => `- ${label(x)}: ${x.img ? '[صورة]' : (x.text || '').slice(0, 140)}`).join('\n') || 'لا يوجد';
}
export const imageInput = (r, list) => `من ${label(r)} الساعة ${r.ts}. ${r.text ? 'التعليق: ' + r.text : 'بدون تعليق.'}\nحواليها:\n${around(r, list)}`;

/** One correction as a line of training. */
export const exampleLine = e => e.auto ? `- درس: ${e.content}`
  : `- ${e.side === 'shop' ? 'من المحل' : 'من العميل'} | ${e.content} | فهمتها: ${KIND[e.ai?.kind] || '?'} ${e.ai?.amount ?? ''} | الصح: ${KIND[e.fix.kind]} ${e.fix.amount ?? ''}${e.note ? ' | السبب: ' + e.note : ''}`;

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
