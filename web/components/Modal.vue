<!-- A pop-up: bottom sheet on phones, centered box on big screens. Closes with Esc or a click outside. -->
<script setup>
import { onMounted, onBeforeUnmount } from 'vue';
defineProps({ title: String, wide: Boolean });
const emit = defineEmits(['close']);
const onKey = e => { if (e.key === 'Escape') emit('close'); };
onMounted(() => document.addEventListener('keydown', onKey));
onBeforeUnmount(() => document.removeEventListener('keydown', onKey));
</script>
<template>
  <Teleport to="body">
    <div class="overlay" @mousedown.self="emit('close')">
      <div class="sheet" :class="{ wide }" role="dialog" aria-modal="true" :aria-label="title">
        <header class="between"><h3>{{ title }}</h3><button class="btn icon" aria-label="إغلاق" @click="emit('close')">✕</button></header>
        <div class="body"><slot /></div>
        <footer v-if="$slots.footer"><slot name="footer" /></footer>
      </div>
    </div>
  </Teleport>
</template>
<style scoped>
.overlay { position: fixed; inset: 0; z-index: 50; background: rgba(28, 28, 48, .32); display: flex; align-items: flex-end; justify-content: center; }
.sheet { background: var(--surface); width: 100%; max-width: 480px; max-height: min(720px, 92vh); display: flex; flex-direction: column; border-radius: 16px 16px 0 0; box-shadow: var(--shadow-pop); }
.sheet.wide { max-width: 760px; }
header { padding: 14px 16px 6px; } h3 { margin: 0; font-size: 17px; }
.body { padding: 8px 16px 16px; overflow: auto; }
footer { padding: 12px 16px; border-top: 1px solid var(--line); display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; }
@media (min-width: 700px) { .overlay { align-items: center; } .sheet { border-radius: 16px; } }
</style>
