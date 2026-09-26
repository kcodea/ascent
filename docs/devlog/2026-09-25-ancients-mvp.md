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
