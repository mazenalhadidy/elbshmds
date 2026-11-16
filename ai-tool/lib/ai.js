// =====================================================================
// The only code that talks to Claude (used by the Netlify edge function AND the local server).
// - The page sends a TASK name + its data; the prompt, rules and output shape live here
//   (the endpoint is not an open relay to Claude).
// - Rules + the owner's training go in `system` with a cache breakpoint: during one analysis
//   every image / batch re-uses them from the cache (~90% cheaper input, faster).
// - Answers are JSON constrained by a schema (structured outputs): no parsing guesswork.
// =====================================================================
import Anthropic from '@anthropic-ai/sdk';

export const MODELS = { fast: 'claude-haiku-5-5', strong: 'claude-sonnet-5-5' };
export const EFFORT = { fast: 'low', strong: 'medium' };          // reading receipts is quick work: low thinking on the fast model

// $ per 1M tokens: [input, output, cache read, cache write (5 min)] — used for the cost shown after each analysis
const PRICE = { 'claude-haiku-5-5': [0.10, 0.50, 0.01, 0.125], 'claude-sonnet-5-5': [2, 10, 0.10, 2.5] };

export const RULES = `محاسب لمحل موبايلات مصري (محل الباشمهندس). بتقرأ محادثة واتساب بين المحل وعميل وتحسب دين العميل.
- الدين = اللي على العميل للمحل (موجب = العميل مدين).
- sent: المحل حوّل/بعت/شحن للعميل ← الدين يزيد.
- received: العميل دفع/حوّل للمحل ← الدين يقل.
- ignore: كلام، سؤال، طلب ("ابعتلي ٥٠٠")، تأكيد وصول، أو عملية اتحسبت قبل كده.
قواعد:
1. إيصال من طرف المحل = sent، ومن العميل = received، إلا لو الصورة تثبت العكس.
2. نفس العملية نص + صورة (نفس المبلغ في وقت قريب) تتحسب مرة واحدة.
3. من الإيصال خُد مبلغ التحويل بس: مش الرصيد ولا الرسوم ولا رقم العملية أو الموبايل.
4. "ألف" = ×١٠٠٠، و"ك" بعد الرقم = ×١٠٠٠. الأرقام ممكن تكون عربية.
5. مش متأكد؟ قلّل confidence وما تخترعش رقم.
6. why: جملة قصيرة بالعامية: شفت إيه وليه.
7. «تم تحويل X جنيه لرقم ... مصاريف الخدمة ١ جنيه» (فودافون كاش، شاشة موبايل أو نوكيا أو «الدفع تم بنجاح») = إيصال بمبلغ X.
8. المبلغ ممكن يتبعت على كذا إيصال وبعدين المحل يكتب «تم ٥٠٠٠٠ فلان» أو يرد «تم» على طلب العميل («39930» أو «40» يعني ٤٠٬٠٠٠). دي عملية واحدة بالمجموع: الرسالة دي تاخد المجموع، وof = أرقام الإيصالات اللي جواها. ما تحسبش الإيصالات تاني.
9. الرسائل المعاد توجيهها من المحل = من المحل. «صور» = صور ملصوقة من غير مرسل معروف: الافتراضي المحل، إلا لو الصورة بتقول غير كده.
10. آلة حاسبة «أ+ب+…−ج=الناتج» = كشف حساب المحل: أول رقم = الرصيد اللي قبله، الموجب = اتبعت للعميل، السالب = اتدفع، والناتج = الرصيد الجديد. مش عملية جديدة (ignore).`;

/* ---------- output shapes ---------- */
const KIND = { type: 'string', enum: ['sent', 'received', 'ignore'] };
const NUM_OR_NULL = { anyOf: [{ type: 'number' }, { type: 'null' }] };
const INT_OR_NULL = { anyOf: [{ type: 'integer' }, { type: 'null' }] };
const obj = (properties) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });

