<!--
  One table for: wallets (المحافظ), clients (العملاء), shop debts (الديون), constants (الثوابت).
  - add: the two fields on top, Enter adds, the cursor goes back to the first field
  - wallet: ✓ = used today (others are dimmed); click the balance to change it
  - client: الدين (from the day before) | الحساب (calculator) | النهائي = الدين + الحساب
  - wallet / debt / constant: the amount, typed in place
  - the first field of the add row also searches the table (also in view-only mode); an exact duplicate is flagged and cannot be added
  - constant: click the amount to change it
  - click a name/number: its history day by day
  - 🗑: deleted items stay at the bottom (struck, red) with their history; "حذف نهائي" removes them and their log
  The total at the bottom counts only the items that are not deleted (clients/debts: the final values).
-->
<script setup>
import { ref, computed, nextTick } from 'vue';
import { useShop } from '@/stores/shop.js';
import { uid } from '@/lib/api.js';
import { fmt, toArabicDigits, toLatinDigits, evalCalc } from '@shared/money.js';
import { rowFinal } from '@shared/engine.js';
import MoneyInput from './MoneyInput.vue';
import Money from './Money.vue';
import Icon from './Icon.vue';
import CalcDialog from './CalcDialog.vue';
import ItemHistory from './ItemHistory.vue';
import DeleteItemDialog from './DeleteItemDialog.vue';

const props = defineProps({
  type: { type: String, required: true },          // wallet | client | debt | constant
  title: { type: String, default: '' },
  bare: Boolean,                                    // inside a folded card (no own card frame)
});
const shop = useShop();
const isCalc = computed(() => props.type === 'client');
const T = {
  wallet: { first: 'رقم المحفظة', second: 'الرصيد', firstMode: 'tel', empty: 'لا توجد محافظ' },
  client: { first: 'اسم العميل', second: 'الدين عليه', empty: 'لا يوجد عملاء' },
  debt: { first: 'الاسم', second: 'المبلغ على المحل', empty: 'لا توجد ديون' },
  constant: { first: 'الاسم (اختياري)', second: 'المبلغ', empty: 'لا توجد ثوابت' },
}[props.type];

/* ----- the rows of this table (today, or the saved day being edited) ----- */
const list = computed(() => {
  const book = shop.book; if (!book) return [];
  const out = [];
  for (const [id, row] of Object.entries(book.rows)) {
    const it = shop.items[id];
    if (!it || it.type !== props.type || (it.purged && !shop.view?.editing)) continue;
    out.push({ id, name: props.type === 'wallet' ? toArabicDigits(it.name) : it.name, row, final: rowFinal(row, it.type), result: isCalc.value ? evalCalc(row.calc) : 0 });
  }
  const q = query.value;
  if (q) return out.filter(x => key(x.name).includes(q)).sort((a, b) => (a.row.status === 'deleted') - (b.row.status === 'deleted') || a.name.localeCompare(b.name, 'ar'));
  const rank = x => (x.row.status === 'deleted' ? 3 : props.type === 'wallet' ? (x.row.active ? 0 : 1) : x.final === 0 && isCalc.value ? 2 : 0);
  return out.sort((a, b) => rank(a) - rank(b) || Math.abs(b.final) - Math.abs(a.final) || a.name.localeCompare(b.name, 'ar'));
});
// the total never follows the search: it is always the whole table
const total = computed(() => {
  const book = shop.book; if (!book) return 0;
  return Object.entries(book.rows).filter(([id, r]) => shop.items[id]?.type === props.type && !shop.items[id].purged && r.status === 'active').reduce((a, [, r]) => a + rowFinal(r, props.type), 0);
});
defineExpose({ total });

/* ----- add + search: the first field filters the table as you type ----- */
const first = ref(''), second = ref(''), firstEl = ref(null), secondEl = ref(null);
// wallets: the digits only (spaces, dashes and Arabic digits don't matter); names: أ/إ/آ=ا, ة=ه, ى=ي
const key = s => (props.type === 'wallet'
  ? toLatinDigits(s).replace(/\D/g, '')
  : String(s || '').trim().toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/[\u064B-\u0652\u0640]/g, '').replace(/\s+/g, ' '));
