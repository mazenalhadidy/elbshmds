// Small helpers shared by the Netlify functions and the local server (no Node-only APIs: also runs on Deno/Edge).

/** Compare a given key with the real one without leaking how many characters matched. */
export function sameKey(given, real) {
  const x = new TextEncoder().encode(String(given ?? '')), y = new TextEncoder().encode(String(real ?? ''));
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0 && y.length > 0;
}

export const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

/** Wrong key: wait 1 s before answering (slows down guessing). */
export const deny = () => new Promise(r => setTimeout(r, 1000)).then(() => json({ error: 'unauthorized' }, 401));

/** Training storage keys (nothing else is ever stored; chats and images are never saved). */
export const STORE_KEYS = new Set(['settings', 'examples']);
export const STORE_MAX = 3_000_000;
