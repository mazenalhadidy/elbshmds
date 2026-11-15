/* Talking to the shop computer (the server). Every request gives up after 60 s (slow connections). */
import { ls } from './storage.js';

export const clientId = ls.get('elb_cid') || (() => { const id = Math.random().toString(36).slice(2) + Date.now().toString(36); ls.set('elb_cid', id); return id; })();
export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

let token = ls.get('elb_token', '');
export const getToken = () => token;
export const setToken = t => { token = t || ''; t ? ls.set('elb_token', t) : ls.del('elb_token'); };

export class ApiError extends Error { constructor(msg, status, body) { super(msg); this.status = status; this.body = body; } }
/** true when the error means "could not reach the server" (offline, timeout, server off). */
export const isOffline = e => !(e instanceof ApiError);

export async function api(method, url, body, { timeout = 60000 } = {}) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch('/api' + url, {
      method, signal: ctl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, 'X-Client-Id': clientId },
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new ApiError(j.error || 'خطأ في الاتصال', r.status, j);
    return j;
  } finally { clearTimeout(t); }
}

/** Save a JSON object as a file on this device. */
export function downloadJson(name, data) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }));
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
