<!-- الإدارة: cash & network, the constants under them, add/subtract on the real total, ربح الكاش | devices (disconnect), program -->
<script setup>
import { useShop } from '@/stores/shop.js';
import CashFields from '@/components/CashFields.vue';
import AdjustmentsTable from '@/components/AdjustmentsTable.vue';
import ItemTable from '@/components/ItemTable.vue';
import CashProfitCard from '@/components/CashProfitCard.vue';
import DevicesCard from '@/components/DevicesCard.vue';
import ProgramCard from '@/components/ProgramCard.vue';
const shop = useShop();
</script>
<template>
  <div class="page">
    <div class="grid2">
      <div class="stack">
        <CashFields />
        <ItemTable type="constant" title="الثوابت" />
        <AdjustmentsTable />
        <CashProfitCard v-if="!shop.view?.editing" />
      </div>
      <div class="stack" v-if="!shop.view?.editing">
        <DevicesCard />
        <ProgramCard />
      </div>
    </div>
  </div>
</template>
