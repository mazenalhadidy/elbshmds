// The page: chat (zip / txt / pictures + copied messages) -> who is the shop -> the AI finds the last closing
// by meaning -> analysis -> final calculation -> review & teach.
// Logic lives in core.js; the prompts and rules live on the server (lib/ai.js).
import {
  esc, fmt, num, clamp, KIND, IMG, MEDIA, parse, strip, prep, applyAnswer, weak,
  dedupeRefs, totals, lines, imageInput, exampleLine, trainingText, pool,
  linkGroups, transactions, statementCheckpoints, statementCp, mergeCheckpoints, equation, reconcile, expression, expressionHtml,
} from './core.js';

const $ = s => document.querySelector(s);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const mime = f => ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', gif: 'image/gif' })[f.split('.').pop().toLowerCase()] || 'application/octet-stream';
const show = (el, on = true) => $(el).classList.toggle('hide', !on);

/* ===== state ===== */
const DEF = { shop: [], keywords: ['بدايتنا'], rules: [], learned: '', segs: [], selfChecked: 0 };
const KEEP = 39;                    // newest corrections sent as they are; older ones are merged into one summary
const IMG_AT_ONCE = 4, TEXT_AT_ONCE = 2, BATCH = 40;
let settings = structuredClone(DEF), examples = [], key = '';
let msgs = [], media = new Map(), shop = new Set(), cps = [], openIdx = -1, rows = [], filter = 'money', busy = false, chatName = '', stopped = false, spent = 0;
let cp = null, startIdx = -1;               // the chosen starting point; where the analysis starts (before it when checking a statement)
const imgCache = new Map();                 // message index -> the image answer (never pay twice for the same picture)
const PICS = 'صور';                         // sender name of pasted / picked pictures (counted as the shop; tap to change)
const has = f => media.has(f);

/* ===== server ===== */
const lsGet = k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };
class Unauthorized extends Error {}
async function api(path, opts = {}) {
  const res = await fetch(path, { ...opts, headers: { 'content-type': 'application/json', 'x-app-key': key, ...(opts.headers || {}) } });
  if (res.status === 401) throw new Unauthorized();
  let v; try { v = JSON.parse(await res.text()); } catch { throw new Error('رد غير مفهوم من الخادم'); }
  if (!res.ok || v.error) { const e = new Error(v.error || 'خطأ ' + res.status); e.code = v.code || res.status; throw e; }
  return v;
}
/** Ask the AI to do one task. tier: fast (default) or strong. Retries once (longer after rate limits). */
async function ai(task, input, { image = null, tier = 'fast', training = trainingText(settings, examples) } = {}) {
  for (let t = 0; ; t++) {
    try {
      const v = await api('/api/analyze', { method: 'POST', body: JSON.stringify({ task, tier, training, input, image }) });
      spent += v.cost || 0;
      return v.data;
    } catch (e) {
      if (e instanceof Unauthorized) { stopped = true; showLogin('تغيّرت كلمة المرور، سجّل الدخول مجددًا.'); throw e; }
      if (t > 0 || e.code === 400 || e.code === 422) throw e;
      await sleep(e.code === 429 || e.code === 529 ? 8000 : 1500);
    }
  }
}

/* ===== training storage (online, with a copy on this device) ===== */
let saving = Promise.resolve();
function persist(kind) {
  const body = kind === 'settings' ? settings : { list: examples };
  lsSet('wd_' + kind, body);
  saving = saving.then(() => api('/api/store?k=' + kind, { method: 'PUT', body: JSON.stringify(body) }))
    .then(() => { $('#store').textContent = 'محفوظ أونلاين.'; })
    .catch(() => { $('#store').textContent = 'محفوظ على هذا الجهاز فقط حتى يعود الاتصال.'; });
}
async function loadStore() {
  const [a, b] = await Promise.all([api('/api/store?k=settings'), api('/api/store?k=examples')]);
  const st = a.value || lsGet('wd_settings'), ex = (b.value || lsGet('wd_examples') || {}).list;
  if (st) settings = { ...DEF, ...st, keywords: st.keywords?.length ? [...st.keywords] : DEF.keywords };
  if (Array.isArray(ex)) examples = [...ex];
  $('#store').textContent = 'محفوظ أونلاين.';
  renderRules();
  setTimeout(mergeOld, 0);
}
function showLogin(msg) { show('#login'); $('#pwErr').textContent = msg || ''; show('#pwErr', !!msg); setTimeout(() => $('#pw').focus(), 50); }
$('#loginForm').addEventListener('submit', async e => {
  e.preventDefault(); key = $('#pw').value; show('#pwErr', false);
  try { await loadStore(); lsSet('wd_key', key); $('#pw').value = ''; show('#login', false); }
  catch (x) { $('#pwErr').textContent = x instanceof Unauthorized ? 'كلمة المرور خاطئة.' : 'الخادم غير متاح. تأكد من الاتصال بالإنترنت.'; show('#pwErr'); }
});
$('#logout').addEventListener('click', () => { try { localStorage.removeItem('wd_key'); } catch { /* ignore */ } key = ''; showLogin(); });

