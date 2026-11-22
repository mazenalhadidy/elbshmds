<!--
  One table for: wallets (المحافظ), clients (العملاء), shop debts (الديون), constants (الثوابت).
  - add: the two fields on top, Enter adds, the cursor goes back to the first field
  - wallet: ✓ = used today (others are dimmed); click the balance to change it
  - client / debt (the same table): التغيير (the calculator) | النهائي (tap it, type the new value: the difference
    becomes today's change). The value from the day before is not shown. Sorted by the balance (largest first).
  - wallet / constant: the amount, typed in place
  - the first field of the add row also searches the table (also in view-only mode): letters and digits, spaces ignored;
    an exact duplicate is flagged and cannot be added («0100… فودافون» and «0100… اتصالات» are different)
  - constant: click the amount to change it
  - click a name/number: its history day by day
  - 🗑: deleted items stay at the bottom (struck, red) with their history; "حذف نهائي" removes them and their log
  The total at the bottom counts only the items that are not deleted (clients/debts: the final values).
-->
<script setup>
import { ref, computed, nextTick } from 'vue';
import { useShop } from '@/stores/shop.js';
import { uid } from '@/lib/api.js';
import { fmt, toArabicDigits, evalCalc, negateCalc, parseAmount } from '@shared/money.js';
import { rowFinal, sameKey, personSide } from '@shared/engine.js';
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
  fixed: Boolean,                                   // the list keeps one height (the page never jumps while searching)
});
const shop = useShop();
const isCalc = computed(() => props.type === 'client' || props.type === 'debt');
/* العملاء and الديون show ONE list of people, each where his balance is: + he owes the shop (العملاء), − the shop owes
   him (الديون, shown as a positive amount; its changes are seen from the shop's side: + = the shop owes him more). */
const S = props.type === 'debt' ? -1 : 1;
const isPerson = it => it.type === 'client';
const inThis = (it, row) => (isCalc.value ? isPerson(it) && personSide(row) === props.type : it.type === props.type);
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
    if (!it || !inThis(it, row) || (it.purged && !shop.view?.editing)) continue;
    out.push({ id, name: props.type === 'wallet' ? toArabicDigits(it.name) : it.name, row, final: S * rowFinal(row, it.type) || 0, result: isCalc.value ? S * evalCalc(row.calc) || 0 : 0 });
  }
  const q = query.value;
  if (q) return out.filter(x => key(x.name).includes(q)).sort((a, b) => (a.row.status === 'deleted') - (b.row.status === 'deleted') || a.name.localeCompare(b.name, 'ar'));
  const rank = x => (x.row.status === 'deleted' ? 3 : props.type === 'wallet' ? (x.row.active ? 0 : 1) : x.final === 0 && isCalc.value ? 2 : 0);
  return out.sort((a, b) => rank(a) - rank(b) || Math.abs(b.final) - Math.abs(a.final) || a.name.localeCompare(b.name, 'ar'));
});
// the total never follows the search: it is always the whole table
const total = computed(() => {
  const book = shop.book; if (!book) return 0;
  return Object.entries(book.rows).filter(([id, r]) => shop.items[id] && inThis(shop.items[id], r) && !shop.items[id].purged && r.status === 'active').reduce((a, [id, r]) => a + S * rowFinal(r, shop.items[id].type), 0);
});
defineExpose({ total });

