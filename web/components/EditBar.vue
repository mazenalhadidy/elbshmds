<!--
  Shown while you edit a saved day. Every page now shows THAT day, exactly as it was;
  change anything. "حفظ التعديلات" shows what will change (that day and every day after it),
  asks for a note (why) and the password, then saves.
-->
<script setup>
import { ref } from 'vue';
import { useShop } from '@/stores/shop.js';
import { useToasts } from '@/stores/toasts.js';
import { fmt, toArabicDigits, fmtDate } from '@shared/money.js';
import Modal from './Modal.vue';
const shop = useShop(), toasts = useToasts();
const saving = ref(false), preview = ref(null), note = ref(''), pw = ref(''), err = ref(''), busy = ref(false);

async function openSave() {
  if (!shop.editing.ops.length) { toasts.show('لا توجد تعديلات بعد', 'error'); return; }
  saving.value = true; preview.value = null; err.value = '';
  try { preview.value = await shop.previewEdit(); } catch (e) { err.value = e.status ? e.message : 'يحتاج اتصالًا بجهاز المحل'; }
}
async function save() {
  err.value = '';
  if (!note.value.trim()) { err.value = 'اكتب سبب التعديل'; return; }
  if (!pw.value) { err.value = 'اكتب كلمة المرور'; return; }
  busy.value = true;
  try { await shop.saveEdit({ note: note.value, password: pw.value }); saving.value = false; note.value = ''; toasts.show('تم حفظ تعديل اليوم وتحديث الأيام التالية'); }
  catch (e) { err.value = e.status ? e.message : 'يحتاج اتصالًا بجهاز المحل'; pw.value = ''; }
  busy.value = false;
}
function cancel() { if (!shop.editing.ops.length || confirm('إلغاء كل التعديلات على هذا اليوم؟')) shop.cancelEdit(); }
const dayName = c => (c.open ? 'اليوم الحالي' : fmtDate(c.date));
</script>
<template>
  <div class="editbar" role="status">
    <div class="inner">
      <span><b>تعديل يوم محفوظ: {{ fmtDate(shop.editing.date) }}</b> <span class="small">— كل الصفحات تعرض هذا اليوم · {{ toArabicDigits(shop.editing.ops.length) }} تغيير</span></span>
      <span class="row"><button class="btn sm" @click="cancel">إلغاء</button><button class="btn sm primary" @click="openSave">حفظ التعديلات</button></span>
    </div>
  </div>
  <Modal v-if="saving" title="حفظ تعديل اليوم" wide @close="saving = false">
    <p v-if="!preview && !err" class="muted">جارٍ الحساب…</p>
    <template v-if="preview">
      <h4 style="margin:0 0 6px">التغييرات</h4>
      <ul style="margin:0 0 12px;padding-inline-start:18px"><li v-for="(d, i) in preview.described" :key="i">{{ d }}</li></ul>
      <h4 style="margin:0 0 6px">أثرها على الأيام</h4>
      <div class="card scroll" style="max-height:240px">
        <table class="tbl small">
          <thead><tr><th>اليوم</th><th class="n">تصفية البارحة</th><th class="n">التصفية الحقيقية</th><th class="n">العجز/الزيادة</th></tr></thead>
          <tbody>
            <tr v-for="c in preview.changes" :key="c.dayId">
              <td>{{ dayName(c) }}</td>
              <td class="n num"><span v-if="c.before.opening !== c.after.opening" class="muted">{{ fmt(c.before.opening) }} ← </span>{{ fmt(c.after.opening) }}</td>
              <td class="n num"><span v-if="c.before.real !== c.after.real" class="muted">{{ fmt(c.before.real) }} ← </span>{{ fmt(c.after.real) }}</td>
              <td class="n num">{{ c.after.diff == null ? '—' : fmt(c.after.diff) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <label class="label" for="enote" style="margin-top:14px">سبب التعديل</label>
      <textarea id="enote" v-model="note" class="input" ></textarea>
      <label class="label" for="epw" style="margin-top:10px">كلمة المرور</label>
      <input id="epw" v-model="pw" class="input" type="password" autocomplete="current-password" @keydown.enter.prevent="save" />
    </template>
    <p v-if="err" class="hint neg" role="alert">{{ err }}</p>
    <template #footer><button class="btn" @click="saving = false">رجوع</button><button class="btn primary" :disabled="busy || !preview" @click="save">حفظ</button></template>
  </Modal>
</template>
<style scoped>
.editbar { position: sticky; top: 60px; z-index: 6; background: #fff7e0; border-bottom: 1px solid #f0dfae; }
.inner { max-width: var(--maxw); margin: 0 auto; padding: 8px 16px; display: flex; gap: 10px; align-items: center; justify-content: space-between; flex-wrap: wrap; color: #5c4510; }
</style>
