<!-- النقدية و المكن (typed; saved as you type; counted in التصفية الحقيقية) -->
<script setup>
import { ref, watch } from 'vue';
import { useShop } from '@/stores/shop.js';
import MoneyInput from './MoneyInput.vue';
import { useToasts } from '@/stores/toasts.js';
const toasts = useToasts();
let typed = false;   // a value was typed: say "saved" when you leave the field
const shop = useShop();
// a counted 0 shows «٠» (it is not the same as «not typed yet», which stays empty)
const shown = (v, counted) => (counted ? v ?? 0 : v || '');
const cash = ref(shown(shop.book?.day.cash, shop.book?.day.cashChanged)), net = ref(shown(shop.book?.day.network, shop.book?.day.networkChanged));
watch(() => [shop.book?.day.cash, shop.book?.day.cashChanged], ([v, c]) => { if (document.activeElement?.id !== 'cash') cash.value = shown(v, c); });
watch(() => [shop.book?.day.network, shop.book?.day.networkChanged], ([v, c]) => { if (document.activeElement?.id !== 'net') net.value = shown(v, c); });
// typing the same value still counts the first time (a real 0 means "counted: nothing"), so the gap can show
const save = (t, v) => {
  const d = shop.book.day, cur = t === 'setCash' ? d.cash : d.network, counted = t === 'setCash' ? d.cashChanged : d.networkChanged;
  if (v !== '' && (v !== cur || !counted) && shop.dispatch({ t, value: v }, { quiet: true })) typed = true;
};
const done = label => { if (typed) { toasts.show('تم حفظ ' + label); typed = false; } };
// Enter: from النقدية to المكن; from المكن the keyboard closes (both are saved as you type)
const toNet = () => document.getElementById('net')?.focus();
const blurNet = () => document.getElementById('net')?.blur();
</script>
<template>
  <section class="card">
    <div class="card-h"><h2>النقدية والمكن</h2></div>
    <div class="card-b grid2">
      <div><label class="label" for="cash">النقدية الموجودة في المحل</label><MoneyInput id="cash" v-model="cash" :disabled="!shop.canEdit" enterkeyhint="next" @enter="toNet" @update:model-value="v => save('setCash', v)" @blur="done('النقدية')" /></div>
      <div><label class="label" for="net">المكن</label><MoneyInput id="net" v-model="net" :disabled="!shop.canEdit" enterkeyhint="done" @enter="blurNet" @update:model-value="v => save('setNetwork', v)" @blur="done('المكن')" /></div>
    </div>
  </section>
</template>
