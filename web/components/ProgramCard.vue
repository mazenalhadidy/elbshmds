<!-- Version, updates from GitHub (installed only from «تحديث متاح»), and the Turso online copy. -->
<script setup>
import { computed, ref } from 'vue';
import { useShop } from '@/stores/shop.js';
import { api } from '@/lib/api.js';
import { useToasts } from '@/stores/toasts.js';
import { toArabicDigits } from '@shared/money.js';
const shop = useShop();
const sys = computed(() => shop.system);
const when = s => (s ? toArabicDigits(new Date(s).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })) : '—');
const busy = ref(false);
const toasts = useToasts();
/* why «تحديث متاح» does (not) show: said plainly, with what to do */
const up = computed(() => sys.value?.update || null);
const alive = computed(() => !!up.value?.aliveAt && Date.now() - new Date(up.value.aliveAt).getTime() < 3 * 60e3);
const problem = computed(() => {
  if (!sys.value) return '';
  if (!up.value || !alive.value) return 'التحديث لا يعمل: البرنامج لم يُشغَّل من start-shop.cmd (أو الاختصار / التشغيل التلقائي).';
  if (!up.value.repo) return 'التحديث غير مفعّل: أضف السطر GITHUB_REPO=mazenalhadidy/elbshmds في ملف .env ثم أعد تشغيل البرنامج.';
  if (!sys.value.updatePassword) return 'كلمة مرور التحديث غير مضبوطة: أضف UPDATE_PASSWORD= في ملف .env ثم أعد تشغيل البرنامج.';
  return '';
});
const checking = ref(false);
async function checkNow() {
  checking.value = true;
  try { await api('POST', '/update/check'); toasts.show('جارٍ الفحص — قد يستغرق تجهيز التحديث بضع دقائق'); setTimeout(() => shop.refreshSystem(), 8000); }
  catch { toasts.show('لا يوجد اتصال بجهاز المحل', 'error'); }
  checking.value = false;
}
async function syncNow() {
  busy.value = true;
  try { const st = await api('POST', '/sync-now'); await shop.refreshSystem(); st.lastError ? toasts.show('تعذّر الحفظ على Turso — سيُعاد المحاولة تلقائيًا', 'error') : toasts.show('تم الحفظ على Turso'); }
  catch { toasts.show('لا يوجد اتصال بجهاز المحل', 'error'); }
  busy.value = false;
}
</script>
<template>
  <section class="card">
    <div class="card-h"><h2>البرنامج وقاعدة البيانات</h2></div>
    <div class="card-b small" v-if="sys">
      <div class="between"><span class="muted">الإصدار</span><span dir="ltr">{{ (sys.version.sha || 'local').slice(0, 7) }}</span></div>
      <div class="between"><span class="muted">التحديث</span><span data-test="update-msg">{{ up && alive ? (up.message || '—') : 'لا يعمل' }}</span></div>
      <div v-if="up?.checkedAt" class="between"><span class="muted">آخر فحص للتحديث</span><span>{{ when(up.checkedAt) }}</span></div>
      <p v-if="problem" class="hint warn-hint" data-test="update-problem">⚠️ {{ problem }}</p>
      <details v-if="up?.lastError && alive" class="err"><summary class="muted">سبب آخر خطأ</summary><pre dir="ltr">{{ up.lastError }}</pre></details>
      <button v-if="alive && up?.repo" class="btn sm" style="margin-top:8px" :disabled="checking || up?.switching" data-test="check-now" @click="checkNow">افحص الآن</button>
      <hr style="border:0;border-top:1px solid var(--line);margin:10px 0">
      <template v-if="sys.turso.configured">
        <div class="between"><span class="muted">آخر حفظ على Turso</span><span>{{ when(sys.turso.lastOkAt) }}</span></div>
        <div class="between"><span class="muted">بانتظار الإرسال إلى Turso</span><span class="num">{{ toArabicDigits(sys.turso.pendingRows || 0) }}</span></div>
        <p v-if="sys.turso.lastError" class="hint neg">لا يوجد إنترنت أو Turso لا يرد — البيانات محفوظة على جهاز المحل وستُرسل تلقائيًا.</p>
        <div class="row" style="margin-top:10px"><button class="btn sm" :disabled="busy" @click="syncNow">مزامنة الآن</button><button class="btn sm" @click="shop.download()">تنزيل نسخة كاملة</button></div>
      </template>
      <template v-else>
        <p class="muted" style="margin:0">Turso غير مضبوط: البيانات على جهاز المحل فقط (مع نسخ احتياطية يومية).</p>
        <button class="btn sm" style="margin-top:10px" @click="shop.download()">تنزيل نسخة كاملة</button>
      </template>
    </div>
    <div v-else class="card-b muted">يحتاج اتصالًا بجهاز المحل.</div>
  </section>
</template>
<style scoped>
.err pre { white-space: pre-wrap; font-size: 11px; max-height: 160px; overflow: auto; background: var(--surface-2); padding: 8px; border-radius: 8px; }
</style>
