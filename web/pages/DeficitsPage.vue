<!--
  العجوزات: one row per saved day (newest first):
    اليوم والتاريخ | التصفية الافتراضية | التصفية الحقيقية | عجز / زيادة | ملاحظة
  عجز or زيادة: the word says which, only the number is coloured (red = عجز, green = زيادة), never a minus sign.
  The note button opens THAT day's «ملاحظات اليوم» under its row (the same note, not a new one);
  it is saved when you close it (button, Esc, or opening another note).
-->
<script setup>
import { ref, computed, nextTick } from 'vue';
import { useRouter, onBeforeRouteLeave } from 'vue-router';
import { useShop } from '@/stores/shop.js';
import { useToasts } from '@/stores/toasts.js';
import { isOffline } from '@/lib/api.js';
import { fmt, fmtDate, fmtWeekday, toArabicDigits } from '@shared/money.js';
// on a phone the year is left out to keep one row: «١٦ نوفمبر»
const fmtDayMonth = d => (d ? new Date(d + 'T00:00:00Z').toLocaleDateString('ar-EG', { day: 'numeric', month: 'long', timeZone: 'UTC' }) : '');
import { deficitRecords, cumulative, diffKind, dayWord, cumulativeWord } from '@shared/deficits.js';
import Icon from '@/components/Icon.vue';

const shop = useShop(), toasts = useToasts(), router = useRouter();
const records = computed(() => deficitRecords(shop.snap?.days));
const total = computed(() => cumulative(shop.snap?.days));
const tone = d => ({ deficit: 'neg', surplus: 'pos' })[diffKind(d)] || '';
// Arabic counting: يوم واحد / يومان / ٣–١٠ أيام / ١١+ يومًا
const daysText = computed(() => {
  const n = records.value.length, d = toArabicDigits(n);
  return n === 1 ? 'يوم واحد محفوظ' : n === 2 ? 'يومان محفوظان' : n >= 3 && n <= 10 ? `${d} أيام محفوظة` : `${d} يومًا محفوظًا`;
});

/* ----- the note of one day: open -> edit -> close = saved ----- */
const editing = ref(null);             // { id, text, original }
const saving = ref(false);
async function toggleNote(r) {
  if (editing.value?.id === r.id) return closeNote();
  if (editing.value && !(await closeNote())) return;           // the open note is saved first
  editing.value = { id: r.id, text: r.notes, original: r.notes };
  await nextTick(); document.getElementById('note-' + r.id)?.focus();
}
/** Save (only if changed) and close. false = could not be saved: the text stays open, nothing is lost. */
async function closeNote() {
  const e = editing.value; if (!e) return true;
  if (e.text === e.original) { editing.value = null; return true; }
  saving.value = true;
  try {
    await shop.saveDayNotes(e.id, e.text);
    editing.value = null;
    toasts.show('تم حفظ الملاحظة');
    return true;
  } catch (err) {
    toasts.show(isOffline(err) ? 'لم تُحفظ الملاحظة: لا يوجد اتصال بجهاز المحل' : 'لم تُحفظ الملاحظة: ' + err.message, 'error');
    return false;
  } finally { saving.value = false; }
}
// leaving the page saves the open note too (and stays if it could not be saved)
onBeforeRouteLeave(async () => (await closeNote()) || false);
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
      <div class="scroll-x">
        <table class="tbl def">
          <thead>
            <tr><th>اليوم</th><th class="n">التصفية<br>الافتراضية</th><th class="n">التصفية<br>الحقيقية</th><th class="n">العجز /<br>الزيادة</th><th class="c">ملاحظة</th></tr>
          </thead>
          <tbody>
            <template v-for="r in records" :key="r.id">
              <tr data-test="def-rec" :class="{ open: editing?.id === r.id }">
                <td><b>{{ fmtWeekday(r.date) }}</b><div class="muted small nowrap"><span class="full">{{ fmtDate(r.date) }}</span><span class="short">{{ fmtDayMonth(r.date) }}</span></div></td>
                <td class="n num">{{ r.virtual == null ? '—' : fmt(r.virtual) }}</td>
                <td class="n num">{{ r.real == null ? '—' : fmt(r.real) }}</td>
                <td class="n diff"><span class="word" :class="tone(r.diff)">{{ dayWord(r.diff) }}</span> <b class="num" :class="tone(r.diff)">{{ r.diff == null ? '—' : fmt(Math.abs(r.diff)) }}</b></td>
                <td class="c">
                  <button class="btn icon note-btn" :class="{ has: r.notes }" :aria-expanded="editing?.id === r.id" :disabled="!shop.lock.editor && !r.notes"
                          :aria-label="r.notes ? 'ملاحظة هذا اليوم' : 'إضافة ملاحظة لهذا اليوم'" :title="r.notes || 'إضافة ملاحظة'" @click="toggleNote(r)">
                    <Icon name="note" />
                  </button>
                </td>
              </tr>
              <tr v-if="editing?.id === r.id" class="note-row">
                <td colspan="5">
                  <textarea :id="'note-' + r.id" v-model="editing.text" class="input" rows="3" :disabled="!shop.lock.editor || saving"
                            :placeholder="'ملاحظات يوم ' + fmtDate(r.date) + '…'" @keydown.esc.prevent="closeNote"></textarea>
                  <div class="between small" style="margin-top:6px">
                    <span class="muted">{{ shop.lock.editor ? 'تُحفظ عند الإغلاق' : 'وضع المشاهدة فقط' }}</span>
                    <button class="btn sm" :disabled="saving" @click="closeNote">{{ saving ? 'جارٍ الحفظ…' : 'إغلاق' }}</button>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
      <p v-if="!records.length" class="empty">لا توجد أيام محفوظة بعد</p>
    </section>
    <p class="hint">{{ daysText }} · الرقم الأحمر عجز والأخضر زيادة · زر الملاحظة يفتح «ملاحظات اليوم» لذلك اليوم.</p>
  </div>
</template>
<style scoped>
.total-line { display: flex; justify-content: space-between; align-items: center; padding: 14px 16px; border-bottom: 1px solid var(--line); font-weight: 650; font-size: 17px; }
.total-line b { font-size: 21px; }
.scroll-x { overflow-x: auto; }
.def { min-width: 0; }
.def td { height: 64px; padding: 8px 12px; }               /* thick rows */
.def th { line-height: 1.35; vertical-align: bottom; }
.short { display: none; }
.def th.c, .def td.c { text-align: center; width: 1%; }
.def .num { font-size: 15px; }
.diff { white-space: nowrap; }
.diff .word { font-size: 13px; font-weight: 600; }
.diff b { font-size: 16px; }
.nowrap { white-space: nowrap; }
.note-btn { width: 38px; min-height: 38px; }
.note-btn.has { color: var(--brand); background: var(--brand-soft); }
tr.open td { background: var(--brand-soft); }
/* a phone: still ONE row per day — tighter, the word above its number, no year */
@media (max-width: 600px) {
  .def th, .def td { padding: 6px 5px; }
  .def th:first-child, .def td:first-child { padding-inline-start: 12px; }
  .def th { font-size: 11px; }
  .def .num { font-size: 13px; }
  .diff .word { display: block; font-size: 11px; }
  .diff b { font-size: 14px; }
  .full { display: none; } .short { display: inline; }
  .note-btn { width: 34px; min-height: 34px; }
}
.note-row td { height: auto; background: var(--surface-2); }
</style>
