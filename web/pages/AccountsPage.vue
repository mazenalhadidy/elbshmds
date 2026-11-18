<!-- الحسابات: العملاء (right) · المحافظ (middle) · الديون (left).
     Three side by side only where each table fits whole (≥ 1000 px); narrower (phone, tablet): tabs, one table at a time.
     Each list keeps one height, so the page never moves while you search. -->
<script setup>
import { ref } from 'vue';
import ItemTable from '@/components/ItemTable.vue';
const tab = ref('client');
const T = [['client', 'العملاء'], ['wallet', 'المحافظ'], ['debt', 'ديون']];
</script>
<template>
  <div class="page">
    <div class="seg tabs" style="margin-bottom:14px;width:100%" role="tablist">
      <button v-for="[k, l] in T" :key="k" role="tab" :aria-selected="tab === k" :class="{ on: tab === k }" style="flex:1" @click="tab = k">{{ l }}</button>
    </div>
    <div class="cols">
      <ItemTable v-for="[k, l] in T" :key="k" :type="k" :title="k === 'wallet' ? 'المحافظ الإلكترونية' : l" fixed :class="{ narrow: tab !== k }" />
    </div>
  </div>
</template>
<style scoped>
.cols { display: grid; gap: 16px; align-items: start; }
@media (min-width: 1000px) { .cols { grid-template-columns: repeat(3, minmax(0, 1fr)); } .tabs { display: none; } }
@media (max-width: 999px) { .narrow { display: none; } }
</style>
