<!-- First start only: type the تصفية to start from (it becomes "تصفية البارحة" of the first day). -->
<script setup>
import { ref } from 'vue';
import { useShop } from '@/stores/shop.js';
import MoneyInput from './MoneyInput.vue';
const shop = useShop();
const v = ref(''), err = ref(''), busy = ref(false);
async function go() {
  if (v.value === '') { err.value = 'اكتب المبلغ'; return; }
  busy.value = true; err.value = '';
  try { await shop.setup(v.value); } catch (e) { err.value = e.message; }
  busy.value = false;
}
</script>
<template>
  <div class="card center">
    <h1>أول تشغيل</h1>
    <p class="muted">تصفية البارحة لأول يوم</p>
    <MoneyInput v-model="v" placeholder="المبلغ" @enter="go" />
    <p v-if="err" class="hint neg">{{ err }}</p>
    <button class="btn primary wide" style="margin-top:14px" :disabled="busy" @click="go">ابدأ</button>
  </div>
</template>
<style scoped>.center { max-width: 420px; margin: 10vh auto; padding: 28px 24px; text-align: center; } h1 { font-size: 20px; margin: 0 0 6px; }</style>
