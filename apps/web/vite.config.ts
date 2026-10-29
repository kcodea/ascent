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
import { gauntletStagePlugin, STAGES_DIR } from './gauntletStagePlugin';
import { plateTuningPlugin } from './plateTuningPlugin';
import { backdropTuningPlugin } from './backdropTuningPlugin';
import { workbenchPlugin } from './workbenchPlugin';
import { publicArtList } from './publicArt';
import { phoneArtPlugin } from './phoneArtPlugin';
import { hoverGuardPlugin } from './hoverGuardPlugin';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Build identity, baked in at config load (dev + build): the package version + the short git SHA, so the
// in-game version badge unambiguously says which build is live (no more "is this last night's?").
const pkgVersion = (createRequire(import.meta.url)('../../package.json') as { version: string }).version;
const buildSha = (() => {
  try { return execSync('git rev-parse --short HEAD').toString().trim(); } catch { return 'dev'; }
})();
// DIRTY = the tree has uncommitted or untracked changes, so the bundle is NOT the commit the SHA names (an
// untracked fx def or art file is globbed straight in). `scripts/release-desktop.mjs` refuses a dirty tree; the
// badge shows a `*` so a hand build can never pass for a release. Untracked files count, ignored ones don't.
const buildDirty = (() => {
  try { return execSync('git status --porcelain --untracked-files=all').toString().trim().length > 0; } catch { return true; }
})();
const buildDate = new Date().toISOString();
// The public images the UI references, in BASE_URL-relative form — the art preload warms them in priority order
// (packages/ui/src/preloadPlan.ts; art pop-in fix 2026-09-29). Derived from the source so it never goes stale.
const publicArt = publicArtList(r('./public'), [r('../../packages/ui/src'), r('./src')]);

// Resolve workspace packages straight to their TS source so Vite compiles them
// directly (no per-package build step). Boundaries stay enforced by imports.
export default defineConfig(({ command }) => ({
  // Relative base for the production build so the bundle works when served from a
  // sub-path (e.g. itch.io's CDN, which hosts the game under /html/<id>/). Dev stays absolute.
  base: command === 'build' ? './' : '/',
  define: {
    __APP_VERSION__: JSON.stringify(pkgVersion),
    __BUILD_SHA__: JSON.stringify(buildSha),
    __BUILD_DIRTY__: JSON.stringify(buildDirty),
    __BUILD_DATE__: JSON.stringify(buildDate),
    __PUBLIC_ART__: JSON.stringify(publicArt),
    // No phone copies outside a production build (the dev server serves originals); phoneArtPlugin overrides it there.
    __PHONE_ART__: 'null',
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
  // `plateTuningPlugin` (also `apply: 'serve'`) = the Card Plate Editor's POST /__plates/tuning: one plate's frame and
  // interior numbers into packages/ui/src/cardPlate/plate-tuning.json, then that plate's Collection image rebuilt.
  // `backdropTuningPlugin` (also `apply: 'serve'`) = the Background Tuner's POST /__backdrops/tuning: one board backdrop's
  // tune (zoom, position, darkness, tint, shadow) into packages/ui/src/backdrop-tuning.json.
  // `gauntletStagePlugin` (also `apply: 'serve'`) = the Stage Builder's GET/POST /__gauntlet/stage over
  // packages/content/src/gauntlet/stages/*.json. That directory is watcher-ignored so a Save does not force a
  // full page reload (which would throw away the sandbox): the running game keeps the BUNDLED stage data until
  // the dev server restarts, while the Stage Builder always reads from disk via GET.
  plugins: [react(), fxDefsPlugin(), uiAssetPlugin(), beatLabPlugin(), rulebookPlugin(), bugBoardPlugin(), qaScenarioPlugin(), workbenchPlugin(), gauntletStagePlugin(), plateTuningPlugin(), backdropTuningPlugin(),
    // Production only: the downscaled phone copies of the big art + the `__PHONE_ART__` list of them (phoneArtPlugin.ts).
    phoneArtPlugin({ uiSrc: r('../../packages/ui/src'), publicDir: r('./public'), publicArt, cacheDir: r('../../node_modules/.cache/phone-art') })],
  // HOVER GUARD (R-TOUCH-HOVERGUARD-01): every hover glow / lift rule is wrapped in `@media (hover: hover)` at build
  // time so it never sticks after a tap on a phone. A mouse always matches the query, so desktop is unchanged.
  css: { postcss: { plugins: [hoverGuardPlugin()] } },
  // PERF BENCH builds only (never a player build): hidden source maps, so `npm run perf:gauntlet -- --profile <scene>`
  // can name the minified functions in a CPU profile. 'hidden' writes the .map files without linking them.
  build: { sourcemap: process.env.VITE_PERF_BENCH === '1' ? 'hidden' : false },
  server: { watch: { ignored: [STAGES_DIR.replaceAll('\\', '/') + '/**'] } },
  resolve: {
    alias: {
      '@game/core': r('../../packages/core/src/index.ts'),
      '@game/content': r('../../packages/content/src/index.ts'),
      '@game/sim': r('../../packages/sim/src/index.ts'),
      '@game/progression': r('../../packages/progression/src/index.ts'),
      '@game/guides': r('../../packages/guides/src/index.ts'),
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
