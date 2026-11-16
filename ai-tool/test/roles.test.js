// Who represents the shop: learned from the user's answers, guessed for new names.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roleFromHistory, recordRoles, seedStats, rolesInput, parse } from '../public/core.js';

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
  assert.match(t, /المرسل: مختار \(3 رسالة، 1 مرفق\)/); assert.match(t, /- تم 50000 محمد ابراهيم/);
  assert.match(t, /المرسل: ~samlamlam335 \(1 رسالة، 0 مرفق\)\n- 39930/);
});
