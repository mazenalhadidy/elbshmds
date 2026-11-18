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

export const RULES = `أنت محاسب في محل هواتف مصري (محل الباشمهندس). تقرأ محادثة واتساب بين المحل وعميل وتحسب دين العميل.
- الدين = ما على العميل للمحل (موجب = العميل مدين).
- sent: حوّل المحل أو أرسل أو شحن للعميل ← يزيد الدين.
- received: دفع العميل أو حوّل للمحل ← يقل الدين.
- ignore: كلام عادي، أو سؤال، أو طلب (مثل "ابعتلي ٥٠٠")، أو تأكيد وصول، أو عملية حُسبت من قبل.
القواعد:
1. الإيصال المرسل من المحل = sent، ومن العميل = received، إلا إذا أثبتت الصورة العكس. واسم المرسِل قرينة لا دليل قاطع: إن دلّ محتوى الرسالة بوضوح على الطرف الآخر (مثل إيصالات المحل وتأكيداته من اسم أو رقم جديد) فاحكم بالمحتوى واذكر ذلك في why.
2. العملية نفسها نصًّا وصورةً (المبلغ نفسه في وقت متقارب) تُحسب مرة واحدة.
3. من الإيصال خذ مبلغ التحويل فقط: لا الرصيد ولا الرسوم ولا رقم العملية أو رقم الهاتف.
4. "ألف" = ×١٠٠٠، وحرف "ك" بعد الرقم = ×١٠٠٠. قد تكون الأرقام عربية.
5. إن لم تكن متأكدًا فقلّل confidence ولا تخترع رقمًا.
6. why: جملة قصيرة بالعربية الفصحى: ماذا رأيت ولماذا.
7. «تم تحويل X جنيه لرقم ... مصاريف الخدمة ١ جنيه» (فودافون كاش، من شاشة هاتف أو نوكيا أو «الدفع تم بنجاح») = إيصال بمبلغ X.
8. قد يُرسل المبلغ على عدة إيصالات، ثم يكتب المحل «تم ٥٠٠٠٠ فلان» أو يرد بـ«تم» على طلب العميل («39930»، أو «40» بمعنى ٤٠٬٠٠٠). هذه عملية واحدة بالمجموع: تأخذ هذه الرسالة المجموع، وof = أرقام الإيصالات التي يضمها. لا تحسب الإيصالات مرة أخرى.
9. الرسائل المعاد توجيهها من المحل = من المحل. «صور» = صور ملصقة بلا مرسل معروف: الافتراضي أنها من المحل، إلا إذا دلّت الصورة على غير ذلك.
10. الآلة الحاسبة «أ+ب+…−ج=الناتج» = كشف حساب المحل: الرقم الأول = الرصيد السابق، والموجب = ما أُرسل للعميل، والسالب = ما دُفع، والناتج = الرصيد الجديد. ليست عملية جديدة (ignore).
11. ليست كل رسالة أو صورة من الحساب: الصور العشوائية والشخصية، والملصقات، والتهاني، والمحادثات الجانبية، والرسائل المحذوفة أو المعدّلة، والصور غير الواضحة التي لا تُظهر تحويلًا = ignore. لا تخمّن مبلغًا من صورة لا تُظهر تحويلًا أو آلة حاسبة (is_transfer = false).`;

/* ---------- output shapes ---------- */
const KIND = { type: 'string', enum: ['sent', 'received', 'ignore'] };
const NUM_OR_NULL = { anyOf: [{ type: 'number' }, { type: 'null' }] };
const INT_OR_NULL = { anyOf: [{ type: 'integer' }, { type: 'null' }] };
const obj = (properties) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });

