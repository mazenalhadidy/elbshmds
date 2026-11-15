// /api/analyze — the page sends { task, tier, training, input, image }; this asks Claude (lib/ai.js).
// The Anthropic key stays in Netlify's environment. Edge Function = no 10-second limit:
// a space is sent right away and the answer when Claude finishes (never hits the 40 s header limit).
import { makeClient, runTask, AiError, MODELS } from '../../lib/ai.js';
import { sameKey, json, deny } from '../../lib/http.js';

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const password = Netlify.env.get('APP_PASSWORD'), apiKey = Netlify.env.get('ANTHROPIC_API_KEY');
  if (!password || !apiKey) return json({ error: 'السيرفر ناقصه APP_PASSWORD أو ANTHROPIC_API_KEY' }, 500);
  if (!sameKey(req.headers.get('x-app-key'), password)) return deny();

  const raw = await req.text();
  if (raw.length > 5_000_000) return json({ error: 'الطلب كبير جدًا' }, 413);
  let body; try { body = JSON.parse(raw); } catch { return json({ error: 'bad json' }, 400); }

  const models = { fast: Netlify.env.get('MODEL_FAST') || MODELS.fast, strong: Netlify.env.get('MODEL_STRONG') || MODELS.strong };
  const client = makeClient(apiKey), enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(ctrl) {
      ctrl.enqueue(enc.encode(' '));
      let out;
      try { out = await runTask(client, body, { models }); }
      catch (e) { out = { error: e instanceof AiError ? e.message : String(e?.message || e), code: e.status || 500 }; }
      ctrl.enqueue(enc.encode(JSON.stringify(out)));
      ctrl.close();
    },
  });
  return new Response(stream, { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
};

export const config = { path: '/api/analyze' };
