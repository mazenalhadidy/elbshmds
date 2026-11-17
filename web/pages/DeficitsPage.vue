<!--
  العجوزات: one row per saved day (newest first):
    اليوم | التصفية الافتراضية | التصفية الحقيقية | العجز / الزيادة | تعويض
  عجز or زيادة: the word says which, only the number is coloured (red = عجز, green = زيادة), never a minus sign.
  A day changed after it was closed (تعويض or a calendar edit) shows its original values crossed out next to the new ones.
  «تعويض» opens the pop-up to neutralize the difference (with that day's note); tapping the day opens it.
-->
<script setup>
import { ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import { useShop } from '@/stores/shop.js';
import { fmt, fmtDate, fmtWeekday } from '@shared/money.js';
import { deficitRecords, cumulative, diffKind, dayWord, cumulativeWord } from '@shared/deficits.js';
import Was from '@/components/Was.vue';
import CompensateDialog from '@/components/CompensateDialog.vue';
import DayDialog from '@/components/DayDialog.vue';

const shop = useShop(), router = useRouter();
const records = computed(() => deficitRecords(shop.snap?.days));
const total = computed(() => cumulative(shop.snap?.days));
const tone = d => ({ deficit: 'neg', surplus: 'pos' })[diffKind(d)] || '';
// on a phone the year is left out to keep one row: «١٦ نوفمبر»
const fmtDayMonth = d => (d ? new Date(d + 'T00:00:00Z').toLocaleDateString('ar-EG', { day: 'numeric', month: 'long', timeZone: 'UTC' }) : '');
/** The original value, only for a day that was itself changed after closing (later days are not crossed here). */
const was = (r, key) => (r.own && r.orig?.[key] != null && r[key] != null && Math.abs(r.orig[key] - r[key]) >= 0.005 ? r.orig[key] : null);
const comp = ref(null), dayOpen = ref(null);
</script>
<template>
  <div class="page narrow stack">
    <div class="between">
      <h1 class="page-title" style="margin:0">العجوزات</h1>
      <button class="btn sm" @click="router.push('/settle')">رجوع إلى التصفية</button>
    </div>

    <section class="card">
      <div class="total-line" data-test="def-total">
        <span :class="tone(total)">{{ cumulativeWord(total) }}</span>
        <b class="num" :class="tone(total)">{{ fmt(Math.abs(total)) }}</b>
      </div>
      <table class="tbl def">
        <thead>
          <tr><th>اليوم</th><th><span class="lng">التصفية </span>الافتراضية</th><th><span class="lng">التصفية </span>الحقيقية</th><th><span class="lng">العجز / الزيادة</span><span class="sht">عجز/زيادة</span></th><th class="c">تعويض</th></tr>
        </thead>
        <tbody>
          <tr v-for="r in records" :key="r.id" data-test="def-rec" :class="{ changed: r.own }">
            <td>
              <button class="day-btn" :title="'فتح يوم ' + fmtDate(r.date)" @click="dayOpen = { id: r.id, date: r.date }">
                <b>{{ fmtWeekday(r.date) }}</b>
                <span class="muted small nowrap"><span class="full">{{ fmtDate(r.date) }}</span><span class="short">{{ fmtDayMonth(r.date) }}</span></span>
                <span v-if="r.own" class="tag">مُعدّل</span>
              </button>
            </td>
            <td><Was :was="was(r, 'virtual')" :v="r.virtual" plain class="stack" /></td>
            <td><Was :was="was(r, 'real')" :v="r.real" plain class="stack" /></td>
            <td class="diff">
              <s v-if="was(r, 'diff') != null" class="old num"><span class="old-word">{{ dayWord(was(r, 'diff')) }} </span>{{ fmt(Math.abs(was(r, 'diff'))) }}</s>
              <span class="word" :class="tone(r.diff)">{{ dayWord(r.diff) }}</span>
              <b class="num" :class="tone(r.diff)">{{ r.diff == null ? '—' : fmt(Math.abs(r.diff)) }}</b>
            </td>
            <td class="c">
              <button class="btn sm comp-btn" data-test="comp-btn" @click="comp = r">تعويض</button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="!records.length" class="empty">لا توجد أيام محفوظة بعد</p>
    </section>
    <CompensateDialog v-if="comp" :day="comp" @close="comp = null" />
    <DayDialog v-if="dayOpen" :day="dayOpen" @close="dayOpen = null" />
  </div>
</template>
<style scoped>
.total-line { display: flex; justify-content: space-between; align-items: center; padding: 14px 16px; border-bottom: 1px solid var(--line); font-weight: 650; font-size: 17px; }
.total-line b { font-size: 21px; }
/* right-to-left, everything aligned to the right; titles on one line */
.def { table-layout: auto; }
.def th, .def td { text-align: right; }
.def th { white-space: nowrap; }
.def { width: 100%; }
.def td { height: 64px; padding: 8px 12px; }               /* thick rows */
.def td:first-child { padding-inline-end: 14px; }
.def th.c, .def td.c { text-align: center; width: 1%; }
.def .num { font-size: 15px; }
.def :deep(.stack) { flex-direction: column; align-items: flex-start; gap: 0; }
.diff { white-space: nowrap; }
.diff .word { font-size: 13px; font-weight: 600; margin-inline-end: 6px; }
.diff b { font-size: 16px; }
.old { display: block; color: var(--faint); font-size: 12px; font-weight: 400; }
.day-btn { all: unset; cursor: pointer; display: grid; gap: 1px; }
.day-btn:hover b { color: var(--brand); }
.day-btn:focus-visible { outline: 2px solid var(--brand); border-radius: 4px; }
.nowrap { white-space: nowrap; }
.short { display: none; }
.sht { display: none; }
.tag { margin: 2px 0 0; justify-self: start; }
.comp-btn { color: var(--brand); border-color: var(--brand); background: var(--brand-soft); font-weight: 600; }
/* a phone: still ONE row per day — tighter, the word above its number, no year */
@media (max-width: 600px) {
  .def th, .def td { padding: 6px 3px; }
  .def th:first-child, .def td:first-child { padding-inline-start: 10px; padding-inline-end: 8px; }
  .def th:last-child, .def td:last-child { padding-inline-end: 8px; }
  .def th { font-size: 9.5px; }
  .def .num { font-size: 12px; }
  .diff .word { display: block; font-size: 11px; }
  .diff b { font-size: 13px; }
  .old-word { display: none; }
  .day-btn b { font-size: 14px; }
  .full { display: none; } .short { display: inline; }
  .comp-btn { padding: 0 6px; min-height: 30px; font-size: 12px; }
}
/* very small phones (≤ 380 px): shorter titles, still one line */
@media (max-width: 380px) {
  .lng { display: none; } .sht { display: inline; }
  .def th { font-size: 10px; }
}
</style>
