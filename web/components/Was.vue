<!--
  A value that may have changed after the day was closed: the original crossed out, then the new value.
    <Was :was="original or null" :v="current" />          (bold, for the summary lines)
    <Was :was="..." :v="..." plain />                      (normal weight, for detail lines and tables)
-->
<script setup>
import { fmt } from '@shared/money.js';
defineProps({ was: { type: Number, default: null }, v: { type: Number, default: null }, plain: Boolean });
</script>
<template>
  <span class="was-v">
    <s v-if="was != null" class="old num" title="القيمة عند إنهاء اليوم">{{ fmt(was) }}</s>
    <component :is="plain ? 'span' : 'b'" class="num" :class="{ changed: was != null }">{{ v == null ? '—' : fmt(v) }}</component>
  </span>
</template>
<style scoped>
.was-v { display: inline-flex; align-items: baseline; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
.old { color: var(--faint); font-size: 0.85em; font-weight: 400; }
.changed { color: var(--brand-ink); }
</style>
