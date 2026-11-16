// "Our start is this": found from the end of the chat backwards; messages that are not part of the account.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse, findTextMarker, markerText, dhash, hamming, SAME_PICTURE, prep, strip, isTransaction } from '../public/core.js';

const CHAT = parse(`[15/11/2026, 11:00:00 PM] مختار: 1,000+500=1,500
[15/11/2026, 11:05:00 PM] مختار: تم 50000 محمد ابراهيم
[16/11/2026, 12:30:00 AM] مختار: تم تحويل 1800 جنيه لرقم 01019886531 مصاريف الخدمة 1 جنيه
[16/11/2026, 12:31:00 AM] مختار: تم 50000 محمد ابراهيم
[16/11/2026, 12:32:00 AM] أحمد: صباح الخير`);

test('a pasted start text is found from the END: the newest match wins', () => {
  assert.equal(findTextMarker(CHAT, 'تم 50000 محمد ابراهيم'), 3);
  assert.equal(findTextMarker(CHAT, 'محمد  إبراهيم'), 3);                          // spaces / أ إ ا don't matter
});
test('a copied WhatsApp message (with its "[date] name:" header) works as the start', () => {
  assert.equal(markerText('[16/11/2026, 12:30 AM] مختار: تم تحويل 1800 جنيه'), 'تم تحويل 1800 جنيه');
  assert.equal(findTextMarker(CHAT, '[16/11/2026, 12:30 AM] مختار: تم تحويل 1800 جنيه لرقم'), 2);
  assert.equal(findTextMarker(CHAT, 'شيء غير موجود'), -1);
  assert.equal(findTextMarker(CHAT, 'ا'), -1);                                        // too short to mean anything
});

test('picture fingerprint: same picture matches, a different one does not', () => {
  const img = Array.from({ length: 72 }, (_, k) => (k * 37) % 255);
  const resized = img.map(v => v * 0.9 + 8);                                          // brightness / recompression change
  const other = Array.from({ length: 72 }, (_, k) => (k * 91 + 13) % 255);
  assert.equal(hamming(dhash(img), dhash(resized)), 0);
  assert.ok(hamming(dhash(img), dhash(other)) > SAME_PICTURE);
});

test('not every message is part of the account', () => {
  const shop = new Set(['مختار']), has = () => true;
  const m = parse(`[16/11/2026, 1:00:00 AM] مختار: STK-20261116-WA0001.webp (file attached)
[16/11/2026, 1:01:00 AM] مختار: VID-20261116-WA0002.gif (file attached)
[16/11/2026, 1:02:00 AM] مختار: هذه الرسالة محذوفة
[16/11/2026, 1:03:00 AM] مختار: تم 5000 <This message was edited>
[16/11/2026, 1:04:00 AM] مختار: IMG-20261116-WA0003.jpg (file attached)`);
  const rows = m.map(x => prep(x, { shop, has }));
  assert.match(rows[0].why, /ملصق/); assert.equal(rows[0].state, 'done');
  assert.match(rows[1].why, /متحركة/);
  assert.match(rows[2].why, /محذوفة/);
  assert.equal(rows[3].text, 'تم 5000'); assert.equal(strip('تم 5000 <تم تعديل هذه الرسالة>'), 'تم 5000');
  assert.equal(rows[4].img, true); assert.equal(rows[4].state, 'pending');            // a real picture still goes to the AI
  assert.equal(isTransaction({ state: 'done', kind: 'sent', amount: 5 }), true);
  assert.equal(isTransaction({ state: 'done', kind: 'ignore', amount: 5 }), false);
});
