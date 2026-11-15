<!-- A saved day: its التصفية, notes, and every edit made to it later. "تعديل هذا اليوم" opens the full simulation of that day. -->
<script setup>
import { ref, onMounted } from 'vue';
import { useShop } from '@/stores/shop.js';
import { toArabicDigits, fmtDate } from '@shared/money.js';
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
</script>
<template>
  <Modal :title="'تصفية يوم ' + fmtDate(day.date)" @close="emit('close')">
    <p v-if="err" class="hint neg">{{ err }}</p>
    <p v-else-if="!data" class="muted">جارٍ التحميل…</p>
    <template v-else>
      <SummaryPanel :s="data.summary" />
      <p v-if="data.book.day.notes" class="card card-b" style="margin-top:12px;white-space:pre-wrap">{{ data.book.day.notes }}</p>
      <div v-if="data.edits.length" style="margin-top:14px">
        <h4 style="margin:0 0 6px">تعديلات لاحقة على هذا اليوم</h4>
        <div v-for="e in data.edits" :key="e.id" class="card card-b small" style="margin-bottom:6px">
          <div class="between"><b>{{ e.note }}</b><span class="muted">{{ when(e.createdAt) }}</span></div>
          <ul style="margin:6px 0 0;padding-inline-start:18px"><li v-for="(d, i) in e.changes.described" :key="i">{{ d }}</li></ul>
        </div>
      </div>
    </template>
    <template #footer>
      <button class="btn" @click="emit('close')">إغلاق</button>
      <button v-if="data && shop.lock.editor" class="btn primary" :disabled="busy" @click="edit">تعديل هذا اليوم</button>
    </template>
  </Modal>
</template>
