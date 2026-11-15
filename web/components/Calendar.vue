<!--
  Calendar of التصفية:
  - saved day   (violet tint + ✓)  -> click to open it (its summary, and "edit")
  - free day    (white, bordered)  -> click to choose it as the date of the day you are closing
  - future day  (faded, no border) -> cannot be chosen yet
  - today has a ring
-->
<script setup>
import { ref, computed } from 'vue';
import { toArabicDigits } from '@shared/money.js';
const props = defineProps({ saved: { type: Array, default: () => [] }, today: String, selected: String, pickable: { type: Boolean, default: true } });
const emit = defineEmits(['pick', 'open']);

const start = props.selected || props.today || new Date().toISOString().slice(0, 10);
const y = ref(+start.slice(0, 4)), m = ref(+start.slice(5, 7) - 1);
const byDate = computed(() => Object.fromEntries(props.saved.filter(d => d.date).map(d => [d.date, d])));
const pad = n => String(n).padStart(2, '0');
const title = computed(() => new Date(Date.UTC(y.value, m.value, 1)).toLocaleDateString('ar-EG', { month: 'long', year: 'numeric', timeZone: 'UTC' }));
const cells = computed(() => {
  const days = new Date(Date.UTC(y.value, m.value + 1, 0)).getUTCDate();
  const lead = (new Date(Date.UTC(y.value, m.value, 1)).getUTCDay() + 1) % 7;   // the week starts on Saturday
  const out = Array.from({ length: lead }, () => null);
  for (let d = 1; d <= days; d++) {
    const date = `${y.value}-${pad(m.value + 1)}-${pad(d)}`;
    const saved = byDate.value[date];
    out.push({ d, date, saved, future: !saved && props.today && date > props.today });
  }
  return out;
});
function nav(step) { m.value += step; if (m.value < 0) { m.value = 11; y.value--; } if (m.value > 11) { m.value = 0; y.value++; } }
function click(c) { if (c.saved) emit('open', c.saved); else if (!c.future && props.pickable) emit('pick', c.date); }
</script>
<template>
  <div class="cal">
    <div class="between head">
      <button class="btn icon" aria-label="الشهر السابق" @click="nav(-1)">›</button>
      <b>{{ title }}</b>
      <button class="btn icon" aria-label="الشهر التالي" @click="nav(1)">‹</button>
    </div>
    <div class="grid">
      <span v-for="w in ['س','ح','ن','ث','ر','خ','ج']" :key="w" class="wd">{{ w }}</span>
      <template v-for="(c, i) in cells" :key="i">
        <i v-if="!c"></i>
        <button v-else class="day" :class="{ saved: c.saved, future: c.future, free: !c.saved && !c.future, sel: c.date === selected, today: c.date === today }"
                :disabled="c.future || (!c.saved && !pickable)" :title="c.saved ? 'محفوظ — اضغط للعرض' : c.future ? 'لم يأتِ بعد' : 'متاح'"
                :aria-label="toArabicDigits(c.date) + (c.saved ? ' محفوظ' : c.future ? ' لم يأتِ بعد' : ' متاح')" @click="click(c)">
          {{ toArabicDigits(c.d) }}<span v-if="c.saved" class="mark">✓</span>
        </button>
      </template>
    </div>
    <div class="legend small">
      <span><i class="sw free"></i>متاح</span><span><i class="sw saved"></i>محفوظ (اضغط للعرض)</span><span><i class="sw future"></i>لم يأتِ بعد</span>
    </div>
  </div>
</template>
<style scoped>
.cal { max-width: 380px; margin-inline: auto; }
.head { margin-bottom: 8px; }
.grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 5px; text-align: center; }
.wd { font-size: 12px; color: var(--muted); padding: 2px 0; }
.day { position: relative; height: 42px; border-radius: 10px; border: 1px solid transparent; background: none; cursor: pointer; font-variant-numeric: tabular-nums; }
.day.free { border-color: var(--line-strong); background: #fff; }
.day.free:hover { border-color: var(--brand); }
.day.saved { background: var(--brand-soft); color: var(--brand-ink); font-weight: 650; }
.day.saved:hover { background: #e6defa; }
.day .mark { position: absolute; top: 2px; inset-inline-end: 5px; font-size: 10px; color: var(--brand); }
.day.future { color: #c4c4cf; cursor: not-allowed; }
.day.today { box-shadow: inset 0 0 0 2px var(--brand); }
.day.sel { background: var(--brand); color: #fff; border-color: var(--brand); font-weight: 700; }
.legend { display: flex; flex-wrap: wrap; gap: 14px; justify-content: center; margin-top: 12px; color: var(--muted); }
.legend span { display: inline-flex; align-items: center; gap: 6px; }
.sw { width: 14px; height: 14px; border-radius: 4px; display: inline-block; }
.sw.free { border: 1px solid var(--line-strong); background: #fff; } .sw.saved { background: var(--brand-soft); } .sw.future { background: #f0f0f4; }
</style>
