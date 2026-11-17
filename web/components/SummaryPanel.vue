<!--
  The التصفية numbers, always live:
    [slot "top": e.g. the «العجوزات» button]
    تصفية البارحة · ربح اليوم (التفاصيل) · التصفية الافتراضية
    (space)
    التصفية الحقيقية (التفاصيل) · عجز / زيادة of this day (the whole row coloured)
    (space)                                   — only when `cumulative` is given (the open day)
    عجز تراكمي / زيادة تراكمية until now      — only the word and the number coloured
    … after this day (bold)
    [slot "bottom": e.g. the list of changes of a saved day]
  No minus signs: the word (عجز / زيادة) and the colour say which one it is.
  `orig` = the values the day was closed with. A value that changed since is shown crossed out next to the new one:
  every value when `crossAll` (the day itself was changed), otherwise only تصفية البارحة (it changed because of an
  earlier day).
-->
<script setup>
import { ref, computed } from 'vue';
import { fmt } from '@shared/money.js';
import { diffKind, dayWord, cumulativeWord } from '@shared/deficits.js';
import Was from './Was.vue';
const props = defineProps({
  s: Object,
  editableOpening: Boolean,
  uncounted: Boolean,                          // today's cash and network not typed yet: the gap is not a real shortage
  cumulative: { type: Number, default: null }, // sum of the saved days before this one (null = don't show the group)
  orig: { type: Object, default: null },       // the values the day was closed with
  crossAll: Boolean,
});
const emit = defineEmits(['edit-opening']);
const openReal = ref(false), openProfit = ref(false);

