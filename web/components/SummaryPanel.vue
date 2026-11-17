<!--
  The التصفية numbers, always live:
    [slot "top": e.g. the «العجوزات» button]
    تصفية البارحة · ربح اليوم (التفاصيل) · التصفية الافتراضية
    (space)
    التصفية الحقيقية (التفاصيل) · عجز / زيادة of this day (the whole row coloured)
    (space)                                   — only when `cumulative` is given (the open day)
    عجز تراكمي / زيادة تراكمية until now      — only the word and the number coloured
    … after this day (bold)
  No minus signs: the word (عجز / زيادة) and the colour say which one it is.
-->
<script setup>
import { ref, computed } from 'vue';
import { fmt } from '@shared/money.js';
import { diffKind, dayWord, cumulativeWord } from '@shared/deficits.js';
const props = defineProps({
  s: Object,
  editableOpening: Boolean,
  uncounted: Boolean,                          // today's cash and network not typed yet: the gap is not a real shortage
  cumulative: { type: Number, default: null }, // sum of the saved days before this one (null = don't show the group)
});
const emit = defineEmits(['edit-opening']);
const openReal = ref(false), openProfit = ref(false);

const waiting = computed(() => props.uncounted && !!props.s.diff);
const tone = d => ({ deficit: 'neg', surplus: 'pos' })[diffKind(d)] || '';
const dayLabel = computed(() => (waiting.value ? 'العجز / الزيادة' : props.s.diff == null ? 'العجز / الزيادة' : dayWord(props.s.diff)));
const after = computed(() => (props.cumulative == null || props.s.diff == null ? null : props.cumulative + props.s.diff));
</script>
<template>
  <section class="card summary">
    <slot name="top" />
    <div class="line">
      <span>تصفية البارحة</span>
      <span class="row"><b class="num">{{ s.opening == null ? '—' : fmt(s.opening) }}</b>
        <button v-if="editableOpening" class="btn icon" title="تعديل تصفية أول يوم" @click="emit('edit-opening')">✎</button></span>
    </div>
    <div class="line">
      <span>ربح اليوم <button class="link small" :aria-expanded="openProfit" @click="openProfit = !openProfit">{{ openProfit ? 'إخفاء التفاصيل' : 'التفاصيل' }}</button></span>
      <b class="num">{{ fmt(s.profit) }}</b>
    </div>
    <div v-if="openProfit" class="parts small">
      <div class="between"><span>المدخلات</span><span class="num">+ {{ fmt(s.input) }}</span></div>
      <div class="between"><span>المبيعات</span><span class="num">+ {{ fmt(s.sale) }}</span></div>
      <div class="between"><span>المخرجات</span><span class="num">− {{ fmt(s.output) }}</span></div>
    </div>
    <div class="line strong"><span>التصفية الافتراضية</span><b class="num">{{ s.virtual == null ? '—' : fmt(s.virtual) }}</b></div>

    <div class="gap"></div>

    <div class="line strong">
      <span>التصفية الحقيقية <button class="link small" :aria-expanded="openReal" @click="openReal = !openReal">{{ openReal ? 'إخفاء التفاصيل' : 'التفاصيل' }}</button></span>
      <b class="num">{{ fmt(s.real) }}</b>
    </div>
    <div v-if="openReal" class="parts small">
      <div class="between"><span>العملاء</span><span class="num">+ {{ fmt(s.clients) }}</span></div>
      <div class="between"><span>المحافظ</span><span class="num">+ {{ fmt(s.wallets) }}</span></div>
      <div class="between"><span>النقدية</span><span class="num">+ {{ fmt(s.cash) }}</span></div>
      <div class="between"><span>رصيد ماكينات الشبكة</span><span class="num">+ {{ fmt(s.network) }}</span></div>
      <div class="between"><span>الديون على المحل</span><span class="num">− {{ fmt(s.debts) }}</span></div>
      <div class="between"><span>الثوابت</span><span class="num">− {{ fmt(s.constants) }}</span></div>
      <div v-if="s.adjustments" class="between"><span>إضافة / خصم يدوي</span><span class="num">{{ s.adjustments > 0 ? '+' : '−' }} {{ fmt(Math.abs(s.adjustments)) }}</span></div>
    </div>
    <!-- this day: the whole row is coloured -->
    <div class="line result" :class="waiting ? 'wait' : tone(s.diff)" data-test="day-diff">
      <span>{{ dayLabel }}</span>
      <b class="num">{{ waiting ? 'بانتظار عدّ النقدية' : s.diff == null ? '—' : fmt(Math.abs(s.diff)) }}</b>
    </div>
    <p v-if="waiting" class="wait-note small">لم تُكتب النقدية ولا رصيد الشبكة لهذا اليوم بعد. اكتبهما في «الإدارة» ليظهر العجز أو الزيادة الحقيقي.</p>

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
  </section>
</template>
<style scoped>
.summary { padding: 6px 0; }
.line { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 10px 18px; font-size: 16px; }
.line + .line { border-top: 1px solid var(--line); }
.line.strong b { font-size: 19px; }
.gap { height: 14px; background: var(--bg); border-block: 1px solid var(--line); }
.parts { margin: 0 18px 8px; padding: 8px 12px; background: var(--surface-2); border-radius: 8px; color: var(--muted); display: grid; gap: 2px; }
.result b { font-size: 20px; } .result.neg { background: var(--neg-soft); } .result.pos { background: var(--pos-soft); }
.result.neg b { color: var(--neg); } .result.pos b { color: var(--pos); }
.result.wait b { color: var(--muted); font-size: 16px; }
.wait-note { margin: 0; padding: 0 18px 10px; color: var(--muted); }
.link { border: 0; background: none; color: var(--brand); cursor: pointer; padding: 0 6px; font: inherit; }
</style>
