<!-- Add or subtract any amount on التصفية الحقيقية, with a note saying what it is. Enter adds. -->
<script setup>
import { ref, computed, nextTick } from 'vue';
import { useShop } from '@/stores/shop.js';
import { uid } from '@/lib/api.js';
import { fmt } from '@shared/money.js';
import MoneyInput from './MoneyInput.vue';
import Icon from './Icon.vue';
const shop = useShop();
const sign = ref(1), amount = ref(''), note = ref(''), amountEl = ref(null), noteEl = ref(null);
const rows = computed(() => Object.values(shop.book?.adjs || {}));
const total = computed(() => rows.value.reduce((a, x) => a + x.amount, 0));
function add() {
  if (!(amount.value > 0)) { amountEl.value?.focus(); return; }
  if (!note.value.trim()) { noteEl.value?.focus(); return; }
  if (shop.dispatch({ t: 'addAdj', id: uid(), amount: sign.value * amount.value, note: note.value })) { amount.value = ''; note.value = ''; nextTick(() => amountEl.value?.focus()); }
}
</script>
<template>
  <section class="card">
    <div class="card-h"><h2>إضافة أو خصم من التصفية الحقيقية</h2></div>
    <form class="addrow" style="flex-wrap:wrap" @submit.prevent="add">
      <div class="seg" role="radiogroup"><button type="button" :class="{ on: sign === 1 }" @click="sign = 1">+ إضافة</button><button type="button" :class="{ on: sign === -1 }" @click="sign = -1">− خصم</button></div>
      <MoneyInput ref="amountEl" v-model="amount" style="flex:1;min-width:110px" placeholder="المبلغ" :disabled="!shop.canEdit" @enter="noteEl.focus()" />
      <input ref="noteEl" v-model="note" class="input" style="flex:2;min-width:160px" placeholder="السبب" :disabled="!shop.canEdit" @keydown.enter.prevent="add" />
      <button class="btn primary icon" style="width:42px;min-height:38px;color:#fff" :disabled="!shop.canEdit" aria-label="إضافة"><Icon name="plus" /></button>
    </form>
    <table class="tbl">
      <tbody>
        <tr v-for="a in rows" :key="a.id">
          <td class="num" :class="a.amount > 0 ? 'pos' : 'neg'" style="width:35%">{{ a.amount > 0 ? '+' : '−' }} {{ fmt(Math.abs(a.amount)) }}</td>
          <td>{{ a.note }} <span v-if="a.late" class="tag">يوم سابق</span></td>
          <td class="actions"><button class="btn icon" aria-label="حذف" :disabled="!shop.canEdit" @click="shop.dispatch({ t: 'delAdj', id: a.id })"><Icon name="trash" /></button></td>
        </tr>
      </tbody>
    </table>
    <p v-if="!rows.length" class="empty">لا يوجد</p>
    <div class="total"><span>الصافي</span><span class="num">{{ total < 0 ? '−' : '' }}{{ fmt(Math.abs(total)) }}</span></div>
  </section>
</template>
