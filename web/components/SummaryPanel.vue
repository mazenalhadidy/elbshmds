<!--
  The التصفية numbers, always live:
    تصفية البارحة · ربح اليوم · التصفية الافتراضية
    (space)
    التصفية الحقيقية · العجز/الزيادة (الافتراضي − الحقيقي)
-->
<script setup>
import { ref, computed } from 'vue';
import { fmt } from '@shared/money.js';
const props = defineProps({ s: Object, editableOpening: Boolean });
const emit = defineEmits(['edit-opening']);
const open = ref(false);
const diffLabel = computed(() => (props.s.diff == null ? '—' : props.s.diff > 0 ? 'عجز' : props.s.diff < 0 ? 'زيادة' : 'مطابق'));
const diffTone = computed(() => (props.s.diff > 0 ? 'neg' : props.s.diff < 0 ? 'pos' : ''));
</script>
<template>
  <section class="card summary">
    <div class="line">
      <span>تصفية البارحة</span>
      <span class="row"><b class="num">{{ s.opening == null ? '—' : fmt(s.opening) }}</b>
        <button v-if="editableOpening" class="btn icon" title="تعديل تصفية أول يوم" @click="emit('edit-opening')">✎</button></span>
    </div>
    <div class="line"><span>ربح اليوم</span><b class="num">{{ fmt(s.profit) }}</b></div>
    <div class="line strong"><span>التصفية الافتراضية</span><b class="num">{{ s.virtual == null ? '—' : fmt(s.virtual) }}</b></div>

    <div class="gap"></div>

    <div class="line strong">
      <span>التصفية الحقيقية <button class="link small" @click="open = !open">{{ open ? 'إخفاء التفاصيل' : 'التفاصيل' }}</button></span>
      <b class="num">{{ fmt(s.real) }}</b>
    </div>
    <div v-if="open" class="parts small">
      <div class="between"><span>العملاء</span><span class="num">+ {{ fmt(s.clients) }}</span></div>
      <div class="between"><span>المحافظ</span><span class="num">+ {{ fmt(s.wallets) }}</span></div>
      <div class="between"><span>النقدية</span><span class="num">+ {{ fmt(s.cash) }}</span></div>
      <div class="between"><span>رصيد ماكينات الشبكة</span><span class="num">+ {{ fmt(s.network) }}</span></div>
      <div class="between"><span>الديون على المحل</span><span class="num">− {{ fmt(s.debts) }}</span></div>
      <div class="between"><span>الثوابت</span><span class="num">− {{ fmt(s.constants) }}</span></div>
      <div v-if="s.adjustments" class="between"><span>إضافة / خصم يدوي</span><span class="num">{{ s.adjustments > 0 ? '+' : '−' }} {{ fmt(Math.abs(s.adjustments)) }}</span></div>
    </div>
    <div class="line result" :class="diffTone">
      <span>العجز / الزيادة <span class="small muted">(الافتراضي − الحقيقي)</span></span>
      <b class="num">{{ diffLabel + (s.diff ? ' ' + fmt(Math.abs(s.diff)) : '') }}</b>
    </div>
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
.link { border: 0; background: none; color: var(--brand); cursor: pointer; padding: 0 6px; }
</style>
