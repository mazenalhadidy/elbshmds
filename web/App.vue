<!-- The frame of the app: header with the menu in the middle, the page, the bottom menu on phones, the status circle. -->
<script setup>
import { useShop } from '@/stores/shop.js';
import { pages } from './router.js';
import { useRoute } from 'vue-router';
import LoginScreen from './components/LoginScreen.vue';
import SetupScreen from './components/SetupScreen.vue';
import EditBar from './components/EditBar.vue';
import StatusDot from './components/StatusDot.vue';
import Toasts from './components/Toasts.vue';
import UpdateButton from './components/UpdateButton.vue';
const shop = useShop();
// a tab is highlighted on its page and on the pages under it (/settle/deficits -> «التصفية»)
const route = useRoute();
const isOn = p => route.path === p.path || (p.path !== '/' && route.path.startsWith(p.path + '/'));
</script>
<template>
  <template v-if="!shop.loggedIn"><LoginScreen /></template>
  <template v-else-if="!shop.snap && !shop.ready"><p class="muted" style="text-align:center;margin-top:20vh">جارٍ التحميل…</p></template>
  <template v-else-if="!shop.snap"><p class="muted" style="text-align:center;margin-top:20vh">لا يوجد اتصال بجهاز المحل ولا بيانات محفوظة على هذا الجهاز بعد.</p></template>
  <template v-else-if="shop.snap.setupNeeded"><SetupScreen /></template>
  <template v-else>
    <header class="top">
      <div class="bar">
        <div class="brand"><img src="/icon.svg" width="30" height="30" alt="" /><b>محل الباشمهندس</b></div>
        <nav class="desk-only" aria-label="القائمة">
          <RouterLink v-for="p in pages" :key="p.name" :to="p.path" class="tab" active-class="" :class="{ on: isOn(p) }">{{ p.label }}</RouterLink>
        </nav>
        <div class="end">
          <UpdateButton />
          <span v-if="!shop.lock.editor && !shop.editing" class="viewonly">مشاهدة فقط <button class="btn sm" @click="shop.takeOver()">تولّي التعديل</button></span>
        </div>
      </div>
    </header>
    <EditBar v-if="shop.editing" />
    <main><RouterView /></main>
    <nav class="bottom phone-only" aria-label="القائمة">
      <RouterLink v-for="p in pages" :key="p.name" :to="p.path" class="tab" active-class="" :class="{ on: isOn(p) }">{{ p.label }}</RouterLink>
    </nav>
    <StatusDot />
  </template>
  <Toasts />
</template>
<style scoped>
.top { position: sticky; top: 0; z-index: 8; background: var(--surface); border-bottom: 1px solid var(--line); }
.bar { max-width: var(--maxw); margin: 0 auto; min-height: 60px; padding: 8px 16px; display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 12px; }
.brand { display: flex; align-items: center; gap: 10px; font-size: 17px; white-space: nowrap; }
.end { display: flex; justify-content: flex-end; align-items: center; gap: 8px; flex-wrap: wrap; }
nav { display: flex; gap: 4px; justify-content: center; }
.tab { text-decoration: none; color: var(--muted); padding: 8px 16px; border-radius: 10px; font-weight: 500; white-space: nowrap; }
.tab:hover { color: var(--fg); background: var(--surface-2); }
.tab.on { background: var(--brand-soft); color: var(--brand); font-weight: 700; }
.viewonly { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--warn); }
.bottom { position: fixed; bottom: 0; inset-inline: 0; z-index: 8; background: var(--surface); border-top: 1px solid var(--line); padding: 6px 6px calc(6px + env(safe-area-inset-bottom)); gap: 4px; }
.bottom .tab { flex: 1; text-align: center; padding: 8px 2px; font-size: 13px; }
@media (max-width: 899px) { .bar { grid-template-columns: 1fr auto; } }
</style>
