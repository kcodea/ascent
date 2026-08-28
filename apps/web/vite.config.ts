import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fxDefsPlugin } from './fxDefsPlugin';
import { uiAssetPlugin } from './uiAssetPlugin';
import { beatLabPlugin } from './beatLabPlugin';
import { rulebookPlugin } from './rulebookPlugin';
import { bugBoardPlugin } from './bugBoardPlugin';
import { qaScenarioPlugin } from './qaScenarioPlugin';
import { workbenchPlugin } from './workbenchPlugin';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Build identity, baked in at config load (dev + build): the package version + the short git SHA, so the
// in-game version badge unambiguously says which build is live (no more "is this last night's?").
const pkgVersion = (createRequire(import.meta.url)('../../package.json') as { version: string }).version;
const buildSha = (() => {
  try { return execSync('git rev-parse --short HEAD').toString().trim(); } catch { return 'dev'; }
})();

// Resolve workspace packages straight to their TS source so Vite compiles them
// directly (no per-package build step). Boundaries stay enforced by imports.
export default defineConfig(({ command }) => ({
  // Relative base for the production build so the bundle works when served from a
  // sub-path (e.g. itch.io's CDN, which hosts the game under /html/<id>/). Dev stays absolute.
  base: command === 'build' ? './' : '/',
  define: {
    __APP_VERSION__: JSON.stringify(pkgVersion),
    __BUILD_SHA__: JSON.stringify(buildSha),
  },
  // `fxDefsPlugin`, `uiAssetPlugin`, and `beatLabPlugin` are all `apply: 'serve'` — they add write endpoints to
  // the dev server ONLY, and are inert (never instantiated) in a production build. `fxDefsPlugin` = the FX
  // workbench's /__fx/def + /__fx/art; `uiAssetPlugin` = the in-run UI editor's /__ui/asset image upload;
  // `beatLabPlugin` = the Beat Lab's /__beat-lab/defaults commit (writes packages/ui/src/beatLab/beat-defaults.json).
  // `bugBoardPlugin` (also `apply: 'serve'`) = the Bug Board's /__bugboard/* endpoints — it reads the
  // service-role key from the untracked repo-root .env, which is exactly why it must never ship in a build.
  // `qaScenarioPlugin` (also `apply: 'serve'`) = the Scene Builder's /__qa-scenario/save fixture write
  // (Docbot handoff §4.5) — dev server only, like every other write endpoint above.
  // `workbenchPlugin` (also `apply: 'serve'`) = the QA Workbench's READ-ONLY /__workbench/* endpoints
  // (Doc Bot 2.0 §15): the gitignored findings ledger + sweep artifacts + curated scenario fixtures. It
  // writes nothing — the workbench's one write (accepting a wording recommendation) reuses /__rulebook/decide.
  plugins: [react(), fxDefsPlugin(), uiAssetPlugin(), beatLabPlugin(), rulebookPlugin(), bugBoardPlugin(), qaScenarioPlugin(), workbenchPlugin()],
  resolve: {
    alias: {
      '@game/core': r('../../packages/core/src/index.ts'),
      '@game/content': r('../../packages/content/src/index.ts'),
      '@game/sim': r('../../packages/sim/src/index.ts'),
      '@game/ui': r('../../packages/ui/src/index.ts'),
      // Order matters: Vite's string aliases prefix-match, so the deep contracts entrypoints must be
      // listed BEFORE the bare '@game/rules' or they resolve to '…/index.ts/contracts/…' (ENOENT).
      '@game/rules/parked': r('../../packages/rules/src/parked.ts'),
      '@game/rules/contracts/schema': r('../../packages/rules/src/contracts/schema.ts'),
      '@game/rules/contracts/curated': r('../../packages/rules/src/contracts/curated/index.ts'),
      '@game/rules/contracts': r('../../packages/rules/src/contracts/index.ts'),
      '@game/rules': r('../../packages/rules/src/index.ts'),
    },
  },
}));
