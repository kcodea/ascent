# 2026-10-19 — Tiered chest openings: each paid chest opens with its own art, effects and sound, and "crate" becomes "chest"

The Aether shop sells five rarity-floor crates, but they all opened with the same chest, and the opening only escalated
once the server answered (by the **reward's** rarity). Mike painted a chest for each paid tier and asked for "increasing
amounts of magic and sparks and flair, with the properly associated colors for each tier". Spec:
`docs/superpowers/specs/2026-10-19-tiered-chest-openings-design.md`; plan:
`docs/superpowers/plans/2026-10-19-tiered-chest-openings.md`. Stacked on `feat/aether-shop-ui` (the Aether PR #2170).

Owner words that bound the work:

- On Ancient: "multichrome/opal bands of swirling energy pulling into the chest, causing it to shake and glow", then
  "bursting open with a bright flash of white and multichrome sparkles and wisps of energy".
- On scope: "we should not stray too far from the original opening experience for now. only adding some additional
  flair and effects for added oomph for each tier."

## What shipped

- **Tier art.** Rare, Epic, Legendary and Ancient each have a two-layer chest (body + lid) as webps in
  `apps/web/public/collection/chest_<tier>_body.webp` / `chest_<tier>_lid.webp`. Standard keeps today's art. Geometry
  (rim, spike, keyhole, lid attach point) for each lives in `chestModel.ts` (`CHEST_TIER_ART`, `artChestModel(…, art)`).
- **Tier layer (`chestTiers.ts`, `crateScene.ts`).** The crate's tier comes from its rarity floor (`chestTierOf`;
  none = Standard, a milestone crate = Legendary) and rides on `CrateQueueItem.tier` from every caller (the bay, the
  New rewards pop-up, the Chest Shop buy and milestone open). The layer starts at the click and adds, per tier, an aura,
  drifting motes, wisps pulled toward the keyhole (Epic and up), orbiting light bands (Legendary and Ancient), extra
  shake and glow, and a burst flash, sparkles and wisps. Rare is blue, Epic purple, Legendary gold, Ancient opal with
  per-particle hue cycling (its base is the opal white `#f4eeff`). An Ancient REWARD's burst sparks and embers cycle hue
  too, from any chest, but the reward's colour stays the approved cyan (see the final review below).
- **The reward still decides the finale.** `presetFor(reward.rarity)` drives the charge, hitch, burst, double burst,
  coins and Ancient's time-stop exactly as before; the tier layer only adds to shake and glow. A Rare chest that rolls a
  Legendary still gets the Legendary finale.
- **Sound.** Three new cues built from clips already in the game (a shimmer bed, a swirl under the wisps, a burst
  flourish), each with its own mixer category (`crateTierShimmer`, `crateTierSwirl`, `crateTierBurst`) and a per-tier
  gain. Standard adds no tier sound.
- **Tuner.** The Chest opening tuner (`CrateFxTuner`, config `crateFxConfig.ts`) gains one group per tier ("Rare chest",
  "Epic chest", "Legendary chest", "Ancient chest": colour, aura, motes, wisps and pull, bands and speed, extra shake and
  glow, burst flash / sparkles / wisps, hue speed, and the three sound gains), a "Sound: chest shimmer / swirl / burst"
  clip picker group, and a chest-tier choice on the play buttons so "Rare chest, Legendary reward" can be previewed.
  Values ship the usual way: Copy JSON into `CRATE_FX_DEFAULTS`.
- **Rename.** Every player-facing "crate" is now "chest": the level and tier names (Welcome Chest, Level 20 Chest,
  Gauntlet Chest · Stage 3, Epic Chest, Level 20 Legendary Chest), the Chest Shop, Sealed chests, the odds line, error and
  status copy, the sign-in gate, the New rewards pop-up, the Gauntlet end screen and stage select, menu badges, tooltips,
  the rules-wiki entry (old "crate" search words kept as aliases), `docs/GAME-RULES.md` and the rules-registry statements
  that name player text. Identifiers, CSS classes, test ids, storage keys, event names, SQL and server codes, the mixer
  category ids and the tuner id `cratefx` are unchanged (the DevMenu entry now reads "Chest opening"). Rule ids are
  unchanged; verbatim owner quotes in rule evidence still say "crate".
- **Patch notes.** One new Systems entry in the existing (unreleased) 2026-10-19 block; that block's Aether and
  Card Plates entries now say "chests" too. Older entries are history and still say "crates".

## The art pipeline

The owner paints `<Tier> Chest Bottom.png` and `<Tier> Chest Top.png`. To rebuild the webps:

```
node scripts/build-chest-art.mjs --src "C:\Users\micha\Desktop\Reference Art\Chests"
node scripts/build-chest-art.mjs --src "..." --tier epic      # one tier only
```

It crops each layer to its alpha box, scales the pair by the body's factor (so the lid's notch still lands on the body's
spike), writes the webps, and prints the numbers `CHEST_TIER_ART` needs that the alpha can give (body span, rim, lid
width). The anchors the alpha cannot give (spike centre, keyhole box, lid attach point) are measured from the art by hand.

## Calls made (the execution ledger, `.superpowers/sdd/2026-10-19-tiered-chest-openings/progress.md`)

