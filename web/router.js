// The four pages. Change the order/names of the menu here.
import { createRouter, createWebHistory, createMemoryHistory } from 'vue-router';
import JournalPage from './pages/JournalPage.vue';
import AccountsPage from './pages/AccountsPage.vue';
import ManagePage from './pages/ManagePage.vue';
import SettlePage from './pages/SettlePage.vue';
import DeficitsPage from './pages/DeficitsPage.vue';

export const pages = [
  { path: '/', name: 'journal', label: 'اليومية', component: JournalPage },
  { path: '/accounts', name: 'accounts', label: 'العملاء والمحافظ', component: AccountsPage },
  { path: '/manage', name: 'manage', label: 'الإدارة', component: ManagePage },
  { path: '/settle', name: 'settle', label: 'التصفية', component: SettlePage },
];
export const makeRouter = (memory = false) => createRouter({
  history: memory ? createMemoryHistory() : createWebHistory(),
  // «العجوزات» is opened from «التصفية» (its button); it is not a tab of its own, the «التصفية» tab stays highlighted
  routes: [...pages, { path: '/settle/deficits', name: 'deficits', component: DeficitsPage }, { path: '/:p(.*)*', redirect: '/' }],
});
