<!--
  تغييرات متأخرة: changes a phone wrote OFFLINE for a day that was closed meanwhile. The saved day was not changed.
  Each one: «أضف» (into that saved day, needs the password; flows to later days) or «ارفض».
  All together: «أضف الكل» / «ارفض الكل». A change that no longer fits its day stays here with the reason.
-->
<script setup>
import { ref, computed } from 'vue';
import { useShop } from '@/stores/shop.js';
import { useToasts } from '@/stores/toasts.js';
import { isOffline } from '@/lib/api.js';
import { fmtDate, toArabicDigits } from '@shared/money.js';
import { describeOp } from '@shared/describe.js';
import Modal from './Modal.vue';
import PasswordDialog from './PasswordDialog.vue';

const emit = defineEmits(['close']);
const shop = useShop(), toasts = useToasts();
const dayOf = id => shop.snap?.days?.find(d => d.id === id);
/** Grouped by the day they were written for, oldest day first. */
const groups = computed(() => {
  const by = new Map();
  for (const x of shop.snap?.late || []) { if (!by.has(x.dayId)) by.set(x.dayId, []); by.get(x.dayId).push(x); }
  return [...by.entries()].map(([dayId, list]) => ({ dayId, day: dayOf(dayId), list })).sort((a, b) => (a.day?.seq || 0) - (b.day?.seq || 0));
});
const time = s => (s ? toArabicDigits(new Date(s).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })) : '');
const what = x => { try { return describeOp(x.op, shop.items); } catch { return x.op.t; } };

const asking = ref(null);       // ids to add (password), [] = all
const busy = ref(false), err = ref('');
async function add(pw) {
  try {
    const r = await shop.decideLate({ ids: asking.value, accept: true, password: pw });
    toasts.show(r.failed.length ? `أُضيف ${toArabicDigits(r.accepted)}، وبقي ${toArabicDigits(r.failed.length)}` : 'تمت الإضافة');
  } catch (e) { throw new Error(isOffline(e) ? 'يحتاج اتصالًا بجهاز المحل' : e.message); }
}
async function refuse(ids) {
  busy.value = true; err.value = '';
  try { await shop.decideLate({ ids, accept: false }); toasts.show('تم الرفض'); }
  catch (e) { err.value = isOffline(e) ? 'يحتاج اتصالًا بجهاز المحل' : e.message; }
  busy.value = false;
}
const count = computed(() => (shop.snap?.late || []).length);
</script>
<template>
  <Modal title="تغييرات متأخرة" wide @close="emit('close')">
    <p v-if="!count" class="empty">لا يوجد</p>
    <div v-for="g in groups" :key="g.dayId" class="grp">
      <h4>{{ g.day ? fmtDate(g.day.date) : 'يوم سابق' }}</h4>
      <div v-for="x in g.list" :key="x.opId" class="rec" data-test="late-rec">
        <div class="txt">
          <div>{{ what(x) }}</div>
          <div class="muted small">{{ time(x.at) }}<span v-if="x.error" class="neg"> · {{ x.error }}</span></div>
        </div>
        <div class="acts">
          <button class="btn sm add" :disabled="!shop.lock.editor || busy" @click="asking = [x.opId]">أضف</button>
          <button class="btn sm" :disabled="!shop.lock.editor || busy" @click="refuse([x.opId])">ارفض</button>
        </div>
      </div>
    </div>
    <p v-if="!shop.lock.editor && count" class="hint warn-hint">وضع المشاهدة فقط</p>
    <p v-if="err" class="hint neg">{{ err }}</p>
    <template v-if="count > 1" #footer>
      <button class="btn" :disabled="!shop.lock.editor || busy" data-test="late-refuse-all" @click="refuse([])">ارفض الكل</button>
      <button class="btn primary" :disabled="!shop.lock.editor || busy" data-test="late-add-all" @click="asking = []">أضف الكل</button>
    </template>
    <PasswordDialog v-if="asking" :title="asking.length ? 'إضافة إلى يومه' : 'إضافة الكل'" confirm-text="أضف" :run="add" @close="asking = null" />
  </Modal>
</template>
<style scoped>
.grp + .grp { margin-top: 12px; }
.grp h4 { margin: 0 0 6px; font-size: 14px; color: var(--muted); }
.rec { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 12px; border: 1px solid var(--line); border-radius: var(--radius-sm); }
.rec + .rec { margin-top: 6px; }
.txt { min-width: 0; overflow-wrap: break-word; }
.acts { display: flex; gap: 6px; flex-shrink: 0; }
.add { color: var(--brand); border-color: var(--brand); background: var(--brand-soft); }
</style>
