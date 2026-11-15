<!-- Version, automatic updates from GitHub, and the Turso online copy. -->
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
      <div class="between"><span class="muted">التحديث التلقائي</span><span>{{ sys.update ? (sys.update.message || '—') : 'غير مفعّل' }}</span></div>
      <div v-if="sys.update?.checkedAt" class="between"><span class="muted">آخر فحص للتحديث</span><span>{{ when(sys.update.checkedAt) }}</span></div>
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
