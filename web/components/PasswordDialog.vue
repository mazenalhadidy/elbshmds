<!-- Asks for the password before a sensitive action. `run(password)` does the action; errors are shown here. -->
<script setup>
import { ref, onMounted } from 'vue';
import Modal from './Modal.vue';
const props = defineProps({ title: String, confirmText: { type: String, default: 'تأكيد' }, run: Function, danger: Boolean });
const emit = defineEmits(['close', 'done']);
const pw = ref(''), err = ref(''), busy = ref(false), input = ref(null);
onMounted(() => input.value?.focus());
async function go() {
  if (!pw.value || busy.value) return;
  busy.value = true; err.value = '';
  try { const r = await props.run(pw.value); emit('done', r); emit('close'); }
  catch (e) { err.value = e.message; pw.value = ''; input.value?.focus(); }
  busy.value = false;
}
</script>
<template>
  <Modal :title="title" @close="emit('close')">
    <slot />
    <form @submit.prevent="go">
      <label class="label" for="pw">كلمة المرور</label>
      <input id="pw" ref="input" v-model="pw" class="input" type="password" autocomplete="current-password" />
      <p v-if="err" class="hint neg" role="alert">{{ err }}</p>
      <button class="btn wide" :class="danger ? 'danger' : 'primary'" style="margin-top:14px" :disabled="busy || !pw">{{ busy ? '...' : confirmText }}</button>
    </form>
  </Modal>
</template>
