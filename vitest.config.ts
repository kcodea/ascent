import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const resolvePath = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  // Mirror the build's compile-time defines (`apps/web/vite.config.ts`) so any test that transitively imports a
  // UI module using them doesn't crash on collection. `store.ts` references these for telemetry patch tags; a
  // test reaching it (via `useCombatReplay`, etc.) otherwise fails with `__APP_VERSION__ is not defined`. Test
  // values are placeholders — nothing under test asserts on the real version/SHA.
  define: {
    __APP_VERSION__: JSON.stringify('0.0.0-test'),
    __BUILD_SHA__: JSON.stringify('test'),
  },
  resolve: {
    alias: {
      '@game/core': resolvePath('./packages/core/src/index.ts'),
      '@game/content': resolvePath('./packages/content/src/index.ts'),
    },
  },
  test: {
    include: ['packages/**/*.test.ts'],
    // Polyfill `navigator` for Node < 21 (CI pins Node 20) so pixi.js's module-load `isSafari()` doesn't throw
    // when a test transitively imports pixiFx (the choreographer impact/lunge/engine tests). See the setup file.
    setupFiles: ['./vitest.setup.ts'],
  },
});
