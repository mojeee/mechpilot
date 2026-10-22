import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

const alias = {
  '@shared': resolve(__dirname, 'shared'),
  '@library': resolve(__dirname, 'library'),
  '@samples': resolve(__dirname, 'samples'),
};

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias },
    build: { rollupOptions: { input: { index: resolve(__dirname, 'app/main/index.ts') } } },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias },
    build: { rollupOptions: { input: { index: resolve(__dirname, 'app/preload/index.ts') } } },
  },
  renderer: {
    root: resolve(__dirname, 'app/renderer'),
    resolve: { alias },
    plugins: [react()],
    // Workers (app/workers/*) are bundled as ES modules so they can import from /shared.
    worker: { format: 'es' },
    build: { rollupOptions: { input: { index: resolve(__dirname, 'app/renderer/index.html') } } },
  },
});
