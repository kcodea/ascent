import { fileURLToPath } from 'node:url';
import { configDefaults, defineConfig } from 'vitest/config';

const resolvePath = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// ── Test groups (selected with `--mode`; plain `npm test` = everything except NIGHTLY_ONLY) ──────────────────
// NIGHTLY_ONLY never runs on a PR: `npm run test:slow` (= `--mode nightly`) runs it locally, and
// .github/workflows/nightly-slow-tests.yml runs it every night + on manual dispatch.
const NIGHTLY_ONLY = ['packages/sim/src/balance/strategy/benchmark.test.ts'];
// HEAVY_GROUPS are the multi-minute self-play suites. CI gives each group its OWN runner (`--mode heavy-<i>`) and
// shards everything else with `--mode light`, so two heavy files can never land in one shard and set the floor.
// Adding/removing a group here? Keep the `heavy-<i>` matrix entries in .github/workflows/ci.yml in sync.
const HEAVY_GROUPS = [
  ['packages/sim/src/productionBots/bots.test.ts'],
  ['packages/sim/src/balance/selfPlayLobby.test.ts'],
  ['packages/sim/src/balance/scoutContext.test.ts', 'packages/sim/src/balance/generalistPilot.test.ts'],
  ['packages/sim/src/balance/selfPlayArmor.test.ts', 'packages/sim/src/lobby/lobby.test.ts'],
];
const ALL_TESTS = ['packages/**/*.test.ts', 'packages/ui/src/**/*.test.tsx', 'apps/**/*.test.ts'];

function testSelection(mode: string): { include: string[]; exclude: string[] } {
  const base = configDefaults.exclude;
  if (mode === 'nightly') return { include: NIGHTLY_ONLY, exclude: base };
  if (mode === 'light') return { include: ALL_TESTS, exclude: [...base, ...NIGHTLY_ONLY, ...HEAVY_GROUPS.flat()] };
  const heavy = /^heavy-(\d+)$/.exec(mode);
  if (heavy) {
    const group = HEAVY_GROUPS[Number(heavy[1])];
    if (!group) throw new Error(`vitest: no HEAVY_GROUPS[${heavy[1]}] (have ${HEAVY_GROUPS.length})`);
    return { include: group, exclude: base };
  }
  return { include: ALL_TESTS, exclude: [...base, ...NIGHTLY_ONLY] };
}

export default defineConfig(({ mode }) => ({
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
    // Which files run is decided by `testSelection` above (the `--mode` groups).
    ...testSelection(mode),
    // Polyfill `navigator` for Node < 21 (CI pins Node 20) so pixi.js's module-load `isSafari()` doesn't throw
    // when a test transitively imports pixiFx (the choreographer impact/lunge/engine tests). See the setup file.
    setupFiles: ['./vitest.setup.ts'],
  },
}));
