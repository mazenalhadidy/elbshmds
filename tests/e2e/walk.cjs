// The whole site through the real screens (1280 px), checked against the server after each step; then every page at
// 390 / 768 / 1280 for page errors and sideways overflow.
const { chromium } = require('playwright');
// Run: start a server on an EMPTY data folder (APP_PASSWORD=test-password-1 PORT=3999), then: node tests/e2e/walk.cjs <folder for screenshots>
const B = process.env.WALK_URL || 'http://localhost:3999', PW = process.env.WALK_PASSWORD || 'test-password-1';
const fails = [];
const ok = (c, msg) => { console.log((c ? '✓ ' : '✗ ') + msg); if (!c) fails.push(msg); };
(async () => {
  const dir = process.argv[2];
  const api = async (m, u, b, t) => (await fetch(B + '/api' + u, { method: m, headers: { 'Content-Type': 'application/json', 'X-Client-Id': 'check', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined })).json();
  const { token } = await api('POST', '/login', { password: PW });
  await api('POST', '/setup', { opening: 100000 }, token);
  const st = async () => api('GET', '/state', null, token);
  const byName = (s, n) => Object.keys(s.items).find(id => s.items[id].name === n);
  const fin = r => r.opening + (r.calc ? r.calc.split('\n').reduce((a, l) => a + Number(l || 0), 0) : 0);

  const br = await chromium.launch(); const errs = [];
  const p = await br.newPage({ viewport: { width: 1280, height: 900 } }); p.on('pageerror', e => errs.push(e.message));
  p.on('dialog', d => d.accept());
  await p.goto(B); await p.fill('input[type=password]', PW); await p.keyboard.press('Enter'); await p.waitForTimeout(1200);
  const go = async path => { await p.goto(B + path); await p.waitForTimeout(800); if (await p.isVisible('text=تولّي التعديل')) { await p.click('text=تولّي التعديل'); await p.waitForTimeout(400); } };
  const table = i => p.locator('.cols > section').nth(i);   // 0 العملاء · 1 المحافظ · 2 الديون
  const calcType = async t => { if (await p.isVisible('.result-only')) { await p.click('.result-only'); await p.waitForTimeout(150); } await p.locator('textarea.lines').fill(t); };

  /* ---------- day 1 ---------- */
  await go('/');
  const sale = p.locator('.grid3 > section').nth(0);
  await sale.locator('input.money').first().click(); await p.keyboard.type('500شاحن 2'); await p.keyboard.press('Enter'); await p.waitForTimeout(300);
  await p.locator('.grid3 > section').nth(1).locator('input.money').first().click(); await p.keyboard.type('1000 ربح'); await p.keyboard.press('Enter');
  await p.locator('.grid3 > section').nth(2).locator('input.money').first().click(); await p.keyboard.type('200'); await p.keyboard.press('Enter'); await p.waitForTimeout(600);
  let s = await st();
  const e = Object.values(s.book.entries);
  ok(e.some(x => x.kind === 'sale' && x.amount === 500 && x.name === 'شاحن 2'), 'اليومية: «500شاحن 2» → 500 + name «شاحن 2» (numbers allowed in the name)');
  ok(s.summary.profit === 1300, 'اليومية: profit 500 + 1000 − 200 = 1,300');

  await go('/accounts');
  await table(0).locator('[data-test=item-first]').click(); await p.keyboard.type('أحمد3000'); await p.waitForTimeout(150);
  ok(await table(0).locator('[data-test=item-first]').inputValue() === 'أحمد', 'العملاء: «أحمد3000» → name «أحمد» …');
  ok((await table(0).locator('input.money').first().inputValue()).includes('٣٬٠٠٠'), '… and 3,000 moved to the amount, cursor there');
  await p.keyboard.press('Enter'); await p.waitForTimeout(300);
  await table(0).locator('[data-test=item-first]').fill('سامي'); await table(0).locator('input.money').first().fill('5000'); await table(0).locator('input.money').first().press('Enter'); await p.waitForTimeout(300);
  await table(2).locator('[data-test=item-first]').click(); await p.keyboard.type('تاجر 2000'); await p.keyboard.press('Enter'); await p.waitForTimeout(300);
  await table(1).locator('[data-test=item-first]').fill('01019886531'); await table(1).locator('input.money').first().fill('20000'); await table(1).locator('input.money').first().press('Enter'); await p.waitForTimeout(400);
  s = await st();
  const ahmed = byName(s, 'أحمد'), sami = byName(s, 'سامي'), tajer = byName(s, 'تاجر');
  ok(s.items[tajer].type === 'client' && s.book.rows[tajer].value === -2000, 'الديون: «تاجر 2000» → one person the shop owes 2,000');
  ok(s.summary.clients === 8000 && s.summary.debts === 2000, 'totals: العملاء 8,000 · الديون 2,000');
  // the other table's people show up while typing
  await table(2).locator('[data-test=item-first]').fill('احمد'); await p.waitForTimeout(200);
  ok(await table(2).locator('[data-test=others]').isVisible(), 'typing «احمد» in الديون shows أحمد from العملاء');
  ok(await table(2).locator('button[aria-label=إضافة]').isDisabled(), '… and he cannot be added twice');
  await table(2).locator('[data-test=item-first]').fill('');
  // أحمد pays 10,000: owes 3,000 → the shop owes him 7,000 → he moves to الديون
  await table(0).locator('tbody tr', { hasText: 'أحمد' }).locator('.calc-chip').click(); await p.waitForTimeout(300);
  await calcType('-10000'); await p.locator('button:has-text("إنهاء")').click(); await p.waitForTimeout(400);
  ok(await table(2).locator('tbody tr', { hasText: 'أحمد' }).count() === 1 && await table(0).locator('tbody tr', { hasText: 'أحمد' }).count() === 0, 'أحمد −10,000 → moved to الديون');
  ok((await table(2).locator('tbody tr', { hasText: 'أحمد' }).textContent()).includes('٧٬٠٠٠'), '… showing 7,000 (the shop owes him)');
  s = await st();
  ok(s.summary.clients === 5000 && s.summary.debts === 9000, 'totals now: العملاء 5,000 · الديون 9,000');
  ok((await table(0).locator('.total').textContent()).includes('٥٬٠٠٠') && (await table(2).locator('.total').textContent()).includes('٩٬٠٠٠'), 'each table total = the summary');
  await p.screenshot({ path: dir + '/walk-accounts-1280.png' });

  await go('/manage');
  await p.fill('#cash', '3000'); await p.locator('#cash').dispatchEvent('input'); await p.waitForTimeout(200);
  const cons = p.locator('section', { hasText: 'الثوابت' }).first();
  await cons.locator('[data-test=item-first]').click(); await p.keyboard.type('إيجار1500'); await p.keyboard.press('Enter'); await p.waitForTimeout(300);
  const adj = p.locator('section', { hasText: 'إضافة أو خصم' }).first();
  await adj.locator('input.money').click(); await p.keyboard.type('200سلفة'); await p.keyboard.press('Enter'); await p.waitForTimeout(500);
  s = await st();
  ok(s.summary.constants === 1500, 'الثوابت: «إيجار1500» → 1,500');
  ok(Object.values(s.book.adjs).some(a => a.amount === 200 && a.note === 'سلفة'), 'الإضافة: «200سلفة» → 200, reason «سلفة»');
  const real1 = 20000 + 5000 + 3000 - 9000 - 1500 + 200;
  ok(s.summary.real === real1, `التصفية الحقيقية day 1 = ${real1}`);

  await go('/settle');
  await p.locator('.cal button.free').first().click(); await p.waitForTimeout(200);
  ok(!(await p.locator('button:has-text("إنهاء اليوم")').last().isDisabled()), 'day 1 can be closed (cash typed, every person written)');
  await p.locator('button:has-text("إنهاء اليوم")').last().click(); await p.waitForTimeout(300);
  await p.fill('#pw', PW); await p.keyboard.press('Enter'); await p.waitForTimeout(1200);
  s = await st();
  ok(s.days.length === 1 && s.book.day.opening === real1, 'day 1 saved; day 2 starts from its real total');

  /* ---------- day 2 ---------- */
  await go('/settle');
  ok(await p.isVisible('[data-test=need-check]'), 'day 2: closing waits until every person has today\'s change');
  await go('/accounts');
  // سامي: tap the final, type 4,000 → change −1,000
  await table(0).locator('tbody tr', { hasText: 'سامي' }).locator('[data-test=final]').click(); await p.keyboard.press('Control+A'); await p.keyboard.type('4000'); await p.keyboard.press('Enter'); await p.waitForTimeout(400);
  s = await st();
  ok(s.book.rows[sami].calc === '-1000' && fin(s.book.rows[sami]) === 4000, 'سامي: typed 4,000 on النهائي → change −1,000');
  // the others: 0 (written)
  for (const n of ['أحمد', 'تاجر']) { await table(2).locator('tbody tr', { hasText: n }).locator('.calc-chip').click(); await p.waitForTimeout(250); await calcType('0'); await p.locator('button:has-text("إنهاء")').click(); await p.waitForTimeout(300); }
  await go('/');
  await p.locator('.grid3 > section').nth(0).locator('input.money').first().click(); await p.keyboard.type('700 سماعة'); await p.keyboard.press('Enter'); await p.waitForTimeout(500);
  const before = await st();

  // edit day 1 from the calendar: سامي's final on day 1 becomes 0
  await go('/settle');
  await p.locator('.cal button.saved').first().click(); await p.waitForTimeout(800);
  await p.locator('button:has-text("تعديل هذا اليوم")').click(); await p.waitForTimeout(800);
  await p.locator('nav.desk-only a', { hasText: 'العملاء' }).click(); await p.waitForTimeout(800);   // in-app (a reload would drop the draft)
  ok(await p.isVisible('.editbar'), 'editing day 1 (the edit bar shows)');
  await table(0).locator('tbody tr', { hasText: 'سامي' }).locator('[data-test=final]').click(); await p.keyboard.press('Control+A'); await p.keyboard.type('0'); await p.keyboard.press('Enter'); await p.waitForTimeout(300);
  await p.locator('button:has-text("حفظ التعديلات")').click(); await p.waitForTimeout(900);
  await p.fill('#enote', 'دفع سامي كل الدين'); await p.fill('#epw', PW); await p.locator('[role=dialog] button:has-text("حفظ")').last().click(); await p.waitForTimeout(1500);
  s = await st();
  const r2 = s.book.rows[sami];
  ok(r2.opening === 0 && r2.calc === '-1000' && fin(r2) === -1000, 'day 2 after the edit: سامي starts at 0, today\'s −1,000 kept → the shop owes him 1,000');
  ok(s.summary.debts === 7000 + 2000 + 1000 && s.summary.clients === 0, 'day 2 totals: الديون 10,000 · العملاء 0');
  ok(Object.keys(s.book.entries).length === Object.keys(before.book.entries).length, 'day 2 entries untouched');
  ok(s.book.rows[ahmed].calc === '0' && fin(s.book.rows[ahmed]) === -7000 && s.book.rows[tajer].calc === '0', 'day 2: أحمد and تاجر untouched');
  const d1 = (await api('GET', '/days/' + s.days[0].id, null, token));
  ok(d1.summary.real === real1 - 5000 && s.book.day.opening === d1.summary.real, 'day 1 real −5,000; day 2 starts from it');
  await go('/accounts');
  ok(await table(2).locator('tbody tr', { hasText: 'سامي' }).count() === 1, 'سامي now shows in الديون (1,000)');
  ok((await table(2).locator('.total').textContent()).includes('١٠٬٠٠٠'), 'الديون total on screen = 10,000');

  // a تعويض on day 1 from العجوزات, then today again
  await go('/settle/deficits');
  await p.locator('[data-test=def-rec] button:has-text("تعويض")').first().click(); await p.waitForTimeout(400);
  const dlg = p.locator('[role=dialog]');
  await dlg.locator('input.money').fill('500'); await p.waitForTimeout(100);
  const sel = dlg.locator('select'); if (await sel.count()) await sel.selectOption('wallets');
  await dlg.locator('input[type=password]').fill(PW); await dlg.locator('button.primary').last().click(); await p.waitForTimeout(1200);
  const s3 = await st();
  ok(s3.book.rows[sami].calc === '-1000' && fin(s3.book.rows[ahmed]) === -7000, 'after the تعويض: today\'s people unchanged');
  ok(s3.book.day.opening !== s.book.day.opening, 'after the تعويض: today\'s تصفية البارحة moved');

  /* ---------- delete for good, then edit an older day: the saved days keep him ---------- */
  await go('/accounts');
  await table(2).locator('tbody tr', { hasText: 'تاجر' }).locator('button.del').click(); await p.waitForTimeout(300);
  await p.locator('[role=dialog] input[type=checkbox]').check(); await p.fill('#dpw', PW);
  await p.locator('[role=dialog] button.danger, [role=dialog] button.primary').last().click(); await p.waitForTimeout(1000);
  let s4 = await st();
  ok(s4.items[tajer].purged && !s4.book.rows[tajer], 'تاجر deleted for good: gone from today');
  const d1b = await api('GET', '/days/' + s4.days[0].id, null, token);
  ok(!!d1b.book.rows[tajer], '… the saved day keeps him');
  await go('/settle');
  await p.locator('.cal button.saved').first().click(); await p.waitForTimeout(800);
  await p.locator('button:has-text("تعديل هذا اليوم")').click(); await p.waitForTimeout(800);
  await p.locator('nav.desk-only a', { hasText: 'اليومية' }).click(); await p.waitForTimeout(600);
  await p.locator('.grid3 > section').nth(0).locator('input.money').first().click(); await p.keyboard.type('300 كابل'); await p.keyboard.press('Enter'); await p.waitForTimeout(300);
  await p.locator('button:has-text("حفظ التعديلات")').click(); await p.waitForTimeout(900);
  await p.fill('#enote', 'بيع منسي'); await p.fill('#epw', PW); await p.locator('[role=dialog] button:has-text("حفظ")').last().click(); await p.waitForTimeout(1500);
  const d1c = await api('GET', '/days/' + s4.days[0].id, null, token), s5 = await st();
  ok(!!d1c.book.rows[tajer] && d1c.summary.debts === d1b.summary.debts, 'after editing day 1: تاجر still in the saved day, its الديون unchanged');
  ok(d1c.summary.profit === d1b.summary.profit + 300 && s5.book.day.opening === d1c.summary.real, 'the forgotten sale counts on day 1 and flows to today');

  /* ---------- on a phone: tabs, a person from the other table ---------- */
  const ph = await br.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 }); ph.on('pageerror', x => errs.push('phone ' + x.message));
  await ph.goto(B); await ph.evaluate(t => localStorage.setItem('elb_token', JSON.stringify(t)), (await api('POST', '/login', { password: PW })).token);
  await ph.goto(B + '/accounts'); await ph.waitForTimeout(900);
  if (await ph.isVisible('text=تولّي التعديل')) { await ph.click('text=تولّي التعديل'); await ph.waitForTimeout(400); }
  const vis = () => ph.locator('.cols > section:visible');
  await ph.click('[role=tab]:has-text("ديون")'); await ph.waitForTimeout(200);
  await vis().locator('[data-test=item-first]').click(); await ph.keyboard.type('حسن1500'); await ph.keyboard.press('Enter'); await ph.waitForTimeout(400);
  await ph.click('[role=tab]:has-text("العملاء")'); await ph.waitForTimeout(200);
  await vis().locator('[data-test=item-first]').fill('حسن'); await ph.waitForTimeout(200);
  ok(await vis().locator('[data-test=others] button').count() === 1, 'phone: «حسن» typed in العملاء shows حسن from الديون');
  await ph.screenshot({ path: dir + '/walk-phone-others-390.png' });
  await vis().locator('[data-test=others] button').first().click(); await ph.waitForTimeout(300);
  ok((await ph.locator('[role=dialog]').textContent()).includes('١٬٥٠٠'), 'phone: his calculator opens in his own direction (1,500)');
  if (await ph.isVisible('.result-only')) { await ph.click('.result-only'); await ph.waitForTimeout(150); }
  await ph.locator('textarea.lines').fill('+500'); await ph.locator('button:has-text("إنهاء")').click(); await ph.waitForTimeout(500);
  const s6 = await st(), hasan = byName(s6, 'حسن');
  ok(fin(s6.book.rows[hasan]) === -2000, 'phone: +500 → the shop owes حسن 2,000');
  await ph.close();

  /* ---------- تصفية البارحة typed by hand (the day before today was not saved) ---------- */
  await go('/settle');
  const pen = p.locator('button[title="تعديل تصفية البارحة"]');
  ok(await pen.count() === 1, 'the day before today is not saved: ✎ next to تصفية البارحة');
  await pen.click(); await p.waitForTimeout(250);
  await p.locator('[role=dialog] input.money').fill('123456'); await p.locator('[role=dialog] button.primary').click(); await p.waitForTimeout(700);
  const s7 = await st();
  ok(s7.book.day.opening === 123456 && s7.book.day.openingManual === true, 'تصفية البارحة typed: 123,456 (kept when earlier days change)');
  ok((await p.locator('.summary').first().textContent()).includes('١٢٣٬٤٥٦'), '… and the summary shows it');

  /* ---------- every page, three widths ---------- */
  for (const [w, h] of [[390, 844], [768, 1024], [1280, 900]]) {
    const q = await br.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: w === 390 ? 2 : 1 }); q.on('pageerror', x => errs.push(w + ' ' + x.message));
    await q.goto(B); await q.evaluate(t => localStorage.setItem('elb_token', JSON.stringify(t)), token);
    for (const path of ['/', '/accounts', '/manage', '/settle', '/settle/deficits']) {
      await q.goto(B + path); await q.waitForTimeout(700);
      const over = await q.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      if (over > 0) ok(false, `${w}px ${path}: page wider than the screen by ${over}px`);
      if (w === 390) await q.screenshot({ path: `${dir}/walk-${path.replace(/\//g, '_') || 'home'}-390.png`, fullPage: true });
    }
    await q.close();
  }
  ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  console.log(`\n${fails.length ? fails.length + ' FAILED' : 'ALL PASSED'}`);
  await br.close();
})();
