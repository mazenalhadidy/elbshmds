<!-- العملاء والمحافظ: wallets and clients side by side, the shop debts folded below -->
<script setup>
import { ref, computed } from 'vue';
import { useShop } from '@/stores/shop.js';
import ItemTable from '@/components/ItemTable.vue';
import Icon from '@/components/Icon.vue';
import { fmt } from '@shared/money.js';
const shop = useShop();
const debtsOpen = ref(false);
const debtTotal = computed(() => shop.summary?.debts || 0);
</script>
<template>
  <div class="page stack">
    <div class="grid2">
      <ItemTable type="wallet" title="المحافظ الإلكترونية" />
      <ItemTable type="client" title="العملاء" />
    </div>
    <details class="card fold" :open="debtsOpen" @toggle="e => (debtsOpen = e.target.open)">
      <summary><Icon name="chev" class="chev" /><span>الديون على المحل</span><span class="sum num">{{ fmt(debtTotal) }}</span></summary>
      <ItemTable type="debt" bare />
    </details>
  </div>
</template>
