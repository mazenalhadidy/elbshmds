<!-- History of one wallet / client / debt / constant: its value on every day (newest first). Also lets you rename it. -->
<script setup>
import { ref, onMounted } from 'vue';
import { useShop } from '@/stores/shop.js';
import { fmt, fmtSigned, evalCalc, fmtDate } from '@shared/money.js';
import Modal from './Modal.vue';

const props = defineProps({ id: String, name: String, type: String });
const emit = defineEmits(['close']);
const shop = useShop();
const rows = ref(null), err = ref(''), newName = ref(props.name), renaming = ref(false);
const isCalc = props.type === 'client' || props.type === 'debt';
// a person: one balance, said with its side (عليه = he owes the shop, له = the shop owes him); the change from this table's side
const S = props.type === 'debt' ? -1 : 1;
const bal = v => fmt(Math.abs(v)) + (v > 0 ? ' عليه' : v < 0 ? ' له' : '');
onMounted(async () => {
  try { rows.value = (await shop.itemHistory(props.id)).rows; }
  catch (e) { err.value = e.status ? e.message : 'السجل يحتاج اتصالًا بجهاز المحل'; }
});
function rename() { if (newName.value.trim() && newName.value.trim() !== props.name && shop.dispatch({ t: 'renameItem', id: props.id, name: newName.value })) renaming.value = false; }
const dayLabel = r => (r.open ? 'اليوم الحالي' : fmtDate(r.date));
</script>
<template>
  <Modal :title="'السجل — ' + name" wide @close="emit('close')">
    <div class="row" style="margin-bottom:12px">
      <template v-if="renaming">
        <input v-model="newName" class="input" style="max-width:280px" @keydown.enter.prevent="rename" />
        <button class="btn primary sm" @click="rename">حفظ الاسم</button><button class="btn sm" @click="renaming = false">إلغاء</button>
      </template>
      <button v-else-if="shop.canEdit" class="btn sm" @click="renaming = true">تغيير الاسم</button>
    </div>
    <p v-if="err" class="hint neg">{{ err }}</p>
    <p v-else-if="!rows" class="muted">جارٍ التحميل…</p>
    <div v-else class="scroll card">
      <table class="tbl">
        <thead><tr><th>اليوم</th><template v-if="isCalc"><th class="n">البداية</th><th class="n">التغيير</th><th class="n">النهائي</th></template><th v-else class="n">{{ type === 'wallet' ? 'الرصيد' : 'المبلغ' }}</th><th></th></tr></thead>
        <tbody>
          <tr v-for="r in rows" :key="r.dayId" :class="{ deleted: r.status === 'deleted' }">
            <td class="num">{{ dayLabel(r) }}</td>
            <template v-if="isCalc">
              <td class="n num">{{ bal(r.opening) }}</td>
              <td class="n num muted" :title="r.calc">{{ r.calc ? fmtSigned(S * evalCalc(r.calc) || 0) : '—' }}</td>
              <td class="n num"><b>{{ bal(r.opening + (evalCalc(r.calc) || 0)) }}</b></td>
            </template>
            <td v-else class="n num">{{ fmt(r.value) }}</td>
            <td class="small muted">{{ r.status === 'deleted' ? 'محذوف' : type === 'wallet' && !r.active ? 'غير مستخدمة' : '' }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </Modal>
</template>
