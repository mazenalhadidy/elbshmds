// Vite = builds the Vue screens into dist/ (served by the Node server). Also the test runner config (Vitest).
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./web', import.meta.url)),          // the Vue app
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)), // rules shared with the server
    },
  },
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: false },
  server: { proxy: { '/api': 'http://localhost:3000' } },             // `npm run dev`: screens on 5173, API from the running server
  test: {
    include: ['tests/**/*.test.js'],              // ai-tool/ has its own tests (npm run test:ai)
    environment: 'node',
    environmentMatchGlobs: [['tests/web/**', 'jsdom']],
    testTimeout: 20000,
  },
});