/* ===== 1. the file ===== */
$('#file').addEventListener('change', async e => {
  const f = e.target.files[0]; if (!f) return;
  show('#err', false); media = new Map();
  $('#fileLabel').textContent = 'جارٍ فتح ' + f.name + ' …';
  try {
    let txt;
    if (/\.zip$/i.test(f.name) || /zip/.test(f.type)) {
      if (!window.JSZip) throw new Error('لم تُحمَّل مكتبة فك الضغط. حاول مرة أخرى.');
      const zip = await window.JSZip.loadAsync(f);
      const ents = Object.values(zip.files).filter(z => !z.dir && !z.name.includes('__MACOSX'));
      const chat = ents.find(z => /(^|\/)_chat\.txt$/i.test(z.name)) || ents.find(z => /\.txt$/i.test(z.name));
      if (!chat) throw new Error('لا يوجد ملف محادثة (.txt) داخل الملف.');
      txt = await chat.async('string');
      for (const z of ents) { const b = z.name.split('/').pop(); if (MEDIA.test(b)) media.set(b.toLowerCase(), z); }
    } else txt = await f.text();
    msgs = parse(txt); imgCache.clear();
    if (!msgs.length) throw new Error('هذا ليس ملف تصدير من واتساب.');
    chatName = f.name.replace(/\.(zip|txt)$/i, '').replace(/^WhatsApp Chat( with| -)?\s*/i, '');
    $('#fileLabel').textContent = `${f.name} · ${msgs.length} رسالة · ${[...media.keys()].filter(k => IMG.test(k)).length} صورة`;
    rows = []; show('#sum', false); show('#step3', false);
    setup();
  } catch (x) { $('#err').textContent = x.message || 'تعذّرت قراءة الملف.'; show('#err'); $('#fileLabel').textContent = 'اختر ملف التصدير (.zip مع الوسائط)'; }
});

/* ===== 1b. or: pictures + copied messages (paste, pick, drop, or forward to the phone and pick) ===== */
let inbox = [];                              // picture files in chat order
const picExt = f => ({ 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' })[f.type] || 'jpg';
function addPics(files) {
  const imgs = [...files].filter(f => /^image\//.test(f.type));
  if (!imgs.length) return;
  inbox.push(...imgs);
  $('#thumbs').innerHTML = inbox.map(f => `<img src="${URL.createObjectURL(f)}" alt="">`).join('');
  $('#picsLabel').textContent = `${inbox.length} صورة · أضف أو الصق المزيد`;
  refreshPicsButtons();
}
function refreshPicsButtons() { const any = inbox.length || $('#pasteText').value.trim(); show('#usePics', !!any); show('#clearPics', !!any); }
// picked files: oldest first (screenshot time, then name: IMG_8517 before IMG_8518)
$('#pics').addEventListener('change', e => { addPics([...e.target.files].sort((a, b) => a.lastModified - b.lastModified || a.name.localeCompare(b.name, undefined, { numeric: true }))); e.target.value = ''; });
document.addEventListener('paste', e => { const f = [...(e.clipboardData?.files || [])]; if (f.length) { e.preventDefault(); addPics(f); } });
const drop = $('#picsDrop');
drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('drag'); });
drop.addEventListener('dragleave', () => drop.classList.remove('drag'));
drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('drag'); addPics(e.dataTransfer.files); });
$('#pasteText').addEventListener('input', refreshPicsButtons);
$('#clearPics').addEventListener('click', () => { inbox = []; $('#thumbs').innerHTML = ''; $('#pasteText').value = ''; $('#picsLabel').textContent = 'صور ولقطات شاشة (اختر، أو الصق، أو اسحب هنا)'; refreshPicsButtons(); });
/** Copied messages first (they carry names and times), then the pictures in the order added. */
$('#usePics').addEventListener('click', () => {
  show('#err', false);
  const txt = $('#pasteText').value.trim();
  let list = txt ? parse(txt) : [];
  if (txt && !list.length) list = txt.split(/\n+/).map(t => t.trim()).filter(Boolean).map(t => ({ sender: 'رسالة منسوخة', ts: '', text: t }));
  media = new Map(); imgCache.clear();
  inbox.forEach((f, k) => { const name = `pic-${k + 1}.${picExt(f)}`; media.set(name, { async: () => Promise.resolve(f) }); list.push({ sender: PICS, ts: 'صورة ' + (k + 1), text: name + ' (file attached)' }); });
  msgs = list.map((m, i) => ({ ...m, i }));
  if (!msgs.length) return;
  chatName = 'صور ورسائل'; rows = []; show('#sum', false); show('#step3', false);
  $('#fileLabel').textContent = `${msgs.length} رسالة (${inbox.length} صورة)`;
  setup();
});