/* ----- add + search: the first field filters the table as you type ----- */
const first = ref(''), second = ref(''), firstEl = ref(null), secondEl = ref(null);
// letters and digits as they read: أ/إ/آ=ا, ة=ه, ى=ي, ٠-٩=0-9, spaces and dashes ignored (the same rule as the engine)
const key = sameKey;
const query = computed(() => (props.type === 'constant' ? '' : key(first.value)));
// an ACTIVE one with exactly this number / name: it cannot be added again
const duplicate = computed(() => !!query.value && (list.value.some(x => x.row.status === 'active' && key(x.name) === query.value) || others.value.some(x => key(x.name) === query.value)));
// people in the OTHER table (العملاء ↔ الديون) whose name matches: pick one to write his change from this table
const others = computed(() => {
  const book = shop.book, q = query.value; if (!isCalc.value || !book || !q) return [];
  return Object.entries(book.rows).filter(([id, r]) => { const it = shop.items[id]; return it && isPerson(it) && !it.purged && r.status === 'active' && personSide(r) !== props.type && key(it.name).includes(q); })
    .map(([id, row]) => ({ id, name: shop.items[id].name, row, final: S * rowFinal(row, 'client') || 0 })).slice(0, 5);
});
const OTHER = { client: 'ديون', debt: 'عميل' };
function pick(x) { first.value = ''; calcFor.value = { ...x, S: personSide(x.row) === 'debt' ? -1 : 1 }; }   // in his own direction
/* typing the name then a number (no space needed): the number goes to the amount field (not for wallet numbers) */
function onFirst() {
  if (props.type === 'wallet') return;
  const m = String(first.value).match(/^(.*?[^\s\d٠-٩.,٬])\s*([\d٠-٩][\d٠-٩.,٬]*)$/u);
  if (!m) return;
  first.value = m[1].trim(); second.value = parseAmount(m[2]);
  nextTick(() => secondEl.value?.focusEnd());
}
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
/* ----- client / debt: tap النهائي and type the new value; the difference becomes today's change ----- */
const startFinal = x => { if (!shop.canEdit || x.row.status === 'deleted') return; editing.value = { id: x.id, value: x.final, final: true }; nextTick(() => document.getElementById('val-' + x.id)?.focus()); };
function saveFinal(e) {
  const r = shop.book.rows[e.id]; if (!r || e.value === '') return;
  // the value typed is what this table shows (in الديون: what the shop owes him); the change is kept from his side
  const target = S * Number(e.value), diff = Math.round((target - (r.opening || 0)) * 100) / 100;
  if (target === rowFinal(r, 'client') && r.calc) return;                         // nothing changed
  shop.dispatch({ t: 'setCalc', id: e.id, calc: diff > 0 ? '+' + diff : String(diff) });
}
function saveEdit() {
  const e = editing.value; editing.value = null;
  if (e?.final) return saveFinal(e);
  if (!e || e.value === '' || e.value === shop.book.rows[e.id]?.value) return;
  shop.dispatch({ t: 'setValue', id: e.id, value: e.value });
}

/* ----- dialogs ----- */
const calcFor = ref(null), historyFor = ref(null), deleteFor = ref(null);
// the calculator is written from THIS table's side (in الديون: + = the shop owes him more); kept from his side
const calcS = () => calcFor.value?.S ?? S;
const saveCalc = calc => { shop.dispatch({ t: 'setCalc', id: calcFor.value.id, calc: calcS() < 0 ? negateCalc(calc) : calc }); calcFor.value = null; };
const restore = x => shop.dispatch({ t: 'restoreItem', id: x.id });
</script>

