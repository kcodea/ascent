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
    // `apps/**` is here for the dev-server-side units that can't live in a package: apps/web's Vite plugins
    // (e.g. fxDefsPlugin's write-validation) are node code the browser bundle never sees, but their
    // safety checks still need covering.
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts'],
    // Polyfill `navigator` for Node < 21 (CI pins Node 20) so pixi.js's module-load `isSafari()` doesn't throw
    // when a test transitively imports pixiFx (the choreographer impact/lunge/engine tests). See the setup file.
    setupFiles: ['./vitest.setup.ts'],
  },
});