/* ===== 2. who is the shop ===== */
function setup() {
  const cnt = new Map();
  for (const m of msgs) if (m.sender && !m.sys) cnt.set(m.sender, (cnt.get(m.sender) || 0) + 1);
  shop = new Set([...cnt.keys()].filter(s => settings.shop.includes(s) || s === PICS));
  $('#senders').innerHTML = [...cnt].sort((a, b) => b[1] - a[1]).map(([s, n]) => `<button class="chip" data-s="${esc(s)}" aria-pressed="${shop.has(s)}">${esc(s)}<small>${n}</small></button>`).join('');
  $('#openBox').innerHTML = ''; show('#openRow', false);
  show('#step2');
}
$('#senders').addEventListener('click', e => {
  const b = e.target.closest('[data-s]'); if (!b) return; const s = b.dataset.s;
  if (shop.has(s)) { shop.delete(s); settings.shop = settings.shop.filter(x => x !== s); } else { shop.add(s); if (!settings.shop.includes(s) && s !== PICS) settings.shop.push(s); }
  b.setAttribute('aria-pressed', shop.has(s)); persist('settings');
});

/* ===== understanding the chat: where was the account last closed? =====
   No fixed word. The AI reads the end of the chat (texts + what the pictures show) like an accountant:
   a calculator total, «الحساب كده»، a day-end balance, an agreed number… = the account closed there, and the
   next day starts from that balance. If the end of the chat has no closing, it reads further back. */
const WINDOW = 150, MAX_BACK = 900;
let allRows = [], analyzedFrom = 0;

/** Closings the AI sees in rows[from..], merged with typed/pictured calculator statements. */
async function findClosings(from) {
  const part = allRows.slice(from);
  const typed = statementCheckpoints(part.map(r => msgs[r.i]));
  const pics = part.filter(r => r.calc?.terms?.length >= 2).map(r => statementCp(r.i, { terms: r.calc.terms, total: r.calc.total }));
  let found = [];
  try {
    const v = await ai('closings', lines(part));
    found = (v?.closings || []).map(c => ({ i: Number(c.i), amount: Math.abs(num(c.balance) ?? NaN), dir: num(c.balance) < 0 ? 'shop_owes' : 'client_owes', conf: clamp(c.confidence), why: String(c.why || ''), kind: c.kind }))
      .filter(c => allRows[c.i] && c.i >= from && Number.isFinite(c.amount) && c.conf >= 0.6);
  } catch { /* typed / pictured statements still work */ }
  // a closing on the result picture right after its statement = the statement
  found = found.map(c => {
    const st = pics.find(p => p.i <= c.i && c.i - p.i <= 3 && Math.abs(p.stated - c.amount * (c.dir === 'shop_owes' ? -1 : 1)) < 1);
    return st ? { ...st, why: c.why || st.why } : c;                  // keep the AI's reason
  });
  return mergeCheckpoints(found, typed, pics);
}
/** Make sure every row from `from` to the end is analyzed (pictures cached, nothing paid twice). */
async function analyzeFrom(from, onStep) {
  if (allRows.slice(from).every(r => r.state !== 'pending')) { analyzedFrom = Math.min(analyzedFrom, from); return; }
  await runAnalysis(allRows.slice(from), onStep);
  analyzedFrom = Math.min(analyzedFrom, from);
}
async function understand(onStep) {
  let from = Math.max(0, msgs.length - WINDOW);
  for (;;) {
    $('#progText').textContent = `جارٍ فهم آخر ${msgs.length - from} رسالة…`;
    await analyzeFrom(from, onStep);
    cps = await findClosings(from);
    const last = cps[cps.length - 1];
    const enough = last && (!last.terms || cps.length > 1);   // a statement is checked against what came before it
    if (enough || from === 0 || msgs.length - from >= MAX_BACK || stopped) return from;
    from = Math.max(0, from - WINDOW);
  }
}
function showOpening() {
  const box = $('#openBox'); show('#openRow');
  if (!cp) {
    box.innerHTML = `<p class="warnbox">لم أجد إقفالًا للحساب${analyzedFrom > 0 ? ` في آخر ${msgs.length - analyzedFrom} رسالة` : ''}، لذا أحسب من ${analyzedFrom > 0 ? 'هناك' : 'أول المحادثة'}. اكتب الرصيد إن كنت تعرفه.</p>`; return;
  }
  const k = cps.indexOf(cp), m = msgs[cp.i];
  const opts = cps.map((x, j) => `<option value="${j}" ${j === k ? 'selected' : ''}>${esc(msgs[x.i].ts)} · ${fmt(x.amount)}</option>`).reverse().join('');
  box.innerHTML = `<p class="note">بدأتُ من آخر إقفال للحساب · ${esc(m.sender || '')} · ${esc(m.ts)}</p><div class="quote${cp.terms ? ' expr' : ''}"${cp.terms ? ' dir="ltr"' : ''}>${cp.terms ? expressionHtml(cp.terms, cp.stated) : esc(cpText(cp))}</div>
  <p class="note">${esc(cp.why)}</p>
  ${cps.length > 1 ? `<label class="note" for="cpSel">ليس هذا؟ اختر غيره:</label><select id="cpSel">${opts}</select>` : ''}`;
}
const cpText = c => (c.terms ? expression(c.terms) + '\n=' + fmt(c.stated) : strip(msgs[c.i].text) || '[صورة]');

