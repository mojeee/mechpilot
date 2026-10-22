import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'shared'),
      '@library': resolve(__dirname, 'library'),
      '@samples': resolve(__dirname, 'samples'),
    },
  },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
