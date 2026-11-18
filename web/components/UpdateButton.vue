<!--
  «تحديث متاح»: a new version was prepared on the shop computer. It is installed only from here, with the
  update password. Unsent changes of this device are sent first; the others keep theirs and send them after.
-->
<script setup>
import { ref } from 'vue';
import { useShop } from '@/stores/shop.js';
import { useToasts } from '@/stores/toasts.js';
import { api, isOffline } from '@/lib/api.js';
import PasswordDialog from './PasswordDialog.vue';
const shop = useShop(), toasts = useToasts();
const asking = ref(false);
async function update(pw) {
  if (!(await shop.flush())) throw new Error('لا يمكن الوصول إلى جهاز المحل الآن');
  try { await api('POST', '/update', { password: pw }); }
  catch (e) { throw new Error(isOffline(e) ? 'لا يمكن الوصول إلى جهاز المحل الآن' : e.message); }
  shop.app = { ...shop.app, update: { ...shop.app.update, switching: true } };
  toasts.show('جارٍ التحديث — يعود البرنامج خلال دقيقة');
}
</script>
<template>
  <button v-if="shop.app?.update" class="btn sm upd" :disabled="shop.app.update.switching" data-test="update-btn" @click="asking = true">
    {{ shop.app.update.switching ? 'جارٍ التحديث…' : 'تحديث متاح' }}
  </button>
  <PasswordDialog v-if="asking" title="تحديث البرنامج" confirm-text="حدّث" :run="update" @close="asking = false">
    <p v-if="shop.app.update.notes" class="muted" style="margin:0 0 10px">{{ shop.app.update.notes }}</p>
  </PasswordDialog>
</template>
<style scoped>
.upd { color: #fff; background: var(--brand); border-color: var(--brand); font-weight: 650; }
</style>
