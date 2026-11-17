<!--
  التصفية: the live numbers, the day's notes, and the calendar:
  choose the date of this day and press "إنهاء اليوم" (password) — the real total becomes
  "تصفية البارحة" of the next day. Click a saved (violet) day to see it or edit it.
-->
<script setup>
import { ref, computed } from 'vue';
import { useShop } from '@/stores/shop.js';
import { useToasts } from '@/stores/toasts.js';
import { fmt, fmtDate } from '@shared/money.js';
import SummaryPanel from '@/components/SummaryPanel.vue';
import Calendar from '@/components/Calendar.vue';
import PasswordDialog from '@/components/PasswordDialog.vue';
import DayDialog from '@/components/DayDialog.vue';
import Modal from '@/components/Modal.vue';
import MoneyInput from '@/components/MoneyInput.vue';
import Icon from '@/components/Icon.vue';
import { cumulative } from '@shared/deficits.js';

const shop = useShop(), toasts = useToasts();
const s = computed(() => shop.summary);
const saved = computed(() => shop.snap?.days || []);
const today = computed(() => shop.snap?.today);
const taken = computed(() => new Set(saved.value.map(d => d.date)));
const chosen = ref(null);
const date = computed(() => chosen.value || (today.value && !taken.value.has(today.value) ? today.value : null));
const asking = ref(false), dayOpen = ref(null), openingEdit = ref(null);
const canEditOpening = computed(() => shop.book?.day.seq === 1 && shop.canEdit);
// the running total of the saved days (hidden while a saved day is being edited: it would mix two different days)
const cum = computed(() => (shop.view?.editing ? null : cumulative(saved.value)));
const uncounted = computed(() => !!shop.book && !shop.book.day.cashChanged && !shop.book.day.networkChanged);

function notes(e) { shop.dispatch({ t: 'setNotes', notes: e.target.value }, { quiet: true }); }
async function close(pw) {
  try { await shop.closeDay({ date: date.value, password: pw }); }
  catch (e) { throw new Error(e.message); }
  chosen.value = null; toasts.show('تم حفظ التصفية');
}
function saveOpening() { if (openingEdit.value !== '' && shop.dispatch({ t: 'setOpening', value: openingEdit.value })) openingEdit.value = null; }
</script>
<template>
  <div class="page narrow stack" v-if="s">
    <SummaryPanel :s="s" :editable-opening="canEditOpening" :uncounted="uncounted" :cumulative="cum" @edit-opening="openingEdit = s.opening ?? ''">
      <template #top>
        <div class="top-btn"><RouterLink to="/settle/deficits" class="btn wide deficits-btn" data-test="deficits-btn"><Icon name="list" /> العجوزات</RouterLink></div>
      </template>
    </SummaryPanel>

    <section class="card">
      <div class="card-h"><h2>ملاحظات اليوم</h2></div>
      <div class="card-b"><textarea class="input" :value="shop.book.day.notes" :disabled="!shop.canEdit" placeholder="أي ملاحظة عن هذا اليوم…" @input="notes"></textarea></div>
    </section>

    <section class="card">
      <div class="card-h"><h2>{{ shop.view.editing ? 'السجل' : 'إنهاء اليوم' }}</h2></div>
      <div class="card-b">
        <Calendar :saved="saved" :today="today" :selected="shop.view.editing ? null : date" :pickable="!shop.view.editing" @pick="d => (chosen = d)" @open="d => (dayOpen = d)" />
        <template v-if="!shop.view.editing">
          <p class="hint" style="text-align:center">{{ date ? 'سيُحفظ هذا اليوم بتاريخ ' + fmtDate(date) : 'اختر تاريخًا متاحًا من التقويم' }}</p>
          <p v-if="!shop.lock.editor" class="hint warn-hint" style="text-align:center">وضع المشاهدة فقط: جهاز آخر يعدّل الآن. اضغط «تولّي التعديل» في الأعلى لإنهاء اليوم من هذا الجهاز.</p>
          <button class="btn primary wide" style="margin-top:12px;min-height:48px;font-size:16px" :disabled="!date || !shop.lock.editor" @click="asking = true">إنهاء اليوم</button>
        </template>
      </div>
    </section>

    <PasswordDialog v-if="asking" title="إنهاء اليوم" confirm-text="إنهاء اليوم وحفظه" :run="close" @close="asking = false">
      <p style="margin-top:0">سيُحفظ اليوم بتاريخ <b>{{ fmtDate(date) }}</b>، وتصبح التصفية الحقيقية <b class="num">{{ fmt(s.real) }}</b> هي «تصفية البارحة» لليوم التالي.</p>
      <p v-if="uncounted" class="hint warn-hint">⚠️ لم تُكتب النقدية ولا رصيد الشبكة لهذا اليوم، فالتصفية الحقيقية لا تشملهما. اكتبهما في «الإدارة» قبل الإنهاء إن وُجدا.</p>
      <p v-if="s.diff" class="hint" :class="s.diff > 0 ? 'neg' : 'pos'">يوجد {{ s.diff > 0 ? 'عجز' : 'زيادة' }} {{ fmt(Math.abs(s.diff)) }}</p>
      <p class="hint">بعد الحفظ يمكن تعديله فقط من التقويم مع كتابة السبب وكلمة المرور.</p>
    </PasswordDialog>
    <DayDialog v-if="dayOpen" :day="dayOpen" @close="dayOpen = null" />
    <Modal v-if="openingEdit !== null" title="تصفية البارحة لأول يوم" @close="openingEdit = null">
      <MoneyInput v-model="openingEdit" @enter="saveOpening" />
      <template #footer><button class="btn" @click="openingEdit = null">إلغاء</button><button class="btn primary" @click="saveOpening">حفظ</button></template>
    </Modal>
  </div>
</template>
<style scoped>
.top-btn { padding: 8px 18px 12px; border-bottom: 1px solid var(--line); }
.deficits-btn { min-height: 46px; text-decoration: none; font-weight: 650; color: var(--brand-ink); background: var(--brand-soft); border-color: transparent; }
.deficits-btn:hover { background: #e7defa; }
</style>
