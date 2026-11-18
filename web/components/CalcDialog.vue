<!--
  TODAY'S CHANGE of a client / shop debt — two ways (the first is the default):
  «القيمة الجديدة»: type the new value; the change (new − before) is calculated and saved as one line.
  «الحاسبة»: the calculator below. Opening it again shows the way it was written (several lines = the calculator).
  - type a number, press + or −  -> a new line starts, the result is always shown below
  - press = (or Enter)            -> the cursor stops and only the result is shown
  - click the result              -> back to the lines, cursor at the end, continue with + or −
  - إنهاء                          -> saves: final = current debt + result
  The lines are kept, so opening it again shows exactly what you typed (and you can change it).
-->
<script setup>
import { ref, computed, nextTick, onMounted, watch } from 'vue';
import { evalCalc, fmt, fmtSigned, toArabicDigits, r2 } from '@shared/money.js';
import Modal from './Modal.vue';
import MoneyInput from './MoneyInput.vue';

const props = defineProps({ name: String, opening: { type: Number, default: 0 }, calc: { type: String, default: '' }, readonly: Boolean });
const emit = defineEmits(['close', 'save']);

const text = ref(toArabicDigits(props.calc || ''));
// the new value directly (default), unless it was written with the calculator (more than one line)
const lines = String(props.calc || '').split('\n').filter(l => l.trim());
const mode = ref(lines.length > 1 ? 'calc' : 'value');
const newValue = ref(props.calc ? r2(props.opening + (evalCalc(props.calc) || 0)) : '');
const valueEl = ref(null);
const diff = computed(() => (newValue.value === '' ? null : r2(Number(newValue.value) - props.opening)));
function saveValue() { if (diff.value == null) { valueEl.value?.focus(); return; } emit('save', diff.value > 0 ? '+' + diff.value : String(diff.value)); }
function setMode(m) { mode.value = m; if (m === 'value') nextTick(() => valueEl.value?.focus()); else if (showResult.value) nextTick(() => resBtn.value?.focus()); else toEnd(); }
const showResult = ref(false);
const area = ref(null), resBtn = ref(null);
const result = computed(() => evalCalc(text.value));
const valid = computed(() => Number.isFinite(result.value));
const final = computed(() => r2(props.opening + (valid.value ? result.value : 0)));

const toEnd = () => nextTick(() => { const a = area.value; if (a) { a.focus(); a.setSelectionRange(a.value.length, a.value.length); a.scrollTop = a.scrollHeight; } });
onMounted(() => { if (mode.value === 'value') { nextTick(() => valueEl.value?.focus()); return; } if (props.calc) showResult.value = true; else toEnd(); });
watch(showResult, v => { if (v && mode.value === 'calc') nextTick(() => resBtn.value?.focus()); });   // after = the result has the focus: Enter = إنهاء

function addSign(sign) {
  let t = text.value.replace(/\s+$/, '');
  const lines = t.split('\n');
  if (!t) t = sign === '-' ? '-' : '';                                   // first number may start with −
  else if (/^[+-]$/.test(lines[lines.length - 1].trim())) t = [...lines.slice(0, -1), sign].join('\n');   // change the sign of an empty line
  else t += '\n' + sign;
  text.value = t; toEnd();
}
function onKey(e) {
  if (e.key === '+' || e.key === '-' || e.key === '−') { e.preventDefault(); addSign(e.key === '+' ? '+' : '-'); return; }
  if (e.key === '=' || e.key === 'Enter') { e.preventDefault(); showResult.value = true; return; }
  if (e.key === 'Escape') return;                                        // the dialog closes itself
  if (e.key.length === 1 && !/[0-9٠-٩.٫,٬ ]/.test(e.key) && !e.ctrlKey && !e.metaKey) e.preventDefault();   // only numbers
}
function onInput() { text.value = toArabicDigits(text.value); }
function edit() { if (props.readonly) return; showResult.value = false; toEnd(); }
function save() { if (!valid.value) return; emit('save', text.value.split('\n').map(l => l.trim()).filter(l => l && !/^[+-]$/.test(l)).join('\n')); }
function onResultKey(e) { if (e.key === 'Enter') { e.preventDefault(); save(); } }
</script>

