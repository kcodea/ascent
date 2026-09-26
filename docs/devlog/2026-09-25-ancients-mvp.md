# 2026-09-25: Ancients proof of concept (Scene Builder, Set 3, Indy)

A first playable of **Ancients**: a run-defining transformation of the hero power, unlocked by a meter. It is built
from the owner's handoff (`Ascent_Ancients_System_Handoff.md`), with the owner's rulings of 2026-09-25 overriding the
handoff's numbers and awakening rules. Dev-only, so there is no patch note.

## Owner rulings (2026-09-25)

1. **Scope.** Scene Builder, Set 3 only, behind a flag. `RunState.ancientsEnabled` is set only by
   `startSceneBuilder` for a Set 3 sandbox while the rig's "✦ Ancients" toggle is on (default on, persisted).
   Lobby, practice and normal runs never carry it. Every sim hook returns before touching anything when it is
   absent, so existing runs, replays and goldens are unchanged.
2. **The meter.** First ruled as a cost counting down 16 → 0. On the first playable the owner changed it: *"it
   should fill the meter not deplete it"*. It now **fills** from 0 to 16. Every Shop refresh adds 1, paid or free
   (the `roll` action, Frank's Clearance and Harlan's Buyout: every `refreshTavern` that is not the turn-start roll).
   Every combat fought adds 2, as the next Shop opens. The Ancient awakens once, at full. The three numbers are
   tuner values stamped on the run. `ANCIENT_METER_BY_HERO` is the per-hero override seam (empty today).
3. **The offer.** When the meter is full, the Shop pauses behind a Discover of 3 of the 5 Ancients. The pick is
   seeded off `mixSeed(seed, 0x41, wave)`, never the run cursor. Picking locks it for the run.
4. **Registry.** `ANCIENT_PAIRINGS[heroId][ancientId] = { offerText, powerText, effects }`, built from five Ancient
   effect primitives (`AncientEffect`). A hero with no written pairing shows "Not written yet." and does nothing.
5. **Indy** (MVP hero): Death, Fortune, Genesis, War and Time, as ruled (see below). The hero-power text prints the
   combined power (`heroPowerText` wraps `ancientPowerText`).
6. **Look.** The awakening reuses the triple's `gild-trail`, re-targeted into the hero power. The awakened power is a
   split circle. The meter sits around the hero power, and hovering it opens a preview that cycles on the scroll
   wheel. Owner direction on the first playable: *"cleaner and more minimalistic, not dark and weird/gloomy"*; *"make
   the ring 1 gradient bar not chunks"*; *"the ancient hero power thing is a half circle of the hero power, it
   doesnt need its own badge"*.

## Where each Indy effect fires

| Ancient | Primitive | Hook | Phase |
| --- | --- | --- | --- |
| Death | `powerTargetGainsKeywords` (RB, T): Rebirth + Taunt (owner, same day: "rebirth instead of rise") | reducer `gild` branch, after `gildMinion` | Shop (power) |
| Fortune | `sellGildedGetsPlainCopy` | `settleMinionSale` (every sale path) | Shop |
| Genesis | `powerGivesCopiesInstead` (2) | reducer `gild` branch, instead of the gild; the branch's `checkTriples` completes the triple | Shop (power) |
| War | `friendlyDeathBuffsGilded` (+8/+8) | Shop: `afterShopDestroy`. Combat: `QuestCombatMods.ancientWar`, an `onDeath` listener that records `permaGain` so the gain carries back | Both |
| Time | `socGildRightmost` | `QuestCombatMods.ancientTimeGild`, first in the per-side Start-of-Combat block. It emits `ascend { gild: true }` plus a `buff` of the printed stats. The run card is never touched | Combat only |

The Ancient combat mods are added to the PLAYER's fight in `playerCombatSideState` only, never through
`questCombatMods`, so snapshots and opponents never carry them.

## Judgement calls (flag to the owner)

