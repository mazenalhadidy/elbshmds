<!-- Quick light notifications at the bottom (errors stay a bit longer; some have an "undo" button). -->
<script setup>
import { useToasts } from '@/stores/toasts.js';
const t = useToasts();
const run = (x) => { x.action.run(); t.close(x.id); };
</script>
<template>
  <div class="toasts" aria-live="polite">
    <div v-for="x in t.list" :key="x.id" class="toast" :class="x.kind">
      <span>{{ x.kind === 'done' ? '✓ ' : '' }}{{ x.text }}</span>
      <button v-if="x.action" class="undo" @click="run(x)">{{ x.action.label }}</button>
    </div>
  </div>
</template>
<style scoped>
.toasts { position: fixed; z-index: 60; inset-inline: 0; bottom: 84px; display: flex; flex-direction: column; align-items: center; gap: 6px; pointer-events: none; }
.toast { pointer-events: auto; max-width: 92vw; display: flex; gap: 12px; align-items: center; padding: 8px 14px; border-radius: 10px; font-size: 14px; box-shadow: 0 4px 14px rgba(30, 30, 60, .12); }
.toast.done { background: var(--brand-soft); color: var(--brand-ink); border: 1px solid #ddd3f5; }
.toast.error { background: #3a3a50; color: #fff; }
.undo { border: 0; background: none; color: inherit; font-weight: 700; text-decoration: underline; cursor: pointer; }
@media (min-width: 900px) { .toasts { bottom: 24px; } }
</style>
