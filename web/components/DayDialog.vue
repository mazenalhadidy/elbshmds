<!--
  A saved day: its التصفية exactly as it was closed — a value changed later (تعويض or a calendar edit) is shown
  crossed out next to its new value — then the list of changes at the end of the summary:
    التاريخ | التغيير | الملاحظة
  Calendar edits are dated with the day itself (as if the day was closed that way); a تعويض with the date it was made.
  A day that only changed because of an earlier day shows only تصفية البارحة crossed out.
  "تعديل هذا اليوم" opens the full simulation of that day.
-->
<script setup>
import { ref, computed, onMounted } from 'vue';
import { useShop } from '@/stores/shop.js';
import { toArabicDigits, fmt, fmtDate } from '@shared/money.js';
import { COMP_FIELDS } from '@shared/engine.js';
import Modal from './Modal.vue';
import SummaryPanel from './SummaryPanel.vue';
const props = defineProps({ day: Object });
const emit = defineEmits(['close']);
const shop = useShop();
const data = ref(null), err = ref(''), busy = ref(false);
onMounted(async () => { try { data.value = await shop.getDay(props.day.id); } catch (e) { err.value = e.status ? e.message : 'يحتاج اتصالًا بجهاز المحل'; } });
async function edit() {
  busy.value = true;
  try { await shop.startEdit(props.day.id); emit('close'); } catch (e) { err.value = e.status ? e.message : 'يحتاج اتصالًا بجهاز المحل'; }
  busy.value = false;
}
const when = s => toArabicDigits(new Date(s).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' }));
/** Every change made on this day after it was closed, oldest first. */
const changes = computed(() => {
  if (!data.value) return [];
  const edits = data.value.edits.map(e => ({ key: e.id, at: fmtDate(props.day.date), what: e.changes.described.join('، '), note: e.note }));
  const comps = Object.values(data.value.book.comps || {}).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))).map(c => ({
    key: c.id, at: when(c.createdAt),
    // shown as: تعويض [+١١٬٠٠٠] على المحافظ — the signed amount in its own left-to-right box (sign in front of the number)
    what: 'تعويض', amount: (c.amount > 0 ? '+' : '−') + fmt(Math.abs(c.amount)), rest: `${c.amount > 0 ? 'على' : 'من'} ${COMP_FIELDS[c.field] || c.field}`,
    note: c.note,
  }));
  return [...edits, ...comps];
});
</script>
<template>
  <Modal :title="'تصفية يوم ' + fmtDate(day.date)" wide @close="emit('close')">
    <p v-if="err" class="hint neg">{{ err }}</p>
    <p v-else-if="!data" class="muted">جارٍ التحميل…</p>
    <template v-else>
      <SummaryPanel :s="data.summary" :orig="data.book.day.orig" :cross-all="changes.length > 0">
        <template v-if="changes.length" #bottom>
          <div class="changes">
            <h4>التغييرات بعد إنهاء اليوم</h4>
            <table class="tbl" data-test="day-changes">
              <thead><tr><th>التاريخ</th><th>التغيير</th><th>الملاحظة</th></tr></thead>
              <tbody>
                <tr v-for="c in changes" :key="c.key"><td class="nowrap muted small">{{ c.at }}</td><td>{{ c.what }}<template v-if="c.amount"> <bdi dir="ltr" class="amt">{{ c.amount }}</bdi> {{ c.rest }}</template></td><td class="note">{{ c.note || '—' }}</td></tr>
              </tbody>
            </table>
          </div>
        </template>
      </SummaryPanel>
      <p v-if="data.book.day.notes" class="card card-b" style="margin-top:12px;white-space:pre-wrap">{{ data.book.day.notes }}</p>
    </template>
    <template #footer>
      <button class="btn" @click="emit('close')">إغلاق</button>
      <button v-if="data && shop.lock.editor" class="btn primary" :disabled="busy" @click="edit">تعديل هذا اليوم</button>
    </template>
  </Modal>
</template>
<style scoped>
.changes { border-top: 1px solid var(--line); padding: 10px 18px 6px; }
.changes h4 { margin: 0 0 6px; font-size: 14px; }
.changes .tbl { table-layout: fixed; width: 100%; }
.changes .tbl th, .changes .tbl td { text-align: right; overflow-wrap: anywhere; }
.changes .tbl th:nth-child(1) { width: 28%; } .changes .tbl th:nth-child(2) { width: 34%; }
.changes .tbl td { height: auto; padding: 8px 8px; font-size: 14px; }
.changes .note { white-space: pre-wrap; color: var(--muted); }
.nowrap { white-space: nowrap; }
.amt { font-weight: 650; white-space: nowrap; font-variant-numeric: tabular-nums; margin-inline: 4px; }
</style>