const query = computed(() => (props.type === 'constant' ? '' : key(first.value)));
// an ACTIVE one with exactly this number / name: it cannot be added again
const duplicate = computed(() => !!query.value && list.value.some(x => x.row.status === 'active' && key(x.name) === query.value));
function add() {
  if (!shop.canEdit) return;
  if (props.type !== 'constant' && !String(first.value).trim()) { firstEl.value?.focus(); return; }
  if (duplicate.value) { firstEl.value?.focus(); return; }
  if (second.value === '') { secondEl.value?.focus(); return; }
  if (shop.dispatch({ t: 'addItem', id: uid(), type: props.type, name: first.value, amount: second.value })) {
    first.value = ''; second.value = '';
    nextTick(() => firstEl.value?.focus());
  }
}

/* ----- change a value in place (wallet balance / constant amount) ----- */
const editing = ref(null);
const startEdit = x => { if (!shop.canEdit) return; editing.value = { id: x.id, value: x.row.value }; nextTick(() => document.getElementById('val-' + x.id)?.focus()); };
function saveEdit() {
  const e = editing.value; editing.value = null;
  if (!e || e.value === '' || e.value === shop.book.rows[e.id]?.value) return;
  shop.dispatch({ t: 'setValue', id: e.id, value: e.value });
}

/* ----- dialogs ----- */
const calcFor = ref(null), historyFor = ref(null), deleteFor = ref(null);
const saveCalc = calc => { shop.dispatch({ t: 'setCalc', id: calcFor.value.id, calc }); calcFor.value = null; };
const restore = x => shop.dispatch({ t: 'restoreItem', id: x.id });
</script>

