// Talking to the AI about the result: what it is sent, and which of its actions are accepted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chatInput, cleanActions, parse, prep } from '../public/core.js';
import { buildRequest, validate, TASKS } from '../lib/ai.js';

const msgs = parse(`[16/11/2026, 12:30:00 AM] مختار: تم تحويل 1800 جنيه لرقم 01019886531
[16/11/2026, 12:31:00 AM] سام: 39930
[16/11/2026, 12:32:00 AM] مختار: تم`);
const rows = msgs.map(m => Object.assign(prep(m, { shop: new Set(['مختار']), has: () => false }), { state: 'done' }));
rows[0].kind = 'sent'; rows[0].amount = 1800;

test('the AI sees who is who, the start, the calculation, the messages with my reading, and the owner\'s words', () => {
  const t = chatInput({ rows, shopNames: ['مختار'], clientNames: ['سام'], start: { i: 0, ts: 'x' }, opening: 5000, calc: '5,000+1,800 =6,800', closings: [{ i: 0, balance: 5000 }], history: [{ me: true, text: 'مرحبا' }, { me: false, text: 'أهلًا' }], said: 'الـ 39930 من العميل' });
  assert.match(t, /المحل: مختار · العميل: سام/);
  assert.match(t, /البداية: #0 \(x\) · الرصيد 5000/);
  assert.match(t, /الحساب الآن: 5,000\+1,800 =6,800/);
  assert.match(t, /#0 \| .*تم تحويل 1800.* ⟵ فهمتُها: أرسلنا له 1800/);
  assert.match(t, /#1 \| .*39930 ⟵ فهمتُها: تجاهل/);
  assert.match(t, /صاحب المحل: مرحبا\nأنت: أهلًا/);
  assert.match(t, /صاحب المحل الآن: الـ 39930 من العميل$/);
});

test('a long chat keeps its newest messages', () => {
  const many = Array.from({ length: 3000 }, (_, i) => ({ i, ts: 't', sender: 'سام', side: 'client', text: 'رسالة طويلة '.repeat(5) + i, state: 'done', kind: 'ignore' }));
  const t = chatInput({ rows: many, said: 'ok' });
  assert.ok(t.length <= 101_000, String(t.length));
  assert.match(t, /رسالة طويلة 2999/); assert.doesNotMatch(t, /#0 \|/);
});

test('only real messages, known senders and real amounts are accepted', () => {
  const ok = cleanActions([
    { type: 'fix', i: 1, kind: 'sent', amount: 39930 }, { type: 'fix', i: 99, kind: 'sent', amount: 5 },
    { type: 'fix', i: 1, kind: 'sent', amount: null }, { type: 'fix', i: 2, kind: 'ignore', amount: null },
    { type: 'start', i: 0 }, { type: 'start', i: 7 }, { type: 'opening', amount: -2500 }, { type: 'opening', amount: null },
    { type: 'side', sender: 'سام', side: 'shop' }, { type: 'side', sender: 'غريب', side: 'shop' },
    { type: 'remember', text: '«وصل» تأكيد' }, { type: 'remember', text: ' ' }, { type: 'delete_all' },
  ], { rows, senders: ['مختار', 'سام'] });
  assert.deepEqual(ok.map(a => a.type + (a.i ?? a.amount ?? a.sender ?? '')), ['fix1', 'fix2', 'start0', 'opening-2500', 'sideسام', 'remember']);
  assert.deepEqual(cleanActions(null, { rows, senders: [] }), []);
});

test('the chat task: a known task, strong model, a reply plus actions', () => {
  const req = buildRequest(validate({ task: 'chat', tier: 'strong', input: 'x' }));
  assert.equal(req.model, 'claude-sonnet-5-5');
  assert.deepEqual(TASKS.chat.schema.required, ['reply', 'actions']);
  assert.deepEqual(TASKS.chat.schema.properties.actions.items.properties.type.enum, ['fix', 'start', 'opening', 'side', 'remember']);
});
