# Spiritbinder throws a beam at the board Spirit it buffs

**2026-09-22** — owner ask: *"I made a spiritbinder effect. It should target the board minion, but the minion
in hand should still get the generic hand buffed effect that it currently has."*

Spiritbinder (`spiritbringer`, granted by Knot / `sp3_bondweaver`) buffs one random Spirit **on the board** and
one random Spirit **in hand**. The owner authored `packages/ui/src/fx/defs/spiritbinder.json` — a 900 ms beam
(travel 200 / dwell 180 / release 420, gold to red) with a shockwave on the target at 90 ms. It now plays from
the Equipment slot onto the board recipient. The hand recipient is untouched.

## What was wrong to begin with

Spiritbinder had no `useFxId`, so the reducer took the `captureBuffFx` branch and the board buff showed as the
**generic tendril** — and only sometimes. Two holes made it read as "the effect doesn't play at all":

- `captureBuffFx` skips self-buffs (`recruit.ts`, `if (source && c.uid === source.uid) continue`). Knot is an
  eligible recipient, so a self-draw produced **no event at all**.
- With the granter sold the source is a stand-in `eq:<id>` body, so `sourceCardId` is `''` and nothing
  card-keyed resolves.

Both are gone now: the destination rides the Equipment's own `use` cue, which is stamped whether or not a body
survives and whichever body was drawn.

## The source is the SLOT, not the Knot body

Decided deliberately, and worth not re-litigating:

1. The repo already ruled on it. `equipment.ts`: *"`useFxAt` (2026-09-09 → 2026-09-12) is gone: the Equipment
   is ALWAYS the `source` of its use def and the aimed body its `target`."* Starting from the body means
   re-adding an override the owner deleted ten days ago.
2. The slot always exists. Knot can be sold and still hold its grant for the turn (the reducer builds an `eq:`
   stand-in for exactly that), and a stand-in has no DOM element to leave from.
3. **It dissolves the self-target edge case.** Knot is itself a Spirit and is eligible. A body-to-itself beam is
   degenerate; a slot-to-Knot beam is not. No special case, no skipped beam.

If the owner wants the Knot body instead, the fallback chain `findEl(cue.uid) ?? slot` is a two-line change at
the `playDef` call in `Recruit.tsx`.

## The signal

One new per-action scratch, mirroring `equipmentSpellCasts` exactly:

- `RunState.equipmentFxBuffed?: { uid, attack, health }[]` — the BOARD bodies an Equipment's own effect buffed
  this action. Cleared at the top of every action. Display metadata only: no RNG, no stats.
- `equipmentBuffRandomTribeBoardAndHand` records its **board** pick there. It does **not** record the hand pick,
  and must not: the hand pop is a render diff and a second channel would double it.
- `EquipFx` (`kind: 'use'`) gains `buffAttack` / `buffHealth` beside `targetUid`.
- `buffedFxTarget(state, def, mark)` reduces the entries pushed since `mark` into one cue payload. `mark` is
  taken before each fire, so a Counterrotation re-fire never inherits the player activation's pick.

Opt-in per definition via `EquipmentDefinition.useFxTargetsBuffed`. Blast Pump and Dueling Rubettas are
untargeted too and their authored defs are meant to stay on the button, so this could not be a general rule for
untargeted Equipment.

All **three** `use`-cue stamp sites carry it: the player activation, Rune of Dismantling on sell, and Rune of
Counterrotation. The latter two come for free because `fireEquipmentFree` now returns the cue fields it earned
(`EquipUseFxTarget`) and the callers spread it.

## The buff is held to the beam

`holdStat(cue.targetUid, { attack, health }, { origin: 'cue', startAt: cfg.useDelayMs + EQUIP_BUFF_LAND_MS })`,
placed inside the **existing** `useLayoutEffect` that fires the use def. Two reasons it lives there:

- that effect is pre-paint and already advances its own seq guard exactly once per action, so no new effect and
  no new counter;
- a plain `useEffect` would let the new number paint for a frame and then jump backwards before rolling, which
  is worse than no hold (the failure the Ruby hold documents).

`EQUIP_BUFF_LAND_MS = 90` is the def's shockwave `at` — the impact beat, not the launch. The delta is carried on
the signal, never derived from the recipient's `CardBuff` ledger: the ledger is a run total and an Amplified
activation buffs the same body twice, so `total / count` would print a number the body never had.

One cue per activation stays the rule. A multi-trigger fire (extra triggers, Amplified) beams the **last** body
it picked and owes that body's total for the fire; earlier picks move their numbers without a beam, exactly as a
three-trigger Bloodpot is one travel.

## Edge cases

| case | what happens |
|---|---|
| no Spirit on the board | no `targetUid` on the cue, and `useFxTargetsBuffed` turns that into **no beam at all** — the slot fallback would otherwise fire the beam from the button to the button. The hand recipient still pops. |
| no Spirit in hand | beam only, one recipient. |
| the source is the recipient (Knot self-draw) | beam still plays, slot to Knot. No special case — see the source decision above. |
| granter sold | grant outlives it; the cue's `uid` is the `eq:` stand-in, the destination is still stamped. |
| gilded | +12/+12, same single pair of recipients, and the hold owes 12/12. |
| several activations in one turn | one cue per activation, each naming its own draw. |

