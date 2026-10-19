# Tiered Chest Openings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each paid chest tier opens with its own art and an escalating, tier-coloured effects and sound layer on top of today's opening, and every player-facing "crate" becomes "chest".

**Architecture:**
- **Config:** a new `chestTiers.ts` defines the chest tier axis: tier from the crate's floor, per-tier dials and the resolved `ChestTierPreset`. Its dials are folded into the existing `CrateFxConfig`, so the existing tuner, persistence and Copy JSON just work.
- **Rendering:** the Pixi controller gains `setChest(tier)`, which loads and caches the tier's two-layer art. The scene gains a tier layer (aura, motes, wisps, swirling bands, burst flash and sparkles, multichrome for Ancient) that rides the existing phase calls.
- **Opener:** `CrateOpener` learns each crate's tier from `CrateQueueItem.tier`, set by every caller.

**Tech Stack:** TypeScript, React, PixiJS v8, Vitest, sharp (art build script).

**Spec:** `docs/superpowers/specs/2026-10-19-tiered-chest-openings-design.md`. Read it first.

## Global Constraints

- **Tiers:** `standard` (floor common, or no floor), `rare`, `epic`, `legendary`, `ancient`. Milestone crates are `legendary`.
- **Standard stays exactly today's opening:** today's art, no tier layer, no tier sound.
- **Tier colours:** rare `#5aa8ff`, epic `#c07bff`, legendary `#ffb938`, ancient multichrome. Ancient's base is `#f4eeff`, and its particles cycle hue.
- **The reward still drives today's dials** (`presetFor(reward.rarity)`). The tier layer adds to shake and glow and never replaces them.
- **Performance:**
  - Particles come from the existing pool and never exceed `MAX_PARTICLES` (320).
  - Textures are baked once.
  - No per-frame Pixi filters, and no looping CSS paint-property animation.
  - The ticker stays stopped while idle.
- **Fallbacks:**
  - Reduced motion and Pixi failure behave as today.
  - If a tier's art fails to load, or isn't ready within `CHEST_ART_WAIT_MS` = 300, that opening uses the Standard art.
- **Rename** is player-facing text only. Identifiers, CSS classes, storage keys, event names, mixer categories and the tuner id `'cratefx'` stay as they are.
- **Repo UI rules:** no `title=`, no bare `cursor: pointer`, portals into `stageHost()`, no raw `vw`/`vh`.
- **Gates:** `npm run typecheck && npm run lint && npm test && npm run build:web` plus `npm run docbot:report -- --check`.

## Review Focus

1. **Open next across tiers:** a queue of [Standard crate, Rare crate] must swap the chest art and the tier layer between the two openings, never keeping the first's. Test: Task 4 `open next swaps the chest`.
2. **A tier's art 404s or is slow:** the opening never stalls; it plays on the Standard art within 300 ms. Test: Task 3 `art failure falls back to standard`.
3. **A Rare chest rolling a Legendary reward:** the blue tier layer plays AND the Legendary finale (double burst, coins, sting) still plays. Test: Task 3 `tier layer composes with the reward finale`.
4. **Ancient chest + Ancient reward:** the double burst plus every tier sparkle stays within 320 live particles. Test: Task 3 `particle cap holds at ancient + ancient`.
5. **Reduced motion or no Pixi:** the tier still names the chest ("Epic Chest") and nothing throws. Test: Task 4 `reduced motion shows the tier name`.

---

## File structure

