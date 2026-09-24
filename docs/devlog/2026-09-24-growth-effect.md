# 2026-09-24: Growth and Waking Rift get their own cast effects, in every phase and from every source

Owner asks (verbatim):

- *"i added a growth effect for whenever growth is cast, by any means. player,rune,minion etc and any phase.
  recruit, combat, end of turn whatever it may be. (this should be default by now anyways and if it isnt, please
  write into the oracle that our effects and mechanics should be wired to work across phases by default. always
  ask if unsure)"*
- Same day, same PR: *"i added a waking rift effect"*.

## What shipped

- Two owner-authored defs from the Beat/FX workbench: `fx/defs/growth-effect.json` (sound
  `fx/universfield-cinematic-swoosh-impact-454392`) and `fx/defs/waking-rift-fx.json` (sound `fx/waking-rift`).
  Both clips are committed in `audio/fx/`.
- ONE per-spell cast binding, a card-level `spellCast` row in `choreo/bindings.json`: `growth` -> `growth-effect`,
  `sparkplug` (Waking Rift keeps its old id) -> `waking-rift-fx`. It is read by `spellCastFxFor` (card level only,
  so the kind-level `spell-sparks` default never leaks onto rune / minion / combat casts, and fan-out rows such as
  Dragonflame's `buffedOn` keep their own per-buff paths).
- ONE play, `fx/spellCastFx.ts` (`playSpellCastFx`), reached from every phase:

| Phase / source | Path | Before |
|---|---|---|
| Player, from hand / Shop | `runSpellCastFire` (shop cue runner) on the `spellCast` moment | already worked once bound |
| Rune / minion in the Shop | Recruit.tsx `castFxSeq` watcher -> `playRecordedCastFx(run.castFx, 'recruit')` | no path for a spell effect (only the cast preview read it) |
| Rally fired in the Shop (Hoardbreaker's inline "cast Growth") | `recordActorCast` added to the shop arena `castRepeat` | recorded nothing |
| End of Turn | `spellResolved` presenter context (authoritative) + `EotStepFx.casts` (legacy) | no path for a spell effect |
| Combat | new `spellCastFx` cue in `choreo/score.ts`, once per `sc` + `spellId` | arena `castRepeat` casts (Fatecarver, Taragosa, Hoardbreaker) logged no `sc` and emitted untagged buffs |

## Engine choke points (so every spell gets per-spell FX, not just these two)

- Combat: `withCastingSpell` in `packages/core/src/effects/factories.ts` marks the window of every combat cast
  (`resolveCombatSpellCast` itself, and the arena `castRepeat`), so every buff a cast produces carries `spellId`.
  The arena `castRepeat` now also logs one `sc` + `spellId` announcement per cast from the caster. This is the same
  `castRepeat` change open PR #1671 makes (plus the mark); whichever lands second resolves a small conflict there.
- Shop: `recordActorCast` in `packages/sim/src/recruit.ts` is the one recorder, shared by `applyCastEffects` and the
  shop arena `castRepeat`.

## Anchor choice

Both defs are camera-anchored, board-wide bursts (Growth's layers sit at `offsetY: 110`), authored in the workbench
whose camera is the viewport centre. So they play ONCE per cast on `camera` = viewport centre (the Blast Pump /
Stellar Lens / shop-buff-purple convention). Fanning them out per buffed minion (`buffedOn`) would stack seven
identical copies on one point, because a camera layer ignores the minion anchors. The stock buff tendrils still
play under the combat effect (additive). The owner can swap to "replace" later.

## Owner ruling: the cast effect replaces the tendril

*"the growth and waking rift effects should replace the tendril for a card that carried those effects, like
fatecarver as an example."* When a CARD casts a spell that has its own cast effect, the buffs that cast produced
draw NO tendril / descend. The stat change and number still land; the spell's effect is the whole presentation.
One predicate, `castFxReplacesTendril(spellId)` in `choreo/bindings.ts`, is asked in every phase. Any future bound
spell behaves the same, and unbound spells keep their tendril.

- **Combat.** `fireBuffCasts` (useCombatReplay.ts) reads the `spellId` that `withCastingSpell` stamps on each buff.
  It skips the tendril and still rolls the badge on the authored clock.
- **Shop and legacy End of Turn.** `BuffFxEvent.spellId` is stamped in two places. `applyCastEffects` stamps its
  `spell` capture when the innermost cast actor is a minion. `captureBuffFx` stamps a `minion` / `deathrattle`
  capture with the one spell that minion cast inside it (`spellCastBySince`, read off `castFx`).
  `replayBuffFxEvents` then drops the tendril for that event.
- **Authoritative End of Turn.** The trigger scope stamps `statsChanged.spellId` for a minion beat's cast. The
  `statsChanged` presenter then skips `statGain` when `ctx.spellHasCastFx` says the spell is bound.
- **Not a card:** the player's own cast keeps its release-point cue and descends. A rune's cast keeps its
  rail ribbon. The ruling named cards; ask before extending it to either.
- `docbot/retroCatalog.ts`: the Gifts re-injection's find/replace text follows the new `captureBuffFx` argument.

## Oracle

`R-PHASE-01` (foundation): effects, mechanics, triggers, tallies and FX are wired to work in every phase and from
every source by default. A phase-limited behaviour needs an owner ruling; when unsure, ask. The same sentence is in
CLAUDE.md (Architecture) and the `ascent-gameplay` skill.

## Tests

- `packages/core/src/combat/growthCastTag.test.ts`: Fatecarver, Hoardbreaker and Taragosa log one `sc` per cast
  and tag their buffs. Sporebat re-casting Growth or Waking Rift tags its buffs. These fail without the fix.
- `packages/sim/src/growthCastFx.test.ts`: a player cast records nothing. A Mage-Pup, a shop Rally, Gilded Ledger
  and Rune of Recurrence at End of Turn each record the cast, for both spells. The shop Rally case fails without the fix.
- `packages/ui/src/fx/spellCastFx.test.ts`: each spell plays its def from the player moment, the shop records, the
  End-of-Turn paths, and a real `simulate()` log run through the real score (one play per cast).

## Live check (port 5277, throwaway Practice run)

Casting Growth from hand fired `growth-effect`. A Mage-Pup taught Waking Rift, played in the Shop, fired
`waking-rift-fx` through the `castFx` watcher. In combat, "Fatecarver casts Growth" fired `growth-effect` once,
matching the one cast. No console errors.

## Open for the owner

- The perf HUD flagged the Growth effect in the shop: "Growth Effect fx/frame", worst frame about 36 ms while it
  played. That is 3 x 240-particle bursts. The def is owner-authored and was left untouched. It may want a lower count.
- Rune of Spellhide's Start-of-Combat re-cast still resolves without an `sc` announcement, so it plays no cast
  effect. Equipment casts still record nothing (R-PRESENT-10). Neither has an owner ruling yet.
