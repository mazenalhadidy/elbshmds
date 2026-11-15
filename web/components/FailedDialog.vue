<!-- Changes the shop computer did not accept: kept here (never deleted automatically). Retry or delete each one. -->
<script setup>
import { useShop } from '@/stores/shop.js';
import { describeOp } from '@shared/describe.js';
import { toArabicDigits } from '@shared/money.js';
import Modal from './Modal.vue';
const shop = useShop();
const emit = defineEmits(['close']);
const drop = i => { if (confirm('حذف هذا التعديل نهائيًا؟')) shop.dropFailed(i); };
</script>
<template>
  <Modal title="تعديلات لم تُقبل" wide @close="emit('close')">
    <p v-if="!shop.failed.length" class="empty">لا يوجد</p>
    <div v-for="(x, i) in shop.failed" :key="i" class="card" style="margin-bottom:8px">
      <div class="card-b">
        <b>{{ describeOp(x.op, shop.items) }}</b>
        <p class="hint neg">{{ x.error }} <span class="muted">· {{ toArabicDigits(new Date(x.at).toLocaleString('en-GB')) }}</span></p>
        <div class="row" style="margin-top:8px"><button class="btn sm primary" @click="shop.retryFailed(i)">إعادة المحاولة</button><button class="btn sm danger" @click="drop(i)">حذف</button></div>
      </div>
    </div>
    <template #footer><button class="btn" @click="shop.download()">تنزيل نسخة</button></template>
  </Modal>
</template>