/** Use closing k as the start: its balance opens the new account; a statement is also checked. */
async function useStart(k) {
  cp = cps[k] || null; openIdx = cp ? cp.i : analyzedFrom - 1;
  $('#openAmt').value = cp ? cp.amount : 0; $('#openDir').value = cp?.dir === 'shop_owes' ? '-1' : '1';
  startIdx = cp?.terms ? Math.max(analyzedFrom - 1, ...cps.filter(c => c.i < cp.i).map(c => c.i)) : openIdx;
  if (startIdx + 1 < analyzedFrom) await analyzeFrom(startIdx + 1);
  rows = allRows.slice(startIdx + 1);
  for (const r of allRows) delete r.start;
  for (const r of rows) if (cps.some(c => c.i === r.i) && r.i >= openIdx) { r.start = true; r.kind = 'ignore'; }
  showOpening(); render();
}
$('#openBox').addEventListener('change', async e => { if (e.target.id === 'cpSel' && !busy) { busy = true; await useStart(Number(e.target.value)); busy = false; } });
const openVal = () => (num($('#openAmt').value) || 0) * Number($('#openDir').value);
$('#openAmt').addEventListener('change', () => rows.length && render());
$('#openDir').addEventListener('change', () => rows.length && render());

/* ===== 3. analysis ===== */
async function shrink(blob) {                       // max 1600 px JPEG: smaller upload, fewer image tokens, same reading
  try {
    const url = URL.createObjectURL(blob);
    const img = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = url; });
    const s = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
    return await new Promise(r => c.toBlob(b => r(b || blob), 'image/jpeg', 0.85));
  } catch { return blob; }
}
const toB64 = blob => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.onerror = rej; fr.readAsDataURL(blob); });
const fail = (r, e) => { r.state = 'error'; r.kind = 'ignore'; r.flag = true; r.why = 'خطأ' + (e?.message ? ': ' + e.message : '') + '. اضغط «أعِد».'; r.ai = { kind: 'ignore', amount: null }; };

