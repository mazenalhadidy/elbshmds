// The shop's calculation: the real example from the شركة المريم group (export starts in the middle).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStatement, statementCheckpoints, mergeCheckpoints, transactions, linkGroups, reconcile, equation, totals, covered, parse } from '../public/core.js';

const STATEMENT = '1,171,035+22,150+72,000+53,000+63,000+34,100+29,800+32,850+39,270+100,000+10,000+10,000+60,000+5,000+29,140+50,000+250,000+50,000+39,930+40,000+6,850−311,000';
const EXPECTED = STATEMENT + '\n=1,857,125';

// What the chat shows after the AI read it: receipts, «تم 50000», «تم» on «39930», a payment of 311,000 …
let i = 0;
const tx = (kind, amount, extra = {}) => ({ i: i++, state: 'done', kind, amount, ...extra });
function chat() {
  i = 0;
  const rows = [
    tx('sent', 100000), tx('sent', 10000), tx('sent', 10000), tx('sent', 60000), tx('sent', 5000), tx('sent', 29140),
    tx('sent', 1800), tx('sent', 30000), tx('sent', 18200),                                     // 3 receipts (#6-#8)…
    tx('sent', 50000, { of: [6, 7, 8] }),                                                         // …«تم 50000 محمد ابراهيم»
    tx('sent', 250000), tx('sent', 50000),
    tx('ignore', 39930),                                                                          // the client's request «39930»
    tx('sent', 10000), tx('sent', 10000), tx('sent', 9930), tx('sent', 10000),                    // 4 receipts (#13-#16)…
    tx('sent', 39930, { of: [13, 14, 15, 16] }),                                                  // …«تم» on the request
    tx('ignore', 40), tx('sent', 40000), tx('sent', 40000, { of: [19] }),                         // «40», receipt, «تم»
    tx('sent', 6850), tx('received', 311000),
  ];
  return rows;
}

test('reads the calculator line, wrapped digits and the result line', () => {
  const st = parseStatement(STATEMENT.replace('53,000', '53,0\n00') + '\n=1,857,125');
  assert.equal(st.terms.length, 22); assert.equal(st.terms.at(-1), -311000); assert.equal(st.total, 1857125);
  assert.equal(parseStatement('16/11/2026 2:41'), null);
  assert.equal(parseStatement('رقم 01016556624'), null);
  assert.equal(parseStatement('1+2+3'), null);                                                    // too small to be money
});

test('split transfers count once, as the shop writes them', () => {
  const rows = chat();
  linkGroups(rows);
  assert.deepEqual([...covered(rows)].sort((a, b) => a - b), [6, 7, 8, 13, 14, 15, 16, 19]);
  assert.equal(rows[7].partOf, 9);
  assert.deepEqual(transactions(rows).map(t => t.amount), [100000, 10000, 10000, 60000, 5000, 29140, 50000, 250000, 50000, 39930, 40000, 6850, -311000]);
  assert.equal(rows[9].flag, undefined);                                                          // 1800+30000+18200 = 50000
});

test('checking the statement: older terms are "before the chat", the rest is found, result exact', () => {
  const st = parseStatement(STATEMENT + '=1,857,125');
  const rec = reconcile(st, transactions(chat()), { midway: true });
  assert.deepEqual(rec.before, [22150, 72000, 53000, 63000, 34100, 29800, 32850, 39270]);
  assert.equal(rec.items.filter(x => x.status === 'ok').length, 13);
  assert.equal(rec.items.filter(x => x.status === 'missing').length, 0);
  assert.deepEqual(rec.extra, []);
  assert.ok(rec.arithmeticOk); assert.ok(rec.matches);
  assert.equal(rec.eq.text, EXPECTED);                                                            // exactly the shop's last 2 messages
  assert.equal(rec.eq.total, 1857125);
});

test('receipts the AI did not group still match a statement term', () => {
  const rows = chat().map(r => ({ ...r, of: undefined }));                                        // no «of» -> parts AND totals counted…
  const plain = rows.filter(r => ![9, 17, 20].includes(r.i));                                     // …so drop the «تم» lines: only receipts
  const rec = reconcile(parseStatement(STATEMENT), transactions(plain));
  assert.equal(rec.items.filter(x => x.status === 'ok').length, 13);
  assert.ok(rec.matches);
});

test('a wrong statement is caught', () => {
  const rows = chat(); rows[10].amount = 205000;                                                   // the chat says 205,000, statement 250,000
  const rec = reconcile(parseStatement(STATEMENT + '=1,857,125'), transactions(rows));
  assert.equal(rec.matches, false);
  assert.deepEqual(rec.extra.map(x => x.amount), [205000]);
  assert.deepEqual(rec.items.filter(x => x.status === 'missing').map(x => x.amount), [250000]);
  assert.equal(rec.eq.total - rec.stated, -45000);
  const bad = parseStatement('1,000+500=1,600'.replace('=', '+100=')); assert.ok(bad);
  assert.equal(reconcile({ terms: [1000, 500, 100], total: 1700 }, []).arithmeticOk, false);
});

test('new transfers after the statement continue from its result', () => {
  const eq = equation(1857125, [{ amount: 20000 }, { amount: -7125 }]);
  assert.equal(eq.text, '1,857,125+20,000−7,125\n=1,870,000');
  const rows = [{ i: 1, state: 'done', kind: 'sent', amount: 5 }, { i: 3, state: 'done', kind: 'sent', amount: 20000 }];
  assert.equal(totals(rows, 1857125, 2).debt, 1877125);                                           // only after the starting point
});

test('a typed statement in the chat becomes the starting point', () => {
  const msgs = parse(`[16/11/2026, 4:01:00 AM] مختار: ${STATEMENT}=1,857,125\n[16/11/2026, 4:02:00 AM] مختار: بدايتنا 1857125`);
  const cps = mergeCheckpoints([{ i: 0, amount: 1, dir: 'client_owes' }], statementCheckpoints(msgs));
  assert.equal(cps.length, 1); assert.equal(cps[0].stated, 1857125); assert.equal(cps[0].terms.length, 22);
});

test('on screen a number is never cut: one piece per number, sign included', async () => {
  const { expressionHtml } = await import('../public/core.js');
  const html = expressionHtml([1171035, 22150, -311000], 882185);
  assert.equal(html, '<span class="t">1,171,035</span><wbr><span class="t">+22,150</span><wbr><span class="t">−311,000</span><br><span class="t">=882,185</span>');
});
