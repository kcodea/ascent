# Pack Opening Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the tactile 5-card pack opening (tear, sleeve, zoom, flip, summary) as a dev-only experience driven by a fixed result contract, tunable in a Pack Lab panel.

**Architecture:** Pure models (`peelModel.ts`) own the tear and sleeve physics; a Pixi scene (`packScene.ts`, a port of the tuned prototype) renders the pack, strip, sleeve, stack and the first half of each flip; a React shell (`PackOpener.tsx`) owns phases, the server request, DOM card faces (second half of each flip), summary and accessibility. The scene is injected into the shell so the shell is tested in jsdom with a fake scene.

**Tech Stack:** TypeScript, React, Zustand-free local state, PixiJS v8 (`MeshGeometry`, `MeshPlane`), Web Audio, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-23-pack-opening-design.md` (read it first). Reference build: `docs/superpowers/specs/2026-11-23-pack-opening-prototype.html` (the tuned tear + sleeve; port its math, do not reinvent it).

## Global Constraints

- Players see no change: nothing outside the DevMenu mounts `PackOpener`. `CrateOpener` looks and behaves exactly as before.
- Portal into `stageHost()`, never `document.body`. No raw `vw`/`vh`, no viewport `@media`.
- Pixi in screen space; convert a measured rect to CSS lengths only with `rectToStage` (`packages/ui/src/stage.ts:252`).
- No `title=` attribute, no SVG `<title>`. No bare `cursor: pointer` / keyword cursor (use the global rule or the gauntlet URL form).
- DOM animations: `transform` / `opacity` only. Looping glows = opacity of a pseudo-element with a static shadow (`kwglow`).
- No `getBoundingClientRect` per frame; no per-frame allocation in the tear/sleeve loops.
- Every `<img>` has `decoding="sync"`.
- All rates dt-scaled (Pixi `ticker.deltaTime`), so 60 Hz and 144 Hz feel the same.
- Feel defaults are the owner's tuned values (spec §7), verbatim.
- The server is asked at the **pop**, never at the first press.
- `@game/progression` stays dependency-free (sibling relative imports only). Do NOT add `packs.ts` to `SHARED_ARTIFACTS` yet (the economy project does that when the server answers in this shape).
- Gates before every commit that touches code: `npm run typecheck && npm run lint` plus the task's vitest file; before the final PR: `npm test && npm run build:web`.

## Review Focus

1. **Rapid clicks on the top card mid-flip:** each click flips exactly one card, in order; a click during an in-flight flip is queued or ignored, never skips a card. (Test in Task 7.)
2. **The result arrives late or after close:** late → the stack holds at the zoom with "Still opening", then proceeds; after the theatre closed → ignored, no state update after unmount. (Test in Task 7.)
3. **Pointer released off-canvas / `pointercancel` (touch) mid-tear or mid-sleeve:** treated as a release; nothing stays "held". (Test in Task 2.)
4. **Window rescaled mid-opening:** the DOM face's start rect comes from the scene's rect AT the edge-on moment, converted then, never from a rect cached at mount. (Test in Task 8.)
5. **A result with fewer than 5 cards** (1..5 are legal to the opener): the stack, tray and summary lay out without gaps or crashes. (Test in Task 7.)

---

### Task 1: The result contract (`@game/progression/packs.ts`)

**Files:**
- Create: `packages/progression/src/packs.ts`
- Modify: `packages/progression/src/index.ts` (add `export * from './packs';`)
- Test: `packages/progression/src/packs.test.ts`

**Interfaces:**
- Produces: the types `PackOpenResult`, `PackCard`, `PackLook` exactly as spec §5 (fields `packId`, `pack`, `cards`, `aether?`; `rewardId`, `rarity: CrateRarity`, `guaranteed`, `duplicate: { aether: number } | null`; `kind: 'rarity' | 'category' | 'themed'`, `id`, `name`, `guaranteedFloor: CrateRarity`), plus `parsePackOpenResult(v: unknown): PackOpenResult | null`, plus `packDuplicateAether(r: PackOpenResult): number` (sum of `duplicate.aether`).

- [ ] **Step 1: Write the failing tests** in `packs.test.ts`:
  - `parses a valid 5-card result` → deep-equals the input.
  - `rejects 0 cards and more than 5 cards` → `null` for `cards: []` and for 6 cards.
  - `rejects zero or two guaranteed cards` → `null`.
  - `rejects a guaranteed card that is not last` → `null`.
  - `rejects an unknown rarity, a negative or fractional duplicate aether, a non-string rewardId, an unknown pack kind` → each `null`.
  - `accepts an unknown rewardId string` (newer server, older client) → not `null`.
  - `accepts 1..4 cards when the single guaranteed card is last` → not `null`.
  - `packDuplicateAether sums the duplicates` → `[null, {aether:10}, null, {aether:25}, null]` gives `35`.
- [ ] **Step 2: Run** `npx vitest run packages/progression/src/packs.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** the types and both functions. Validate rarities against `COSMETIC_RARITIES` from `./cosmetics`. Return a fresh frozen object (never the input).
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(progression): pack open result contract + strict parser`.

### Task 2: The pure peel + sleeve model (`peelModel.ts`)

**Files:**
- Create: `packages/ui/src/progression/packOpening/peelModel.ts`
- Test: `packages/ui/src/progression/packOpening/peelModel.test.ts`

**Interfaces:**
- Consumes: `PackFeel` (Task 3), but takes it as a plain parameter so this file has no imports from the config.
- Produces:
  - `interface Vec3 { x: number; y: number; z: number }`
  - `interface TearState { T: number; started: boolean; done: boolean; held: boolean; hand: Vec3; tension: number }` (T = tear position in pack px from the strip's left; `hand` = the held corner in 3D, x right, y down, z toward camera)
  - `newTear(): TearState`
  - `stepTear(s: TearState, input: { held: boolean; target: Vec3 | null }, feel: PackFeel, width: number, dt: number, catchPhase: number): { popped: boolean; ripped: boolean; advanced: number }` (mutates `s` in place; no allocation)
  - `releaseTear(s: TearState): void` (idempotent)
  - `interface SleeveState { dy: number; held: boolean; freed: boolean; falling: boolean; vy: number; card: number; cardV: number; lag: number; pinch: number }`
  - `newSleeve(): SleeveState`
  - `stepSleeve(s: SleeveState, input: { held: boolean; want: number; flickVy: number }, feel: PackFeel, clearDy: number, dt: number): { brokeFree: boolean; dropped: boolean; speed: number }`
  - `releaseSleeve(s: SleeveState, flickVy: number, feel: PackFeel): { dropped: boolean }` (idempotent)
  - Port the math from the prototype's `ticker` + `keepInReach` + `sleeveTick` (the curve itself, `buildCurve`/`solveK`, stays in the scene: it is rendering, not state).

- [ ] **Step 1: Write the failing tests** (feel = the owner defaults; width = 300; dt = 1):
  - `the seal holds until the pull passes the pop tension` → targets under 30 px of pull keep `started === false` and `T <= 10.5`; a target past it returns `popped: true` once.
  - `pulling along the tear line advances the tear` → after pop, holding a target 200 px right for 30 steps raises `T`.
  - `pulling back the other way never advances the tear` (owner bug 2026-11-23) → after pop, holding a target to the LEFT of T for 60 steps leaves `T` unchanged.
  - `the held edge never leaves the peeled length` → for any step, `hypot(hand - (T,0,0)) <= T + 1e-6`.
  - `max tear speed caps one step` → `advanced <= feel.maxTearSpeed * dt`.
  - `letting go mid-tear does not creep the tear` → after release, 120 steps leave `T` unchanged.
  - `releaseTear is idempotent and clears held` (Review Focus 3).
  - `ripped fires once when T reaches the width`.
  - `the sleeve does not slide before the grip distance` → `want = 79` keeps `freed === false` and `dy <= 6 + 73*0.12 + 1e-6`; `want = 81` returns `brokeFree: true`.
  - `an early release slides the sleeve back to 0` → release at `dy = 100`, 200 steps → `dy < 0.5`, `dropped: false`.
  - `release past the let-go distance drops it` → release at `dy = 300` gives `dropped: true`.
  - `a flick drops it` → release at `dy = 50` with `flickVy = 10` gives `dropped: true`.
  - `dragging past the stack bottom drops it while held` → `want = clearDy + 1` gives `dropped: true`.
  - `releaseSleeve is idempotent` (Review Focus 3).
- [ ] **Step 2: Run** `npx vitest run packages/ui/src/progression/packOpening/peelModel.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the model. The tear-advance rule, verbatim from the prototype:
  ```ts
  const chord = Math.hypot(hand.x - T, hand.y, hand.z);
  const along = clamp01(feel.tearsStraightUp + (hand.x - T) / Math.max(1, chord));
  if (chord > T * feel.slackBeforeTear && along > 0) {
    const caught = 1 - feel.fibreCatch * (0.5 + 0.5 * Math.sin(catchPhase * 0.9) * Math.sin(catchPhase * 0.37 + 1.3)) * 0.85;
    T = Math.min(width, T + Math.min((chord - T * feel.slackBeforeTear) * along * caught, feel.maxTearSpeed * along * dt));
  }
  ```
  Pop tension = `hypot(max(0, target.x), min(0, target.y))`, pop at 30; pre-pop `T = 0.5 + min(10, tension * 0.3)`. The hand eases to its target at `feel.edgeFollowsHand * dt`; on release it eases at `0.08 * dt` to `(0.7T, -0.25T, 0.85T)`. Sleeve grip/slide/drop: the prototype's `sleeveTick`, with the drop on release when `dy > feel.sleeveLetGo || flickVy > 9`, fall speed `max(flickVy * 0.8, 5)`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(ui): pack opening peel + sleeve model (direction-aware tear)`.