async function loadBlob(r) {
  if (!r.blob) { const b = await media.get(r.file.toLowerCase()).async('blob'); r.blob = new Blob([b], { type: mime(r.file) }); r.url = URL.createObjectURL(r.blob); }
}
/** The AI's answer for a picture (cached by message). A weak answer is checked again by the strong model. */
async function analyzeImage(r, list, training) {
  if (imgCache.has(r.i)) return imgCache.get(r.i);
  await loadBlob(r);
  const image = await toB64(await shrink(r.blob)), input = imageInput(r, list);
  let v = await ai('image', input, { image, training });
  if (weak(v) && !(v?.calc?.terms?.length)) { try { const v2 = await ai('image', input, { image, training, tier: 'strong' }); if (v2) v = { ...v2, esc: true }; } catch { /* keep the first answer */ } }
  imgCache.set(r.i, v);
  return v;
}
async function doImage(r, list, training) {
  try {
    await loadBlob(r);
    const v = await analyzeImage(r, list, training);
    applyAnswer(r, v); r.esc = !!v.esc;
    if (v.is_transfer === false) { r.kind = 'ignore'; r.ai.kind = 'ignore'; }
    r.summary = String(v.summary || ''); r.ref = String(v.ref || '').replace(/\s/g, ''); r.app = String(v.app || '');
    if (v.unclear) r.flag = true;
    if (v.calc) {                            // calculator: a statement or just its result, never a new transfer
      r.calc = { terms: (v.calc.terms || []).map(Number), total: num(v.calc.total) ?? (v.calc.terms || []).reduce((x, y) => x + Number(y), 0) };
      r.kind = 'ignore'; r.ai.kind = 'ignore'; r.flag = false; r.amount = null;
      r.why = v.calc.terms?.length >= 2 ? `كشف حساب: ${expression(v.calc.terms.map(Number))} = ${fmt(num(v.calc.total) ?? 0)}` : 'ناتج الآلة الحاسبة';
    }
  } catch (e) { fail(r, e); }
}
async function doText(batch, list, training) {
  if (!batch.length) return;
  const a = list.indexOf(batch[0]), b = list.indexOf(batch[batch.length - 1]);
  try {
    const v = await ai('text', lines(list.slice(a, b + 1)), { training });
    const by = new Map(batch.map(r => [r.i, r]));
    for (const it of v?.items || []) {
      const r = by.get(Number(it.i)); if (!r) continue;
      applyAnswer(r, it);
      r.of = Array.isArray(it.of) ? it.of.map(Number).filter(j => j !== r.i) : [];
      if (it.dup_of != null && r.kind !== 'ignore') { r.why += ` (مكررة مع #${it.dup_of})`; r.kind = 'ignore'; r.ai.kind = 'ignore'; }
      by.delete(r.i);
    }
    for (const r of by.values()) { r.state = 'done'; r.flag = true; r.why = 'لم يصل رد لهذه الرسالة، فراجعها.'; }
  } catch (e) { batch.forEach(r => fail(r, e)); }
}
/** Images first (several at once), then the text in batches (they see the image results to avoid double counting). */
async function runAnalysis(list, onStep = () => {}) {
  const training = trainingText(settings, examples);      // the same text for every call -> served from the prompt cache
  const imgs = list.filter(r => r.img && r.state === 'pending'), texts = list.filter(r => r.state === 'pending' && !r.img);
  const batches = []; for (let k = 0; k < texts.length; k += BATCH) batches.push(texts.slice(k, k + BATCH));
  const steps = imgs.length + batches.length;
  await pool(imgs, IMG_AT_ONCE, async r => { await doImage(r, list, training); onStep(steps); }, () => stopped);
  await pool(batches, TEXT_AT_ONCE, async b => { await doText(b, list, training); onStep(steps); }, () => stopped);
  dedupeRefs(list);
  linkGroups(list);
}
$('#go').addEventListener('click', async () => {
  if (busy) return;
  if (!shop.size) { $('#aiNote').textContent = 'اختر اسم المحل أولًا.'; show('#aiNote'); return; }
  show('#aiNote', false); busy = true; stopped = false; spent = 0; $('#go').disabled = true;
  allRows = msgs.map(m => prep(m, { shop, has })); analyzedFrom = msgs.length; cps = []; cp = null; rows = [];
  show('#sum'); show('#step3');
  let done = 0;
  const step = () => { done++; $('#prog').style.width = Math.min(95, 100 * done / Math.max(1, allRows.filter(r => r.state === 'pending').length / 20 + done)) + '%'; renderSoon(); };
  const from = await understand(step);
  if (!stopped) await useStart(cps.length - 1);
  $('#prog').style.width = '100%';
  $('#progText').textContent = stopped ? 'توقّف التحليل. سجّل الدخول واضغط «حلّل».' : `انتهى · قرأتُ ${msgs.length - Math.min(from, analyzedFrom)} رسالة · ≈ $${spent.toFixed(3)}`;
  busy = false; $('#go').disabled = false; render();
  if (!stopped) learnFromHistory();
});

/* ===== self-learning from old periods (background) =====
   Between two starting points the answer is known: next start = previous start + sent − received.
   If my reading of that period disagrees, the strong model looks for what I misread and saves lessons. */