## Registration

`spiritbinder` is a **dynamic** call site: the id resolves from `eq.useFxId`, already counted as
`'Recruit.tsx': 2` in `DYNAMIC_CALL_SITES`. It must **not** be added to `DIRECT_CALL_SITES` or the
`directCalls.test.ts` allow-list — the scan is a literal-text pass and an unearned entry fails the test.
`defs.test.ts` is glob-driven, and `prodPlayback.test.ts` pins named defs only, so neither needed an edit.

The `playDef` call now passes `uids: { source: null, target: cue.targetUid ?? null }`, so a `react` layer added
to any use def later animates the card it landed on instead of nobody. No current use def has one.

## The test that was rewritten on purpose

`set3Spirits.test.ts` asserted that Spiritbinder records a generic tendril from the Shaman. Setting `useFxId`
routes it down the `fire()` branch and that capture stops — which is exactly what the same test's second half
already asserted for Bloodpot. Keeping the capture would give the board Spirit a beam **and** a ribbon for one
press, the double cue the 2026-08-11 owner ruling forbids. Rewritten to pin the new contract, plus six new
cases for the table above and one in `handBuffFx.test.tsx` driving the real sim to prove the hand recipient
still comes out of `diffHandBuffs` and still plays `hand-buff`.

## One press, one cue: the pulse channel had to be told too

Caught in the browser, not by a test. Removing the `recruitBuffFx` capture (which setting `useFxId` does) drops
the board recipient into `Recruit.tsx`'s **self-buff pulse channel** — the `minionSelfBuffed` moment fired for
any board minion that gained stats and is *not* a `recruitBuffFx` target. Its kind default in `bindings.json`
is `self-buff-burst`, so one press played the beam **and** a burst on the same body. (The comment at that site
saying the generic default was removed in 2026-09-02 was stale; the default is still there, and the comment
has since been corrected in place.)

Fixed by excluding the body a `useFxTargetsBuffed` cue is landing on from `burstable`, alongside the existing
`fxTargets` and `weldedNow` exclusions. Deliberately narrow: an *aimed* Equipment's behaviour on this channel
is unchanged, because widening it would silently change Bloodpot, Titan Hammer and Deathfibrillator.

## Verified in the browser

Dev server on 5208, a throwaway practice run, board seeded through the store. Measured via `window.__fxFires`:

- **normal draw** — `spiritbinder -> {source: null, target: <board Spirit>}`, `hand-buff -> H1`,
  `equipment-used-up`. Nothing else. Badge held at the pre-buff number, then rolled: `21/23` at 1 ms and 96 ms,
  `23/25` at 190 ms, settling on the true value.
- **self draw** — same, with `target` = the Knot's own uid. The beam leaves the slot and lands on it; reads fine.
- **no board Spirit** — cue is `{ uid: 'eq:spiritbringer', … }` with no `targetUid`, fires are `hand-buff` +
  `equipment-used-up` only. **No `spiritbinder` fire at all**, and the hand Spirit still gained +6/+6.

One measurement note for whoever repeats this: the Browser pane throttles `requestAnimationFrame` to about one
frame per 500 ms when it is not painting, so a polled read of the badge shows the hold sitting still and then
snapping at `HOLD_TTL_MS` (1200 ms). That is the failsafe, not the hold's schedule. Interleaving screenshots
forces real frames and the 90 ms + 420 ms roll appears as designed.

## Review pass, same day

Four review findings, all minor. Three applied:

- **The roll opened before the beam arrived.** `EQUIP_BUFF_LAND_MS` was 90, the shockwave layer's `at`. The
  beam layer's `travelMs` is 200, so the badge started moving 110 ms before the strand reached the card, which
  is the opposite of the ask. Now 200: the roll opens on contact.
- **The stale binding comment was corrected**, not just noted. It claimed `minionSelfBuffed` has no generic
  default, which is the exact fact the new `beamedNow` filter depends on being false. A reader trusting it
  would have deleted the filter and brought the beam-plus-burst double back.
- **`spiritbinderBeamGuard.test.ts`** pins the three things CI could not see: the `beamedNow` exclusion still
  narrows `burstable`, the no-target guard still gates the def, and `EQUIP_BUFF_LAND_MS` still equals the
  def's own `travelMs`. Source-level, the same technique `rubyStatHoldGuard.test.ts` uses, for the same reason
  (no render harness for `Recruit`). Sabotage-checked both ways. If the owner retunes the beam's `travelMs`,
  that last case fails and names the constant to re-sync, which is the point.

One declined, and written down at `buffedFxTarget` instead: on a multi-trigger or Amplified activation the
earlier board pick plays the generic self-buff burst while the last pick gets the beam, so two fires read as
one beam plus one unrelated pulse. One `use` cue per fire would read better, but a `use` cue also carries the
slot's used-up flourish and its sound, so N cues is N clicks for one press. Left as one cue pending an owner
call; the earlier picks are never silent, only unbeamed.
