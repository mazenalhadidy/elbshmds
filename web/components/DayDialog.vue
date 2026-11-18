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
import PasswordDialog from './PasswordDialog.vue';
import Icon from './Icon.vue';
const props = defineProps({ day: Object });
const emit = defineEmits(['close']);
const shop = useShop();
const data = ref(null), err = ref(''), busy = ref(false), deleting = ref(null);
const load = async () => { try { data.value = await shop.getDay(props.day.id); } catch (e) { err.value = e.status ? e.message : 'يحتاج اتصالًا بجهاز المحل'; } };
onMounted(load);
async function removeComp(pw) {
  try { await shop.deleteCompensation({ dayId: props.day.id, compId: deleting.value, password: pw }); }
  catch (e) { throw new Error(e.status ? e.message : 'يحتاج اتصالًا بجهاز المحل'); }
  await load();
}
async function edit() {
  busy.value = true;
  try { await shop.startEdit(props.day.id); emit('close'); } catch (e) { err.value = e.status ? e.message : 'يحتاج اتصالًا بجهاز المحل'; }
  busy.value = false;
}
// the date takes little room: a short date, the time under it
const shortDate = s => { const d = new Date(s), y = d.getFullYear() !== new Date().getFullYear(); return toArabicDigits(d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', ...(y ? { year: '2-digit' } : {}) })); };   // the year only when it is not this year
const shortTime = s => toArabicDigits(new Date(s).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }));
/** Every change made on this day after it was closed, oldest first. */
const changes = computed(() => {
  if (!data.value) return [];
  // calendar edits: as if the day was closed that way -> dated with the day itself, no time
  const edits = data.value.edits.map(e => ({ key: e.id, day: shortDate(props.day.date + 'T00:00:00'), time: '', what: e.changes.described.join('، '), note: e.note }));
  const comps = Object.values(data.value.book.comps || {}).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))).map(c => ({
    key: c.id, comp: c.id, day: shortDate(c.createdAt), time: shortTime(c.createdAt),
    // shown as: تعويض [+١١٬٠٠٠] على المحافظ — the signed amount in its own left-to-right box (sign in front of the number)
    what: '', amount: (c.amount > 0 ? '+' : '−') + fmt(Math.abs(c.amount)), rest: `${c.amount > 0 ? 'على' : 'من'} ${COMP_FIELDS[c.field] || c.field}`,
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
              <thead><tr><th>التاريخ</th><th>التغيير</th><th>الملاحظة</th><th v-if="shop.lock.editor" class="del"></th></tr></thead>
              <tbody>
                <tr v-for="c in changes" :key="c.key">
                  <td class="when muted"><div>{{ c.day }}</div><div v-if="c.time">{{ c.time }}</div></td>
                  <td class="what" :class="{ one: c.amount }">{{ c.what }}<template v-if="c.amount"><bdi dir="ltr" class="amt">{{ c.amount }}</bdi> {{ c.rest }}</template></td>
                  <td class="note">{{ c.note || '—' }}</td>
                  <td v-if="shop.lock.editor" class="del"><button v-if="c.comp" class="btn icon del" aria-label="حذف التعويض" title="حذف التعويض" data-test="del-comp" @click="deleting = c.comp"><Icon name="trash" :size="16" /></button></td>
                </tr>
              </tbody>
            </table>
          </div>
        </template>
      </SummaryPanel>
      <PasswordDialog v-if="deleting" title="حذف التعويض" confirm-text="احذف" danger :run="removeComp" @close="deleting = null" />
      <p v-if="data.book.day.notes" class="card card-b" style="margin-top:12px;white-space:pre-wrap">{{ data.book.day.notes }}</p>
    </template>
    <template #footer>
      <button class="btn" @click="emit('close')">إغلاق</button>
      <button v-if="data && shop.lock.editor" class="btn primary" :disabled="busy" @click="edit">تعديل هذا اليوم</button>
    </template>
  </Modal>
</template>
<style scoped>
.changes { border-top: 1px solid var(--line); padding: 10px 10px 6px; }
.changes h4 { margin: 0 0 6px; font-size: 14px; }
/* the space goes to the change and the note: the date is narrow (date / time on two lines), the change stays on one line */
.changes .tbl { width: 100%; }
.changes .tbl th, .changes .tbl td { text-align: right; vertical-align: top; }
.changes .tbl td { height: auto; padding: 8px 6px; font-size: 14px; }
.changes .when { width: 1%; white-space: nowrap; font-size: 11.5px; line-height: 1.5; }
.changes .what.one { white-space: nowrap; width: 1%; }
.changes .note { overflow-wrap: break-word; }
.changes .del { width: 1%; padding-inline: 0; }            /* never cuts a number or a phone number in two */
.changes .note { white-space: pre-wrap; color: var(--muted); }
.nowrap { white-space: nowrap; }
.amt { font-weight: 650; white-space: nowrap; font-variant-numeric: tabular-nums; margin-inline-end: 4px; }
</style>
