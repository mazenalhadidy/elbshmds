/* =====================================================================
   Money helpers shared by the server and the browser.
   - Numbers are SHOWN with Egyptian Arabic (Hindi) digits: ١٬٢٣٤٫٥
   - Numbers can be TYPED with either ٠-٩ or 0-9 (and ٬ , as thousands separators).
   - The calculator text ("746\n+9472\n-100") is evaluated here.
   ===================================================================== */

/** Round to 2 decimals (avoids 0.1 + 0.2 = 0.30000000000000004). */
export const r2 = x => Math.round((Number(x) + Number.EPSILON) * 100) / 100;

const AR = '٠١٢٣٤٥٦٧٨٩';   // Arabic-Indic digits (Egypt)
const FA = '۰۱۲۳۴۵۶۷۸۹';   // Persian digits (some keyboards type these)

/** "٣٤٥" -> "345". Leaves other characters as they are. */
export function toLatinDigits(s) {
  return String(s ?? '')
    .replace(/[٠-٩]/g, d => String(AR.indexOf(d)))
    .replace(/[۰-۹]/g, d => String(FA.indexOf(d)));
}

/** "345" -> "٣٤٥" (only the digits). */
export function toArabicDigits(s) {
  return String(s ?? '').replace(/[0-9]/g, d => AR[d]);
}

/** Clean typed text into a plain number string: digits, one '.', optional leading '-'. */
function cleanNumberText(v) {
  return toLatinDigits(v)
    .replace(/[٬,\s‏‎؜]/g, '')   // thousands separators and invisible direction marks
    .replace(/٫/g, '.')                         // Arabic decimal point
    .replace(/[−–]/g, '-');                     // other kinds of minus sign
}

/** Parse what the user typed into a number. Returns NaN when it is not a valid number. */
export function parseAmount(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  const s = cleanNumberText(v);
  if (s === '' || s === '-' || s === '.') return NaN;
  if (!/^-?\d*\.?\d+$|^-?\d+\.$/.test(s)) return NaN;
  return Number(s);
}

const NF = new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 2 });
/** 2420000 -> "٢٬٤٢٠٬٠٠٠" */
export const fmt = n => NF.format(r2(Number(n) || 0));
/** Same as fmt but keeps an explicit + for positive numbers (used for changes like "+٥٠٠"). */
export const fmtSigned = n => (r2(n) > 0 ? '+' : '') + fmt(n);

/* ---------------------------------------------------------------------
   Calculator text. Each line is a term; a line may start with + or -.
   The first line without a sign counts as +.  Example:
       746
       +9472
       -100        -> 10118
   Returns NaN when the text has something that is not a number/sign.
   --------------------------------------------------------------------- */
export function calcTerms(text) {
  const terms = [];
  for (const raw of String(text ?? '').split('\n')) {
    const line = cleanNumberText(raw);               // also removes spaces
    if (!line || line === '+' || line === '-') continue;   // a sign typed before its number counts as nothing
    // a line may hold one or more terms: "+5", "-5", "5", "5+3-2"
    const re = /([+-]?)(\d+(?:\.\d+)?|\.\d+)/g;
    if (line.replace(re, '') !== '') return null;    // something that is not a number or a sign
    let m;
    while ((m = re.exec(line))) terms.push({ sign: m[1] === '-' ? -1 : 1, value: Number(m[2]) });
  }
  return terms;
}
export function evalCalc(text) {
  if (!text || !String(text).trim()) return 0;
  const t = calcTerms(text);
  if (!t) return NaN;
  return r2(t.reduce((a, x) => a + x.sign * x.value, 0));
}

/** The same calculation seen from the other side (every term's sign flipped): "500\n-200" -> "-500\n+200". */
export function negateCalc(text) {
  const t = calcTerms(text);
  if (!t || !t.length) return String(text ?? '').trim() ? String(text) : '';
  return t.map((x, k) => (x.sign > 0 ? (x.value === 0 && k === 0 ? '' : '-') : (k === 0 ? '' : '+')) + x.value).join('\n');
}

/** "2026-11-12" -> "١٢ نوفمبر ٢٠٢٦" */
/** "الاثنين" for "2026-11-16". */
export const fmtWeekday = d => (d ? new Date(d + 'T00:00:00Z').toLocaleDateString('ar-EG', { weekday: 'long', timeZone: 'UTC' }) : '');
export const fmtDate = d => (d ? new Date(d + 'T00:00:00Z').toLocaleDateString('ar-EG', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : '');
