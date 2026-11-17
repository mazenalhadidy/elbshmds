<!--
  تعويض of a saved day: a known reason for its عجز / زيادة (e.g. the missing money was found later on a wallet).
  Choose the category, + or −, the amount («صفّر الفرق» fills the amount that makes the difference exactly 0),
  edit the day's note to say the reason, confirm with the password.
  The amount goes to that category's TOTAL in the summary only (the day's tables stay as they were closed), and
  every later day follows (its تصفية البارحة = this day's new real total).
-->
<script setup>
import { ref, computed } from 'vue';
import { useShop } from '@/stores/shop.js';
import { useToasts } from '@/stores/toasts.js';
import { isOffline } from '@/lib/api.js';
import { fmt, fmtDate, fmtWeekday } from '@shared/money.js';
import { COMP_FIELDS, compEffect, neutralizing } from '@shared/engine.js';
import { diffKind, dayWord } from '@shared/deficits.js';
import Modal from './Modal.vue';
import MoneyInput from './MoneyInput.vue';

const props = defineProps({ day: { type: Object, required: true } });   // a record of deficitRecords()
const emit = defineEmits(['close']);
const shop = useShop(), toasts = useToasts();

const field = ref(''), sign = ref(1), amount = ref(''), notes = ref(props.day.notes || ''), password = ref('');
const err = ref(''), busy = ref(false);
const signed = computed(() => (amount.value > 0 ? sign.value * amount.value : 0));
const eff = computed(() => (field.value ? compEffect(field.value, signed.value) : { virtual: 0, real: 0 }));
const after = computed(() => ({
  virtual: props.day.virtual + eff.value.virtual,
  real: props.day.real + eff.value.real,
  diff: props.day.diff + eff.value.virtual - eff.value.real,
}));
const tone = d => ({ deficit: 'neg', surplus: 'pos' })[diffKind(d)] || '';
const ready = computed(() => !!field.value && signed.value !== 0 && !!password.value && shop.lock.editor);

/** «صفّر الفرق»: the amount (and + / −) on the chosen category that makes this day's difference 0. */
function neutralize() {
  if (!field.value) { err.value = 'اختر أولًا ما يُضاف إليه المبلغ'; return; }
  const v = neutralizing(field.value, props.day.diff);
  sign.value = v < 0 ? -1 : 1; amount.value = Math.abs(v); err.value = '';
}
async function save() {
  if (!field.value) { err.value = 'اختر ما يُضاف إليه المبلغ'; return; }
  if (!signed.value) { err.value = 'اكتب المبلغ'; return; }
  busy.value = true; err.value = '';
  try {
    await shop.compensate({ dayId: props.day.id, field: field.value, amount: signed.value, notes: notes.value, password: password.value });
    toasts.show('تم حفظ التعويض');
    emit('close');
  } catch (e) { err.value = isOffline(e) ? 'يحتاج اتصالًا بجهاز المحل' : e.message; }
  busy.value = false;
}
</script>
<template>
  <Modal :title="'تعويض ' + fmtWeekday(day.date) + ' ' + fmtDate(day.date)" @close="emit('close')">
    <div class="now">
      <span>الفرق الآن</span>
      <b class="num" :class="tone(day.diff)">{{ dayWord(day.diff) }} {{ fmt(Math.abs(day.diff || 0)) }}</b>
    </div>
    <form class="form" @submit.prevent="save">
      <label class="label" for="cf">يُضاف إلى / يُخصم من</label>
      <select id="cf" v-model="field" class="input" data-test="comp-field">
        <option value="" disabled>اختر…</option>
        <option v-for="(label, key) in COMP_FIELDS" :key="key" :value="key">{{ label }}</option>
      </select>

      <label class="label" for="ca">المبلغ</label>
      <div class="row amt">
        <div class="seg" role="radiogroup" aria-label="إضافة أو خصم">
          <button type="button" role="radio" :aria-checked="sign === 1" :class="{ on: sign === 1 }" @click="sign = 1">+ إضافة</button>
          <button type="button" role="radio" :aria-checked="sign === -1" :class="{ on: sign === -1 }" @click="sign = -1">− خصم</button>
        </div>
        <MoneyInput id="ca" v-model="amount" placeholder="المبلغ" style="flex:1" />
      </div>
      <button type="button" class="btn sm ghost zero" :disabled="!field || !day.diff" @click="neutralize">صفّر الفرق</button>

      <div v-if="field && signed" class="preview small" data-test="comp-preview">
        <div v-if="eff.virtual" class="between"><span>التصفية الافتراضية</span><span><s class="num muted">{{ fmt(day.virtual) }}</s> <b class="num">{{ fmt(after.virtual) }}</b></span></div>
        <div v-if="eff.real" class="between"><span>التصفية الحقيقية</span><span><s class="num muted">{{ fmt(day.real) }}</s> <b class="num">{{ fmt(after.real) }}</b></span></div>
        <div class="between"><span>{{ dayWord(after.diff) }}</span><b class="num" :class="tone(after.diff)">{{ fmt(Math.abs(after.diff)) }}</b></div>
      </div>

      <label class="label" for="cn">ملاحظات اليوم</label>
      <textarea id="cn" v-model="notes" class="input" rows="3"></textarea>

      <label class="label" for="cp">كلمة المرور</label>
      <input id="cp" v-model="password" class="input" type="password" autocomplete="current-password" />
      <p v-if="!shop.lock.editor" class="hint warn-hint">وضع المشاهدة فقط</p>
      <p v-if="err" class="hint neg">{{ err }}</p>
      <button class="btn primary wide" style="margin-top:12px" :disabled="!ready || busy" data-test="comp-save">{{ busy ? 'جارٍ الحفظ…' : 'حفظ التعويض' }}</button>
    </form>
  </Modal>
</template>
<style scoped>
.now { display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; border: 1px solid var(--line); border-radius: var(--radius-sm); margin-bottom: 12px; }
.now b { font-size: 18px; }
.form { display: grid; gap: 4px; }
.form .label { margin-top: 8px; }
.amt { gap: 8px; }
.zero { justify-self: start; margin-top: 4px; color: var(--brand); }
.preview { background: var(--surface-2); border-radius: 8px; padding: 8px 12px; margin-top: 6px; display: grid; gap: 2px; }
.preview b { font-size: 15px; }
</style>
