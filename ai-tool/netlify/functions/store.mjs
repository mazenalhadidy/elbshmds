// /api/store?k=settings|examples — the training (rules + corrections) in Netlify Blobs, behind the tool password.
// Chats and screenshots are never stored.
import { getStore } from '@netlify/blobs';
import { sameKey, json, deny, STORE_KEYS, STORE_MAX } from '../../lib/http.js';

export default async (req) => {
  const password = Netlify.env.get('APP_PASSWORD');
  if (!password) return json({ error: 'ينقص الخادمَ APP_PASSWORD' }, 500);
  if (!sameKey(req.headers.get('x-app-key'), password)) return deny();
  const k = new URL(req.url).searchParams.get('k');
  if (!STORE_KEYS.has(k)) return json({ error: 'bad key' }, 400);
  const store = getStore('training');
  if (req.method === 'GET') return json({ value: (await store.get(k, { type: 'json' })) ?? null });
  if (req.method === 'PUT') {
    const text = await req.text();
    if (text.length > STORE_MAX) return json({ error: 'too big' }, 413);
    try { JSON.parse(text); } catch { return json({ error: 'bad json' }, 400); }
    await store.set(k, text);
    return json({ ok: true });
  }
  return json({ error: 'method' }, 405);
};

export const config = { path: '/api/store' };