const BG_SEGMENTS = 2, BG_MAX_IMAGES = 40;
let bgBusy = false;
const signed = c => c.amount * (c.dir === 'shop_owes' ? -1 : 1);
async function learnFromHistory() {
  if (bgBusy || cps.length < 2) return; bgBusy = true;
  try {
    const done = new Set(settings.segs || []), segs = [];
    for (let k = cps.length - 1; k > 0 && segs.length < BG_SEGMENTS; k--) {
      const a = cps[k - 1], b = cps[k], sig = `${chatName}|${msgs[a.i].ts}|${msgs[b.i].ts}|${a.amount}|${b.amount}`;
      if (done.has(sig)) continue;
      const list = allRows.slice(a.i + 1, b.i);
      if (list.filter(r => r.img).length > BG_MAX_IMAGES) { done.add(sig); continue; }
      segs.push({ a, b, sig, list });
    }
    for (const g of segs) {
      if (stopped) break;
      await runAnalysis(g.list);
      const calcd = totals(g.list, signed(g.a)).debt, actual = signed(g.b);
      if (Math.abs(actual - calcd) >= 1) {
        const detail = g.list.filter(x => !x.sys).map(x => `#${x.i} | ${x.side === 'shop' ? 'المحل' : 'العميل'} | ${x.img ? '[صورة: ' + (x.summary || '') + ']' : (x.text || '').replace(/\n/g, ' ').slice(0, 200)} | فهمتُها: ${KIND[x.kind]} ${x.amount ?? ''} | ${x.why}`).join('\n');
        const input = `البداية (#${g.a.i}): "${strip(msgs[g.a.i].text).slice(0, 200)}" = ${signed(g.a)}\nالبداية التالية (#${g.b.i}): "${strip(msgs[g.b.i].text).slice(0, 200)}" = ${actual}\nحسابي: ${calcd} (الفرق ${actual - calcd})\n${detail}`;
        try {
          const v = await ai('lessons', input, { tier: 'strong' });
          const ls = (v?.lessons || []).map(x => String(x).trim()).filter(Boolean).slice(0, 3);
          if (ls.length && clamp(v.confidence) >= 0.6) { for (const l of ls) examples.push({ at: Date.now(), auto: true, content: l }); persist('examples'); }
        } catch { /* try again next time */ }
      }
      done.add(g.sig); settings.segs = [...done].slice(-300); settings.selfChecked = (settings.selfChecked || 0) + 1;
      persist('settings'); renderRules();
    }
    await mergeOld();
  } catch { /* background only */ }
  bgBusy = false;
}

/* ===== merging old corrections into one summary ===== */
let merging = false;
async function mergeOld() {
  const act = examples.filter(e => !e.merged);
  if (merging || act.length <= KEEP) return;
  merging = true; $('#exN').textContent = 'جارٍ دمج التصحيحات القديمة…';
  const old = act.slice(0, act.length - KEEP);
  try {
    const v = await ai('merge', `الخلاصة الحالية:\n${settings.learned || '(فارغة)'}\n\nتصحيحات جديدة:\n${old.map(exampleLine).join('\n')}`, { tier: 'strong', training: '' });
    const sum = String(v?.summary || '').trim();
    if (sum) { settings.learned = sum; old.forEach(e => { e.merged = true; }); persist('settings'); persist('examples'); }
  } catch { /* next time */ }
  merging = false; renderRules();
}

