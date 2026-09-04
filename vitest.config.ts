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
    __BUILD_DIRTY__: JSON.stringify(false),
    __BUILD_DATE__: JSON.stringify('1970-01-01T00:00:00.000Z'),
  },
  // Use the automatic JSX runtime (matches `apps/web/tsconfig.json`'s `jsx: react-jsx`) so a test that
  // transitively imports a JSX-using UI module (e.g. the glossary drift test importing `MinionBook`, which
  // pulls in `Icon.tsx`) doesn't crash on collection with `React is not defined`. Vitest's default esbuild
  // JSX transform is the classic runtime, which needs a React global these leaf modules never import.
  esbuild: { jsx: 'automatic' },
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
    // `.test.tsx` is scoped to @game/ui on purpose: only the rendered-text reconciliation harness mounts
    // React components (per-file `@vitest-environment jsdom` docblock — the sim/core suites stay in the
    // default node environment, untouched).
    include: ['packages/**/*.test.ts', 'packages/ui/src/**/*.test.tsx', 'apps/**/*.test.ts'],
    // Polyfill `navigator` for Node < 21 (CI pins Node 20) so pixi.js's module-load `isSafari()` doesn't throw
    // when a test transitively imports pixiFx (the choreographer impact/lunge/engine tests). See the setup file.
    setupFiles: ['./vitest.setup.ts'],
  },
});
