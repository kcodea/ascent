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
  per-particle hue cycling (its base is the opal white `#f4eeff`; the Ancient reward colour changed to match).
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
- The Ancient reward colour moved from cyan `#8af5ff` to the opal `#f4eeff`, so an Ancient reward from any chest matches
  the Ancient chest.

## Please check (owner)

- **Profile the Ancient chest opening on the prod build.** It is the heaviest case: the double burst plus every tier
  sparkle, band and wisp. Particles come from the existing pool and are capped at `MAX_PARTICLES` (320), textures are
  baked once, there are no per-frame Pixi filters, and the ticker stays stopped while idle, but only the real prod build
  in Chrome DevTools (`vite preview`, as in `docs/performance.md`) settles it. A dropped frame here is a defect.
- **The Legendary tier flash is white,** although the spec's ladder says "a golden flash". The brief mandated white;
  please judge it by eye and say if you want it gold.
- **The tier's extra shake and glow are flat through the charge** rather than building toward the burst.
- **Bands orbit in the screen plane,** a flat ring around the chest, not a 3D swirl.
- Smaller known notes: the Epic and Ancient lock-spike apex sits behind the lid until it launches (the owner's composite
  shows it in front); the Legendary seam light is partly under its trim (`seamOffsetY` is tunable); the tuner's override
  path returns the requested tier without swapping the hidden model (tuner only).

## Verification

`npm run typecheck && npm run lint && npm test && npm run build:web`, `npx vitest run packages/rules` and
`npm run docbot:report -- --check` were run on the final tree; see the task report for the counts. The rules-wiki
tripwire fingerprint for `R-PROG-CRATE-01` was re-set after the Welcome Chest wording change.