const waiting = computed(() => props.uncounted && !!props.s.diff);
const tone = d => ({ deficit: 'neg', surplus: 'pos' })[diffKind(d)] || '';
const dayLabel = computed(() => (waiting.value ? 'العجز / الزيادة' : props.s.diff == null ? 'العجز / الزيادة' : dayWord(props.s.diff)));
const after = computed(() => (props.cumulative == null || props.s.diff == null ? null : props.cumulative + props.s.diff));
/** The original of `key` when it must be shown crossed out, else null. */
const was = key => {
  const o = props.orig?.[key], v = props.s[key];
  if (o == null || v == null || Math.abs(o - v) < 0.005) return null;
  return props.crossAll || key === 'opening' ? o : null;
};
</script>
<template>
  <section class="card summary">
    <slot name="top" />
    <div class="line">
      <span>تصفية البارحة</span>
      <span class="row"><Was :was="was('opening')" :v="s.opening" />
        <button v-if="editableOpening" class="btn icon" title="تعديل تصفية أول يوم" @click="emit('edit-opening')">✎</button></span>
    </div>
    <div class="line">
      <span>ربح اليوم <button class="link small" :aria-expanded="openProfit" @click="openProfit = !openProfit">{{ openProfit ? 'إخفاء التفاصيل' : 'التفاصيل' }}</button></span>
      <Was :was="was('profit')" :v="s.profit" />
    </div>
    <div v-if="openProfit" class="parts small">
      <div class="between"><span>المدخلات</span><span>+ <Was :was="was('input')" :v="s.input" plain /></span></div>
      <div class="between"><span>المبيعات</span><span>+ <Was :was="was('sale')" :v="s.sale" plain /></span></div>
      <div class="between"><span>المخرجات</span><span>− <Was :was="was('output')" :v="s.output" plain /></span></div>
    </div>
    <div class="line strong"><span>التصفية الافتراضية</span><Was :was="was('virtual')" :v="s.virtual" /></div>

    <div class="gap"></div>

    <div class="line strong">
      <span>التصفية الحقيقية <button class="link small" :aria-expanded="openReal" @click="openReal = !openReal">{{ openReal ? 'إخفاء التفاصيل' : 'التفاصيل' }}</button></span>
      <Was :was="was('real')" :v="s.real" />
    </div>
    <div v-if="openReal" class="parts small">
      <div class="between"><span>العملاء</span><span>+ <Was :was="was('clients')" :v="s.clients" plain /></span></div>
      <div class="between"><span>المحافظ</span><span>+ <Was :was="was('wallets')" :v="s.wallets" plain /></span></div>
      <div class="between"><span>النقدية</span><span>+ <Was :was="was('cash')" :v="s.cash" plain /></span></div>
      <div class="between"><span>المكن</span><span>+ <Was :was="was('network')" :v="s.network" plain /></span></div>
      <div class="between"><span>ديون</span><span>− <Was :was="was('debts')" :v="s.debts" plain /></span></div>
      <div class="between"><span>الثوابت</span><span>− <Was :was="was('constants')" :v="s.constants" plain /></span></div>
      <div v-if="s.adjustments" class="between"><span>إضافة / خصم يدوي</span><span class="num">{{ s.adjustments > 0 ? '+' : '−' }} {{ fmt(Math.abs(s.adjustments)) }}</span></div>
    </div>
    <!-- this day: the whole row is coloured -->
    <div class="line result" :class="waiting ? 'wait' : tone(s.diff)" data-test="day-diff">
      <span>{{ dayLabel }}</span>
      <b v-if="waiting" class="num">بانتظار عدّ النقدية</b>
      <span v-else class="row"><s v-if="was('diff') != null" class="old num">{{ dayWord(was('diff')) }} {{ fmt(Math.abs(was('diff'))) }}</s><b class="num">{{ s.diff == null ? '—' : fmt(Math.abs(s.diff)) }}</b></span>
    </div>
    <p v-if="waiting" class="wait-note small">لم تُكتب النقدية ولا المكن لهذا اليوم بعد. اكتبهما في «الإدارة» ليظهر العجز أو الزيادة الحقيقي.</p>

    <!-- the running total: only the word and the number are coloured -->
    <template v-if="cumulative != null">
      <div class="gap"></div>
      <div class="line" data-test="cum-before">
        <span>
          <span :class="tone(cumulative)">{{ cumulativeWord(cumulative) }}</span>
          <span class="small muted"> حتى الآن</span>
        </span>
        <b class="num" :class="tone(cumulative)">{{ fmt(Math.abs(cumulative)) }}</b>
      </div>
      <div class="line strong" data-test="cum-after">
        <span>
          <b :class="waiting ? '' : tone(after)">{{ waiting || after == null ? 'التراكمي' : cumulativeWord(after) }}</b>
          <span class="small muted"> بعد إنهاء هذا اليوم</span>
        </span>
        <b class="num" :class="waiting ? 'muted' : tone(after)">{{ waiting ? 'بانتظار عدّ النقدية' : after == null ? '—' : fmt(Math.abs(after)) }}</b>
      </div>
    </template>
    <slot name="bottom" />
  </section>
</template>
<style scoped>
.summary { padding: 6px 0; }
.line { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 10px 18px; font-size: 16px; }
.line + .line { border-top: 1px solid var(--line); }
.line.strong :deep(b) { font-size: 19px; }
.gap { height: 14px; background: var(--bg); border-block: 1px solid var(--line); }
.parts { margin: 0 18px 8px; padding: 8px 12px; background: var(--surface-2); border-radius: 8px; color: var(--muted); display: grid; gap: 2px; }
.result b { font-size: 20px; } .result.neg { background: var(--neg-soft); } .result.pos { background: var(--pos-soft); }
.result.neg b { color: var(--neg); } .result.pos b { color: var(--pos); }
.result.wait b { color: var(--muted); font-size: 16px; }
.old { color: var(--faint); font-size: 14px; font-weight: 400; }
.wait-note { margin: 0; padding: 0 18px 10px; color: var(--muted); }
.link { border: 0; background: none; color: var(--brand); cursor: pointer; padding: 0 6px; font: inherit; }
</style>