- **Time is combat-only and reverts after the fight** (the brief's reading). If "becomes Gilded" was meant to be
  permanent, change `socGildRightmost` to write the gild back at settle.
- **Genesis on an already-gilded target is allowed.** Its plain copies then simply sit in hand, unless other plain
  copies exist. It uses `grantMinionToHandOrBoard` (hand, else board, else dropped), and the triple rules are
  untouched.
- **Fortune's copy** uses the same grant: printed stats plus the run-wide card aura every fresh copy carries.
- **"Refresh"** means a `refreshTavern` that is not the turn-start roll. The natural new Shop at the start of a turn
  does not count.
- The offer waits behind any other open decision (quest, Runeforge, Discover, Choose One, aim, scout), and behind
  the curtain.

## Placeholder / not in the MVP

- **Faces** are generated flat emblems (a colour disc plus a glyph), labelled "placeholder art". Thesis lines are
  one-line drafts from the handoff's identities.
- Only Indy has pairings. Opponents' Ancients, a second stage, announcer lines, saves, replays, snapshots and
  analytics are all out. The state is plain serialisable data on `RunState.ancients` (a JSON and
  `serialize`/`deserialize` round trip is tested), with no persistence migration.
- **Sounds** reuse existing clips: `tallyCounter` for the fill tick, `goodLuckShine` for the full-ring flash,
  `runeSelectImplosion` and `equipmentSheen` for the reveal. The gains are in the ✦ Ancients tuner.

## Presentation

`packages/ui/src/ancients/`:

- `AncientMeter` is the ring. It is one thick `stroke-dashoffset` arc (a warm gold-to-amber fill on a dark semi-opaque track, set just outside the power's frame, with a bright leading-edge dot and quarter ticks; owner on #1739: "make it look more obvious") with a one-shot eased transition per gain. Its
  displayed value waits for `wipeIdle` (a new store flag published by Recruit) so a combat's gain lands after the
  wipe.
- `AncientSplit` is the half-circle face inside `.heropowerbtn`, and plays the pick beat: the gild-trail plus the face
  flying on its arc, then the reveal and a single shine. A click skips the flight.
- `AncientPreview` is the hover card: wheel, arrows, ←/→ and dots, with a slide and cross-fade.
- `AncientOffer` is the Discover, reusing PR #1712's `EntranceOverlay` and PR #1714's `OfferBanner` ("An Ancient
  Awakens").
- The `ancientsFx` bus sequences ring flash → offer → pick.

Nothing loops: every motion is WAAPI transform/opacity or a one-shot transition.

## Verification

- `packages/sim/src/ancients.test.ts` (19 tests) covers:
  - the meter: refresh +1, combat +2, awakening exactly once when full, the Shop paused while the offer is open;
  - off by default;
  - the seeded offer of 3 distinct Ancients, with the run cursor untouched;
  - all 5 Indy effects in their phases (War in Shop and combat with the carry-back, Time combat-only and reverting,
    Genesis completing a triple, Fortune's plain copy, Death's Rise and Taunt);
  - the "Not written yet" path for Warden;
  - the save round trip.
- The Doc Bot combat-mod lane pin moved 63 → 64: `ancientWar` needs a gilded body beside a dying friend, which the
  staged fight lacks. It is pinned in the test above.
- Perf (dev build, pane hidden): a full fill → flash → offer → pick → split sequence recorded **0 long tasks**.

## Later the same day (owner rounds on #1739)

- **Death** grants **Rebirth** and Taunt (no longer Rise).
- **Art**: Death and Fortune wired (`art/ancients/`, full + hero-power halves); War, Genesis and Time keep emblems.
- **Cards**: the offer and the preview share `AncientCard`: a full-art frame, the name, and the effect in its own panel.
  **All flavour/thesis text removed** (from the data too).
- **Pick flight**: only the triple's `gild-trail` flies into the hero power (no flying face). The split is a jagged
  **crack** (static clip polygon + edge highlight + shadow, jagged end to end), with per-Ancient art fit and crack dials.
- **Hero-power tip** (shared by every hero-power hover, the Equipment slot and the foe's power): the game's dark
  slate-blue panel, gold title, "(Death)" tag in the Ancient's colour, status as a chip. The preview and offer cards
  follow the same dark blue.
- **The Ancient pill** under the power's name, coloured from one table (Death teal, Fortune gold, War crimson,
  Genesis leaf, Time azure), overridable in the tuner. The name pill now sits above the meter ring.
- **Rebirth look (player-facing, patch-noted)**: Rebirth no longer borrows Rise's aqua dome. A thin blue ember rim
  (opacity-only breathe) + rising embers (transform/opacity only) on the card, and a one-shot blue-and-white
  `rebirth-flame` burst + gap-gated flame cue when a minion rebirths in combat (`reborn { rebirth: true }` →
  `onReborn(uid, true)` → `reformRebirth`). 🔥 Rebirth tuner. The keyword box wears the same blues.
- **The meter pill** reads "Ancients 7/16" and is the ONLY hover that opens the preview (the ring takes no pointer
  events). The preview slides/fades in (180 ms) and, after an 80 ms grace, out (110 ms). The hero-power tip hides its
  status chip when it would only say "ready".
- **The gate** (`AncientGate`): after the full-ring ping, the hero power swells, bursts (`ancient-gate-burst` def +
  a quick flash + boom cue) and an iris opens from it (a one-shot `clip-path: circle()` sized to the viewport's
  farthest corner, with a glowing edge ring) into a tinted, semi-transparent backdrop; the offer rises out of it and
  drops its own dim. On a pick the iris contracts back into the hero power while the triple trail lands. Click skips
  the charge; reduced motion fades. Cue slots (clip id / gain / offset) and every timing in the ✦ Ancients tuner, plus
  ▶ Play gate. It never plays under a curtain, in combat or over another decision overlay.
- **Awakening rework (owner: "this looks really bad")**: the hero power never moves. The offer uses the Discover
  view's own backdrop and sits ABOVE it (it now marks `body.modalup`, which dissolves `.app`'s stacking context the
  way every Discover does; before, the body-level gate painted over the whole offer). The Shop row steps back
  (`body.ancoffer`). Cards are crafted tablets (gold-bevel art box, the name in the display font over an Ancient-coloured
  rule, an inset description box, a crest gem; equal height), with painterly placeholders. Genesis no longer prints
  "This checks for triples." The gate is the go-to-combat wipe's language from the hero power (`wipeFx` charge / bloom /
  inhale take an optional palette; the curtain is an aspect-stretched ellipse from `wipeGeometry`, the seam ring the
  wipe's scaled texture) in violet/gold/teal, with "An Ancient Awakens" as its centre moment, then it hands off to the
  offer. Verified with headless-Chrome screenshots at 1920x1080 and 3440x1440 against a real Discover.
- **The awakening as a cinematic** (owner: "ominous exciting … delay the discover, and make the discover animation
  unique to the ancients in timing, sound and appearance"): OMEN (music + other buses duck via the new
  `setMusicDuck` / `duckSfxBuses`, rumble, darkening edges, glyphs flickering around the hero power, embers rising)
  → ERUPTION (boom + flash, a column of light, the curtain bloom with runes on its seam) → TITLE (held, sting) →
  the Ancients' OWN REVEAL (one at a time out of a flash of their colour and a ring of light shards, descending
  per-card cues, a frame shimmer) → SETTLED (drifting motes, a quiet looping hum) → PICK (seal). Every beat and
  every cue (clip / gain / offset / pitch) is a ✦ Ancients tuner dial; ▶ Play full sequence / ▶ Play from reveal.
  A click steps omen/eruption/title → reveal, and a second completes the reveal. Sequencing lives on the
  `ancientsFx` stage bus (`AncientGate` drives it, `AncientOffer` reports `settled`).
