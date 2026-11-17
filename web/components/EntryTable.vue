<!--
  المدخلات / المخرجات / المبيعات — works like a spreadsheet:
  type the amount (and a name if you want) -> Enter -> it is added and the cursor is
  ready for the next one. Click an amount or a name to change it. 🗑 deletes (with "تراجع").
-->
<script setup>
import { ref, computed, nextTick } from 'vue';
import { useShop } from '@/stores/shop.js';
import { useToasts } from '@/stores/toasts.js';
import { uid } from '@/lib/api.js';
import { fmt, toArabicDigits } from '@shared/money.js';
import MoneyInput from './MoneyInput.vue';
import Money from './Money.vue';
import Icon from './Icon.vue';

const props = defineProps({ kind: { type: String, required: true }, title: { type: String, required: true } });
const shop = useShop(), toasts = useToasts();

const rows = computed(() => Object.values(shop.book?.entries || {}).filter(e => e.kind === props.kind).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))));
const total = computed(() => rows.value.reduce((a, e) => a + e.amount, 0));
const time = s => (s ? toArabicDigits(new Date(s).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })) : '');

/* ----- the "add" row ----- */
const amount = ref(''), name = ref(''), amountEl = ref(null);
function add() {
  if (amount.value === '' || !(amount.value > 0)) { amountEl.value?.focus(); return; }
  if (shop.dispatch({ t: 'addEntry', id: uid(), kind: props.kind, amount: amount.value, name: name.value })) {
    amount.value = ''; name.value = '';
    nextTick(() => amountEl.value?.focus());              // ready for the next value
  }
}

/* ----- editing a row in place ----- */
const editing = ref(null);   // { id, field, value }
const startEdit = (e, field) => { if (!shop.canEdit) return; editing.value = { id: e.id, field, value: e[field] }; nextTick(() => document.getElementById('edit-' + e.id)?.focus()); };
function saveEdit() {
  const x = editing.value; if (!x) return;
  editing.value = null;
  const e = shop.book.entries[x.id]; if (!e || e[x.field] === x.value) return;
  if (x.field === 'amount' && !(x.value > 0)) return;
  shop.dispatch({ t: 'editEntry', id: x.id, [x.field]: x.value });
}
function remove(e) {
  if (shop.dispatch({ t: 'delEntry', id: e.id }, { quiet: true }))
    toasts.show('تم الحذف', 'done', { label: 'تراجع', run: () => shop.dispatch({ t: 'addEntry', id: e.id, kind: e.kind, amount: e.amount, name: e.name }, { quiet: true }) });
}
defineExpose({ focus: () => amountEl.value?.focus() });
</script>

<template>
  <section class="card">
    <div class="card-h"><h2>{{ title }}</h2><span class="muted small num">{{ toArabicDigits(rows.length) }} سجل</span></div>
    <form class="addrow" @submit.prevent="add">
      <MoneyInput ref="amountEl" v-model="amount" :placeholder="'المبلغ'" style="flex:1" :disabled="!shop.canEdit" @enter="add" aria-label="المبلغ" />
      <input v-model="name" class="input" style="flex:1.3" placeholder="الاسم (اختياري)" :disabled="!shop.canEdit" @keydown.enter.prevent="add" aria-label="الاسم" />
      <button class="btn primary icon" style="width:42px;min-height:38px;color:#fff" :disabled="!shop.canEdit" aria-label="إضافة"><Icon name="plus" /></button>
    </form>
    <div class="scroll">
      <table class="tbl">
        <tbody>
          <tr v-for="e in rows" :key="e.id">
            <td class="amt" style="width:40%">
              <MoneyInput v-if="editing && editing.id === e.id && editing.field === 'amount'" :id="'edit-' + e.id" v-model="editing.value" @enter="saveEdit" @escape="editing = null" @blur="saveEdit" />
              <button v-else class="cell-btn" :title="'تعديل المبلغ'" @click="startEdit(e, 'amount')"><Money :value="e.amount" /></button>
            </td>
            <td>
              <input v-if="editing && editing.id === e.id && editing.field === 'name'" :id="'edit-' + e.id" v-model="editing.value" class="input" @keydown.enter.prevent="saveEdit" @keydown.esc="editing = null" @blur="saveEdit" />
              <button v-else class="cell-btn" :class="{ muted: !e.name }" @click="startEdit(e, 'name')">{{ e.name || 'بدون اسم' }}</button>
              <span v-if="e.late" class="tag" :title="'كُتب أثناء يوم ' + e.late">يوم سابق</span>
              <div class="muted small num">{{ time(e.createdAt) }}</div>
            </td>
            <td class="actions"><button class="btn icon" :disabled="!shop.canEdit" aria-label="حذف" title="حذف" @click="remove(e)"><Icon name="trash" /></button></td>
          </tr>
        </tbody>
      </table>
      <p v-if="!rows.length" class="empty">لا يوجد</p>
    </div>
    <!-- the total sits on the right, under the amounts -->
    <div class="total"><span class="num">{{ fmt(total) }}</span><span>الإجمالي</span></div>
  </section>
</template>

<style scoped>
/* Amounts on the RIGHT (the reading side in Arabic): the cell, the edit field and the add field. */
.amt { text-align: right; }
.amt :deep(.input.money), .addrow :deep(.input.money) { text-align: right; }
.addrow :deep(.input.money::placeholder) { text-align: right; }
</style>
