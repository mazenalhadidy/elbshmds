// Starts the Vue app.
import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { makeRouter } from './router.js';
import { useShop } from './stores/shop.js';
import './styles/base.css';

const app = createApp(App).use(createPinia()).use(makeRouter());
app.mount('#app');
useShop().start();
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('/sw.js').catch(() => {});
