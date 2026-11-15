<!--
  Deleting a wallet / client / shop debt / constant.
  - normal delete: it stays at the bottom of its table, struck in red, with its history (you can restore it)
  - "delete with its log": gone from today and from its history (needs the password). Saved days keep it: what's done is done.
-->
<script setup>
import { ref } from 'vue';
import { useShop } from '@/stores/shop.js';
import { useToasts } from '@/stores/toasts.js';
import Modal from './Modal.vue';

const props = defineProps({ item: Object, type: String });
const emit = defineEmits(['close']);
const shop = useShop(), toasts = useToasts();
const purge = ref(!!props.item.onlyPurge), pw = ref(''), err = ref(''), busy = ref(false);
const canPurge = !shop.view?.editing;                   // purging is only for today, not while editing a saved day
const what = { wallet: 'المحفظة', client: 'العميل', debt: 'الدين', constant: 'الثابت' }[props.type];

async function go() {
  err.value = '';
  if (!purge.value) { if (shop.dispatch({ t: 'delItem', id: props.item.id })) emit('close'); return; }
  if (!pw.value) { err.value = 'اكتب كلمة المرور'; return; }
  busy.value = true;
  try { await shop.purgeItem(props.item.id, pw.value); toasts.show('تم الحذف النهائي'); emit('close'); }
  catch (e) { err.value = e.status ? e.message : 'الحذف النهائي يحتاج اتصالًا بجهاز المحل'; pw.value = ''; }
  busy.value = false;
}
</script>
<template>
  <Modal :title="'حذف ' + what + ': ' + item.name" @close="emit('close')">
    <p v-if="!item.onlyPurge" style="margin-top:0">سيبقى في أسفل الجدول مشطوبًا بالأحمر مع سجله، ولن يُحسب في الإجمالي. يمكنك استرجاعه في أي وقت.</p>
    <label v-if="canPurge" class="row purge" :class="{ on: purge }">
      <input v-model="purge" type="checkbox" class="check" :disabled="item.onlyPurge" />
      <span><b>حذف نهائي مع سجله</b><br><span class="small muted">لا يمكن التراجع. الأيام المحفوظة سابقًا لا تتغير.</span></span>
    </label>
    <div v-if="purge" style="margin-top:12px">
      <label class="label" for="dpw">كلمة المرور</label>
      <input id="dpw" v-model="pw" class="input" type="password" autocomplete="current-password" @keydown.enter.prevent="go" />
    </div>
    <p v-if="err" class="hint neg" role="alert">{{ err }}</p>
    <template #footer>
      <button class="btn" @click="emit('close')">إلغاء</button>
      <button class="btn danger" :disabled="busy" @click="go">{{ purge ? 'حذف نهائي' : 'حذف' }}</button>
    </template>
  </Modal>
</template>
<style scoped>
.purge { align-items: flex-start; gap: 10px; padding: 12px; border: 1px solid var(--line); border-radius: 10px; cursor: pointer; }
.purge.on { border-color: #ecc9c6; background: var(--neg-soft); }
</style>
