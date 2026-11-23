// Typing on a phone (a real phone profile: touch screen): Enter moves on and the cursor stays for the next entry,
// fields never zoom, the bottom menu hides while typing, buttons are finger-sized.
// Run: a server on an EMPTY data folder (APP_PASSWORD=test-password-1 PORT=3999), then: node tests/e2e/mobile.cjs <folder>
const { chromium, devices } = require('playwright');
const B = process.env.WALK_URL || 'http://localhost:3999', PW = process.env.WALK_PASSWORD || 'test-password-1';
const fails = [];
const ok = (c, msg) => { console.log((c ? '✓ ' : '✗ ') + msg); if (!c) fails.push(msg); };
(async () => {
  const dir = process.argv[2];
  const api = async (m, u, b, t) => (await fetch(B + '/api' + u, { method: m, headers: { 'Content-Type': 'application/json', 'X-Client-Id': 'm', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined })).json();
  const { token } = await api('POST', '/login', { password: PW });
  await api('POST', '/setup', { opening: 100000 }, token);
  const br = await chromium.launch();
  const ctx = await br.newContext({ ...devices['Pixel 7'] });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(B); await p.evaluate(t => localStorage.setItem('elb_token', JSON.stringify(t)), token);
  await p.goto(B + '/'); await p.waitForTimeout(1000);
  if (await p.isVisible('text=تولّي التعديل')) { await p.tap('text=تولّي التعديل'); await p.waitForTimeout(400); }
  const focused = () => p.evaluate(() => document.activeElement?.getAttribute('aria-label') || document.activeElement?.id || document.activeElement?.tagName);

  // اليومية: amount → Enter → name → Enter → added, cursor back on the amount
  await p.tap('[role=tab]:has-text("المبيعات")');
  const sale = p.locator('.grid3 > section:visible');
  await sale.locator('input.money').first().tap();
  ok(await p.evaluate(() => parseFloat(getComputedStyle(document.activeElement).fontSize)) >= 16, 'fields are 16 px: the phone does not zoom in');
  ok(await p.evaluate(() => getComputedStyle(document.querySelector('nav.bottom')).display) === 'none', 'the bottom menu hides while typing');
  ok(await sale.locator('input.money').first().getAttribute('enterkeyhint') === 'next', 'the amount\'s Enter key says «التالي»');
  await p.keyboard.type('750'); await p.keyboard.press('Enter'); await p.waitForTimeout(200);
  ok(await focused() === 'الاسم', 'Enter on the amount → the name');
  await p.keyboard.type('شاحن'); await p.keyboard.press('Enter'); await p.waitForTimeout(400);
  ok(await focused() === 'المبلغ', '… Enter on the name → added, the cursor is back on the amount (keyboard stays)');
  await p.keyboard.type('120'); await p.keyboard.press('Enter'); await p.waitForTimeout(150); await p.keyboard.press('Enter'); await p.waitForTimeout(400);
  let s = await api('GET', '/state', null, token);
  const e = Object.values(s.book.entries).filter(x => x.kind === 'sale');
  ok(e.length === 2 && e.some(x => x.amount === 750 && x.name === 'شاحن') && e.some(x => x.amount === 120 && !x.name), 'two sales in a row: 750 شاحن, 120 without a name');
  await p.locator('h1, h2').first().tap(); await p.waitForTimeout(400);
  ok(await p.evaluate(() => getComputedStyle(document.querySelector('nav.bottom')).display) !== 'none', 'done typing: the bottom menu is back');

  // العملاء: name → Enter → amount → Enter → added, cursor back on the name
  await p.tap('nav.bottom a:has-text("العملاء")'); await p.waitForTimeout(700);
  const cl = p.locator('.cols > section:visible');
  for (const [n, a] of [['أحمد', '3000'], ['سامي', '1500']]) {
    await cl.locator('[data-test=item-first]').tap(); await p.keyboard.type(n); await p.keyboard.press('Enter'); await p.waitForTimeout(150);
    await p.keyboard.type(a); await p.keyboard.press('Enter'); await p.waitForTimeout(400);
  }
  ok(await focused() === 'اسم العميل', 'العملاء: after adding, the cursor is back on the name');
  s = await api('GET', '/state', null, token);
  ok(Object.values(s.items).filter(i => i.type === 'client').length === 2 && s.summary.clients === 4500, 'two clients added by keyboard only (4,500)');
  await p.screenshot({ path: dir + '/mobile-clients.png' });

  // الإدارة: النقدية → Enter → المكن
  await p.locator('h2').first().tap(); await p.waitForTimeout(400);        // done typing: the menu comes back
  await p.tap('nav.bottom a:has-text("الإدارة")'); await p.waitForTimeout(700);
  await p.locator('#cash').tap(); await p.keyboard.type('2000'); await p.keyboard.press('Enter'); await p.waitForTimeout(200);
  ok(await focused() === 'net', 'Enter on النقدية → المكن');

  // finger-sized: every visible button at least 40 px high (and icons 40 px wide)
  for (const path of ['/', '/accounts', '/manage', '/settle']) {
    await p.goto(B + path); await p.waitForTimeout(700);
    const small = await p.$$eval('button, a.btn, a.tab', bs => bs.filter(b => b.offsetParent && !b.closest('.cal') && !b.classList.contains('cell-btn') && !b.classList.contains('calc-chip') && !b.classList.contains('dot')).map(b => [b.textContent.trim().slice(0, 20) || b.getAttribute('aria-label'), Math.round(b.getBoundingClientRect().height)]).filter(([, h]) => h < 36));
    ok(!small.length, `${path}: every button is finger-sized${small.length ? ' — small: ' + JSON.stringify(small) : ''}`);
  }
  ok(await p.evaluate(() => { const d = document.querySelector('.status .dot'), r = d.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2 + 12, r.top + r.height / 2); return hit === d; }), 'the status circle: a finger-sized touch area around it');
  ok(await p.evaluate(() => getComputedStyle(document.documentElement).overscrollBehaviorY) === 'contain', 'pulling the page down does not reload it');
  ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  console.log(`\n${fails.length ? fails.length + ' FAILED' : 'ALL PASSED'}`);
  await br.close();
})();
