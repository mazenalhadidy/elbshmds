<!-- اليومية: المدخلات · المخرجات · المبيعات (three side by side on a computer, one at a time on a phone) -->
<script setup>
import { ref } from 'vue';
import EntryTable from '@/components/EntryTable.vue';
const tab = ref('input');
const T = [['input', 'المدخلات'], ['output', 'المخرجات'], ['sale', 'المبيعات']];
</script>
<template>
  <div class="page">
    <div class="seg phone-only" style="margin-bottom:14px;width:100%" role="tablist">
      <button v-for="[k, l] in T" :key="k" role="tab" :aria-selected="tab === k" :class="{ on: tab === k }" style="flex:1" @click="tab = k">{{ l }}</button>
    </div>
    <div class="grid3">
      <EntryTable v-for="[k, l] in T" :key="k" :kind="k" :title="l" :class="{ 'desk-only': tab !== k }" />
    </div>
  </div>
</template>
