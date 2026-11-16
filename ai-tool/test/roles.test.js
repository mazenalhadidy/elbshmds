// Who represents the shop: learned from the user's answers, guessed for new names.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roleFromHistory, recordRoles, seedStats, rolesInput, decideRoles, parse } from '../public/core.js';

test('a name confirmed twice the same way is decided; one answer or mixed answers are not', () => {
  let st = {};
  st = recordRoles(st, ['مختار', 'سام'], new Set(['مختار']));
  assert.equal(roleFromHistory(st, 'مختار'), null);                          // once is not enough
  st = recordRoles(st, ['مختار', 'سام'], new Set(['مختار']));
  assert.equal(roleFromHistory(st, 'مختار'), 'shop');
  assert.equal(roleFromHistory(st, 'سام'), 'client');
  st = recordRoles(st, ['سام'], new Set(['سام']));                             // you changed your mind once: 2 vs 1
  assert.equal(roleFromHistory(st, 'سام'), null);                              // -> asks again instead of guessing
  assert.equal(roleFromHistory(st, 'غير معروف'), null);
});

test('names saved by the older version count as known shop names', () => {
  const st = seedStats({}, ['مختار']);
  assert.equal(roleFromHistory(st, 'مختار'), 'shop');
  assert.deepEqual(seedStats({ مختار: { shop: 0, client: 5 } }, ['مختار']).مختار, { shop: 0, client: 5 });   // real answers win
});

test('the AI gets a short sample of each unknown sender, plus the names already known', () => {
  const msgs = parse(`[16/11/2026, 12:30:00 AM] مختار: تم تحويل 1800 جنيه لرقم 01019886531
[16/11/2026, 12:31:00 AM] مختار: تم 50000 محمد ابراهيم
[16/11/2026, 12:32:00 AM] مختار: IMG-1.jpg (file attached)
[16/11/2026, 12:33:00 AM] ~samlamlam335: 39930`);
  const t = rolesInput(msgs, ['مختار', '~samlamlam335'], { chat: 'جروب تعاون شركة المريم والباشمهندس', known: ['حسن'] });
  assert.match(t, /جروب تعاون/); assert.match(t, /عُرف سابقًا أنها من المحل: حسن/);
  assert.match(t, /المرسل: مختار \(3 رسالة، 1 مرفق، اسم جديد\)/); assert.match(t, /- تم 50000 محمد ابراهيم/);
  assert.match(t, /المرسل: ~samlamlam335 \(1 رسالة، 0 مرفق، اسم جديد\)\n- 39930/);
  assert.match(rolesInput(msgs, ['مختار'], { history: { مختار: { shop: 4, client: 0 } } }), /سابقًا: محل ×4 وعميل ×0/);
});

const ai = list => new Map(list.map(([sender, side, confidence]) => [sender, { sender, side, confidence, why: 'دليل' }]));
const HIST = { مختار: { shop: 4, client: 0 }, سام: { shop: 0, client: 4 } };

test('every chat: the AI checks everyone; agreeing with your answers = decided', () => {
  const d = decideRoles(['مختار', 'سام'], HIST, ai([['مختار', 'shop', 0.9], ['سام', 'client', 0.9]]));
  assert.deepEqual([...d.shop], ['مختار']); assert.equal(d.sure, true); assert.deepEqual(d.changed, []);
});

test('the shop writes from a NEW name or number: recognised from what it writes', () => {
  const d = decideRoles(['مختار', 'سام', '+20 101 234 5678'], HIST, ai([['مختار', 'shop', 0.9], ['سام', 'client', 0.9], ['+20 101 234 5678', 'shop', 0.92]]));
  assert.ok(d.shop.has('+20 101 234 5678')); assert.equal(d.sure, true);
  const weak = decideRoles(['+20 101 234 5678'], HIST, ai([['+20 101 234 5678', 'shop', 0.6]]));
  assert.ok(weak.shop.has('+20 101 234 5678')); assert.equal(weak.sure, false);   // a weak guess is shown but you are asked
});

test('a known name now acts as the other side: never changed silently', () => {
  const strong = decideRoles(['سام'], HIST, ai([['سام', 'shop', 0.95]]));
  assert.ok(strong.shop.has('سام')); assert.equal(strong.sure, false);
  assert.deepEqual(strong.changed, [{ name: 'سام', was: 'client', now: 'shop' }]);
  const unclear = decideRoles(['سام'], HIST, ai([['سام', 'shop', 0.7]]));
  assert.ok(!unclear.shop.has('سام')); assert.equal(unclear.sure, false);         // not clear enough: your answers win, but it asks
});

test('without the AI (offline): your answers decide; unknown names are asked; pasted pictures = shop', () => {
  const d = decideRoles(['مختار', 'جديد', 'صور'], HIST, null, { always: ['صور'] });
  assert.ok(d.shop.has('مختار')); assert.ok(d.shop.has('صور')); assert.ok(!d.shop.has('جديد')); assert.equal(d.sure, false);
});
