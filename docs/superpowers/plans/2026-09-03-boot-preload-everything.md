# Boot Preload Everything — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove every first-occurrence hitch by loading and warming EVERY shipped asset and GPU program behind a
click-to-begin boot screen that gates on real completion (owner ruling 2026-09-03: "I'd rather wait 2 minutes
than experience pop-in hitches" — this reverses the 2026-08-25 fixed-3.5s splash).

**Architecture:** A single boot pipeline (`bootLoader.ts`) runs weighted stages — images (every art glob + a
GENERATED manifest of `apps/web/public/`), fonts (self-hosted via `@fontsource`), audio (every clip, decoded after
the unlock click), and FX (the Pixi canvas mounted at boot, primitives chunk loaded, every shader linked, every
shape/art texture baked + uploaded). The splash bar shows real progress; the menu opens only when every stage
resolves (each item has its own timeout so boot is always bounded). A DEV hitch log records long tasks with game
context so the claim "no first-use hitches" is measured, not assumed.

**Tech Stack:** React 18, Vite 6, Pixi v8, Web Audio, `@fontsource/*`, Vitest.

**Spec:** the conversation of 2026-09-03 (owner answers: "Click to begin, then load"; "Self-host fonts and gate
on them"). Findings that motivate each task are in `docs/devlog/2026-09-03-boot-preload-everything.md` (Task 9).

## Global Constraints

- Never `Math.random` in core/content/sim (ESLint). UI is free but deterministic hashing is preferred.
- No paint-property loops; the boot bar animates `transform: scaleX()` only.
- Public asset paths are `import.meta.env.BASE_URL`-relative (never root-absolute; `publicAssetPaths.test.ts`).
- `packages/ui` may import other packages only through public entrypoints.
- Every gate item has a timeout; boot can never hang (offline / broken CDN → degrade, never block).
- Gameplay-visible change → `packages/ui/src/patchNotes.ts` entry in the same PR.

---

### Task 1: Generated manifest of `apps/web/public/`

**Files:**
- Create: `packages/tools/src/public-manifest.ts` (generator, `npm run assets:manifest`)
- Create: `packages/tools/src/public-manifest.lib.ts` (pure listing, shared with the test)
- Create: `packages/ui/src/publicAssets.generated.ts` (committed output)
- Create: `packages/ui/src/publicAssets.test.ts`
- Modify: `package.json` scripts

**Interfaces:**
- Produces: `PUBLIC_ASSETS: readonly string[]` — public-root-relative forward-slash paths of every image/svg
  file under `apps/web/public/` (`*.webp|png|jpg|svg`), sorted, excluding `*-preview.html` and `README.md`.
- Produces: `listPublicAssets(publicDir: string): string[]` (lib).

- [ ] Write `public-manifest.lib.ts`: recursive readdir, filter by extension, relative forward-slash paths, sorted.
- [ ] Write `public-manifest.ts`: renders
  `export const PUBLIC_ASSETS: readonly string[] = [ ... ] as const;` with a "GENERATED — run npm run assets:manifest" header.
- [ ] Add script `"assets:manifest": "tsx packages/tools/src/public-manifest.ts"`; run it; commit the output.
- [ ] Test `publicAssets.test.ts`: `listPublicAssets(<repo>/apps/web/public)` deep-equals `PUBLIC_ASSETS`
  (message: "run npm run assets:manifest"). Run → PASS.
- [ ] Commit `chore(ui): generated manifest of public/ assets`.

### Task 2: Preload EVERY image, and gate on decode

**Files:**
- Modify: `packages/ui/src/art.ts` (`ALL_ART_URLS`, `preloadAllArt`)
- Create: `packages/ui/src/preloadImages.test.ts`

**Interfaces:**
- Produces: `ALL_IMAGE_URLS: readonly string[]` (exported for the test) = every value of MINION/SPELL/EQUIPMENT/
  HERO/POWER/QUEST/RUNE/MODE art + FX committed art (`fx/shapeLibrary` glob urls) + `PUBLIC_ASSETS` prefixed
  with `BASE_URL`, deduped.
- Produces: `preloadAllArt(onProgress?, opts?: { perItemMs?: number })` now resolves each item on `onload` AND
  `decode()` settled (decode failure/timeout → still settles), so the gate means "decoded".

- [ ] Export the eight art indexes' values via a `allBundledArtUrls()` helper; add `PUBLIC_ASSETS` mapping;
  keep `PUBLIC_ART_URLS` (now redundant) deleted — its entries are in the manifest.
- [ ] Test: `ALL_IMAGE_URLS` contains an entry ending in `fx/damage-splash-2.png`, one in `frames/cardplate.webp`,
  one rune, one quest, one spell; has no duplicates; none start with `/` unless `BASE_URL` is `/`.
- [ ] Commit `feat(ui): preload every bundled + public image, gate on decode`.

### Task 3: Self-hosted fonts + gate

**Files:**
- Modify: `apps/web/package.json` (deps `@fontsource/outfit`, `@fontsource/nunito-sans`,
  `@fontsource/cinzel-decorative`), `apps/web/src/main.tsx` (CSS imports), `apps/web/index.html` (drop the
  Google Fonts links + preconnects)
- Create: `packages/ui/src/fontsPreload.ts`, `packages/ui/src/fontsPreload.test.ts`

**Interfaces:**
- Produces: `FONT_FACES: readonly { family: string; weight: number }[]` — Outfit 400/500/600/700/800/900,
  Nunito Sans 400/600/700, Cinzel Decorative 400/600/700.
- Produces: `preloadFonts(onProgress?, timeoutMs = 10000): Promise<void>` — `document.fonts.load('<w> 1em "<family>"')`
  per face (each raced with the timeout), then `document.fonts.ready`. No-op without `document.fonts`.

- [ ] Test: `FONT_FACES` covers every weight styles.css uses (400,500,600,700,800,900 for Outfit; 600 for
  Cinzel Decorative), and `preloadFonts` resolves with a fake `document.fonts` that never resolves (timeout).
- [ ] Implement; wire imports in main.tsx (`@fontsource/outfit/400.css` … per weight, same for the others).
- [ ] Commit `feat(web): self-host the fonts and preload every face at boot`.

### Task 4: Audio — decode every clip behind the unlock

**Files:**
- Modify: `packages/ui/src/sfx.ts` (`loadSample` → returns a Promise; `prefetchSamples` → uses it;
  new `preloadAllSamples`, `unlockAudio`)
- Create: `packages/ui/src/sfxPreload.test.ts` (pure parts only: `SAMPLE_COUNT` > 0)

**Interfaces:**
- Produces: `unlockAudio(): void` — creates/resumes the context (call from a user gesture).
- Produces: `preloadAllSamples(onProgress?, perClipMs = 15000): Promise<void>` — resolves when every sample's
  fetch+decode settled (failure/timeout counts as settled). Idempotent with the existing lazy path.
- Produces: `SAMPLE_COUNT: number`.

- [ ] Refactor `loadSample` to return the in-flight promise (`loadingSamples: Map<string, Promise<void>>`).
- [ ] `prefetchSamples()` stays (fire-and-forget) for the non-boot path; `preloadAllSamples` awaits all with progress.
- [ ] Commit `feat(ui): preload + decode every audio clip after the unlock click`.

### Task 5: FX warm-up at boot

**Files:**
- Modify: `packages/ui/src/Boot.tsx` (renders `<PixiFxLayer/>` permanently, before children),
  `packages/ui/src/Game.tsx:386` (remove its conditional `<PixiFxLayer/>`),
  `packages/ui/src/fx/playDef.ts` (`schedulePrewarm` → tracked queues; new `warmFx()`),
  `packages/ui/src/fx/primitives/index.ts` (`fxPrewarmSteps` gains a texture-upload step),
  `packages/ui/src/fx/shapeLibrary.ts` (export `hydrateShapeLibrary()` + `cachedTextures()`),
  `packages/ui/src/pixiFx.ts` (export a `warmBuiltinTextures()` that builds the two lazily-made textures).
- Create: `packages/ui/src/fx/warmFx.test.ts`

**Interfaces:**
- Produces: `warmFx(timeoutMs = 20000): Promise<void>` — `ensureDefsReady()`, then waits until the 'over'
  renderer's step queue AND every slot queue brought up by the prewarm has drained (or timeout). Resolves
  immediately when there is no renderer (no WebGL).
- Produces: `uploadTextures(renderer, textures)` step: for each texture `renderer.texture.bind(tex, 0)`
  (Pixi v8 GlTextureSystem uploads on bind) so the first draw never uploads.

- [ ] Add `pendingWarm: Map<FxSlot, Promise<void>>` in playDef; `schedulePrewarm` records a promise per slot
  that resolves when its queue empties; `warmFx()` = `Promise.race([Promise.all(pending values after 'over' registered), timeout])`.
- [ ] Add to `fxPrewarmSteps` (after shapes): `() => uploadTextures(renderer, [...cachedTextures(), ...pixiBuiltinTextures(renderer)])`.
- [ ] Boot renders `<PixiFxLayer/>` always; Game.tsx drops its own (keep the comment's reasoning, updated).
- [ ] Test (node): `warmFx()` resolves when `pixiFx.renderer` is null; resolves after the fake queue drains.
- [ ] Commit `feat(fx): mount the FX canvas at boot and warm every program + texture before the menu`.

### Task 6: The boot gate — click to begin, real progress

**Files:**
- Create: `packages/ui/src/bootLoader.ts` (+ `bootLoader.test.ts`)
- Modify: `packages/ui/src/Boot.tsx`, `apps/web/index.html`

**Interfaces:**
- Produces: `runBootLoader(opts: { unlocked: Promise<void>; onProgress: (p: number) => void; skipAudio?: boolean }): Promise<BootReport>`
  where stages + weights: images 0.55, audio 0.25, fx 0.15, fonts 0.05. Images/fonts/fx start immediately;
  audio starts after `unlocked`. `BootReport = { ms: number; stages: Record<StageName, { ms: number; ok: boolean }> }`.
- Produces: `bootProgress(stageFractions, weights): number` (pure, tested).

- [ ] index.html: bar fill becomes `transform: scaleX(var(--boot-p, 0))` (no keyframe); add
  `<div id="bootsplash-cta">Click to begin</div>` (opacity 0 → `.is-in` shows it; hidden once `.is-unlocked`);
  `#bootsplash` gets `cursor: pointer` via the gauntlet url form. Reduced-motion: no transition only.
- [ ] Boot.tsx: on mount — stamp `inAt` as before; `unlocked` = first `pointerdown`/`keydown` on the splash
  (also `unlockAudio()` there); run the loader; `--boot-p` written per progress; ready = loader done AND
  unlocked AND `now - clickAt >= 3500`; then the existing fade-out. DEV-only escape: `?skipboot` resolves
  the gate immediately (documented in ONBOARDING).
- [ ] Remove the fallback React `.bootload` markup's fake-percent text; it now shows the real percent.
- [ ] Test `bootProgress`: weights sum to 1; partial fractions produce the weighted mean; clamps to [0,1].
- [ ] Commit `feat(boot): click to begin, then a real loading gate over every asset`.

### Task 7: Hitch log (measure, don't assume)

**Files:**
- Modify: `packages/ui/src/perfMonitor.ts` (record long tasks ≥ 50 ms into a ring of 200 with `{ at, ms, phase, wave, mark }`;
  `hitches(): Hitch[]`; DEV: `window.__hitches` + one `console.warn` per hitch)
- Create: `packages/ui/src/perfMonitor.hitches.test.ts`

- [ ] Test: feeding two fake longtask entries records both with the registered context; the ring caps at 200.
- [ ] Commit `feat(perf): hitch log — every long task with the phase it landed in`.

### Task 8: Verification against the prod build

- [ ] `npm run build:web`; serve `apps/web/dist` statically; in the Browser pane: splash shows CTA; after click the bar
  fills with real progress; `window.__hitches` stays empty through boot → menu (DEV build) — and note any hitch found.
- [ ] Confirm `document.fonts.check('800 1em Outfit')` is true on the menu and no request to `fonts.googleapis.com`.
- [ ] Gates: `npm run typecheck && npm run lint && npm test && npm run build:web`.

### Task 9: Docs

- [ ] `docs/devlog/2026-09-03-boot-preload-everything.md` (the findings + the reversal of the 2026-08-25 ruling).
- [ ] `docs/performance.md`: §3c note — the over canvas is now mounted at boot (idle ticker → no per-frame cost);
  new §"Boot preload contract" listing the four stages and the manifest test.
- [ ] `patchNotes.ts` entry; `ONBOARDING.md` mention of `?skipboot` (DEV) and `npm run assets:manifest`.
- [ ] Commit `docs: boot preload contract`.
