# The lasso beam — one def, four sources, and a card that waits for the rope

**2026-09-22** · owner ask · `packages/sim`, `packages/ui`

The owner authored a `lasso` def in the FX workbench and asked for it on every Shop steal: "It will function
slightly differently for every source, but run the same effect." The beam leaves the spell's drop point, or
Rope Wrangler, or the equipment slot; several steals cascade rather than firing at once; and — the part that
made this more than a `playDef` call — **the beam has to hit the card before the card is taken.**

## What the reducer already did, and why that was the problem

`stealTavernMinion` (`packages/sim/src/recruit.ts`) splices the offer out of `state.shop` and pushes a copy
into `state.hand` in one commit. By the time any UI code runs, the card is gone from the row, the row has
reflowed, and the hand copy has a **fresh** uid — so matching on the Shop uid matches nothing (the same trap
that broke the buy path). There was nothing on `RunState` saying a steal had happened at all.

## The signal

`RunState.lassoFx` / `lassoFxSeq`, modelled on `starformFx`: appended by the effect, cleared per action at the
top of `reduce`, seq bumped per record. Each entry carries the whole stolen `ShopCard`, its `index` at splice
time, the `handUid` of the copy, and an `origin` string.

Carrying the whole offer is deliberate: the hold **re-renders the real card** in its slot while the rope is in
the air, and the shop view builder only knows how to build a view from an offer. It is transient, so it never
grows a save.

`origin` rides the same private-param channel as `_source`: `applyCastEffects` and `castSpell` take an optional
origin, the minion-casts-a-spell factories pass `board:<self.uid>` (the CASTER, not the carry the untargeted
spell was handed — `applyCastEffects` passes `target` down as `self`, so the factory cannot tell them apart),
`fireEquipmentTriggers` merges `_origin: 'equipment'` into its params, and Rune of Lassoing passes `'rune'`.
A plain hand cast leaves it unset and means the drop point.

## Two channels, because End of Turn commits after the phase flips

Rope Wrangler and Rune of Lassoing resolve inside `faceOmen`, after the shop has gone — the same reason
`handGrants`, `shopBuff`, `ruby` and `welds` each got their own `EotStepFx` field. The authoritative
choreographer path (the default since 2026-08-13) emits **one `cardGranted` per steal**, so the beam rides
that grant, keyed by the hand uid, off the already-resolved `prepared.after.lassoFx`. The legacy projection
path (`ascent.choreo = '0'`) collapses the casts into one beat and reads `EotStepFx.steals` instead.

**Measured, and worth stating because it contradicts what the emission suggests:** the batch carries a
separate `sourceTrigger` per cast, but the compiled timeline delivered all five of a gilded Rope Wrangler's
`cardGranted`s inside the same millisecond (live, 2026-09-22). Firing on the delivery alone put five ropes on
screen at once. So the pacing is a **floor**, not a stagger: each beam launches no earlier than 300 ms after
the previous one, which costs nothing if the beats ever do spread out further than that. "Each cast gets its
own beat" is true of the emission and of what the player sees; it is not yet true of the delivery clock.

## The holds

`packages/ui/src/lassoHolds.ts` — extracted rather than left inline, because the failure mode is a card
stranded invisible and that deserves a test. Three answers, the first load-bearing because it cannot be
forgotten at a call site:

1. **`lassoHoldsForPhase` is applied during render.** Off the recruit screen there are no holds at all, so
   "did the release timer fire?" never arises once the shop is gone.
2. `resolveAllLassoHolds` is what a cancelled cascade and an unmount both call — `gambleHold`'s rule that a
   second roll mid-tumble never strands the first prize.
3. A release is keyed on the stolen offer's uid and the arrival's own uid. Never a blanket flag: one of those
   threw away every other fresh card in the same tick on 2026-07-23.

The held offers are folded back into the row **above** the view memo, so the view builder, `displayShop`,
`rowsKey`/`flipKey` and the drag's home-slot order all see them — which is what keeps FLIP still. Re-insertion
walks the records in **reverse**: each `index` was taken against the row as it stood when that steal spliced.

The stolen card is kept out of the hand fan until contact, so the universal hand-diff coalesce watcher never
sees it; the materialise is fired by hand when the rope delivers it instead.

## Timings

`LASSO_STAGGER_MS = 300` (the owner's "overlap slightly", so five casts read as ~1.5 s) and
`LASSO_CONTACT_MS = 200` (the def's own `travelMs`). The card leaves the Shop and enters the hand on contact,
never on the reducer tick.

## Shop only

Three independent gates, no new one needed. `stealTavernMinion` exists only in `RECRUIT_FACTORIES` and has no
combat counterpart, so `simulate()` cannot reach it. The signal lives on `RunState`, which combat replay
(`useCombatReplay`, off the `CombatEvent` log) and an opponent `BoardSnapshot` never carry. And the watcher is
gated on `run.phase === 'recruit'` on top of both.

## Also

The def's audio clip (`universfield-whip-snap-242215.mp3`) had been written into the primary checkout by the
dev `/__fx/sound` endpoint, because port 5173 runs on `main` while the def was authored in the worktree. It was
untracked in both. `sfx.ts` globs the directory, so a missing clip is a silent no-sound with no failing test —
it is committed here with the def.

## Review pass — three things the first cut got wrong

**Only the first steal of a recruit phase actually held its card.** The holds are seeded during render, and
the cascade watcher returned `resolveAllLassoHolds` as its cleanup. React runs a changed-dep effect's cleanup
*after* the render that bumped the dep has committed, so from the second steal action onward the cleanup wiped
the batch that very render had just seeded: the offer left the Shop and the copy reached the hand before the
rope was drawn, which is the one thing the feature exists to prevent. Measured with three separate Lasso casts
(hold, then nothing, then nothing). Cancelling a previous cascade now happens **in the seed** —
`holdLassoSteals(resolveAllLassoHolds(prev), fresh, row)` — and the old batch's timers are dropped at the top
of the effect body. The watcher registers no cleanup at all; the phase gate and the unmount hatch are the only
two, and neither can race a render.

No pure test could see that, so the whole wiring moved out of `Recruit.tsx` into `useLassoCascade`
(`lassoHolds.ts`) and `lassoCascade.test.tsx` drives two steal actions through a real mounted component. Put
the cleanup back and it fails on the second action.

**The rune beam launched from the opponent's tray.** `document.querySelector('.runebadge')` is unscoped, and
`OpponentFrame` renders its own rune badges earlier in the document than the player's `.questbadges`. Scoped
and named now, the way the quest-tendril lookups in the same file already do it:
`.questbadges [data-source-id="rune_lassoing"]`.

**A Refresh mid-beam left the stolen offer sitting among the new ones.** The hold was folded back by its
splice-time index with no check that the row was still the row it came from. A hold now records the Shop uids
it was taken out of, and `foldLassoHolds` drops one whose row has been replaced outright. Harmless before (a
buy on a missing uid is a no-op in the reducer) but it read as a bug.

Also: the End-of-Turn presenters' timers are registered so an unmount clears them, on a list the phase watcher
deliberately leaves alone — those beams play across the flip to combat by design. And the "byte-identical
either way" sim test was comparing `reduce` with `reduceWithPresentation`, which both carry the new fields, so
it could not have failed; it now asserts the outcome directly (the row lost exactly the recorded offers and
kept its order, the hand gained one matching copy per record) and compares the two entry points with the
channel stripped.