### Task 3: Feel config (`packFxConfig.ts`)

**Files:**
- Create: `packages/ui/src/progression/packOpening/packFxConfig.ts`
- Test: `packages/ui/src/progression/packOpening/packFxConfig.test.ts`

**Interfaces:**
- Produces: `interface PackFeel` with these fields and `DEFAULT_PACK_FEEL` set to exactly these values (spec §7): `peelAngle 0.4`, `edgeTowardCamera 139`, `slackBeforeTear 0.92`, `edgeFollowsHand 0.1`, `maxTearSpeed 18`, `fibreCatch 0.7`, `pinchTwist 0.65`, `tearsStraightUp 0.15`, `highlight 0.65`, `perspective 1780`, `volume 0.45`, `sleeveGrip 80`, `sleeveFollows 0.36`, `sleeveRimDrag 1`, `sleeveFingerPinch 0.08`, `sleeveLetGo 295`, `stackZoom 0.3`; plus `quickOpenMs 1000`. Also `PACK_FEEL_KNOBS: readonly { key: keyof PackFeel; label: string; min: number; max: number; step: number }[]` (labels and ranges = the prototype's), `getPackFeel(): PackFeel`, `setPackFeel(patch: Partial<PackFeel>): void`, `resetPackFeel(): void`, `subscribePackFeel(cb: () => void): () => void`, and `PACK_BASE_SIZE = { w: 300, h: 476 }` (the size the px values are tuned at). Overrides persist to `localStorage` key `ascent.packFeel.v1`; a malformed stored value falls back to defaults.

- [ ] **Step 1: Write the failing tests:** `defaults are the owner's tuned values` (assert every value above); `setPackFeel persists and getPackFeel reads it back`; `a malformed stored value falls back to defaults`; `resetPackFeel clears the override`; `every knob key is a PackFeel key and its default lies within [min, max]`.
- [ ] **Step 2: Run** `npx vitest run packages/ui/src/progression/packOpening/packFxConfig.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(ui): pack opening feel config with the owner's tuned defaults`.

### Task 4: Shared reward preview (refactor out of `CrateOpener`)

**Files:**
- Create: `packages/ui/src/progression/rewardPreview.ts`
- Modify: `packages/ui/src/progression/CrateOpener.tsx` (replace the inline `rewardLabel` body and the `skinKind` / `skinUrl` block with calls; keep `rewardLabel` exported from `CrateOpener.tsx` as a re-export so existing imports keep working)
- Test: `packages/ui/src/progression/rewardPreview.test.ts`

**Interfaces:**
- Produces: `rewardLabel(rewardId: string | null)` (moved verbatim), `type RewardArtKind = 'hero' | 'minion' | 'emote' | 'plate' | 'frame'`, `type RewardEmblem = 'title' | 'announcer' | 'music' | 'hero_attack' | 'board' | 'unknown'`, and `rewardPreview(rewardId: string | null): { label: ReturnType<typeof rewardLabel>; art: { kind: RewardArtKind; url: string } | null; emblem: RewardEmblem | null; category: CosmeticCategory | null }`. Exactly one of `art` / `emblem` is non-null (an art category whose url is missing falls back to its category's emblem slot `'unknown'`).

- [ ] **Step 1: Write the failing tests:** one per category, using a real catalog id of that category (pick ids from `COSMETICS`): hero skin, minion skin, emote, card plate, portrait frame → `art.kind` as mapped and a non-empty `url`; title, announcer, music, hero attack, board → `emblem` equals the category; an unknown id → `emblem: 'unknown'` and the label "New reward". Plus `CrateOpener` still renders the same reward plate: run the existing crate tests unchanged.
- [ ] **Step 2: Run** `npx vitest run packages/ui/src/progression/rewardPreview.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** by moving the existing logic (no behaviour change for the five art categories).
- [ ] **Step 4: Run** the new test plus `npx vitest run packages/ui/src/progression/crateFx` and any `CrateOpener` test. Expected: all PASS, existing tests untouched.
- [ ] **Step 5: Commit** `refactor(ui): share the reward preview between the chest and pack openers`.

### Task 5: Pack sounds (`packSounds.ts`)

**Files:**
- Create: `packages/ui/src/progression/packOpening/packSounds.ts`
- Test: `packages/ui/src/progression/packOpening/packSounds.test.ts`

**Interfaces:**
- Consumes: `audioContext()` and `fxBusTarget(a, bus)` from `packages/ui/src/sfx.ts` (pick the `BusName` the chest opener's cues use, so the game's volume and mute apply); `getPackFeel().volume`.
- Produces: `interface PackSounds { pop(): void; tear(speed: number): void; crackle(speed: number, dt: number): void; rip(): void; sleeveFree(): void; slide(speed: number): void; drop(): void; whoosh(): void; flip(rarity: CrateRarity, guaranteed: boolean): void; stamp(): void; aether(): void; summary(): void; silence(): void; dispose(): void }` and `createPackSounds(): PackSounds`. Each named cue is one slot in a `PACK_CUES` table so a recorded clip can replace it later. The synthesised parameters are the prototype's (spec §8): pop = 70 ms @ 1.7 kHz + 30 ms @ 5.2 kHz; tear loop band 1300 + speed·220 Hz, gain min(1, speed/9)·0.55; crackles 10-35 ms @ 2.4-6.9 kHz at rate speed·0.07·dt; rip = 380 ms sweep 4.2 kHz → 500 Hz + 80 ms @ 900 Hz; sleeve free = 50 ms @ 700 Hz + 20 ms @ 3 kHz; slide loop band 450 + speed·80 Hz, gain min(1, speed/10)·0.45; drop = 220 ms @ 260 Hz + 300 ms sweep 2.2 kHz → 400 Hz; whoosh = 300 ms sweep 600 Hz → 2.4 kHz. `flip`, `stamp`, `aether`, `summary` use existing chest reveal cues from `sfx` where one fits, else a synthesised placeholder (the builder's choice; name it in the commit message).
- Noise for crackles uses a seedless JS PRNG local to this file (UI code: `Math.random` is allowed outside core/content/sim, but keep one helper so it is swappable).

- [ ] **Step 1: Write the failing tests:** `every cue is a no-op when there is no AudioContext` (call each method with `audioContext()` returning null; no throw); `silence() stops the loops` (with a minimal fake AudioContext, the loop gains target 0); `dispose() is idempotent`.
- [ ] **Step 2: Run** `npx vitest run packages/ui/src/progression/packOpening/packSounds.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(ui): pack opening sound cues (synthesised v1, clip-swappable slots)`.

### Task 6: The Pixi scene (`packScene.ts`)

**Files:**
- Create: `packages/ui/src/progression/packOpening/packScene.ts`
- Create: `packages/ui/src/progression/packOpening/packTextures.ts` (placeholder pack, strip, foil-lining, card-back textures drawn on canvas, as the prototype does; rarity backs = tint + gem count; a `PackLook` picks the foil colours)
- Test: `packages/ui/src/progression/packOpening/packScene.test.ts` (only the pure helpers below)

**Interfaces:**
- Consumes: Task 2 model functions, Task 3 `getPackFeel` / `PACK_BASE_SIZE`, Task 5 `PackSounds`, `PackLook` / `CrateRarity` from `@game/progression`.
- Produces:
  ```ts
  interface PackSceneEvents {
    onPop(): void;                       // the seal gave: the shell sends the request now
    onStripFree(): void;                 // the sleeve is live this instant
    onSleeveDropped(): void;
    onZoomed(): void;                    // the stack is settled at the zoom
    onFlipEdge(index: number, screenRect: { left: number; top: number; width: number; height: number }): void; // card at 90°, rect in SCREEN px
  }
  interface PackScene {
    setBacks(backs: readonly { rarity: CrateRarity; guaranteed: boolean }[] | null): void; // null = plain pack-brand backs
    flipTop(toScreen: { x: number; y: number }): boolean;   // false while a flip is in flight
    quickOpen(): void;                   // scripted tear + sleeve over feel.quickOpenMs
    resetSealed(): void;                 // short fade back to a sealed pack (failure path)
    setInputEnabled(on: boolean): void;
    destroy(): void;                     // safe at any moment, including before async init resolves
  }
  createPackScene(host: HTMLElement, look: PackLook, cardCount: number, sounds: PackSounds, events: PackSceneEvents): PackScene
  ```
  - Pure helpers exported for tests: `scaleFeelPx(feel: PackFeel, packW: number): PackFeel` (scales the px-valued knobs `maxTearSpeed`, `sleeveGrip`, `sleeveLetGo` by `packW / PACK_BASE_SIZE.w`), and `topBackVisible(cardIndex: number, flipped: number): boolean` (only the current top card's back is visible).
- Lifecycle like `crateFx/crateFxPixi.ts`: `new Application()` + `await app.init(phonePixiOptions({...}))`, a `destroy()` that is safe before init resolves, textures destroyed on teardown. The ticker stops after `onZoomed` while nothing moves, and restarts on input or `flipTop`.
- Port from the prototype: the strip mesh (per-triangle vertices, front/back split by projected winding, shade + spec meshes sharing a geometry, contact shadow, torn lip, flecks), `buildCurve` / `solveK`, the sleeve `MeshPlane` deform, the stack, the zoom spring. Card flip first half: rotate 0° → 90° with real perspective (a `PerspectiveMesh` per card or the strip's projection) while moving toward `toScreen`, then fire `onFlipEdge` with the card's screen rect and hide the Pixi card.
- Rects for input: cache the canvas rect at pointerdown, never per frame. Pointer events only (a finger drag tears like the mouse); `pointercancel` = release.
- Card backs: plain pack-brand back until `setBacks`; a `setBacks` while the top card is visible crossfades it with a short opacity shimmer. Backs show rarity colour + gem count (1-5); Legendary/Ancient backs pulse (alpha of a static glow sprite, no per-frame redraw); the guaranteed card's back carries a "Guaranteed <floor>+" ribbon.

- [ ] **Step 1: Write the failing tests** for `scaleFeelPx` (a 600-px pack doubles the three px knobs, leaves the rest) and `topBackVisible`.
- [ ] **Step 2: Run** `npx vitest run packages/ui/src/progression/packOpening/packScene.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the helpers, then the scene.
- [ ] **Step 4: Run** the test, then `npm run typecheck && npm run lint`. Expected: PASS / clean.
- [ ] **Step 5: Commit** `feat(ui): pack opening Pixi scene (tear, sleeve, stack, flip first half)`.

### Task 7: The opener shell (`PackOpener.tsx`): phases, request, failure, reveal flow

**Files:**
- Create: `packages/ui/src/progression/packOpening/PackOpener.tsx`
- Create: `packages/ui/src/progression/packOpening/packOpening.css`
- Test: `packages/ui/src/progression/packOpening/PackOpener.test.tsx` (jsdom; follow the existing crate opener tests for render/portal setup)

**Interfaces:**
- Consumes: Tasks 1, 3, 5, 6; `prefersReducedMotion` from `../CrateOpener`; `stageHost`.
- Produces:
  ```ts
  type PackOpenOutcome = { status: 'ok'; result: PackOpenResult } | { status: 'error'; reason: string };
  interface PackQueueItem { packId: string; look: PackLook }
  interface PackOpenerProps {
    queue: readonly PackQueueItem[];
    open: (packId: string) => Promise<PackOpenOutcome>;
    onOpened?: (r: PackOpenResult) => void;
    onClose?: () => void;
    reducedMotion?: boolean;
    sceneFactory?: typeof createPackScene;   // tests inject a fake
  }
  type PackPhase = 'sealed' | 'tearing' | 'sleeve' | 'zooming' | 'waiting' | 'reveal' | 'summary' | 'error';
  ```
- Behaviour (spec §3, §5, §10): request on `onPop` only; on ok → `setBacks`; at `onZoomed` with no result → phase `waiting` + "Still opening"; on error at any point before the summary → `setInputEnabled(false)`, note "Could not open the pack. Try again.", `resetSealed()`, phase `sealed`, nothing consumed; close before pop → `onClose` with the pack still sealed; close after pop → jump to `summary` (all cards shown) instead of closing; "Quick open" button on `sealed` → `scene.quickOpen()`; "Reveal all" after zoom → flips the remaining cards in quick succession then `summary`; Enter/Space on `sealed` = Quick open, on `reveal` = flip next; status region announces each card ("<name>, <rarity>, new" / "<name>, <rarity>, duplicate, +N Aether"); "Open next" when the queue has more, "Done" otherwise. Dialog `aria-label="Opening a pack"`. Reduced motion: no scene; sealed pack + **Open** button → request → five backs in a row → click/Enter flips each with a crossfade → summary.
- Phase changes only; the DOM card face component is Task 8 (render a minimal placeholder face here that Task 8 replaces).

- [ ] **Step 1: Write the failing tests** (fake scene records calls and lets the test fire events; `open` is a controllable promise):
  - `does not request on press, requests once on pop`.
  - `a failure mid-tear resets to sealed, shows the note, and asks again only on the next pop`.
  - `close before the pop closes with the pack sealed`; `close after the pop shows the summary instead`.
  - `a late result holds at the zoom with "Still opening", then reveals` (Review Focus 2).
  - `a result after close is ignored` (unmount, then resolve: no error, no state update) (Review Focus 2).
  - `rapid clicks flip exactly one card per click in order` (fake `flipTop` returns false while in flight) (Review Focus 1).
  - `Reveal all flips the rest and shows the summary with the duplicate Aether total`.
  - `a 3-card result reveals 3 and the summary lists 3` (Review Focus 5).
  - `Quick open calls scene.quickOpen; Enter on sealed does the same`.
  - `reduced motion: Open → five flips → summary, duplicates announced, no scene created`.
  - `the theatre portals into stageHost and has no title attribute anywhere`.
- [ ] **Step 2: Run** `npx vitest run packages/ui/src/progression/packOpening/PackOpener.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS. Then `npm run typecheck && npm run lint`.
- [ ] **Step 5: Commit** `feat(ui): pack opener shell (phases, request at pop, failure reset, reveal flow)`.

### Task 8: Card faces, the flip handoff, tray and summary layout

**Files:**
- Create: `packages/ui/src/progression/packOpening/packFaces.tsx`
- Modify: `packages/ui/src/progression/packOpening/PackOpener.tsx` (replace the placeholder face; handle `onFlipEdge`)
- Modify: `packages/ui/src/progression/packOpening/packOpening.css`
- Test: `packages/ui/src/progression/packOpening/packFaces.test.tsx`

**Interfaces:**
- Consumes: Task 4 `rewardPreview`; `rectToStage` from `../../stage`; `PackCard`.
- Produces: `PackFace({ card, phase: 'handoff' | 'featured' | 'tray' | 'summary', from?: StageRect }): JSX.Element`. One layout for every face (spec §6): category label, art area (art `<img decoding="sync">` or an inline-SVG emblem per `RewardEmblem`, drawn in this file), name, rarity ribbon, NEW chip or DUPLICATE stamp + "+N Aether". The handoff: on `onFlipEdge(i, rect)`, convert `rect` with `rectToStage` at that moment, mount the face at that rect with `rotateY(90deg)` and the scene's perspective, then CSS-transition to `rotateY(0)` and the featured slot. The previous featured face moves to the tray; at the summary all faces move to one row. Transform/opacity only. Legendary/Ancient featured faces get the opacity-only breathing glow. Warm every result face's art (`img.decode()`) as soon as the result arrives (spec §11).

- [ ] **Step 1: Write the failing tests:** `an art category renders its art with decoding="sync"`; `an emblem category renders its emblem and no img`; `an unknown reward renders the update-the-game face`; `a duplicate shows the stamp and +N Aether, a new card shows NEW`; `the handoff face starts at rectToStage(rect) computed at the edge event` (mock `rectToStage`, change its scale between mount and the event, assert the later scale is used) (Review Focus 4); `no title attribute and no inline cursor style`.
- [ ] **Step 2: Run** `npx vitest run packages/ui/src/progression/packOpening/packFaces.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** this test and Task 7's. Expected: PASS. Then `npm run typecheck && npm run lint`.
- [ ] **Step 5: Commit** `feat(ui): pack card faces, edge-on flip handoff, tray and summary`.

### Task 9: The Pack Lab (DevMenu panel)

**Files:**
- Create: `packages/ui/src/progression/packOpening/PackLabTuner.tsx`
- Create: `packages/ui/src/progression/packOpening/packLabSamples.ts`
- Modify: `packages/ui/src/DevMenu.tsx` (register `{ key: 'packlab', icon: '🎴', label: 'Pack Lab', C: PackLabTuner, hint: 'Open sample card packs and tune the tear, sleeve and flip feel', alt: 'pack opening tear peel sleeve flip cards chest feel tuner' }` beside the Card Plate Editor entry)
- Test: `packages/ui/src/progression/packOpening/packLabSamples.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 3, 7; `useDraggablePanel('packlab')` (the standard frame, as `CardPlateEditorTuner` uses).
- Produces: `PACK_LAB_SAMPLES: readonly { id: string; label: string; result: PackOpenResult; delayMs?: number; fail?: boolean }[]` with at least: `all-new`, `mixed-dupes`, `legendary-guaranteed`, `ancient-guaranteed`, `every-category` (two packs covering all ten categories), `unknown-reward`, `slow` (`delayMs: 5000`), `failed` (`fail: true`); a look picker for rarity / category / themed placeholders. The panel: every `PACK_FEEL_KNOBS` slider (live, persisted), Reset to defaults, sample + look pickers, Open, Slow-mo (0.25×).

- [ ] **Step 1: Write the failing tests:** `every sample result parses with parsePackOpenResult`; `the every-category samples cover all ten COSMETIC_CATEGORIES`; `each sample's guaranteed card is last`.
- [ ] **Step 2: Run** `npx vitest run packages/ui/src/progression/packOpening/packLabSamples.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the samples (use real catalog ids from `COSMETICS`) and the panel. After this lands, open the panel once in the browser pane to confirm it mounts (memory: a dev panel needs its draggable frame and one real open).
- [ ] **Step 4: Run** the test, `npm run typecheck && npm run lint`. Expected: PASS / clean.
- [ ] **Step 5: Commit** `feat(ui): Pack Lab dev panel with sample packs and live feel knobs`.

### Task 10: Performance proof, docs, PR

**Files:**
- Create: `docs/devlog/2026-11-23-pack-opening-experience.md`
- Modify: `docs/roadmap.md` (add "Pack economy (packs replace chests)" as the next item, pointing at spec §12)

- [ ] **Step 1: Full gates:** `npm run typecheck && npm run lint && npm test && npm run build:web`. Expected: all green; report the output.
- [ ] **Step 2: Perf capture on the prod build** (`npm run build:web`, serve the build, open the Pack Lab, Chrome Performance recording of one full opening with the `mixed-dupes` sample). Pass = no long task over 50 ms and no dropped-frame run during tear, rip, drop, zoom or any flip. Write the numbers into the devlog entry. If it fails, fix before the PR.
- [ ] **Step 3: Write the devlog entry** (what shipped, that it is dev-only, the contract, the owner's tuned defaults, the perf numbers) and the roadmap line. No `patchNotes.ts` entry (no player-facing change).
- [ ] **Step 4: Commit, push, open the PR** (`feat/pack-opening` → `main`), arm `gh pr merge --auto --squash`, and wait for `verify`.