| File | Responsibility |
|---|---|
| `scripts/build-chest-art.mjs` (new) | Crops, scales and writes the four tiers' body and lid webps; prints measured geometry |
| `apps/web/public/collection/chest_<tier>_body.webp`, `chest_<tier>_lid.webp` (new, 8 files) | The art |
| `packages/ui/src/progression/crateFx/chestModel.ts` | The `ChestArt` type, `CHEST_ART` (Standard, unchanged values), `CHEST_TIER_ART` (4 tiers), `artChestModel(…, art)` |
| `packages/ui/src/progression/crateFx/chestTiers.ts` (new) | `ChestTier`, `chestTierOf`, tier dials, defaults, ranges, `ChestTierPreset`, `chestTierPresetFor` |
| `packages/ui/src/progression/crateFx/crateFxConfig.ts` | Folds in the tier dials, tier sound cues, tuner groups, the preview chest choice, and Ancient's colour |
| `packages/ui/src/progression/crateFx/crateTextures.ts` | New baked textures: wisp, band |
| `packages/ui/src/progression/crateFx/crateScene.ts` | The tier layer |
| `packages/ui/src/progression/crateFx/crateFxPixi.ts` | `setChest(tier)`: load, cache, fall back |
| `packages/ui/src/progression/CrateOpener.tsx` | `CrateQueueItem.tier`; calls `setChest` and passes the tier preset; tier cues |
| `packages/ui/src/progression/CollectionScreen.tsx`, `CrateShop.tsx`, `NewRewardsPopup.tsx`, `crateFx/CratePreview.tsx` | Pass the tier |
| `packages/ui/src/audio/config.ts` | Mixer categories for the three tier cues |
| Player-facing strings across `packages/progression/src/cosmetics.ts`, `packages/ui/src/**`, `docs/GAME-RULES.md`, the rules registry | crate → chest |

---

### Task 1: Chest art

**Files:**
- Create: `scripts/build-chest-art.mjs`
- Create: the 8 webps under `apps/web/public/collection/`
- Modify: `packages/ui/src/progression/crateFx/chestModel.ts`
- Test: `packages/ui/src/progression/crateFx/chestModel.test.ts` (create)

**Interfaces:**
- Produces:
```ts
export interface ChestArt {
  bodyUrl: string; lidUrl: string; bodySrcW: number; bodyX0: number; bodyX1: number; baseY: number;
  rimY: number; rimX0: number; rimX1: number; spikeX: number;
  keyhole: { x0: number; y0: number; x1: number; y1: number };
  lidSrcW: number; lidAttachX: number; lidAttachY: number; lidOverlap: number;
}
export const CHEST_ART: ChestArt; // unchanged values (the Standard chest)
export const CHEST_TIER_ART: Readonly<Record<'rare' | 'epic' | 'legendary' | 'ancient', ChestArt>>;
export function artChestModel(body: Texture, lid: Texture, keyhole: Texture | null, art?: ChestArt): ChestModel; // art defaults to CHEST_ART
```

- [ ] **Step 1: Write the build script** `scripts/build-chest-art.mjs`. Usage:
  `node scripts/build-chest-art.mjs --src "C:\Users\micha\Desktop\Reference Art\Chests"`.
  - For each tier, read `<Tier> Chest Bottom.png` and `<Tier> Chest Top.png`.
  - Crop each to its alpha bounding box plus 4 px.
  - Scale the body to 840 px wide, and scale the lid by the **same** factor (the convention in the `chestModel.ts` header).
  - Write `chest_<tier>_body.webp` and `chest_<tier>_lid.webp` (sharp, quality 92, alpha kept).
  - Print, for each tier, the cropped masters' `bodySrcW`, `bodyX0/X1`, `baseY`, `lidSrcW` and the rim's top edge `rimY/rimX0/rimX1`, measured from the alpha.
  - Match the house style of `scripts/build-card-plate.mjs`.
- [ ] **Step 2: Run it.** Then check that each body webp is under 120 KB and each lid under 80 KB (`ls -l`). If one is over, lower the quality to 88 for that file only.
- [ ] **Step 3: Measure the art-dependent anchors** that alpha can't give (`spikeX`, `keyhole` box, `lidAttachX/Y`): read the cropped masters, find the keyhole as the dark opening in the lock plate, and find the lid's notch at the centre of its bottom edge. Write each tier's numbers into `CHEST_TIER_ART` with `bodyUrl: 'collection/chest_<tier>_body.webp'` etc. and `lidOverlap: 3`.
- [ ] **Step 4: Write the failing tests** in `chestModel.test.ts`, using fake textures `{ width, height }` cast as `Texture`:
  - `standard model is unchanged`: `artChestModel(body, lid, null)` gives the same `cx`/`rimY`/`keyholeX` as before the refactor. Snapshot the numbers from the current code first.
  - `every tier's geometry is sane`, for each tier:
    - `0 ≤ bodyX0 < spikeX < bodyX1 ≤ bodySrcW`
    - `rimY < keyhole.y0 < keyhole.y1 < baseY`
    - the keyhole box contains `spikeX` (±40 px)
    - `0 < lidAttachX < lidSrcW`
  - `the tier art files exist`: `existsSync` on each URL under `apps/web/public/`.
