// The page's logic: reading the export, starting points, totals, duplicates, training text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse, attachment, strip, amountAfter, keywordCheckpoints, prep, applyAnswer, weak, dedupeRefs, totals, trainingText, num, pool } from '../public/core.js';

const IOS = `[15/11/2026, 10:21:33 AM] المحل: بدايتنا ١٢ الف
[15/11/2026, 10:22:00 AM] أحمد: تمام
[15/11/2026, 10:23:00 AM] المحل: ‎IMG-001.jpg (file attached)
[15/11/2026, 10:24:00 AM] أحمد: حولتلك ٥٠٠
سطر تاني
[15/11/2026, 10:25:00 AM] أحمد: This message was deleted`;
const ANDROID = `15/11/2026, 10:21 - المحل: بدايتنا 3,000
15/11/2026, 10:22 - Messages and calls are end-to-end encrypted.
15/11/2026, 10:23 م - أحمد: <Media omitted>`;

test('parses iPhone and Android exports, multi-line messages, Arabic digits', () => {
  const m = parse(IOS);
  assert.equal(m.length, 5);
  assert.equal(m[0].sender, 'المحل');
  assert.equal(m[3].text, 'حولتلك 500\nسطر تاني');
  const a = parse(ANDROID);
  assert.equal(a.length, 3);
  assert.equal(a[1].sender, null);
  assert.equal(a[2].ts, '15/11/2026 10:23 م');
});

test('attachments: found in the zip, missing, or none', () => {
  const m = parse(IOS), has = f => f === 'img-001.jpg';
  assert.deepEqual(attachment(m[2], has), { file: 'IMG-001.jpg' });
  assert.equal(attachment(m[2], () => false).missing, true);
  assert.equal(attachment(m[1], has), null);
  assert.equal(strip(m[2].text), '');
  assert.equal(attachment(parse(ANDROID)[2], has).missing, true);
});

test('starting amounts: thousands words and separators', () => {
  assert.equal(amountAfter('بدايتنا ١٢ الف', 'بدايتنا'), 12000);
  assert.equal(amountAfter('بدايتنا 3,000 جنيه', 'بدايتنا'), 3000);
  assert.equal(amountAfter('بدايتنا 5ك', 'بدايتنا'), 5000);
  assert.equal(amountAfter('مفيش رقم', 'بدايتنا'), null);
  const cps = keywordCheckpoints(parse(IOS), ['بدايتنا']);
  assert.deepEqual(cps.map(c => [c.i, c.amount]), [[0, 12000]]);
});

test('prep decides system / deleted / missing media without the AI', () => {
  const m = parse(IOS), shop = new Set(['المحل']), has = f => f === 'img-001.jpg';
  const rows = m.map(x => prep(x, { shop, has }));
  assert.equal(rows[2].img, true); assert.equal(rows[2].side, 'shop'); assert.equal(rows[2].state, 'pending');
  assert.equal(rows[3].side, 'client'); assert.equal(rows[3].state, 'pending');
  assert.equal(rows[4].state, 'done'); assert.match(rows[4].why, /محذوفة/);
});

test('answers, weak answers, totals and running balance', () => {
  const r = applyAnswer({ i: 1 }, { kind: 'sent', amount: '1,500', confidence: 0.9, why: 'x' });
  assert.equal(r.amount, 1500); assert.equal(r.flag, false);
  assert.equal(applyAnswer({ i: 2 }, { kind: 'received', amount: null, confidence: 0.95 }).flag, true);
  assert.ok(weak({ confidence: 0.5 })); assert.ok(weak({ is_transfer: true, amount: null, confidence: 1 })); assert.ok(!weak({ is_transfer: true, amount: 10, confidence: 0.9 }));
  const rows = [
    { i: 1, state: 'done', kind: 'sent', amount: 1000 },
    { i: 2, state: 'done', kind: 'received', amount: 300, flag: true },
    { i: 3, state: 'pending', kind: 'sent', amount: 99 },
    { i: 4, state: 'done', kind: 'ignore', amount: 50 },
  ];
  const t = totals(rows, 200);
  assert.equal(t.debt, 900); assert.equal(t.rev, 1); assert.equal(t.bal.get(2), 900); assert.equal(t.bal.has(3), false);
});

test('two receipts with the same transaction number count once', () => {
  const list = [{ i: 1, img: true, ref: '998877', kind: 'sent', why: '' }, { i: 2, img: true, ref: '998877', kind: 'sent', why: '' }];
  dedupeRefs(list);
  assert.deepEqual(list.map(r => r.kind), ['sent', 'ignore']);
});

test('training text: rules, summary, unmerged corrections only; stable for caching', () => {
  const settings = { rules: ['قاعدة'], learned: 'خلاصة', keywords: ['بدايتنا'] };
  const examples = [{ merged: true, content: 'XMERGEDX' }, { side: 'client', content: 'دفعت', ai: { kind: 'sent', amount: 5 }, fix: { kind: 'received', amount: 5 } }];
  const t = trainingText(settings, examples);
  assert.match(t, /1\. قاعدة/); assert.match(t, /خلاصة/); assert.match(t, /الصح: استلمنا منه 5/); assert.doesNotMatch(t, /XMERGEDX/);
  assert.equal(t, trainingText(settings, examples));
  assert.equal(trainingText({ rules: [], learned: '', keywords: [] }, []), '');
});

test('num + pool', async () => {
  assert.equal(num('١٬٢٣٤'), 1234); assert.equal(num('abc'), null);
  let running = 0, max = 0; const seen = [];
  await pool([1, 2, 3, 4, 5, 6], 2, async x => { running++; max = Math.max(max, running); await new Promise(r => setTimeout(r, 5)); seen.push(x); running--; });
  assert.equal(max, 2); assert.equal(seen.length, 6);
});
