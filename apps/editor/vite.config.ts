/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  // Unit + component tests (Vitest).
  //  - Default environment is `node` (fast) for store/schema/API `*.test.ts`.
  //  - Component tests are `*.test.tsx` and opt into jsdom via a per-file
  //    `// @vitest-environment jsdom` docblock; setup.ts provides jest-dom
  //    matchers and the DOM stubs React Flow needs.
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    setupFiles: ['./src/test/setup.ts'],
  },
});