- [ ] **Step 5: Run them and confirm they fail.** `npx vitest run packages/ui/src/progression/crateFx/chestModel.test.ts` → FAIL.
- [ ] **Step 6: Refactor `chestModel.ts`** to the `ChestArt` interface and the `art` parameter. All existing call sites keep working with the default.
- [ ] **Step 7: Run them and confirm they pass**, then `npx vitest run packages/ui/src/progression/crateFx` → PASS.
- [ ] **Step 8: Commit** the script, the 8 webps, chestModel and its test: `git commit -m "feat(ui): the four tier chests' art and geometry"`.

### Task 2: Tier dials, config, tuner and Ancient's colour

**Files:**
- Create: `packages/ui/src/progression/crateFx/chestTiers.ts`
- Modify: `packages/ui/src/progression/crateFx/crateFxConfig.ts`, `packages/ui/src/audio/config.ts`
- Test: `packages/ui/src/progression/crateFx/chestTiers.test.ts` (create); extend `crateFx.test.ts` if the tuner/config tests live there

**Interfaces:**
- Consumes: `CosmeticRarity` (`@game/progression`).
- Produces (chestTiers.ts):
```ts
export type ChestTier = 'standard' | 'rare' | 'epic' | 'legendary' | 'ancient';
export const CHEST_TIERS: readonly ChestTier[];
export type LayeredTier = Exclude<ChestTier, 'standard'>;
export const LAYERED_TIERS: readonly LayeredTier[]; // rare, epic, legendary, ancient
export function chestTierOf(floor: CosmeticRarity | null | undefined): ChestTier; // common/undefined/null → 'standard'
export const CHEST_TIER_LABEL: Readonly<Record<ChestTier, string>>; // 'Standard' … 'Ancient'
export const TIER_NUM_SUFFIXES: readonly [
  'AuraGlow', 'Motes', 'Wisps', 'WispPull', 'Bands', 'BandSpeed', 'ExtraShake', 'ExtraGlow',
  'BurstFlash', 'BurstSparkles', 'BurstWisps', 'HueSpeed', 'ShimmerGain', 'SwirlGain', 'BurstGain',
];
export type TierNumKey = `${LayeredTier}${(typeof TIER_NUM_SUFFIXES)[number]}`;
export type TierColorKey = `${LayeredTier}TierColor`;
export interface ChestTierPreset {
  tier: ChestTier; color: number; colorCss: string; multichrome: boolean;
  auraGlow: number; motes: number; wisps: number; wispPull: number; bands: number; bandSpeed: number;
  extraShake: number; extraGlow: number; burstFlash: number; burstSparkles: number; burstWisps: number; hueSpeed: number;
  shimmerGain: number; swirlGain: number; burstGain: number;
}
export const NO_TIER_LAYER: ChestTierPreset; // tier 'standard', every number 0
```
- Produces (crateFxConfig.ts):
  - `CrateFxConfig` gains every `TierNumKey` and `TierColorKey`, plus globals `sfxTierShimmerClip`, `sfxTierSwirlClip` and `sfxTierBurstClip`.
  - `export function chestTierPresetFor(tier: ChestTier, c?: CrateFxConfig): ChestTierPreset`, which returns `NO_TIER_LAYER` for `'standard'`.
  - `CrateCue` gains `'tierShimmer' | 'tierSwirl' | 'tierBurst'`, with `CRATE_CUE_CATEGORY` entries `crateTierShimmer`, `crateTierSwirl` and `crateTierBurst` (registered in `audio/config.ts` like `crateHum`).
  - Preview: `CrateFxPlayDetail` gains `chest?: ChestTier`. Add `export function previewChest(): ChestTier` and `setPreviewChest(t)`, dev only, never saved.