<template>
  <component :is="bare ? 'div' : 'section'" :class="bare ? '' : 'card'">
    <div v-if="!bare && title" class="card-h"><h2>{{ title }}</h2></div>

    <form class="addrow" @submit.prevent="add">
      <div class="find" style="flex:1.2">
        <Icon v-if="type !== 'constant'" name="search" :size="16" class="find-ic" />
        <input v-if="type === 'wallet'" ref="firstEl" v-model="first" class="input pad" :class="{ dup: duplicate }" :placeholder="T.first" dir="auto" @keydown.enter.prevent="secondEl.focus()" :aria-label="T.first" data-test="item-first" />
        <input v-else ref="firstEl" v-model="first" class="input" :class="{ dup: duplicate, pad: type !== 'constant' }" :placeholder="T.first" :disabled="!shop.canEdit && type === 'constant'" @input="onFirst" @keydown.enter.prevent="secondEl.focus()" :aria-label="T.first" data-test="item-first" />
      </div>
      <MoneyInput ref="secondEl" v-model="second" style="flex:1" :placeholder="T.second" :allow-negative="type !== 'constant'" :disabled="!shop.canEdit" @enter="add" :aria-label="T.second" />
      <button class="btn primary icon" style="width:42px;min-height:38px;color:#fff" :disabled="!shop.canEdit || duplicate" aria-label="إضافة"><Icon name="plus" /></button>
    </form>
    <div v-if="others.length" class="others" data-test="others">
      <button v-for="x in others" :key="x.id" type="button" class="other" :disabled="!shop.canEdit" @click="pick(x)">
        <span>{{ x.name }}</span><span class="muted small">{{ OTHER[type] }} · <Money :value="Math.abs(x.final)" /></span>
      </button>
    </div>
    <p v-else-if="duplicate && shop.canEdit" class="dup-msg" data-test="dup-msg">{{ type === 'wallet' ? 'هذا الرقم موجود بالفعل' : 'هذا الاسم موجود بالفعل' }}</p>

    <div class="scroll" :class="{ fixed }">
      <table class="tbl">
        <thead>
          <tr v-if="type === 'wallet'"><th style="width:1%"><span class="sr-only">مستخدمة اليوم</span>✓</th><th>الرقم</th><th class="n">الرصيد</th><th></th></tr>
          <tr v-else-if="isCalc"><th>{{ type === 'client' ? 'العميل' : 'الاسم' }}</th><th class="n">التغيير</th><th class="n">النهائي</th><th></th></tr>
          <tr v-else><th>الاسم</th><th class="n">المبلغ</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="x in list" :key="x.id" :class="{ deleted: x.row.status === 'deleted', dim: x.row.status === 'active' && ((type === 'wallet' && !x.row.active) || (isCalc && x.final === 0)) }">
            <td v-if="type === 'wallet'">
              <input type="checkbox" class="check" :checked="x.row.active" :disabled="!shop.canEdit || x.row.status === 'deleted'" :aria-label="'مستخدمة اليوم: ' + x.name"
                     @change="e => shop.dispatch({ t: 'setActive', id: x.id, active: e.target.checked }, { quiet: true })" />
            </td>
            <td><button class="cell-btn" :dir="type === 'wallet' ? 'ltr' : null" title="السجل" @click="historyFor = x">{{ x.name }}</button></td>

            <template v-if="isCalc">
              <td class="n">
                <button class="cell-btn calc-chip" :class="{ has: x.row.calc }" :disabled="x.row.status === 'deleted'" title="الحاسبة" @click="calcFor = x">
                  <template v-if="x.row.calc"><Money :value="x.result" signed /></template>
                  <template v-else>احسب</template>
                </button>
              </td>
              <td class="n">
                <MoneyInput v-if="editing && editing.id === x.id" :id="'val-' + x.id" v-model="editing.value" allow-negative @enter="saveEdit" @escape="editing = null" @blur="saveEdit" />
                <button v-else class="cell-btn" :disabled="x.row.status === 'deleted'" title="اضغط للتعديل" data-test="final" @click="startFinal(x)"><b><Money :value="x.final" /></b></button>
              </td>
            </template>
            <td v-else class="n">
              <MoneyInput v-if="editing && editing.id === x.id" :id="'val-' + x.id" v-model="editing.value" :allow-negative="type === 'wallet'" @enter="saveEdit" @escape="editing = null" @blur="saveEdit" />
              <button v-else class="cell-btn" :disabled="x.row.status === 'deleted'" title="اضغط للتعديل" @click="startEdit(x)"><Money :value="x.row.value" /></button>
            </td>

            <td class="actions">
              <template v-if="x.row.status === 'deleted'">
                <button class="btn icon" title="استرجاع" aria-label="استرجاع" :disabled="!shop.canEdit" @click="restore(x)"><Icon name="restore" /></button>
                <button v-if="!shop.view?.editing" class="btn icon del" title="حذف نهائي" aria-label="حذف نهائي" :disabled="!shop.canEdit" @click="deleteFor = { ...x, onlyPurge: true }"><Icon name="trash" /></button>
              </template>
              <button v-else class="btn icon del" title="حذف" aria-label="حذف" :disabled="!shop.canEdit" @click="deleteFor = x"><Icon name="trash" /></button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="!list.length" class="empty">{{ query ? 'لا توجد نتيجة' : T.empty }}</p>
    </div>
    <div class="total"><span>الإجمالي</span><span class="num">{{ fmt(total) }}</span></div>

    <CalcDialog v-if="calcFor" :name="calcFor.name" :opening="calcS() * calcFor.row.opening || 0" :calc="calcS() < 0 ? negateCalc(calcFor.row.calc) : calcFor.row.calc" :readonly="!shop.canEdit" @close="calcFor = null" @save="saveCalc" />
    <ItemHistory v-if="historyFor" :id="historyFor.id" :name="historyFor.name" :type="type" @close="historyFor = null" />
    <DeleteItemDialog v-if="deleteFor" :item="deleteFor" :type="type" @close="deleteFor = null" />
  </component>
</template>

<style scoped>
.find { position: relative; min-width: 0; }
.find .input { width: 100%; }
.find-ic { position: absolute; top: 50%; transform: translateY(-50%); inset-inline-start: 10px; color: var(--faint); pointer-events: none; }
.find .input.pad { padding-inline-start: 32px; }
.find .input.dup { border-color: var(--neg); box-shadow: 0 0 0 3px var(--neg-soft); }
.others { display: grid; gap: 4px; padding: 6px 10px; border-bottom: 1px solid var(--line); background: var(--brand-soft); }
.other { all: unset; box-sizing: border-box; cursor: pointer; display: flex; justify-content: space-between; gap: 8px; align-items: center; padding: 6px 10px; border-radius: 8px; background: var(--card, #fff); }
.other:hover { outline: 2px solid var(--brand); }
.other:disabled { cursor: default; opacity: .6; }
.dup-msg { margin: 0; padding: 6px 14px; background: var(--neg-soft); color: var(--neg); font-size: 13px; border-bottom: 1px solid var(--line); }
.calc-chip { font-size: 13px; min-width: 64px; text-align: center; border: 1px dashed var(--line-strong); color: var(--muted); }
.calc-chip.has { border-style: solid; border-color: #ddd3f5; background: var(--brand-soft); color: var(--brand-ink); }
.calc-chip:disabled { cursor: default; opacity: .6; }
.scroll.fixed { height: clamp(260px, 55vh, 560px); overflow-y: auto; }
</style>