- **C1.** The tier-name tests assert through `crateLabel(...)` rather than a literal "Crate", so the rename did not need
  rewriting twice.
- **C2.** Nothing was pushed or PR'd during the build; commits stayed local on `feat/tiered-chests`, to be pushed as a
  PR stacked on #2170 with the owner's go-ahead.
- **C3.** The manual prod-build profiling the spec asks for could not be driven by a subagent, so it became a code-level
  check (below) plus a request to the owner.
- **C4.** Pipelined the tasks (the next task started while the previous task's read-only review ran) when their files did
  not overlap, because the owner asked for speed.
- The rename is player-facing text only (Claude's call in the spec: a deep rename is churn no player sees).
- ~~The Ancient reward colour moved from cyan `#8af5ff` to the opal `#f4eeff`.~~ Reverted at the final review (below).

## The final review's fixes (2026-10-19)

The whole-branch review found the tier art was never preloaded: every real opening mounts a fresh theatre with a fresh
Pixi controller, so each one fetched and decoded its chest cold in the middle of the anticipation, painted Standard
first and swapped, and could lose its 300 ms race on a cold cache. Fixed, with the controller's rulings:

- **The art is loaded and decoded before it is needed** (`crateFx/chestArt.ts`): one page-wide cache, `img.decode()`
  before it counts as loaded, the keyhole mask cut there too. It is warmed when the Chest Shop's tier is picked, when
  the Collection bay holds a sealed tiered chest, at the theatre's mount (every tier in its queue) and at the click.
- **The first frame is the right chest.** `mount(host, firstTier)` starts that tier's art before Pixi's own init and
  races it (up to `CHEST_ART_WAIT_MS`) inside the bake, before the first render.
- **GPU upload before the swap.** A tier's textures are uploaded (`renderer.texture.initSource`) when the model is
  built, so the swap's frame pays neither a decode nor an upload.
- **No swap after the burst.** Art that lands once the burst has started is dropped for that opening (it stays cached).
- **A beat asked before the mount still plays** (the bay's and post-game's autoOpen start before Pixi is up): the
  controller keeps the anticipation (or a skip's settled reveal) and replays it at mount, resumed as far in as it already
  is, so the tier aura, motes, wisps, shake and heartbeat all play.
- **Only the ART falls back** (ruling): late or failed art plays on the Standard chest, but the asked tier's layer and
  all three of its cues still play.
- **The Ancient reward colour reverted to `#8af5ff`** (ruling): the approved R-PROG-RARITY-01 ("Prismatic Aurora", cyan
  to magenta) outranks the spec's call, and opal big-lights read too close to Common. The Ancient reward ribbon is its
  cyan to magenta gradient again. Kept: the hue cycling on an Ancient reward's sparks and embers, and the Ancient
  CHEST's opal multichrome layer (`ancientTierColor` `#f4eeff`). **A dev tuner config saved before this fix may still
  hold the old `ancientColor` `#f4eeff`**: Reset it (or edit the colour) in the Chest opening tuner.
- **The tier burst flash takes the tier's colour** (ruling): Rare, Epic and Legendary flash in their colour lightened
  30% toward white (`tierFlashColor`); Ancient stays white.
- **The tier's extra shake and glow build through the charge**: from what the anticipation ended on to twice that at
  the burst (`× (1 + easeInQuad)`), so Legendary and Ancient "build harder". *(Claude's call: the literal `× easeInQuad`
  would drop the extra shake to 0 at the charge's start, a visible jolt after the anticipation.)*
- Smaller: the bay's "Next:" names a sealed shop chest by its tier; the tuner hints say what the dials do (the shimmer
  plays at the click, wisps are a per-second rate, the extra shake builds through the charge); the player wiki's chests
  and Gauntlet answers read true before and after Aether (they now cover R-PROG-AETHER-01/-02/-04).

## Please check (owner)

- **Profile the openings on the prod build** (`npm run build:web`, then `vite preview`, as in `docs/performance.md`).
  In Chrome DevTools: Network "Disable cache" + "Slow 4G", Performance CPU 4x slowdown. Record:
  - the first-ever open of each tier (Rare, Epic, Legendary, Ancient) in a fresh tab, from the bay and from the Chest
    Shop, so the art really comes cold;
  - an Ancient chest with an Ancient reward (the heaviest: the double burst plus every tier sparkle, band and wisp).
  Particles come from the existing pool and are capped at `MAX_PARTICLES` (320), textures are baked once, there are no
  per-frame Pixi filters, and the ticker stays stopped while idle, but only the real prod build settles it. A dropped
  frame here is a defect.
- **Bands orbit in the screen plane,** a flat ring around the chest, not a 3D swirl.
- Smaller known notes: the Legendary seam light is partly under its trim (`seamOffsetY` is tunable); the tuner's
  override path returns the requested tier without swapping the hidden model (tuner only).

## Verification

`npm run typecheck && npm run lint && npm test && npm run build:web`, `npx vitest run packages/rules` and
`npm run docbot:report -- --check` were run on the final tree; see the task report for the counts. The rules-wiki
tripwire fingerprint for `R-PROG-CRATE-01` was re-set after the Welcome Chest wording change.