<template>
  <Modal :title="name" @close="emit('close')">
    <div class="seg" style="width:100%;margin-bottom:10px" role="tablist">
      <button role="tab" style="flex:1" :aria-selected="mode === 'value'" :class="{ on: mode === 'value' }" data-test="mode-value" @click="setMode('value')">القيمة الجديدة</button>
      <button role="tab" style="flex:1" :aria-selected="mode === 'calc'" :class="{ on: mode === 'calc' }" data-test="mode-calc" @click="setMode('calc')">الحاسبة</button>
    </div>
    <div class="between small muted" style="margin-bottom:8px"><span>قبل اليوم</span><b class="num" style="color:var(--fg)">{{ fmt(opening) }}</b></div>

    <template v-if="mode === 'value'">
      <MoneyInput ref="valueEl" v-model="newValue" class="big-in" allow-negative :disabled="readonly" placeholder="القيمة الجديدة" aria-label="القيمة الجديدة" @enter="saveValue" />
      <div class="sum">
        <div class="between"><span class="muted">التغيير</span><b class="num">{{ diff == null ? '—' : fmtSigned(diff) }}</b></div>
        <div class="between"><span>بعد التغيير</span><b class="num big2">{{ diff == null ? '—' : fmt(newValue) }}</b></div>
      </div>
    </template>
    <template v-else>

    <!-- the lines -->
    <textarea v-show="!showResult" ref="area" v-model="text" class="input lines" dir="ltr" rows="5" spellcheck="false"
              :readonly="readonly" aria-label="الحساب" @keydown="onKey" @input="onInput"></textarea>
    <!-- only the result (after = ) -->
    <button v-show="showResult" ref="resBtn" class="result-only" :disabled="readonly" title="اضغط لتكملة الحساب" @click="edit" @keydown="onResultKey">
      <span class="small muted">نتيجة الحساب — اضغط لتكملة الحساب</span>
      <span class="big num" :class="valid ? '' : 'neg'">{{ valid ? fmtSigned(result) : 'حساب غير صحيح' }}</span>
    </button>

    <div class="pad-keys" v-if="!readonly && !showResult">
      <button class="btn" @click="addSign('+')">+</button><button class="btn" @click="addSign('-')">−</button><button class="btn" @click="showResult = true">=</button>
    </div>

    <div class="sum">
      <div class="between"><span class="muted">النتيجة</span><b class="num" :class="valid ? '' : 'neg'">{{ valid ? fmtSigned(result) : '—' }}</b></div>
      <div class="between"><span>بعد التغيير</span><b class="num big2">{{ fmt(final) }}</b></div>
    </div>
    </template>

    <template #footer>
      <button v-if="!readonly && text && mode === 'calc'" class="btn ghost" @click="text = ''; showResult = false; toEnd()">مسح الحساب</button>
      <button class="btn" @click="emit('close')">إلغاء</button>
      <button v-if="!readonly && mode === 'value'" class="btn primary" :disabled="diff == null" data-test="save-value" @click="saveValue">إنهاء</button>
      <button v-else-if="!readonly" class="btn primary" :disabled="!valid" @click="save">إنهاء</button>
    </template>
  </Modal>
</template>

<style scoped>
.big-in { font-size: 22px; min-height: 52px; }
.lines { min-height: 150px; font-size: 20px; line-height: 1.75; text-align: left; font-variant-numeric: tabular-nums; }
.result-only { all: unset; box-sizing: border-box; width: 100%; min-height: 150px; border: 1px dashed var(--line-strong); border-radius: 10px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; cursor: pointer; }
.result-only:hover { background: var(--brand-soft); }
.result-only:focus-visible { outline: 3px solid rgba(106,75,199,.35); }
.big { font-size: 28px; font-weight: 700; }
.big2 { font-size: 18px; }
.pad-keys { display: flex; gap: 8px; margin-top: 8px; } .pad-keys .btn { flex: 1; font-size: 18px; }
.sum { margin-top: 14px; padding: 12px; border-radius: 10px; background: var(--brand-soft); display: grid; gap: 4px; color: var(--brand-ink); }
</style>