/* ===== results ===== */
let raf = 0; const renderSoon = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(); }); };
/** The final calculation (as the shop writes it) and, for a statement, how it matches the chat. */
function finalCalc() {
  const after = transactions(rows, { after: openIdx });
  if (!cp?.terms) return { eq: equation(openVal(), after) };
  const rec = reconcile({ terms: cp.terms, total: cp.stated }, transactions(rows, { before: openIdx }), { midway: startIdx < 0 });
  return { rec, eq: after.length ? equation(openVal(), after) : rec.eq };
}
function renderCheck(rec) {
  if (!rec) return '';
  const ok = rec.items.filter(x => x.status === 'ok').length, miss = rec.items.filter(x => x.status === 'missing');
  const out = [`الكشف: وجدتُ ${ok} من ${rec.items.length} بندًا في المحادثة ✓`];
  out.push(`وُجدت في المحادثة: ${rec.items.filter(x => x.status === 'ok').map(x => fmt(x.amount)).join('، ') || '—'}`);
  if (rec.before.length) out.push(`منقولة من الآلة الحاسبة، وهي قبل بداية المحادثة (ليست خطأ): ${rec.before.map(fmt).join('، ')}`);
  if (miss.length) out.push(`⚠️ في الكشف وليست في المحادثة: ${miss.map(x => fmt(x.amount)).join('، ')}`);
  if (rec.extra.length) out.push(`⚠️ في المحادثة وليست في الكشف: ${rec.extra.map(x => fmt(x.amount)).join('، ')}`);
  if (!rec.arithmeticOk) out.push('⚠️ جمع الكشف نفسه خاطئ');
  out.push(rec.matches ? `✓ الناتج ${fmt(rec.stated)} صحيح` : `⚠️ حسابي ${fmt(rec.eq.total)} والكشف ${fmt(rec.stated)} (الفرق ${fmt(rec.eq.total - rec.stated)})`);
  return out.join('\n');
}
function render() {
  const c = totals(rows, openVal(), openIdx), fc = finalCalc();
  $('#eq').innerHTML = expressionHtml(fc.eq.terms, fc.eq.total); $('#eqTotal').textContent = fmt(fc.eq.total);
  $('#check').textContent = renderCheck(fc.rec); show('#check', !!fc.rec);
  const tag = new Map();
  if (fc.rec) { for (const it of fc.rec.items) for (const i of it.found || []) tag.set(i, '✓ في الكشف'); for (const x of fc.rec.extra) tag.set(x.i, '⚠️ ليست في الكشف'); }
  for (const r of rows) r.tag = tag.get(r.i) || (r.partOf != null ? `ضمن #${r.partOf}` : '');
  $('#debt').textContent = fmt(Math.abs(c.debt)) + ' ج.م';
  $('#debtLabel').textContent = c.debt >= 0 ? 'على العميل' : 'للعميل عندنا';
  $('#sOpen').textContent = fmt(openVal()); $('#sSent').textContent = fmt(c.s); $('#sRec').textContent = fmt(c.rc);
  $('#revN').textContent = c.rev || '';
  const needs = r => (r.flag && !r.ok) || r.state === 'error';
  const vis = rows.filter(r => !r.sys && !r.start && (filter === 'all' || (filter === 'review' ? needs(r) : r.kind !== 'ignore' || needs(r) || r.dirty || r.state !== 'done')));
  $('#list').innerHTML = vis.length ? vis.map(r => card(r, c.bal.get(r.i))).join('') : `<p class="note">${filter === 'review' ? 'لا شيء يحتاج إلى مراجعة.' : 'لا توجد معاملات بعد.'}</p>`;
}
function card(r, bal) {
  const pend = r.state === 'pending';
  const seg = ['sent', 'received', 'ignore'].map(k => `<button data-k="${k}" aria-pressed="${r.kind === k}" ${pend ? 'disabled' : ''}>${KIND[k]}</button>`).join('');
  const meta = !pend && r.state === 'done' ? `<em>· ${Math.round(r.conf * 100)}%${r.esc ? ' · بنموذج أقوى' : ''}${r.app ? ' · ' + esc(r.app) : ''}${r.learned ? ' · حُفظ' : ''}</em>` : '';
  return `<article class="row ${r.flag && !r.ok ? 'flag' : ''}" data-i="${r.i}">
<header><span class="who ${r.side}">${r.side === 'shop' ? 'المحل' : 'العميل'} · ${esc(r.sender)}</span><time>${esc(r.ts)}</time></header>
${r.url ? `<button class="thumb" data-act="zoom" aria-label="كبّر"><img src="${r.url}" alt="صورة"></button>` : r.img ? '<p class="note">صورة…</p>' : ''}
${r.text ? `<p class="msg">${esc(r.text)}</p>` : ''}
<div class="ai">${pend ? 'جارٍ التحليل…' : esc(r.why) || '—'} ${meta}</div>
<div class="ctl"><div class="seg">${seg}</div><input class="amt" inputmode="decimal" value="${r.amount ?? ''}" placeholder="المبلغ" aria-label="المبلغ" ${pend ? 'disabled' : ''}></div>
${r.tag ? `<div class="bal">${esc(r.tag)}</div>` : ''}${r.state === 'done' && r.i > openIdx && r.partOf == null ? `<div class="bal">الرصيد بعدها: ${fmt(Math.abs(bal ?? 0))} ${(bal ?? 0) >= 0 ? 'على العميل' : 'للعميل'}</div>` : ''}
${r.dirty ? '<div class="fix"><input class="why" placeholder="السبب (اختياري)"><button data-act="learn">احفظ التصحيح</button></div>' : ''}
<div class="acts">${r.flag && !r.ok && !r.dirty && !pend ? '<button class="ghost" data-act="ok">صح ✓</button>' : ''}${r.state === 'error' ? '<button class="ghost" data-act="retry">أعِد</button>' : ''}</div>
</article>`;
}
const rowOf = el => { const a = el.closest('[data-i]'); return a && rows.find(r => r.i === Number(a.dataset.i)); };
$('#list').addEventListener('click', async e => {
  const r = rowOf(e.target); if (!r) return;
  const k = e.target.closest('[data-k]');
  if (k) { if (r.kind !== k.dataset.k) { r.kind = k.dataset.k; r.dirty = true; } render(); return; }
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'zoom') { $('#zoom img').src = r.url; $('#zoom').style.display = 'flex'; }
  if (act === 'ok') { r.ok = true; render(); }
  if (act === 'learn') {
    const note = e.target.closest('article').querySelector('.why')?.value.trim() || '';
    examples.push({ at: Date.now(), side: r.side, content: r.img ? 'صورة: ' + (r.summary || 'إيصال') + (r.text ? ' | تعليق: ' + r.text.slice(0, 120) : '') : (r.text || '').slice(0, 200), ai: r.ai, fix: { kind: r.kind, amount: r.amount }, note });
    persist('examples'); r.dirty = false; r.ok = true; r.learned = true; renderRules(); render(); mergeOld();
  }
  if (act === 'retry' && !busy) {
    r.state = 'pending'; render();
    const training = trainingText(settings, examples);
    if (r.img) await doImage(r, rows, training); else await doText([r], rows, training);
    render();
  }
});
$('#list').addEventListener('change', e => {
  if (!e.target.classList.contains('amt')) return; const r = rowOf(e.target); if (!r) return;
  const v = num(e.target.value); if (v !== r.amount) { r.amount = v; r.dirty = true; } render();
});
$('#filters').addEventListener('click', e => {
  const b = e.target.closest('[data-f]'); if (!b) return; filter = b.dataset.f;
  document.querySelectorAll('#filters [data-f]').forEach(x => x.setAttribute('aria-pressed', x === b)); render();
});
$('#zoom').addEventListener('click', () => { $('#zoom').style.display = 'none'; });
$('#copy').addEventListener('click', async () => {
  const fc = finalCalc();
  try { await navigator.clipboard.writeText(fc.eq.text); $('#copy').textContent = 'تم النسخ ✓'; } catch { $('#copy').textContent = 'النسخ غير متاح'; }
  setTimeout(() => { $('#copy').textContent = 'انسخ الحساب'; }, 2000);
});

