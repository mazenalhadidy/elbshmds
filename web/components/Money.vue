<!-- Shows an amount with Egyptian Arabic digits. signed: shows + for positive. tone: color by sign. -->
<script setup>
import { computed } from 'vue';
import { fmt, fmtSigned } from '@shared/money.js';
const p = defineProps({ value: { type: Number, default: 0 }, signed: Boolean, tone: Boolean });
const text = computed(() => (p.value == null ? '—' : p.signed ? fmtSigned(p.value) : fmt(p.value)));
</script>
<template><span class="num" :class="tone && value ? (value > 0 ? 'pos' : 'neg') : ''">{{ text }}</span></template>
