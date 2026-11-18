<!--
  Number field: shows Egyptian Arabic digits with thousands separators while you type (١٬٢٣٤٬٥٦٧),
  accepts both ٠-٩ and 0-9, removes leading zeros, and is empty (not "0") when there is no value.
  v-model gives a number, or '' when empty.
-->
<script setup>
import { ref, watch } from 'vue';
import { toLatinDigits, toArabicDigits, parseAmount } from '@shared/money.js';

const props = defineProps({
  modelValue: { type: [Number, String], default: '' },
  allowNegative: { type: Boolean, default: false },
  placeholder: { type: String, default: '٠' },
});
const emit = defineEmits(['update:modelValue', 'enter', 'escape', 'letters']);
const el = ref(null);

/** "-0012345.5" -> "-١٢٬٣٤٥٫٥" (digits stay in the same order) */
function pretty(raw) {
  let s = toLatinDigits(raw).replace(/[٬,\s]/g, '').replace(/٫/g, '.').replace(/[−–]/g, '-');
  const neg = props.allowNegative && s.startsWith('-');
  s = s.replace(/[^0-9.]/g, '');
  const [int, ...dec] = s.split('.');
  const intClean = int.replace(/^0+(?=\d)/, '');
  const grouped = intClean.replace(/\B(?=(\d{3})+(?!\d))/g, '٬');
  return (neg ? '-' : '') + toArabicDigits(grouped) + (dec.length ? '٫' + toArabicDigits(dec.join('').slice(0, 2)) : '');
}
const fromModel = v => (v === '' || v == null || Number.isNaN(v) ? '' : pretty(String(v)));
const text = ref(fromModel(props.modelValue));
// value changed from outside (e.g. cleared after adding a row): show it. While you type "-" (no number yet) keep your text.
watch(() => props.modelValue, v => {
  const cur = parseAmount(text.value);
  if (v === '' || v == null) { if (Number.isFinite(cur)) text.value = ''; }
  else if (cur !== Number(v)) text.value = fromModel(v);
});

function onInput(e) {
  const input = e.target;
  // letters typed after the amount (e.g. «٥٠٠ شاحن»): they are not part of the number -> handed to the next field
  const letters = input.value.match(/\p{L}[\p{L}\p{M}\s]*$/u);
  if (letters) { input.value = input.value.slice(0, letters.index); emit('letters', letters[0]); }
  const caret = Math.min(input.selectionStart, input.value.length);
  const before = toLatinDigits(input.value.slice(0, caret)).replace(/[^0-9.]/g, '').length;   // digits before the cursor
  const out = pretty(input.value);
  text.value = out; input.value = out;
  let n = 0, i = 0;                                                                        // put the cursor back after the same digit
  while (i < out.length && n < before) { if (/[0-9.٠-٩٫]/.test(out[i])) n++; i++; }
  input.setSelectionRange(i, i);
  const v = parseAmount(out);
  emit('update:modelValue', Number.isFinite(v) ? v : '');
}
function onKey(e) {
  if (e.key === 'Enter') { e.preventDefault(); emit('enter'); }
  else if (e.key === 'Escape') emit('escape');
}
defineExpose({ focus: () => el.value?.focus(), select: () => el.value?.select() });
</script>
<template>
  <input ref="el" class="input money" type="text" inputmode="decimal" autocomplete="off" :placeholder="placeholder"
         :value="text" @input="onInput" @keydown="onKey" @focus="e => e.target.select()" />
</template>
