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
