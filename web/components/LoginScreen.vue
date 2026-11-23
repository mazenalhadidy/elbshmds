<script setup>
import { ref } from 'vue';
import { useShop } from '@/stores/shop.js';
import { useToasts } from '@/stores/toasts.js';
const shop = useShop();
const pw = ref(''), err = ref(''), busy = ref(false);
async function go() {
  busy.value = true; err.value = '';
  try { await shop.login(pw.value); useToasts().show('تم تسجيل الدخول'); } catch (e) { err.value = e.status ? e.message : 'لا يوجد اتصال بجهاز المحل'; pw.value = ''; }
  busy.value = false;
}
</script>
<template>
  <form class="card center" @submit.prevent="go">
    <img src="/icon.svg" width="56" height="56" alt="" />
    <h1>محل الباشمهندس</h1>
    <input v-model="pw" class="input" type="password" placeholder="كلمة المرور" autocomplete="current-password" enterkeyhint="go" autofocus aria-label="كلمة المرور" />
    <p v-if="err" class="hint neg" role="alert">{{ err }}</p>
    <button class="btn primary wide" style="margin-top:14px" :disabled="busy || !pw">دخول</button>
  </form>
</template>
<style scoped>
.center { max-width: 360px; margin: 12vh auto; padding: 28px 24px; text-align: center; }
h1 { font-size: 20px; margin: 10px 0 18px; }
</style>