- **Default dials:**

| Suffix | rare | epic | legendary | ancient |
|---|---|---|---|---|
| AuraGlow (0..1) | 0.25 | 0.4 | 0.55 | 0.7 |
| Motes (per s) | 4 | 6 | 8 | 10 |
| Wisps | 0 | 6 | 8 | 10 |
| WispPull (0..1) | 0 | 0.5 | 0.6 | 0.7 |
| Bands | 0 | 0 | 2 | 4 |
| BandSpeed (turns/s) | 0 | 0 | 0.35 | 0.5 |
| ExtraShake (px) | 0 | 0.4 | 1 | 1.6 |
| ExtraGlow (0..1) | 0.1 | 0.2 | 0.3 | 0.45 |
| BurstFlash (0..1) | 0 | 0.2 | 0.4 | 0.9 |
| BurstSparkles | 12 | 22 | 32 | 48 |
| BurstWisps | 0 | 6 | 10 | 16 |
| HueSpeed (cycles/s) | 0 | 0 | 0 | 0.35 |
| ShimmerGain | 0.2 | 0.3 | 0.4 | 0.5 |
| SwirlGain | 0 | 0.35 | 0.45 | 0.55 |
| BurstGain | 0 | 0 | 0.5 | 0.6 |
| TierColor | `#5aa8ff` | `#c07bff` | `#ffb938` | `#f4eeff` |

- **Default clips:**
  - `sfxTierShimmerClip = SPARKLE_CLIP`, played from `sfxRevealStartMs` for `sfxRevealLenMs`, the same slice as reveal.
  - `sfxTierSwirlClip = 'fx/stereogenicstudio-swish-swoosh-woosh-sfx-27-357164-3'`.
  - `sfxTierBurstClip = 'fx/universfield-cinematic-swoosh-impact-454392'`.
- **Ranges:** every count 0..80, every 0..1 dial 0..1, `ExtraShake` 0..6, `BandSpeed` 0..2, `HueSpeed` 0..2, gains 0..1.
- **Ancient's reward colour:** `ancientColor` changes from `#8af5ff` to `#f4eeff`, and `multichrome` is true for the ancient tier preset.

- [ ] **Step 1: Write the failing tests** in `chestTiers.test.ts`:
  - `tier from floor`:
    - `chestTierOf(undefined)` → `'standard'`
    - `chestTierOf('common')` → `'standard'`
    - `chestTierOf('epic')` → `'epic'`
    - `chestTierOf('ancient')` → `'ancient'`
  - `standard has no layer`: `chestTierPresetFor('standard')` deep-equals `NO_TIER_LAYER`.
  - `defaults escalate`: for `auraGlow`, `motes`, `extraGlow` and `burstSparkles`, the values across rare < epic < legendary < ancient are strictly increasing. `bands` is 0 below legendary and > 0 at legendary and ancient. `multichrome` is true only for ancient.
  - `defaults are in range`: `sanitizeCrateFxConfig(CRATE_FX_DEFAULTS)` deep-equals `CRATE_FX_DEFAULTS`.
  - `a tuned value survives`: `setCrateFxValue('epicWisps', 9)`, then `chestTierPresetFor('epic').wisps === 9`. Reset afterwards.
  - `ancient reward colour is opal`: `CRATE_FX_DEFAULTS.ancientColor === '#f4eeff'`.
  - `tuner has a group per tier`: `SPEC.controls` contains a group named `Rare chest`, `Epic chest`, `Legendary chest` and `Ancient chest`.
