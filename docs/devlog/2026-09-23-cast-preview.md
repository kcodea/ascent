# 2026-09-23 — The cast preview: a rune's or minion's cast spell floats above its caster

Owner asks (verbatim, from the 9/23 balance list). Rune of the Gilded Ledger: *"please have a copy of the spell
that gets cast pop up above the rune when it is cast. use a hover preview and let it linger for about 2 seconds.
have it fade in/out like a preview"*. Rune of the Spell Market: *"when this happens, show Staff of Guel with the same
preview style we talked about. this should become the norm, when a spell or something is cast or triggered from
runes and minions. i will detail below."* Later the same day, for combat: *"for card like fatecarver or warflame that
casts the same spell every time, it should only do the quick pop one time in combat."*

Built as ONE mechanism, so every rune- or minion-cast spell lights up by construction (the Spell Market, Soul
Defiler and Rope Wrangler PRs in flight today need no wiring of their own).

## The sim half: who cast it

`castSpell` was not the choke point. The cast factories (`castSpell`, `endOfTurnCastSpellOnSelf`,
`endOfTurnCastSpellEscalating`) and Rune of Might call `applyCastEffects` directly, so the record lives at the TOP of
`applyCastEffects`, the one place every cast's effects resolve. It reads the innermost actor off a module-scoped
**cast-actor stack** (`castActorStack` / `withCastActor` in `recruit.ts`, the `activeCollector` pattern):

- every `RECRUIT_FACTORIES` entry is wrapped ONCE at module init to push its `self` as `{ kind: 'minion', uid,
  cardId }` — so any minion trigger that casts is attributed without touching a call site, and a factory written
  tomorrow is covered. A spell's OWN effects dispatch through an unwrapped copy (`RECRUIT_FACTORIES_UNATTRIBUTED`):
  the target of a spell is not its caster;
- `payRuneThreshold` (Gilded Ledger, a Spell Market built as a threshold), the recurring End-of-Turn Rune of
  Recurrence / Rune of Lassoing and Rune of Might push `{ kind: 'rune', id }`;
- the player's `play` runs under no actor and records nothing; an Equipment activation records nothing either
  (`equipmentCastDepth`; see the open questions).

The record is `RunState.castFx` (`{ source, spellId, phase }`, seq `castFxSeq`), cleared per action at the top of
`reduce` like `bounceFx` / `lassoFx`. `phase` is `endOfTurn` inside `applyEndOfTurn` / `projectEndOfTurnSteps` and
those records ride the End-of-Turn beats instead of the action watcher: `EotStepFx.casts` (legacy projection path,
sliced per beat like `steals`) and, under a capturing collector, a `spellResolved` consequence (the authoritative
path — the type existed, nothing emitted it until now). Gameplay never reads any of it.

## The UI half: one layer, three feeders

`packages/ui/src/castPreview.ts` is a tiny external store (no React, node-testable): `showCastPreview({ sourceKey,
spellId, anchor })`, fade in 180 ms, linger 2000 ms, fade out 320 ms. `CastPreviewLayer.tsx` (mounted once in
`Game.tsx`) renders each entry as the SAME plated full card the hover reveal uses (`Card forceFull plated`, the same
`zoom`), built by `conjuredView` so a spell prints its live value and a Ruby its live worth. Fixed,
`pointer-events: none`, one `getBoundingClientRect` per preview at mount (the clamp + de-overlap), opacity/transform
one-shot keyframes only.

- **Shop**: the `castFxSeq` watcher in Recruit.tsx (recruit phase only) resolves the caster's element — a warband /
  hand card by `data-uid`, a rune badge by `.runebadge[data-source-id]` — with a short rAF retry for a caster that
  mounts in the same commit.
- **End of Turn**: the `spellResolved` presenter (`ctx.spellCast(cardId, beat.source)`) and the legacy
  `bfx.casts` loop.
- **Combat**: a `castPreviewFx` cue on EVERY kind (including `attackExchange`, since an on-attack cast is absorbed
  into the wind-up) scanning the moment's `sc` events stamped with `spellId`; `useCombatReplay` keeps a
  `CastPreviewMemory` keyed on `(caster uid, spell id)`, reset in `resetTo` (new fight, seek, rewatch), and anchors
  from the slot reading (`rectOf`).

