// The real screens (Vue) against the real server, in a simulated browser.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import { boot } from '../helpers.js';

let s, realFetch = globalThis.fetch, offline = false;
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, label = '') { for (let i = 0; i < 150; i++) { await flushPromises(); if (fn()) return; await wait(20); } throw new Error('timeout ' + label); }

beforeAll(async () => {
  s = await boot();
  globalThis.fetch = (u, o) => (offline ? Promise.reject(new TypeError('offline')) : realFetch(new URL(u, s.base), o));
  window.confirm = () => true;
});
afterAll(() => { globalThis.fetch = realFetch; s.close(); });

async function mountApp() {
  localStorage.clear();
  const { default: App } = await import('../../web/App.vue');
  const { makeRouter } = await import('../../web/router.js');
  const { useShop } = await import('../../web/stores/shop.js');
  const pinia = createPinia(); setActivePinia(pinia);
  const router = makeRouter(true);
  const w = mount(App, { global: { plugins: [pinia, router] }, attachTo: document.body });
  const shop = useShop();
  await shop.start();
  await router.push('/'); await router.isReady();
  return { w, shop, router };
}
const press = (el, key) => el.trigger('keydown', { key });
async function type(el, text) { el.element.value = text; await el.trigger('input'); }

describe('screens', () => {
  it('the whole day: login, first setup, quick entry, wallets, calculator, live التصفية, closing, editing a saved day, offline', async () => {
    const { w, shop, router } = await mountApp();
    // login
    await w.find('input[type=password]').setValue('pw'); await w.find('form').trigger('submit');
    await until(() => w.text().includes('أول تشغيل'), 'setup');
    // first day: type the starting تصفية
    const first = w.find('input.money'); await type(first, '2420000');
    expect(first.element.value).toBe('٢٬٤٢٠٬٠٠٠');                                  // Hindi digits with separators while typing
    await press(first, 'Enter');
    await until(() => w.text().includes('اليومية'), 'main');

    // quick entry: amount + Enter, the cursor stays for the next one
    const input = w.findAll('form.addrow')[0];
    const amount = input.find('input.money');
    await type(amount, '500'); await press(amount, 'Enter'); await flushPromises();
    await type(amount, '٢٥٠'); await input.find('input:not(.money)').setValue('شحن'); await press(amount, 'Enter'); await flushPromises();
    expect(document.activeElement).toBe(amount.element);
    expect(w.text()).toContain('٧٥٠');                                              // total of المدخلات
    expect(w.text()).toContain('شحن');
    const output = w.findAll('form.addrow')[1].find('input.money');
    await type(output, '100'); await press(output, 'Enter'); await flushPromises();

    // wallets & clients page
    await router.push('/accounts'); await flushPromises();
    const [wForm, cForm] = w.findAll('form.addrow');
    await wForm.find('input:not(.money)').setValue('01001234567'); await type(wForm.find('input.money'), '9000'); await press(wForm.find('input.money'), 'Enter'); await flushPromises();
    await cForm.find('input:not(.money)').setValue('أحمد'); await type(cForm.find('input.money'), '1000'); await press(cForm.find('input.money'), 'Enter'); await flushPromises();
    expect(w.text()).toContain('٩٬٠٠٠'); expect(w.text()).toContain('أحمد');
    // the calculator: 746 + 9472 = , then إنهاء
    await w.find('.calc-chip').trigger('click'); await flushPromises();
    const area = document.querySelector('textarea.lines');
    const key = k => area.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
    area.value = '746'; area.dispatchEvent(new Event('input')); await nextTick(); key('+'); await nextTick();
    expect(area.value).toBe('٧٤٦\n+');
    area.value += '9472'; area.dispatchEvent(new Event('input')); await nextTick();
    expect(document.body.textContent).toContain('١٠٬٢١٨');                          // live result below the lines
    key('='); await nextTick();
    expect(document.querySelector('.result-only').style.display).not.toBe('none');    // only the result is shown
    [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'إنهاء').click(); await flushPromises();
    expect(shop.book.rows[Object.keys(shop.items).find(id => shop.items[id].name === 'أحمد')].value).toBe(11218);

    // live التصفية: virtual = 2,420,000 + 650 ; real = 9000 + 11218
    await router.push('/settle'); await flushPromises();
    expect(shop.summary.virtual).toBe(2420650); expect(shop.summary.real).toBe(20218);
    expect(w.text()).toContain('بانتظار عدّ النقدية');                                 // no cash typed yet: not shown as a shortage
    expect(w.find('.result').classes()).toContain('wait');
    // cash typed in الإدارة changes it immediately
    await router.push('/manage'); await flushPromises();
    await type(w.find('#cash'), '2400432'); await flushPromises();
    expect(shop.summary.diff).toBe(0);
    await router.push('/settle'); await flushPromises();
    expect(w.text()).toContain('مطابق'); expect(w.text()).not.toContain('بانتظار عدّ النقدية');
    await until(() => !shop.pending.length, 'synced');

    // close the day (password) -> next day starts from the REAL total
    await router.push('/settle'); await flushPromises();
    [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'إنهاء اليوم').click(); await flushPromises();
    const pw = document.getElementById('pw'); pw.value = 'pw'; pw.dispatchEvent(new Event('input'));
    pw.closest('form').dispatchEvent(new Event('submit', { cancelable: true })); 
    await until(() => shop.snap.days.length === 1, 'closed');
    expect(shop.book.day.opening).toBe(2420650);
    expect(Object.keys(shop.book.entries)).toHaveLength(0);

    // OFFLINE: changes appear at once, wait, then arrive
    offline = true;
    await router.push('/'); await flushPromises();
    const amt2 = w.findAll('form.addrow')[2].find('input.money');                      // المبيعات
    await type(amt2, '75'); await press(amt2, 'Enter'); await flushPromises();
    await shop.sync();
    expect(shop.connected).toBe(false); expect(shop.pending).toHaveLength(1);
    expect(w.find('.wifi').exists()).toBe(true); expect(w.find('.dot.solid').exists()).toBe(true);
    offline = false; await shop.sync();
    await until(() => !shop.pending.length, 'sent after reconnect');

    // edit the saved day: add a forgotten sale; preview shows today's تصفية البارحة changing
    const day = shop.snap.days[0];
    await shop.startEdit(day.id);
    expect(shop.book.day.id).toBe(day.id);                                             // every page shows THAT day
    expect(shop.dispatch({ t: 'addEntry', id: 'forgot', kind: 'sale', amount: 300, name: 'نسيته' })).toBe(true);
    const pv = await shop.previewEdit();
    expect(pv.changes[1].after.opening).toBe(2420650);                                 // a sale does not change the real total
    await shop.saveEdit({ note: 'نسيت بيع', password: 'pw' });
    expect(shop.editing).toBe(null);
    expect((await shop.getDay(day.id)).summary.sale).toBe(300);
    w.unmount();
  });
});