- [ ] **Step 2: Run them and confirm they fail.** `npx vitest run packages/ui/src/progression/crateFx/chestTiers.test.ts` → FAIL.
- [ ] **Step 3: Implement it:**
  - `chestTiers.ts` holds the types, defaults and ranges.
  - Fold them into `CrateFxConfig`, `CRATE_FX_DEFAULTS`, `CRATE_FX_RANGES` and `sanitizeCrateFxConfig`.
  - Add the `chestTierPresetFor` builder, mirroring `presetFor`'s fallback-to-default per key.
  - Add the tier cues to `crateCue`, and the categories to `audio/config.ts`.
  - Tuner: add the tier groups (labels and hints in plain English, the house style of `RARITY_SPECS`), and a "Sound" sub-control for each tier cue clip.
  - Add actions `Chest: Standard` … `Chest: Ancient` that call `setPreviewChest`. The SPEC note shows the current preview chest.
  - Set the tuner title to `'Chest opening'`; the id stays `'cratefx'`.
- [ ] **Step 4: Run them and confirm they pass**, then `npx vitest run packages/ui/src/progression/crateFx packages/ui/src/audio` → PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat(ui): chest tier dials, sound cues and tuner groups"`.

### Task 3: The tier layer in the scene + `setChest`

**Files:**
- Modify: `packages/ui/src/progression/crateFx/crateScene.ts`, `crateFxPixi.ts`, `crateTextures.ts`
- Test: extend `packages/ui/src/progression/crateFx/crateFx.test.ts` (read how it drives the scene headlessly first)

**Interfaces:**
- Consumes: `ChestTierPreset`, `NO_TIER_LAYER`, `ChestTier` (Task 2); `CHEST_TIER_ART`, `artChestModel(…, art)` (Task 1).
- Produces:
  - `CrateFx` gains `setChest(tier: ChestTier): Promise<ChestTier>`. It resolves with the tier actually drawn: `'standard'` on a failure or a 300 ms timeout. Export `CHEST_ART_WAIT_MS = 300`.
  - `CrateFx` gains `setTierLayer(t: ChestTierPreset): void`, called before `anticipate`.
  - `CrateScene` gains `setTierLayer(t: ChestTierPreset): void` and `setChestModel(m: ChestModel): void`.
  - The recorder used by `setCrateFxFactoryForTests` records `setChest` and `setTierLayer` calls.
- **Behaviour** (layered on the existing phase methods; Standard = `NO_TIER_LAYER` = no new sprites or particles):
  - **anticipation:**
    - An additive aura sprite behind the chest at `auraGlow × ramp` in the tier colour.
    - Motes spawn at `motes`/s and drift up.
    - Wisps (if > 0) curve toward the keyhole at `wispPull`.
    - The tier's `extraShake` and `extraGlow` are added to the anticipation shake and glow.
  - **charge:**
    - Aura, motes and wisps intensify toward 1×.
    - `bands` energy bands orbit the chest at `bandSpeed` and spiral inward to the keyhole by the charge's end.
    - Draw the bands from a baked `paintBand()` texture as rotating sprites or a `MeshRope`; no filters.
  - **burst:**
    - A white additive flash at `burstFlash`, `burstSparkles` sparkles and `burstWisps` wisps, all in the tier colour.
    - These are added to the reward's burst; the reward's own effects are untouched.
  - **reveal / settle:** the aura eases out with the existing settle glow.
  - **multichrome** (Ancient): each tier particle's tint cycles hue at `hueSpeed` from a random start, plus white sparkles. The aura and bands cycle too. Apply the same hue cycling to the reward's burst particles when `p.rarity === 'ancient'`, so an Ancient reward from any chest reads opal.
  - **Particle cap:** every spawn goes through the existing pool, which drops spawns past `MAX_PARTICLES`.
- **`setChest` in the controller:**
  - Load the tier's two webps (cached per tier for the controller's lifetime), cut its keyhole mask with `cutKeyholeMask`, and swap the scene's chest model.
  - Standard uses the textures baked at mount.
  - The one-picture override `crateArt`, when set, wins over every tier.