export const TASKS = {
  image: {
    instruction: 'حلّل الصورة. لو آلة حاسبة: calc.terms = كل الأرقام بإشاراتها بالترتيب (اقرا الأرقام المكسورة على سطرين كرقم واحد)، وcalc.total = الناتج أو null. لو مش آلة حاسبة: calc = null.',
    maxTokens: 4096,
    schema: obj({ is_transfer: { type: 'boolean' }, kind: KIND, amount: NUM_OR_NULL, confidence: { type: 'number' }, unclear: { type: 'boolean' },
      app: { type: 'string' }, ref: { type: 'string' }, summary: { type: 'string' }, why: { type: 'string' },
      calc: { anyOf: [{ type: 'null' }, obj({ terms: { type: 'array', items: { type: 'number' } }, total: NUM_OR_NULL })] } }),
  },
  text: {
    instruction: 'صنّف كل رسالة نصية. الصور متحللة ومكتوبة للاستئناس بس، ما ترجعهاش. dup_of = رقم رسالة مكررة معاها أو null. of = أرقام الإيصالات اللي الرسالة دي مجموعها (قاعدة ٨) أو [].',
    maxTokens: 16000,
    schema: obj({ items: { type: 'array', items: obj({ i: { type: 'integer' }, kind: KIND, amount: NUM_OR_NULL, confidence: { type: 'number' }, dup_of: INT_OR_NULL, of: { type: 'array', items: { type: 'integer' } }, why: { type: 'string' } }) } }),
  },
  closings: {
    instruction: `افهم المحادثة زي محاسب المحل، مش بكلمات معينة. لاقي كل «قفلة حساب»: مكان الحساب اتقفل عنده على رقم، واللي بعده حساب/يوم جديد بيبدأ من الرقم ده.
أمثلة: آلة حاسبة بتجمع اللي فات وناتجها (آخر اليوم)، الناتج لوحده بعدها، «الحساب كده/الباقي عندك/قفلنا على/بدايتنا»، رصيد آخر اليوم، أو اتفاق الطرفين على رقم، حتى لو مكتوب بأي صيغة.
مش قفلة: تحويل، طلب، سؤال، أو رقم في نص الكلام.
balance = الرصيد بعد القفلة (موجب = على العميل). لو كشف وبعده الناتج لوحده، القفلة هي الكشف. why: ليه دي قفلة.`,
    maxTokens: 8000,
    schema: obj({ closings: { type: 'array', items: obj({ i: { type: 'integer' }, balance: { type: 'number' }, kind: { type: 'string', enum: ['statement', 'result', 'agreed', 'day_end', 'other'] }, confidence: { type: 'number' }, why: { type: 'string' } }) } }),
  },
  lessons: {
    instruction: 'دي فترة قديمة بين نقطتين بداية، وحسابي ليها طلع غلط. لاقي الرسائل اللي غالبًا فهمتها غلط، وطلّع لحد ٣ دروس عامة تنفع بعد كده (من غير أسماء أو مبالغ). مش متأكد؟ رجّع قائمة فاضية.',
    maxTokens: 4096,
    schema: obj({ lessons: { type: 'array', items: { type: 'string' } }, confidence: { type: 'number' } }),
  },
  merge: {
    instruction: 'ادمج الخلاصة الحالية والتصحيحات الجديدة في قائمة قواعد قصيرة مرقمة بالعامية. ما تضيعش أي درس، وشيل المكرر.',
    maxTokens: 8000,
    schema: obj({ summary: { type: 'string' } }),
  },
};

export class AiError extends Error { constructor(msg, status = 502) { super(msg); this.status = status; } }

export const LIMITS = { input: 120_000, training: 60_000, image: 4_500_000 };