**Stacking decision** (flagged for the owner): a second cast from the SAME source while its preview is up REPLACES
it — the card swaps, a small ×N chip counts, the linger restarts — so a Gemstorm Instigator's five Rubies read as
one preview refreshing rather than a pile of identical cards over one slot. Casts from DIFFERENT sources run side by
side above their own casters; `placeCastPreview` nudges a newcomer sideways off a live neighbour (right, else left)
and clamps it on-screen, falling below the anchor only when there is no room above.

## Verified

`castFx.test.ts` (minion / rune / player / `withCastActor` / per-action clear / EoT slice), `castPreview.test.ts`
(the clock, replace-vs-stack, placement), `CastPreviewLayer.test.tsx` (mounts on the cast with the right spell and
source, leaves after the linger, stacks two, ×N chip), `choreo/channels/castPreview.test.ts` (the scan, once per
fight, the cue on every kind, Fatecarver ×3 → one). Oracle rule `R-PRESENT-10`.

Browser proof on port 5267 (a throwaway Practice run, the rune and casters injected through the store):
- a Gilded Ledger payout floated Might of Aeon above the rune node (plate bottom 746 vs badge top 766, left-clamped
  at the screen edge); sampled computed opacity 0 → 0.51 → 0.87 → 1 over the first ~190 ms, held at 1 until
  ~2.2 s, `leaving` at 2.24 s, 0.97 → 0.20 through the fade, unmounted at ~2.6 s;
- the rune rail and the warband row rects were byte-identical before and after (no layout shift);
- End Turn with a Rope Wrangler floated Lasso above the Wrangler on its beat (plate bottom 625 vs card top 645),
  three casts in one beat read as ONE preview with a ×3 chip;
- a fight with Warflame + two Dragons against a pinned four-body foe: 7 attacks, 3 Dragonflame casts by Warflame,
  exactly ONE preview (above its slot, never two at once) — the once-per-fight rule.
- Found and fixed during the proof: the card's layout box is the compact tile; the plate overhangs it (58 px above,
  ~400 px below at hover zoom), so the first build placed the card OVER the badge. The layer now measures the
  plate's footprint and offsets by the overhang.

## Open questions for the owner's promised detail

1. **Equipment casts** (the Keg's Ale, Whiplass-o's Lasso) record NO preview today: the owner named runes and
   minions, and an Equipment already has its own authored use cue. Say the word and `equipmentCastDepth` goes.
2. **Shop repeat cap**: the shop previews EVERY cast (a same-source recast refreshes the one preview with ×N). Should
   the shop get the combat's once-per-(source, spell) rule per turn, or is the refresh right? Fatecarver and Warflame
   are combat casters, so the combat rule was applied only there.
3. **Hero-power and quest casts** show nothing (no rune node / minion to hang the card on). Should a hero-power cast
   preview above the power button?
4. **Timing feel**: 180 / 2000 / 320 ms and the hover reveal's zoom. If the combat "quick pop" should be shorter
   than the shop linger, the two clocks are one constant apart.
5. **Same-source recast in combat when the spell differs**: previews once per spell (a Warflame casting Dragonflame
   then a taught spell shows both). Confirm that is the intent.

## Follow-up 2026-09-24: the tuner, smaller defaults, and Fatecarver's missing Growth

Owner feedback 2026-09-23 (with screenshots):

> "this is far too large. can you build a tuner for me to adjust size, positioning, and linger duration? also, why
> does fate carver not show the growth preview? warflame does. it is also massive. make sure to add all of the
> details to the tuner so i can tune both. add an alpha/opacity lever as well."

### The Cast Preview tuner

DEV menu (🛠️) → Buffs & Auras → **🔮 Cast Preview** (panel id `castpreview`, key `ascent.castpreview`, registered
in `tunerAll.ts` so "Reset all tuners" covers it). `castPreviewConfig.ts` is the ONE accessor: the store reads
`castPreviewTimings(context)`, the layer reads `castPreviewLook(context)`, the combat feeder reads
`castPreviewCombatOncePerFight()`; no size, offset or duration is hard-coded in `castPreview.ts`,
`CastPreviewLayer.tsx` or the CSS any more (the CSS `--cp-scale` fallback mirrors the default). Knobs apply live
(a change re-renders a preview already on screen and re-runs its one measure; per change, never per frame).
Two groups, identical knobs:

| Knob | Range | Shop default | Combat default |
|---|---|---|---|
| Size (× the old full plated card) | 0.2 to 1.5 | 0.42 | 0.38 |
| Side of source | above / below / left / right | above | above |
| Offset X / Offset Y | -300 to 300 px | 0 / 0 | 0 / 0 |
| Fade in | 0 to 1000 ms | 180 | 180 |
| Linger | 0 to 6000 ms | 2000 | 1600 |
| Fade out | 0 to 1500 ms | 320 | 320 |
| Max opacity | 0 to 1 | 1 | 1 |
| Once per fight (combat only) | on / off | | on |

**▶ Preview test** fires a Might of Aeon shop preview above the first rune badge and a Growth combat-style preview
above the first warband card (or combat unit); either falls back to a stand-in spot on the roomier side of the
panel when that source is not on screen. Judgement calls: combat lingers 1.6 s (the fight is busier than the shop);
a side with no room flips to the opposite side; the controls carry no hints (the shared panel renders a hint as a
native tooltip).

Size at a 1600 × 900 viewport: before, the plated card measured **262 × 408 px** against a **115 px** board minion;
now **110 × 171** (shop) and **100 × 155** (combat), seated just above the source.

### Fatecarver: root cause

The combat preview keys on `sc` events stamped with `spellId`. Warflame / Flamebeat cast through
`castNamedSpellInCombat`, which always logged "X casts Y". Fatecarver's Growth (`onAllyAttackCastGrowth`) casts
through the arena's `castRepeat` verb, whose COMBAT implementation (`packages/core/src/effects/factories.ts`, the
`castRepeat` entry in `combatArena`) was `(_spellId, body) => castInCombat(ctx, self, body)`: a real cast, but the
spell id was thrown away and nothing was logged. The fix logs one `sc` + `spellId` per cast, from the CASTER, after
its body. Same path, same bug, same fix: Taragosa and Hoardbreaker Drake (Growth), Watcher and Wick Mortis (Lantern
of Souls), Ashen Broodlord (Staff of Guel). Anubis's Echo Lantern (`castTribeAttackSpell`) logged a line with no id;
it now carries `lanternofsouls`. Already correct before: Warflame, Flamebeat Drake, Quil, Sporebat, Runesnout
Archivist, a Moonhowl Mage-Pup. Not addressed: combat Ruby casts (a Ruby is not announced as a spell cast) and the
buffs of a `castRepeat` cast are still unmarked by `castingSpellId` (so Growth's buff wave keeps the stock tendril).

Also: the combat feeder now claims the once-per-fight memory only once the caster has an on-screen rect, so a cast
by a body not yet drawn no longer burns its one preview.

### Proof

Tests: `packages/core/src/combat/combatCastAnnounce.test.ts` (seven casters announce from the caster; Fatecarver one
per friendly attack, golden two, equal to the genuine cast count; Anubis carries the id; the five `castRepeat`
rows and Anubis fail on the old code), `castPreviewConfig.test.ts` (defaults, clamp, persistence round-trip,
reset, independence, panel reachability), `castPreview.test.ts` (tuned timings per context; size, offset, side,
flip), `CastPreviewLayer.test.tsx` (a live preview picks up size / alpha changes), and
`choreo/channels/castPreview.test.ts` (real simulator → compiler → scan → memory: many Growth casts, ONE preview,
from Fatecarver not the attacker; with Warflame beside it, one each). Oracle `R-PRESENT-10` amended.

Browser (port 5273, a throwaway run): the panel opens from the dev menu; Preview test shows both previews at the
new size; dragging Size / Offset Y / Max opacity wrote and persisted the values, and a preview already on screen
re-sized live (combat 294 → 157 px wide, shop opacity 1 → 0.5); a fight with Fatecarver (branch B) + an attacker
(7 Growth casts) showed exactly ONE Growth preview, above Fatecarver's slot (preview 820 to 920 px, Fatecarver 812
to 927 px, attacker 658 to 811 px).
