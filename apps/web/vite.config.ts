import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Resolve workspace packages straight to their TS source so Vite compiles them
// directly (no per-package build step). Boundaries stay enforced by imports.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@game/core': r('../../packages/core/src/index.ts'),
      '@game/content': r('../../packages/content/src/index.ts'),
      '@game/sim': r('../../packages/sim/src/index.ts'),
      '@game/ui': r('../../packages/ui/src/index.ts'),
    },
  },
});
