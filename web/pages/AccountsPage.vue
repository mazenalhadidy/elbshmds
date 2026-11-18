<!-- الحسابات: العملاء (right) · الديون (middle) · المحافظ (left) — three side by side on a computer, one at a time on a phone.
     Each list keeps one height, so the page never moves while you search. -->
<script setup>
import { ref } from 'vue';
import ItemTable from '@/components/ItemTable.vue';
const tab = ref('client');
const T = [['client', 'العملاء'], ['debt', 'ديون'], ['wallet', 'المحافظ']];
</script>
<template>
  <div class="page">
    <div class="seg phone-only" style="margin-bottom:14px;width:100%" role="tablist">
      <button v-for="[k, l] in T" :key="k" role="tab" :aria-selected="tab === k" :class="{ on: tab === k }" style="flex:1" @click="tab = k">{{ l }}</button>
    </div>
    <div class="grid3">
      <ItemTable v-for="[k, l] in T" :key="k" :type="k" :title="k === 'wallet' ? 'المحافظ الإلكترونية' : l" fixed :class="{ 'desk-only': tab !== k }" />
    </div>
  </div>
</template>
