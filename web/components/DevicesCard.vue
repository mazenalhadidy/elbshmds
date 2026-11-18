<!-- Phones: the address (and QR code) to open on a phone on the same Wi-Fi, and the devices connected right now. -->
<script setup>
import { computed, ref } from 'vue';
import { useShop } from '@/stores/shop.js';
import { api, isOffline } from '@/lib/api.js';
import { useToasts } from '@/stores/toasts.js';
import { toArabicDigits } from '@shared/money.js';
import Icon from './Icon.vue';
import PasswordDialog from './PasswordDialog.vue';
const shop = useShop();
const sys = computed(() => shop.system);
// disconnect another device (password): it is logged out at once and must log in again
const leaving = ref(null);
const toasts = useToasts();
async function disconnect(pw) {
  try { await api('POST', `/devices/${encodeURIComponent(leaving.value.id)}/disconnect`, { password: pw }); }
  catch (e) { throw new Error(isOffline(e) ? 'يحتاج اتصالًا بجهاز المحل' : e.message); }
  await shop.refreshSystem(); toasts.show('تم فصل الجهاز');
}
const ago = t => { const s = Math.round((Date.now() - t) / 1000); return s < 60 ? 'الآن' : s < 3600 ? `منذ ${toArabicDigits(Math.round(s / 60))} دقيقة` : `منذ ${toArabicDigits(Math.round(s / 3600))} ساعة`; };
</script>
<template>
  <section class="card">
    <div class="card-h"><h2>الهواتف والأجهزة المتصلة</h2></div>
    <div class="card-b">
      <p v-if="!sys" class="muted">يحتاج اتصالًا بجهاز المحل.</p>
      <template v-else>
        <div v-if="sys.phoneUrls.length" class="phones">
          <img :src="'/api/qr?text=' + encodeURIComponent(sys.phoneUrls[0])" width="132" height="132" alt="رمز QR لفتح البرنامج على الهاتف" />
          <div>
            <p style="margin-top:0">على الهاتف (نفس شبكة الواي فاي): امسح الرمز أو افتح Chrome واكتب:</p>
            <p v-for="u in sys.phoneUrls" :key="u" dir="ltr" class="url">{{ u }}</p>
            <p class="hint">لو لم تفتح على الهاتف: شغّل الملف <b>allow-phones.cmd</b> مرة واحدة على جهاز المحل (كمسؤول).</p>
          </div>
        </div>
        <p v-else class="muted">جهاز المحل غير متصل بشبكة.</p>
        <h3 class="small muted" style="margin:16px 0 6px">الأجهزة</h3>
        <ul class="devs">
          <li v-for="d in sys.devices" :key="d.id" class="between">
            <span class="row"><i class="dot" :class="{ on: d.online }"></i>{{ d.name }} <span class="muted small" dir="ltr">{{ d.ip }}</span>
              <span v-if="d.id === sys.thisDevice" class="tag" style="background:var(--brand-soft);color:var(--brand-ink)">هذا الجهاز</span>
              <span v-if="sys.lock.holder === d.id" class="tag" style="background:var(--pos-soft);color:var(--pos)">يعدّل الآن</span></span>
            <span class="row" style="gap:8px"><span class="muted small">{{ ago(d.lastSeen) }}</span>
              <button v-if="d.id !== sys.thisDevice" class="btn icon del" title="فصل" aria-label="فصل الجهاز" data-test="disconnect" @click="leaving = d"><Icon name="x" :size="16" /></button></span>
          </li>
        </ul>
        <button v-if="!shop.lock.editor" class="btn primary sm" style="margin-top:10px" @click="shop.takeOver()">اجعل هذا الجهاز هو الذي يعدّل</button>
      </template>
    </div>
    <PasswordDialog v-if="leaving" :title="'فصل ' + leaving.name" confirm-text="افصل" danger :run="disconnect" @close="leaving = null" />
  </section>
</template>
<style scoped>
.phones { display: flex; gap: 16px; align-items: flex-start; flex-wrap: wrap; }
.phones img { border: 1px solid var(--line); border-radius: 10px; background: #fff; }
.url { font-weight: 700; font-size: 17px; margin: 4px 0; color: var(--brand-ink); }
.devs { list-style: none; padding: 0; margin: 0; display: grid; gap: 6px; }
.devs li { align-items: center; gap: 8px; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: #c8c8d4; display: inline-block; } .dot.on { background: var(--pos); }
</style>