- **Omen strengthened + reveal round**: the omen vignette creeps in from the edges (~50% at the edges), a violet halo
  and a turning ring of bright rune glyphs around the hero power, cracks of light across the board, motes pulled in,
  and a light tremor on the board ART only (`.boardbg`). The first tremor animated `.app`, which made it the
  containing block for every fixed element and collapsed 21:9 into a 16:9 box (owner report); `gateLayout.test.ts`
  now fails any Ancients code that reaches for `.app` / `.statusbar` / `#root`, or CSS that transforms `.app`. The
  light column is gone. REVEAL STYLE (tuner): two beats (default; the middle rises and slams, then the sides slide out
  from behind it and slam together, one sound) or sequential. Cards are minimal (the art, the name with an
  Ancient-coloured glow + underline, clean text). Pixi smoke everywhere, in each Ancient's colour (`ancient-smoke`,
  `ancient-haze` looped when settled, `ancient-slam`, `ancient-gate-smoke`); the gate now sits at z 105, under the
  z 110 FX canvas, so the smoke draws over the backdrop and behind the offer. Peak ≈ 300 pooled particles (beat 2).
- **Dust, colour pickers, and a cleaner Pixi pass** (owner: "add pixi dust … make the dust dissipate from the hero
  power more quickly … a color picker", then "i dont want stars, id rather dust", then "dust like a pixi burst and
  then smoke kinda like the runeforge animation's smoke", then "the smoke effect is all biffed and so sloppy. make the
  animation cleaner"). Where it landed after three iterations:
  - Each slam plays the Runeforge tablet landing's OWN dust def (`runeforge-land-dust`, the owner-approved tuning) as
    is. It is tinted to the Ancient's colour, centred on the card's bottom edge (the art frame is measured AT the slam),
    and sized in proportion to the card. It plays on the z110 FX canvas, so it sits under the cards. It is one puff,
    with the `ancient-slam` shockwave under it and a one-shot light sweep across the art.
  - The eruption is one short puff of the same dust from the hero power. It gets its own "Hero-power dust life" dial
    (0.45×), so it has played out by the time the curtain has bloomed.
  - There are no particles on the curtain or the settled screen, and the DOM motes are gone. The Ancients' own
    smoke/burst defs are deleted.
  - **Found on the way:** every smoke layer in the Ancients defs had shipped `muted: true` (copied from a muted
    template), so the "coloured smoke" from the previous round never rendered. There was no error and no warning.
    `ancients/ancientDefs.test.ts` now fails on any muted or star-shaped layer in an `ancient-*` def.
  - Screen colour pickers in the ✦ Ancients tuner (live, via CSS vars on the gate root): curtain centre and edge,
    seam ring, title glow, backdrop tint.
  - Dust dials follow the Runeforge entrance's pattern: count, size, life, opacity.
- **All five Ancients' art wired + owner tuner values baked (2026-09-26).**
  - **Art:** War, Genesis (source file spelled "Genesys") and Time were added as 512px WebP in `art/ancients/`, each
    with its full art and its hero-power half. The newer War full art (00:03) was re-wired. Death and Fortune were
    unchanged since their 21:03 wiring.
  - **Placeholder:** the emblem fallback stays generic, for any future Ancient without art.
  - **Art budget:** raised by exactly 6, from 1268 to 1274 ("owner-supplied Ancient art 2026-09-25").
  - **Art fit:** every Ancient uses the neutral hero-power fit (offset 0, scale 1). All five line up with Indy's
    split like Death and Fortune did.
  - **Baked tuner values:** the owner's ✦ Ancients export is now the defaults, including the CSS-var fallbacks:
    - teal curtain: #247067 → #0a0618;
    - title glow #9effd5, seam #fff1bd, backdrop tint #060d0f;
    - cardReveal gain 0.19, pickSeal gain 0.62;
    - revealStyle 1 (two beats).
  - `ancientsConfig.test.ts` pins these values.
