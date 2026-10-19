# Tiered chest openings: design

Owner: Mike, brainstormed 2026-10-19. Status: draft, awaiting owner approval.
Builds on: `docs/superpowers/specs/2026-10-18-aether-crate-shop-design.md` (Aether + the shop, PRs kcodea/ascent#2169 and #2170).

## Why

The Aether shop sells five rarity-floor crates (Standard, Rare, Epic, Legendary, Ancient) at 1× to 9× the price.
Today every one of them opens with the same chest. The opening escalates only once the server answers, by the
**reward's** rarity, so an Ancient crate looks like a Standard one for the first second or two. Mike has painted a
chest for each paid tier. He wants each tier's opening to feel like what the player paid for, with "increasing
amounts of magic and sparks and flair, with the properly associated colors for each tier".

Owner constraint: "we should not stray too far from the original opening experience for now. only adding some
additional flair and effects for added oomph for each tier."

## Goals

- **Each crate tier opens with its own chest art.** Standard keeps today's chest; Rare, Epic, Legendary and Ancient
  use Mike's new chests.
- **Each tier adds its own effects layer, in its colour, growing with the tier** on top of today's opening, which
  is otherwise unchanged.
- **Tiered sound, built from clips already in the game.**
- **Rename "crate" to "chest" everywhere a player reads it.**

## Non-goals

- Re-choreographing the opening. The phases (sealed → anticipation → charge → [freeze] → burst → reveal →
  settled), the lid launch, the nameplate reveal and skip all stay as they are.
- New sound recordings or new art beyond Mike's 12 PNGs.
- Showing the chests outside the opening theatre (shop tiles, bay icons). See "Left to the builder".
- Renaming code, database or API identifiers (`loot_crates`, `buy_crate`, `CrateOpener` …). Only player-facing text
  changes. *(Claude's call: a deep rename is risky churn that no player sees.)*

## Anti-goals

- An opening that feels slower or more padded than today. The tier layer rides on the existing beats; it must not
  lengthen the minimum wait for low tiers.
- Any frame drop or hitch. Performance is the project's north star (CLAUDE.md).
- A tier layer that hides the reward's own escalation. A Rare chest that rolls a Legendary must still get the
  Legendary finale.

## The art

Source folder (owner's machine): `C:\Users\micha\Desktop\Reference Art\Chests\`. For each of Rare, Epic, Legendary and
Ancient there are three PNGs: `<Tier> Chest.png` (whole), `<Tier> Chest Top.png` (lid) and `<Tier> Chest Bottom.png`
(body). They are about 1.0–3.0 MB each, roughly 1,774 px wide, on transparent backgrounds.

Gem colours in the art:

| Tier | Colour |
|---|---|
| Rare | sapphire blue |
| Epic | violet purple |
| Legendary | amber/orange-gold |
| Ancient | opal/iridescent multichrome (white with rainbow sheen) |

Today's chest ships as two cropped webp layers, `apps/web/public/collection/crate_body.webp` (840×457) and
`crate_lid.webp` (819×238). Their anchor geometry (rim, spike centre, keyhole box, lid attach point) lives in
`packages/ui/src/progression/crateFx/chestModel.ts` (`CHEST_ART`, `ChestModel`).

**Each new tier needs the same:**
- Cropped and resized webp body and lid, roughly the current pixel size, keeping alpha, small enough not to slow the
  first open.
- Its own measured `ChestModel` geometry. The builder measures the anchors from the art; the keyhole cutout and the
  seam light depend on them.

## How the tier is known

Today the theatre (`CrateOpener`) knows only the crate id, level and source, and picks every effect from the
**reward's** rarity (`presetFor(reward.rarity, …)`), which arrives with the server's answer.

**New:** the theatre also knows the crate's **tier**, its rarity floor, from the moment Open is pressed.
- `CrateRow.floor` already exists, and `CollectionScreen` already derives `floorOf(c)`: the floor, else Legendary for
  a milestone crate, else common.
- Carry it on `CrateQueueItem` from every place that builds one: the Collection bay, the New rewards pop-up and
  `CrateShop` (buy and milestone open).
- Tier mapping: common → Standard chest, rare → Rare, epic → Epic, legendary → Legendary, ancient → Ancient.
- A crate with no floor (every crate earned before Aether) is Standard.
- Milestone Legendary crates use the Legendary chest.

## The tier layer (what each chest adds)

Two axes, both active at once:

1. **Chest tier** (new) drives:
   - the chest art
   - the tier's own effects layer, from the click through the burst
   - the tier's sound layer
2. **Reward rarity** (today) still drives everything it drives now: charge length, hitch, burst size, double burst,
   coin shower, Ancient's time-stop freeze, the nameplate, and the reward stings.

A crate's reward is always at or above its floor, so a high chest always gets at least its own finale. A low chest
can still surprise upward.

### The ladder (Ancient is the owner's; the rest are Claude's proposal, scaled down from it)

| Chest | While waiting and charging | At the burst |
|---|---|---|
| **Standard** | today, nothing added | today |
| **Rare** (blue) | a soft blue aura around the chest, a few blue motes drifting up | a thin blue spark ring and a few blue sparkles |
| **Epic** (purple) | a brighter aura; thin purple wisps curl **toward the keyhole** (the first tier with energy pulled in) | purple sparkles and wisps |
| **Legendary** (amber) | amber energy **bands swirl around the chest** and are pulled in during the charge; the glow and shake build harder | a golden flash and amber embers on top of today's coin shower |
| **Ancient** (opal) | owner: "multichrome/opal bands of swirling energy pulling into the chest, causing it to shake and glow" | owner: "bursting open with a bright flash of white and multichrome sparkles and wisps of energy" |

Details:
- The layer starts **at the click** (anticipation), grows through the charge, and peaks at the burst. Once the
  reveal starts it eases into the settled glow.
- The tier's extra shake and glow **add to** the reward-driven shake and glow; they never replace them.
- **Ancient's opal/multichrome:** swirling bands and sparkles cycle hue across the spectrum, plus white, rather than
  using one tint. *(Claude's call: change the existing Ancient reward colour `ancientColor`, today cyan `#8af5ff`,
  to read as opal/multichrome as well, so an Ancient reward from any chest matches the Ancient chest. The builder
  may implement "multichrome" as per-particle hue cycling; the existing CSS gem `hue-rotate` may need the same.)*
- Tier colours: Rare, Epic and Legendary reuse the existing `rareColor` (`#5aa8ff`), `epicColor` (`#c07bff`) and
  `legendaryColor` (`#ffb938`), which already match the art.

### Tuning

Every new dial lives in the existing crate FX tuner (`CrateFxTuner`, config `crateFxConfig.ts`), with **one group per
chest tier**. Examples:
- aura strength
- mote count
- wisp count and pull speed
- swirl band count, width, speed and pull-in
- extra shake and extra glow
- burst flash, burst sparkle and wisp counts
- multichrome hue speed (Ancient)
- the tier's sound clips and gains

**Preview:**
- The tuner's play buttons gain a **chest tier** choice next to the reward rarity, so Mike can preview, say, "Rare
  chest → Legendary reward".
- Values ship the same way as today: **Copy JSON** into `CRATE_FX_DEFAULTS`.

## Sound

Use clips already in the game; no new recordings. Each chest tier above Standard adds a sound layer on the existing
cues. *(Claude's proposal; Mike swaps any clip in the tuner's clip picker.)*

| When | What it adds | How it scales by tier |
|---|---|---|
| While waiting | a shimmer bed under today's hum | louder and brighter by tier |
| During the charge | a swirl/whoosh as energy pulls in | Epic and up |
| At the burst | a sparkle or impact layer | heavier by tier: Legendary adds weight; Ancient adds a bright shimmer tail |

Candidates already in `packages/ui/src/audio/`:
- `fx/stereogenicstudio-swish-swoosh-woosh-sfx-27-357164-3`
- `fx/universfield-cinematic-swoosh-impact-454392`
- `fx/metal-woosh`
- `fx/djartmusic-christmas-sparkle-whoosh-1-275404` (another slice of it)
- `fx/oona-powerup`
- `fx/triple-impact`
- `runeselectimplosion` (today's muted charge cue)

Each new cue gets its own mixer category, the same as the existing crate cues in `audio/config.ts`.

## Rename: crate → chest (player-facing text only)

Every string a player reads changes "crate" to "chest":
- **Shop and bay:** "Epic Chest", "Level 20 Legendary Chest", "Gauntlet Chest · Stage 3", "Welcome Chest"; the
  Chest Shop panel and buttons; "Sealed chests", "Open all"; the bay's "Your next chest comes at Level N"; the odds
  line; error copy.
- **Elsewhere:** the New rewards pop-up, the sign-in gate ("Create an account to open chests"), the Gauntlet end
  screen, the post-game panel, menu badges.
- **Docs:** `docs/GAME-RULES.md` (player terms) and the rules-wiki help text.
- **Patch notes:** one 2026-10-19 note covers the rename and the new chests.

The rules oracle (R-PROG-CRATE-*, R-PROG-AETHER-*) keeps its ids. Statements that quote player-visible text change
the word to match.

## Constraints

- **Performance:**
  - Pixi only, inside the existing `CrateScene` / `crateFxPixi.ts` controller.
  - New textures are baked once at mount, like today's.
  - New particles come from the existing pool and respect `MAX_PARTICLES` (320). The builder may raise it only after
    measuring.
  - No new Pixi filters per frame, and no looping CSS paint-property animation.
  - The ticker stays stopped while idle.
  - Profile the Ancient opening on the prod build (`docs/performance.md`).
- **Fallbacks stay intact:**
  - Reduced motion skips the effects and fades the reward in, as today.
  - When Pixi can't start, the DOM stand-in chest is used, now tinted per tier if cheap. If a tier's art fails to
    load, it falls back to the Standard chest art.
- **Deterministic tests:** the existing `setCrateFxFactoryForTests` recorder sees the chest tier, and tests pin that
  the tier reaches the scene from every entry point (bay, pop-up, shop buy, milestone open).
- **Repo rules:** branch + PR (this work is stacked on the shop UI, branch `feat/tiered-chests`); no `title=`; no bare
  `cursor: pointer`; the patch-notes entry ships in the same PR.

## Left to the builder

- Cropping, resizing and measuring the chest art.
- How the swirl bands are drawn (ribbon mesh, rope or sprite trails) within the performance rules.
- Exact default dial values: the tiers must visibly escalate, and Mike tunes the rest.
- Whether to show the tier's chest outside the theatre (a small icon on the shop's tier buttons or the bay). This is
  optional and only worth it if the art is already being cropped. Default: no.
- Which existing clips to start each tier's sound layer with.
