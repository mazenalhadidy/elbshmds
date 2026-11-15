<!-- الإدارة: cash & network, add/subtract on the real total, constants, ربح الكاش, phones, program -->
<script setup>
import { ref, computed } from 'vue';
import { useShop } from '@/stores/shop.js';
import { fmt } from '@shared/money.js';
import CashFields from '@/components/CashFields.vue';
import AdjustmentsTable from '@/components/AdjustmentsTable.vue';
import ItemTable from '@/components/ItemTable.vue';
import CashProfitCard from '@/components/CashProfitCard.vue';
import DevicesCard from '@/components/DevicesCard.vue';
import ProgramCard from '@/components/ProgramCard.vue';
import Icon from '@/components/Icon.vue';
const shop = useShop();
const constOpen = ref(false);
const constTotal = computed(() => shop.summary?.constants || 0);
</script>
<template>
  <div class="page">
    <div class="grid2">
      <div class="stack">
        <CashFields />
        <AdjustmentsTable />
        <details class="card fold" :open="constOpen" @toggle="e => (constOpen = e.target.open)">
          <summary><Icon name="chev" class="chev" /><span>الثوابت</span><span class="sum num">{{ fmt(constTotal) }}</span></summary>
          <ItemTable type="constant" bare />
        </details>
        <CashProfitCard v-if="!shop.view?.editing" />
      </div>
      <div class="stack" v-if="!shop.view?.editing">
        <DevicesCard />
        <ProgramCard />
      </div>
    </div>
  </div>
</template>
