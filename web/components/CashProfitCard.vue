<!-- ربح الكاش من أول الشهر: hidden until you enter the password. Sum of inputs whose name starts with "ربح كاش" or "ربح الكاش". -->
<script setup>
import { ref } from 'vue';
import { useShop } from '@/stores/shop.js';
import { fmt, toArabicDigits, fmtDate } from '@shared/money.js';
import PasswordDialog from './PasswordDialog.vue';
import Icon from './Icon.vue';
const shop = useShop();
const ask = ref(false), result = ref(null);
const run = async pw => { try { return await shop.cashProfit(pw); } catch (e) { throw new Error(e.status ? e.message : 'يحتاج اتصالًا بجهاز المحل'); } };
</script>
<template>
  <section class="card">
    <div class="card-h"><h2>ربح الكاش من أول الشهر</h2>
      <button v-if="!result" class="btn sm" @click="ask = true"><Icon name="lock" :size="16" /> إظهار</button>
      <button v-else class="btn sm" @click="result = null">إخفاء</button>
    </div>
    <div v-if="result" class="card-b">
      <div class="between"><span class="muted small">من {{ fmtDate(result.from) }} — {{ toArabicDigits(result.count) }} سجل</span><b class="num" style="font-size:22px">{{ fmt(result.total) }}</b></div>
    </div>
    <PasswordDialog v-if="ask" title="ربح الكاش من أول الشهر" confirm-text="إظهار" :run="run" @close="ask = false" @done="r => (result = r)" />
  </section>
</template>