/* ===== teaching: rules, summary, keywords ===== */
function renderRules() {
  $('#rules').innerHTML = settings.rules.map((x, k) => `<li><span>${esc(x)}</span><button class="ghost" data-del="${k}" aria-label="احذف">حذف</button></li>`).join('');
  const act = examples.filter(e => !e.merged).length;
  $('#exN').textContent = [examples.length ? `${examples.length} تصحيحًا (${examples.length - act} منها في الخلاصة)` : 'لا توجد تصحيحات بعد', settings.selfChecked ? `راجعتُ ${settings.selfChecked} فترة تلقائيًا` : ''].filter(Boolean).join(' · ');
  $('#learned').value = settings.learned; show('#learnedBox', !!settings.learned);
  $('#kw').value = settings.keywords.join('، ');
}
$('#ruleAdd').addEventListener('click', () => { const v = $('#ruleIn').value.trim(); if (!v) return; settings.rules.push(v); $('#ruleIn').value = ''; persist('settings'); renderRules(); });
$('#rules').addEventListener('click', e => { const b = e.target.closest('[data-del]'); if (!b) return; settings.rules.splice(Number(b.dataset.del), 1); persist('settings'); renderRules(); });
$('#learned').addEventListener('change', () => { settings.learned = $('#learned').value.trim(); persist('settings'); renderRules(); });
$('#kw').addEventListener('change', () => {
  const v = $('#kw').value.split(/[،,]/).map(s => s.trim()).filter(Boolean);
  settings.keywords = v.length ? v : DEF.keywords; persist('settings'); renderRules();
});

/* ===== start ===== */
renderRules();
key = lsGet('wd_key') || '';
if (!key) showLogin();
else loadStore().catch(e => { if (e instanceof Unauthorized) showLogin('تغيّرت كلمة المرور، سجّل الدخول مجددًا.'); else $('#store').textContent = 'الخادم غير متاح الآن.'; });
