<!--
  The small circle at the bottom corner:
  - faint circle               : everything is saved
  - solid circle               : changes waiting to be saved -> click to download a copy
  - blinking wifi icon         : no connection (to the shop computer, or the shop computer has no internet)
  - red number                 : changes that were not accepted -> click to see them
-->
<script setup>
import { computed, ref } from 'vue';
import { useShop } from '@/stores/shop.js';
import { toArabicDigits } from '@shared/money.js';
import Icon from './Icon.vue';
import FailedDialog from './FailedDialog.vue';
const shop = useShop();
const showFailed = ref(false);
const offline = computed(() => !shop.connected || shop.internetOk === false);
const waiting = computed(() => shop.pending.length + (shop.system?.turso?.pendingRows || 0));
const solid = computed(() => waiting.value > 0);
const tip = computed(() => {
  const where = !shop.connected ? 'لا يوجد اتصال بجهاز المحل' : shop.internetOk === false ? 'لا يوجد إنترنت على جهاز المحل (Turso)' : '';
  const what = shop.pending.length ? `${toArabicDigits(shop.pending.length)} تغيير على هذا الجهاز بانتظار الإرسال` : waiting.value ? 'تغييرات بانتظار الحفظ على Turso' : 'كل التغييرات محفوظة';
  return [where, what, 'اضغط لتنزيل نسخة'].filter(Boolean).join(' — ');
});
</script>
<template>
  <div class="status">
    <button v-if="shop.failed.length" class="failed" :title="'تعديلات لم تُقبل — اضغط للعرض'" @click="showFailed = true">{{ toArabicDigits(shop.failed.length) }}</button>
    <span v-if="offline" class="wifi" aria-hidden="true"><Icon name="wifiOff" :size="18" /></span>
    <button class="dot" :class="{ solid, offline }" :aria-label="tip" @click="shop.download()"><span class="tip" role="tooltip">{{ tip }}</span></button>
    <FailedDialog v-if="showFailed" @close="showFailed = false" />
  </div>
</template>
<style scoped>
.status { position: fixed; z-index: 40; inset-inline-end: 14px; bottom: 82px; display: flex; align-items: center; gap: 8px; }
.dot { position: relative; width: 14px; height: 14px; padding: 0; border-radius: 50%; border: 2px solid #c9c4dd; background: #ece9f6; cursor: pointer; }
.dot.solid { background: var(--brand); border-color: var(--brand); box-shadow: 0 0 0 4px rgba(106, 75, 199, .15); }
.dot.offline:not(.solid) { opacity: .5; }
.tip { display: none; position: absolute; bottom: 22px; inset-inline-end: -6px; width: max-content; max-width: 260px; padding: 6px 10px; border-radius: 8px; background: #3a3a50; color: #fff; font-size: 12px; line-height: 1.5; text-align: start; }
.dot:hover .tip, .dot:focus-visible .tip { display: block; }
.wifi { color: var(--neg); animation: blink 1.4s ease-in-out infinite; display: inline-flex; }
@keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: .15; } }
.failed { min-width: 22px; height: 22px; border-radius: 11px; border: 0; background: var(--neg); color: #fff; font-size: 12px; font-weight: 700; cursor: pointer; }
@media (min-width: 900px) { .status { bottom: 16px; } }
</style>
