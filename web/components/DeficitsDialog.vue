<!--
  العجوزات: what every saved day ended with (newest first) — day, date, التصفية الافتراضية, التصفية الحقيقية,
  and عجز or زيادة (only the number is coloured; no minus signs).
  The note button opens THAT day's «ملاحظات اليوم» (the same note, not a new one). It is saved when you close it.
-->
<script setup>
import { ref, computed, nextTick } from 'vue';
import { useShop } from '@/stores/shop.js';
import { useToasts } from '@/stores/toasts.js';
import { isOffline } from '@/lib/api.js';
import { fmt, fmtDate, fmtWeekday, toArabicDigits } from '@shared/money.js';
import { deficitRecords, cumulative, diffKind, dayWord, cumulativeWord } from '@shared/deficits.js';
import Modal from './Modal.vue';
import Icon from './Icon.vue';

const emit = defineEmits(['close']);
const shop = useShop(), toasts = useToasts();
const records = computed(() => deficitRecords(shop.snap?.days));
const total = computed(() => cumulative(shop.snap?.days));
const tone = d => ({ deficit: 'neg', surplus: 'pos' })[diffKind(d)] || '';

/* ----- the note of one day: open -> edit -> close = saved ----- */
const editing = ref(null);             // { id, text, original }
const saving = ref(false);
async function toggleNote(r) {
  if (editing.value?.id === r.id) return closeNote();
  if (editing.value && !(await closeNote())) return;           // the open one is saved first
  editing.value = { id: r.id, text: r.notes, original: r.notes };
  await nextTick(); document.getElementById('note-' + r.id)?.focus();
}
/** Save (only if changed) and close. Returns false if it could not be saved (the text stays open, nothing is lost). */
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
async function close() { if (await closeNote()) emit('close'); }
</script>
<template>
  <Modal title="العجوزات" wide @close="close">
    <div class="sum-line" data-test="def-total">
      <span :class="tone(total)">{{ cumulativeWord(total) }}</span>
      <b class="num" :class="tone(total)">{{ fmt(Math.abs(total)) }}</b>
    </div>
    <p v-if="!records.length" class="empty">لا توجد أيام محفوظة بعد</p>
    <ul class="recs">
      <li v-for="r in records" :key="r.id" class="rec" data-test="def-rec">
        <div class="rec-h">
          <div><b>{{ fmtWeekday(r.date) }}</b> <span class="muted small">{{ fmtDate(r.date) }}</span></div>
          <button class="btn sm note-btn" :class="{ has: r.notes }" :aria-expanded="editing?.id === r.id" :disabled="!shop.lock.editor && !r.notes"
                  :title="r.notes ? 'ملاحظة هذا اليوم' : 'إضافة ملاحظة لهذا اليوم'" @click="toggleNote(r)">
            <Icon name="note" :size="16" /> {{ r.notes ? 'الملاحظة' : 'ملاحظة' }}
          </button>
        </div>
        <div class="rows">
          <div class="between"><span class="k">التصفية الافتراضية</span><span class="num">{{ r.virtual == null ? '—' : fmt(r.virtual) }}</span></div>
          <div class="between"><span class="k">التصفية الحقيقية</span><span class="num">{{ r.real == null ? '—' : fmt(r.real) }}</span></div>
          <div class="between diff"><b :class="tone(r.diff)">{{ dayWord(r.diff) }}</b><b class="num" :class="tone(r.diff)">{{ r.diff == null ? '—' : fmt(Math.abs(r.diff)) }}</b></div>
        </div>
        <div class="run small muted">بعده: <span :class="tone(r.runningAfter)">{{ cumulativeWord(r.runningAfter) }} <span class="num">{{ fmt(Math.abs(r.runningAfter)) }}</span></span></div>
        <div v-if="editing?.id === r.id" class="note-box">
          <textarea :id="'note-' + r.id" v-model="editing.text" class="input" rows="3" :disabled="!shop.lock.editor || saving"
                    placeholder="ملاحظات هذا اليوم…" @keydown.esc.stop.prevent="closeNote"></textarea>
          <div class="between small">
            <span class="muted">{{ shop.lock.editor ? 'تُحفظ عند الإغلاق' : 'وضع المشاهدة فقط' }}</span>
            <button class="btn sm" :disabled="saving" @click="closeNote">{{ saving ? 'جارٍ الحفظ…' : 'إغلاق' }}</button>
          </div>
        </div>
        <p v-else-if="r.notes" class="note-preview small">{{ r.notes }}</p>
      </li>
    </ul>
    <p class="hint">{{ toArabicDigits(records.length) }} يومًا محفوظًا · الرقم الملوّن: الأحمر عجز والأخضر زيادة.</p>
  </Modal>
</template>
<style scoped>
.sum-line { display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; margin-bottom: 10px; border: 1px solid var(--line); border-radius: var(--radius-sm); font-weight: 650; }
.sum-line b { font-size: 19px; }
.recs { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
.rec { border: 1px solid var(--line); border-radius: var(--radius-sm); padding: 10px 12px; background: var(--surface); }
.rec-h { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 8px; }
.rows { display: grid; gap: 2px; background: var(--surface-2); border-radius: 8px; padding: 6px 10px; }
.rows > div { min-height: 28px; }
.k { font-size: 13px; color: var(--muted); }
.rows .diff { border-top: 1px solid var(--line); margin-top: 2px; padding-top: 4px; font-size: 16px; }
.run { margin-top: 6px; }
.note-btn { gap: 4px; color: var(--muted); }
.note-btn.has { color: var(--brand); border-color: var(--brand); background: var(--brand-soft); }
.note-box { margin-top: 8px; display: grid; gap: 6px; }
.note-preview { margin: 8px 0 0; padding: 6px 10px; border-inline-start: 3px solid var(--brand-soft); color: var(--muted); white-space: pre-wrap; overflow-wrap: anywhere; }
</style>
