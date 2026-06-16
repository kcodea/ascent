import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const resolvePath = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@game/core': resolvePath('./packages/core/src/index.ts'),
      '@game/content': resolvePath('./packages/content/src/index.ts'),
    },
  },
  test: {
    include: ['packages/**/*.test.ts'],
  },
});