- [ ] **Step 1: Write the failing tests** in `crateFx.test.ts`, driving the scene the way the file already does:
  - `standard adds nothing`: with `NO_TIER_LAYER`, a full anticipate → charge → burst at a common reward produces the same live sprite count as before. Pin the count from the current code first.
  - `tier layer composes with the reward finale`: `setTierLayer(chestTierPresetFor('rare'))`, then a legendary reward preset. The burst produces the reward's coins AND the tier's sparkles, and `doubleBurst` still fires.
  - `particle cap holds at ancient + ancient`: an ancient tier with an ancient reward, stepped through the burst. The particle count never exceeds `MAX_PARTICLES` at any step.
  - `art failure falls back to standard`:
    - With an image loader that rejects, `await fx.setChest('epic')` resolves `'standard'` within 300 ms.
    - With a loader that never resolves, it resolves `'standard'` after 300 ms (fake timers).
    - Use the injection seam the controller already has for loading images; if there is none, add `loadImage` as a constructor option.
  - `bands only from legendary up`: an epic tier spawns 0 band sprites through the charge; a legendary tier spawns 2.
- [ ] **Step 2: Run them and confirm they fail.** `npx vitest run packages/ui/src/progression/crateFx/crateFx.test.ts` → FAIL.
- [ ] **Step 3: Implement the textures, the scene layer, and the controller's `setChest`/`setTierLayer`.**
- [ ] **Step 4: Run them and confirm they pass**, then `npx vitest run packages/ui/src/progression` → PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat(ui): each chest tier's effects layer and art swap"`.

### Task 4: The opener, every caller, sound, and the preview

**Files:**
- Modify: `packages/ui/src/progression/CrateOpener.tsx`, `CollectionScreen.tsx`, `CrateShop.tsx`, `NewRewardsPopup.tsx` (if it builds queue items), `crateFx/CratePreview.tsx`
- Test: extend `packages/ui/src/progression/Crates.test.tsx`, `CollectionScreen.test.tsx`, `CrateShop.test.tsx`

**Interfaces:**
- Consumes: `chestTierOf`, `chestTierPresetFor`, `ChestTier` (Task 2); `CrateFx.setChest`/`setTierLayer` (Task 3).
- Produces:
  - `CrateQueueItem` gains `tier?: ChestTier`; absent means `'standard'`.
  - Callers set it with `chestTierOf(floorOf(row))`, reusing CollectionScreen's existing `floorOf`.
  - CrateShop sets it from the bought tier's floor (`CRATE_TIER_FLOOR[tier]`) and from the milestone crate's floor (`legendary`).
- **Opener behaviour:**
  - In `start(item)`, before the anticipation:
    1. `const drawn = await fx.setChest(item.tier ?? 'standard')`. This never delays the click feedback: start the hum and anticipation immediately and let the swap land within its 300 ms.
    2. `fx.setTierLayer(chestTierPresetFor(drawn))`.
    3. Put `t-<tier>` on the theatre div, alongside today's `r-<rarity>`.
  - **Sound:**
    - `tierShimmer` at the anticipation start, at the tier's `shimmerGain`, skipped when 0.
    - `tierSwirl` at the charge start, at `swirlGain`.
    - `tierBurst` at the burst, at `burstGain`.
    - All three use the reward preset's `pitch`, like the other cues.
  - CSS (`crateTheatre.css`): under `.t-<tier>`, the DOM fallback `.crate-box` gets a static border and shadow tint in the tier colour. No animation.
  - The Ancient reward ribbon uses a static multichrome `conic-gradient` instead of the cyan; no looping animation.
- **Preview:** `CratePreview` reads `previewChest()` (or `detail.chest`) and sets `tier` on its queue items. Its "all" mode uses the current preview chest for every crate.