/** Check a request body from the page. Returns the clean task or throws AiError(400). */
export function validate(body) {
  const { task, tier = 'fast', training = '', input = '', image = null } = body || {};
  if (!TASKS[task]) throw new AiError('bad task', 400);
  if (!MODELS[tier]) throw new AiError('bad tier', 400);
  if (typeof input !== 'string' || input.length > LIMITS.input) throw new AiError('bad input', 400);
  if (typeof training !== 'string' || training.length > LIMITS.training) throw new AiError('bad training', 400);
  if (image != null && (typeof image !== 'string' || image.length > LIMITS.image || !/^[A-Za-z0-9+/=]+$/.test(image))) throw new AiError('bad image', 400);
  if (task === 'image' && !image) throw new AiError('image missing', 400);
  return { task, tier, training, input, image };
}

/** The system prompt: fixed rules, then the owner's training. The last block carries the cache breakpoint. */
export function systemBlocks(training) {
  const blocks = [{ type: 'text', text: RULES }];
  if (training.trim()) blocks.push({ type: 'text', text: 'تعليم صاحب المحل (له الأولوية على اللي فوق):\n' + training.trim() });
  blocks[blocks.length - 1] = { ...blocks[blocks.length - 1], cache_control: { type: 'ephemeral' } };
  return blocks;
}

/** The exact request sent to Claude (exported so tests can check it without calling the API). */
export function buildRequest({ task, tier, training, input, image }, { models = MODELS, effort = EFFORT } = {}) {
  const T = TASKS[task];
  const content = [];
  if (image) content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: image } });
  content.push({ type: 'text', text: input ? `${T.instruction}\n\n${input}` : T.instruction });
  const req = {
    model: models[tier],
    max_tokens: T.maxTokens,
    system: systemBlocks(training),
    messages: [{ role: 'user', content }],
    output_config: { effort: effort[tier], format: { type: 'json_schema', schema: T.schema } },
  };
  // the strong model: if it declines, the API retries on a fallback model inside the same call
  return tier === 'strong' ? { ...req, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : req;
}

export function costOf(model, u = {}) {
  const p = PRICE[model] || PRICE[MODELS.fast];
  return ((u.input_tokens || 0) * p[0] + (u.output_tokens || 0) * p[1] + (u.cache_read_input_tokens || 0) * p[2] + (u.cache_creation_input_tokens || 0) * p[3]) / 1e6;
}

export function makeClient(apiKey) { return new Anthropic({ apiKey, maxRetries: 2 }); }

/** Run one task on Claude. Returns { data, model, usage, cost }. */
export async function runTask(client, body, opts) {
  const req = buildRequest(validate(body), opts);
  let msg;
  try {
    msg = req.betas ? await client.beta.messages.create(req) : await client.messages.create(req);
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) throw new AiError('ضغط على Claude، استنى شوية', 429);
    if (e instanceof Anthropic.AuthenticationError) throw new AiError('مفتاح Claude غلط (ANTHROPIC_API_KEY)', 500);
    if (e instanceof Anthropic.APIConnectionError) throw new AiError('مفيش اتصال بـ Claude', 503);
    if (e instanceof Anthropic.APIError) throw new AiError(e.message, e.status || 502);
    throw e;
  }
  if (msg.stop_reason === 'refusal') throw new AiError('Claude رفض يحلل دي، راجعها بنفسك', 422);
  if (msg.stop_reason === 'max_tokens') throw new AiError('الرد اتقطع، قلّل حجم الدفعة', 502);
  const text = msg.content.filter(b => b.type === 'text').map(b => b.text).join('');
  return { data: JSON.parse(text), model: msg.model, usage: msg.usage, cost: costOf(msg.model, msg.usage) };
}

/** Same task as one plain prompt (for the offline Ollama engine). */
export function plainPrompt({ task, training, input }) {
  const T = TASKS[task];
  return `${RULES}\n${training.trim() ? '\nتعليم صاحب المحل:\n' + training.trim() + '\n' : ''}\n${T.instruction}\n\n${input}`;
}