<template>
  <component :is="bare ? 'div' : 'section'" :class="bare ? '' : 'card'">
    <div v-if="!bare && title" class="card-h"><h2>{{ title }}</h2></div>

    <form class="addrow" @submit.prevent="add">
      <div class="find" style="flex:1.2">
        <Icon v-if="type !== 'constant'" name="search" :size="16" class="find-ic" :class="{ ltr: type === 'wallet' }" />
        <input v-if="type === 'wallet'" ref="firstEl" v-model="first" class="input" :class="{ dup: duplicate }" :placeholder="T.first" inputmode="tel" dir="ltr" @keydown.enter.prevent="secondEl.focus()" :aria-label="T.first" data-test="item-first" />
        <input v-else ref="firstEl" v-model="first" class="input" :class="{ dup: duplicate, pad: type !== 'constant' }" :placeholder="T.first" :disabled="!shop.canEdit && type === 'constant'" @keydown.enter.prevent="secondEl.focus()" :aria-label="T.first" data-test="item-first" />
      </div>
      <MoneyInput ref="secondEl" v-model="second" style="flex:1" :placeholder="T.second" :allow-negative="type === 'client' || type === 'wallet'" :disabled="!shop.canEdit" @enter="add" :aria-label="T.second" />
      <button class="btn primary icon" style="width:42px;min-height:38px;color:#fff" :disabled="!shop.canEdit || duplicate" aria-label="إضافة"><Icon name="plus" /></button>
    </form>
    <p v-if="duplicate && shop.canEdit" class="dup-msg" data-test="dup-msg">{{ type === 'wallet' ? 'هذا الرقم موجود بالفعل' : 'هذا الاسم موجود بالفعل' }}</p>

    <div class="scroll">
      <table class="tbl">
        <thead>
          <tr v-if="type === 'wallet'"><th style="width:1%"><span class="sr-only">مستخدمة اليوم</span>✓</th><th>الرقم</th><th class="n">الرصيد</th><th></th></tr>
          <tr v-else-if="isCalc"><th>{{ type === 'client' ? 'العميل' : 'الاسم' }}</th><th class="n wide-only">الدين</th><th class="n">الحساب</th><th class="n">النهائي</th><th></th></tr>
          <tr v-else><th>الاسم</th><th class="n">المبلغ</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="x in list" :key="x.id" :class="{ deleted: x.row.status === 'deleted', dim: x.row.status === 'active' && ((type === 'wallet' && !x.row.active) || (isCalc && x.final === 0)) }">
            <td v-if="type === 'wallet'">
              <input type="checkbox" class="check" :checked="x.row.active" :disabled="!shop.canEdit || x.row.status === 'deleted'" :aria-label="'مستخدمة اليوم: ' + x.name"
                     @change="e => shop.dispatch({ t: 'setActive', id: x.id, active: e.target.checked }, { quiet: true })" />
            </td>
            <td><button class="cell-btn" :dir="type === 'wallet' ? 'ltr' : null" title="السجل" @click="historyFor = x">{{ x.name }}</button>
              <div v-if="isCalc" class="narrow-only small muted">الدين: <Money :value="x.row.opening" /></div></td>

            <template v-if="isCalc">
              <td class="n wide-only"><Money :value="x.row.opening" /></td>
              <td class="n">
                <button class="cell-btn calc-chip" :class="{ has: x.row.calc }" :disabled="x.row.status === 'deleted'" title="الحاسبة" @click="calcFor = x">
                  <template v-if="x.row.calc"><Money :value="x.result" signed /></template>
                  <template v-else>احسب</template>
                </button>
              </td>
              <td class="n"><b><Money :value="x.final" /></b></td>
            </template>
            <td v-else class="n">
              <MoneyInput v-if="editing && editing.id === x.id" :id="'val-' + x.id" v-model="editing.value" :allow-negative="type === 'wallet'" @enter="saveEdit" @escape="editing = null" @blur="saveEdit" />
              <button v-else class="cell-btn" :disabled="x.row.status === 'deleted'" title="اضغط للتعديل" @click="startEdit(x)"><Money :value="x.row.value" /></button>
            </td>

            <td class="actions">
              <template v-if="x.row.status === 'deleted'">
                <button class="btn icon" title="استرجاع" aria-label="استرجاع" :disabled="!shop.canEdit" @click="restore(x)"><Icon name="restore" /></button>
                <button v-if="!shop.view?.editing" class="btn icon" title="حذف نهائي" aria-label="حذف نهائي" :disabled="!shop.canEdit" @click="deleteFor = { ...x, onlyPurge: true }"><Icon name="trash" /></button>
              </template>
              <button v-else class="btn icon" title="حذف" aria-label="حذف" :disabled="!shop.canEdit" @click="deleteFor = x"><Icon name="trash" /></button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="!list.length" class="empty">{{ query ? 'لا توجد نتيجة' : T.empty }}</p>
    </div>
    <div class="total"><span>الإجمالي</span><span class="num">{{ fmt(total) }}</span></div>

    <CalcDialog v-if="calcFor" :name="calcFor.name" :opening="calcFor.row.opening" :calc="calcFor.row.calc" :readonly="!shop.canEdit" @close="calcFor = null" @save="saveCalc" />
    <ItemHistory v-if="historyFor" :id="historyFor.id" :name="historyFor.name" :type="type" @close="historyFor = null" />
    <DeleteItemDialog v-if="deleteFor" :item="deleteFor" :type="type" @close="deleteFor = null" />
  </component>
</template>

<style scoped>
.find { position: relative; min-width: 0; }
.find .input { width: 100%; }
.find-ic { position: absolute; top: 50%; transform: translateY(-50%); inset-inline-start: 10px; color: var(--faint); pointer-events: none; }
.find input[dir=ltr] { padding-left: 32px; }            /* wallet numbers are written left-to-right: icon on the left */
.find-ic.ltr { inset-inline-start: auto; left: 10px; }
.find .input.pad { padding-inline-start: 32px; }
.find .input.dup { border-color: var(--neg); box-shadow: 0 0 0 3px var(--neg-soft); }
.dup-msg { margin: 0; padding: 6px 14px; background: var(--neg-soft); color: var(--neg); font-size: 13px; border-bottom: 1px solid var(--line); }
.narrow-only { display: none; }
@media (max-width: 600px) { .wide-only { display: none; } .narrow-only { display: block; } }
.calc-chip { font-size: 13px; min-width: 64px; text-align: center; border: 1px dashed var(--line-strong); color: var(--muted); }
.calc-chip.has { border-style: solid; border-color: #ddd3f5; background: var(--brand-soft); color: var(--brand-ink); }
.calc-chip:disabled { cursor: default; opacity: .6; }
</style>