export const TASKS = {
  image: {
    instruction: 'حلّل الصورة. إن كانت آلة حاسبة: calc.terms = كل الأرقام بإشاراتها بالترتيب (اقرأ الرقم المقسوم على سطرين رقمًا واحدًا)، وcalc.total = الناتج أو null. وإلا: calc = null.',
    maxTokens: 4096,
    schema: obj({ is_transfer: { type: 'boolean' }, kind: KIND, amount: NUM_OR_NULL, confidence: { type: 'number' }, unclear: { type: 'boolean' },
      app: { type: 'string' }, ref: { type: 'string' }, summary: { type: 'string' }, why: { type: 'string' },
      calc: { anyOf: [{ type: 'null' }, obj({ terms: { type: 'array', items: { type: 'number' } }, total: NUM_OR_NULL })] } }),
  },
  text: {
    instruction: 'صنّف كل رسالة نصية. الصور محللة مسبقًا ومذكورة للاستئناس فقط، فلا تُرجعها. dup_of = رقم رسالة مكررة معها أو null. of = أرقام الإيصالات التي تمثل هذه الرسالة مجموعها (القاعدة ٨) أو [].',
    maxTokens: 16000,
    schema: obj({ items: { type: 'array', items: obj({ i: { type: 'integer' }, kind: KIND, amount: NUM_OR_NULL, confidence: { type: 'number' }, dup_of: INT_OR_NULL, of: { type: 'array', items: { type: 'integer' } }, why: { type: 'string' } }) } }),
  },
  closings: {
    instruction: `افهم المحادثة كما يفهمها محاسب المحل، لا بالبحث عن كلمات بعينها. حدّد كل «إقفال للحساب»: موضع أُقفل عنده الحساب على رقم، وما بعده حساب أو يوم جديد يبدأ من هذا الرقم.
أمثلة: آلة حاسبة تجمع ما سبق مع ناتجها (نهاية اليوم)، أو الناتج وحده بعدها، أو رصيد نهاية اليوم، أو اتفاق الطرفين على رقم، بأي صياغة كانت.
افهم العامية المصرية بمعناها، لا بحروفها: «بدايتنا ١٢ الف»، «أولنا ٥٠٠٠»، «هنبدأ من ٣٠ ألف»، «الحساب كده»، «الباقي عندك»، «قفلنا على»، «فاضل عليك»، «معاك كام؟ … ١٥٠٠٠»، «رصيدك ٢٠ الف» = إقفال/بداية برقمه.
الاتجاه من المعنى: «عليك/عندك/لينا» = على العميل (موجب)، «ليك/عندنا/لك عندنا» = للعميل (سالب). «الف/ألف/ك» = ×١٠٠٠، و«مية» = ١٠٠، و«نص» = نصف.
إن تكررت البداية في المحادثة فكل واحدة إقفال مستقل، والأحدث هو بداية الحساب الحالي.
ليس إقفالًا: التحويل، والطلب، والسؤال، والرقم الوارد في سياق الكلام.
balance = الرصيد بعد الإقفال (موجب = على العميل). إن جاء كشف ثم الناتج وحده، فالإقفال هو الكشف. why: سبب اعتباره إقفالًا.`,
    maxTokens: 8000,
    schema: obj({ closings: { type: 'array', items: obj({ i: { type: 'integer' }, balance: { type: 'number' }, kind: { type: 'string', enum: ['statement', 'result', 'agreed', 'day_end', 'other'] }, confidence: { type: 'number' }, why: { type: 'string' } }) } }),
  },
  roles: {
    instruction: `حدّد من يمثّل المحل ومن هو العميل لكل مرسل. المحل عادةً: يرسل إيصالات التحويل («تم تحويل…»)، ويكتب «تم» أو «تم ٥٠٠٠٠ فلان»، ويرسل كشف الآلة الحاسبة والناتج، ويعيد توجيه الإيصالات. والعميل عادةً: يطلب («39930»، «40»، «ابعتلي…»)، ويدفع للمحل. قد يكون للمحل أكثر من موظف، وقد تتغير الأسماء: قد يكتب المحل من اسم أو رقم جديد، وقد يتغير صاحب الاسم. احكم على كل مرسل من محتوى رسائله في هذه المحادثة، واعتبر السوابق قرينة لا قاعدة. why: الدليل باختصار.`,
    maxTokens: 4096,
    schema: obj({ roles: { type: 'array', items: obj({ sender: { type: 'string' }, side: { type: 'string', enum: ['shop', 'client'] }, confidence: { type: 'number' }, why: { type: 'string' } }) } }),
  },
  chat: {
    instruction: `صاحب المحل يكلّمك عن الحساب الذي حسبتَه أنت من المحادثة (الحالة والرسائل أدناه). افهم ما يريد، ونفّذه بإجراءات، ثم ردّ في reply بجملة أو جملتين قصيرتين بالعربية الفصحى.
الإجراءات (actions):
- fix: الرسالة #i عملية kind بمبلغ amount (أو ignore). استخدمه لكل رسالة يصححها، وللرسائل المشابهة التي يقصدها كلامه.
- start: ابدأ الحساب من الرسالة #i (ابحث في الرسائل عن التي يصفها بالتاريخ أو النص أو المبلغ).
- opening: رصيد البداية amount (موجب = على العميل، سالب = للعميل).
- side: المرسل sender يمثّل side (shop أو client) — بالاسم كما في الرسائل تمامًا.
- remember: قاعدة عامة نصّها text تريد تذكّرها في كل محادثة قادمة، فقط إن كانت عامة وليست خاصة بهذه الرسالة.
السؤال يُجاب دون إجراءات. لا تستعمل إلا أرقام # الموجودة. إن لم تفهم فاسأل سؤالًا واحدًا قصيرًا دون إجراءات. الحقول غير المستعملة = null.`,
    maxTokens: 8000,
    schema: obj({ reply: { type: 'string' }, actions: { type: 'array', items: obj({
      type: { type: 'string', enum: ['fix', 'start', 'opening', 'side', 'remember'] }, i: INT_OR_NULL,
      kind: { anyOf: [KIND, { type: 'null' }] }, amount: NUM_OR_NULL, sender: { anyOf: [{ type: 'string' }, { type: 'null' }] },
      side: { anyOf: [{ type: 'string', enum: ['shop', 'client'] }, { type: 'null' }] }, text: { anyOf: [{ type: 'string' }, { type: 'null' }] } }) } }),
  },
  lessons: {
    instruction: 'هذه فترة سابقة بين نقطتي بداية، وجاء حسابي لها خاطئًا. حدّد الرسائل التي أسأتُ فهمها على الأرجح، واستخرج حتى ٣ دروس عامة تفيد لاحقًا (دون أسماء أو مبالغ). إن لم تكن متأكدًا فأرجع قائمة فارغة.',
    maxTokens: 4096,
    schema: obj({ lessons: { type: 'array', items: { type: 'string' } }, confidence: { type: 'number' } }),
  },
  merge: {
    instruction: 'ادمج الخلاصة الحالية والتصحيحات الجديدة في قائمة قواعد قصيرة مرقمة بالعربية الفصحى، دون إسقاط أي درس، مع حذف المكرر.',
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
  if (training.trim()) blocks.push({ type: 'text', text: 'تعليمات صاحب المحل (لها الأولوية على ما سبق):\n' + training.trim() });
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
    if (e instanceof Anthropic.RateLimitError) throw new AiError('ضغط على Claude، انتظر قليلًا', 429);
    if (e instanceof Anthropic.AuthenticationError) throw new AiError('مفتاح Claude غير صحيح (ANTHROPIC_API_KEY)', 500);
    if (e instanceof Anthropic.APIConnectionError) throw new AiError('لا يوجد اتصال بـ Claude', 503);
    if (e instanceof Anthropic.APIError) throw new AiError(e.message, e.status || 502);
    throw e;
  }
  if (msg.stop_reason === 'refusal') throw new AiError('رفض Claude تحليل هذه الرسالة، فراجعها بنفسك', 422);
  if (msg.stop_reason === 'max_tokens') throw new AiError('انقطع الرد، فقلّل حجم الدفعة', 502);
  const text = msg.content.filter(b => b.type === 'text').map(b => b.text).join('');
  return { data: JSON.parse(text), model: msg.model, usage: msg.usage, cost: costOf(msg.model, msg.usage) };
}

/** Same task as one plain prompt (for the offline Ollama engine). */
export function plainPrompt({ task, training, input }) {
  const T = TASKS[task];
  return `${RULES}\n${training.trim() ? '\nتعليمات صاحب المحل:\n' + training.trim() + '\n' : ''}\n${T.instruction}\n\n${input}`;
}