- [ ] **Step 1: Write the failing tests:**
  - `Crates.test.tsx`:
    - `the tier reaches the effects`: a queue item with `tier: 'epic'` calls the recorder's `setChest('epic')`, then `setTierLayer` with `tier: 'epic'`.
    - `open next swaps the chest`: a queue `[{tier:'standard'}, {tier:'rare'}]`; Open, then Open next. The recorded `setChest` calls are `'standard'` then `'rare'`, and the theatre's class goes `t-standard` → `t-rare`.
    - `tier cues play`: a rare tier plays `tierShimmer` and not `tierSwirl`; an ancient tier plays all three. Spy on the cue player the file already stubs.
    - `reduced motion shows the tier name`: with reduced motion, a `milestone:10` crate's nameplate reads its chest name, and nothing throws.
  - `CollectionScreen.test.tsx`: `bay crates carry their tier`: a sealed row with `floor: 'epic'` reaches the opener with `tier: 'epic'`, a legacy level crate with `'standard'`, and a milestone crate with `'legendary'`.
  - `CrateShop.test.tsx`: `a bought chest carries its tier`: buying Epic calls `onOpen` with an item whose `tier` is `'epic'`.
- [ ] **Step 2: Run them and confirm they fail.** `npx vitest run packages/ui/src/progression` → FAIL.
- [ ] **Step 3: Implement it.**
- [ ] **Step 4: Run them and confirm they pass.** Same command → PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat(ui): chests open with their tier's art, effects and sound"`.

### Task 5: crate → chest for players, docs, gates

**Files:**
- Modify: player-facing strings in `packages/progression/src/cosmetics.ts` (`crateName`, `crateLabel`, `crateFloorLabel`), across `packages/ui/src/**` (JSX text, `aria-label`, `aria-description`, `data-tip`, error and status copy), the rules-wiki help text, `docs/GAME-RULES.md`, rule statements in `packages/rules/src/registry/approved/*.ts` that quote player-visible text, and `packages/ui/src/patchNotes.ts`
- Create: `docs/devlog/2026-10-19-tiered-chest-openings.md`
- Regenerate: `npm run progression:shared` (cosmetics.ts changed)

- [ ] **Step 1: Find every player-facing "crate".**
  - Run `grep -rnE "[Cc]rates?\b" packages/ui/src packages/progression/src --include=*.ts --include=*.tsx`.
  - From the results, list only strings a player reads.
  - Leave identifiers, CSS classes, test ids, storage keys, event names, mixer categories, the `'cratefx'` id, and the dev tuner's internal hints.
- [ ] **Step 2: Update the tests first** wherever they assert player text:
  - "Welcome Crate" → "Welcome Chest"
  - "Level 20 Crate" → "Level 20 Chest"
  - "Gauntlet Crate · Stage 3" → "Gauntlet Chest · Stage 3"
  - "Epic Crate" → "Epic Chest"
  - "Sealed crates" → "Sealed chests"
  - "Create an account to open crates" → "Create an account to open chests"

  Run `npx vitest run packages/progression packages/ui/src` and see them fail.
- [ ] **Step 3: Change the strings.** Then run `npm run progression:shared` and the same tests → PASS.
- [ ] **Step 4: Update the docs.**
  - `docs/GAME-RULES.md`: player terms read "chest", and the Aether section names the five chests.
  - Registry statements: replace quoted player text only. Ids are unchanged.
  - Patch notes: add to the existing 2026-10-19 block (no second block for the same date), a `Systems` entry: "Crates are now Chests, and each paid chest has its own look and opening." Its `details`:
    - "Rare, Epic, Legendary and Ancient chests each have their own art."
    - "Each one opens with more magic than the last, in its own colour: blue, purple, gold and opal."
    - "Ancient chests pull in swirling opal energy and burst with a white flash and multichrome sparkles."
    - "What's inside still decides the finale, so a Rare chest can still surprise you."
  - Devlog: what shipped, the owner quotes (Ancient's description, "not stray too far from the original opening"), the art pipeline command, the tuner groups, and the calls made.
- [ ] **Step 5: Run the gates.**
  - `npx vitest run packages/rules`
  - `npm run docbot:report -- --check`
  - `npm run typecheck && npm run lint && npm test && npm run build:web`

  All green.
- [ ] **Step 6: Commit.** `git commit -m "feat(ui,progression): crates are chests for players; docs and patch notes"`.
