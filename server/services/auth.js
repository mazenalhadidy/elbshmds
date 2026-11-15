/* Login password, login tokens and the wrong-password limit. */
import crypto from 'node:crypto';

export function createAuth(password, { tokenDays = 30 } = {}) {
  const sha = x => crypto.createHash('sha256').update(String(x)).digest();
  const same = (a, b) => crypto.timingSafeEqual(sha(a), sha(b));                 // compare without leaking timing
  const secret = sha('elbshmds-token:' + password);                              // tokens stop working when the password changes
  const sign = v => crypto.createHmac('sha256', secret).update(v).digest('hex');

  // 10 wrong passwords from one address -> blocked for 15 minutes (login AND every password confirmation)
  const fails = new Map();
  function check(ip, given) {
    const rec = fails.get(ip) || { n: 0, t: Date.now() };
    if (Date.now() - rec.t > 15 * 60e3) { rec.n = 0; rec.t = Date.now(); }
    if (rec.n >= 10) return { code: 429, error: 'محاولات كثيرة، حاول بعد ١٥ دقيقة' };
    if (password && same(given ?? '', password)) { fails.delete(ip); return null; }
    rec.n++; fails.set(ip, rec);
    if (fails.size > 10000) for (const [k, v] of fails) if (Date.now() - v.t > 15 * 60e3) fails.delete(k);   // never grows without limit
    return { code: 401, error: 'كلمة المرور خاطئة' };
  }
  const makeToken = () => { const exp = String(Date.now() + tokenDays * 864e5); return exp + '.' + sign(exp); };
  const validToken = t => { const [exp, sig] = String(t || '').split('.'); return !!sig && same(sign(exp), sig) && Date.now() < Number(exp); };
  return { check, makeToken, validToken };
}

/* Only one device edits at a time; the others can still look. The role lapses after 45 s without contact. */
export function createEditorLock() {
  let lock = { id: null, seen: 0 };
  const held = () => !!lock.id && Date.now() - lock.seen < 45000;
  return {
    info: id => ({ editor: held() && lock.id === id, held: held(), holder: held() ? lock.id : null }),
    /** Become the editor if nobody else is (or `take` = take over). Returns true if this device is the editor. */
    claim(id, take = false) { if (!id) return false; if (!held() || lock.id === id || take) lock = { id, seen: Date.now() }; return lock.id === id; },
  };
}
