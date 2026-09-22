# Spiritbinder: one beam per fire

**2026-09-22** · owner ruling · `packages/sim`, `packages/ui`, `packages/rules`

Follow-up to [the Spiritbinder beam](2026-09-22-spiritbinder-beam.md) (PR #1628). That PR's review flagged, and
its devlog recorded as declined pending an owner call, one thing: on a **multi-trigger or Amplified** activation
(an extra trigger, the Amplified stack, a Calibration Wrench charge) with several board Spirits, only the **last**
recipient got the beam. The earlier recipient fell through to the generic self-buff pulse with instant numbers, so
two fires read as one beam plus one unrelated flash. The owner has now ruled: *"spiritbinder one beam per fire"* —
each landing on its own recipient with its own beat, the way Rally and Shout count repeated triggers at the signal.

## The signal: one `use` cue per fire

`buffedFxTarget(state, def, mark)` used to fold every pick recorded since `mark` into ONE cue aimed at the last
body, summing that body's gains. It is replaced by `buffedFxTargets`, which returns **one entry per recorded pick,
in pick order, nothing summed**, and the reducer's activation stamps **one cue per entry**:

```ts
const perFire = buffedFxTargets(s, fireDef, fxMark);
if (perFire.length > 0) perFire.forEach((hit, i) => stampEquipFx(s, { ...cueBase, ...cueAim, ...hit, ...(i === 0 ? cueSpells : {}) }));
else stampEquipFx(s, { ...cueBase, ...cueAim, ...cueSpells });
```

Why one-per-pick equals one-per-fire: the only factory that records picks, `equipmentBuffRandomTribeBoardAndHand`,
draws **at most one** board body per fire (`pickRandom(…, 1)`), so N fires push at most N entries, one per fire
that found a Spirit. That invariant is now written at the factory and at the helper. `buffedFxTarget` survives for
`fireEquipmentFree` (a Dismantling sale, a Counterrotation re-fire — exactly one trigger each) as the last
entry of `buffedFxTargets`, which for one fire is the one pick it always returned.

What did **not** change: the picks, the RNG, `addBuff`, the trigger loop, `fireEquipmentFree`, the Keg's
`spellIds` (they ride the first cue only; no flagged Equipment casts anything). Byte-identical cases, pinned with
`toEqual` over the whole cue list and the `equipFxSeq` delta:

- a **single fire** stamps exactly the seven-field cue it stamped before, seq +1;
- an activation that picked **no board Spirit** still stamps the single target-less cue (the UI's "play nothing"
  signal), however many fires it had;
- a **three-trigger Bloodpot** is still one travel — per-fire cues are scoped to `useFxTargetsBuffed`, so every
  aimed Equipment and the Keg are unchanged (`equipment.test.ts` still pins it).

`equipFxSeq` now moves by N for N cues. The UI guard compares previous-vs-current, never counts, so that is
harmless — and it is what lets one action's cascade be one cascade.

## The screen: `useEquipBeamCascade`

New module `packages/ui/src/equipBeamCascade.ts`, the lasso cascade's shape (`lassoHolds.ts`, PR #1629) with the
differences that matter written at the top of the file. What it does per action:

| | |
|---|---|
| **beam N** | launches at `useDelayMs + N × EQUIP_BEAM_STAGGER_MS`, from the slot, at the recipient's **resting** centre measured **at launch** (`restingCenterOf`, transform-immune) — so beam 2 lands where the card *is* after any FLIP, not where it was at the press. A body that left the board is **skipped**, never redirected to the slot. |
| **the gap** | `EQUIP_BEAM_STAGGER_MS = LASSO_STAGGER_MS` (300 ms) — same rationale ("overlap slightly"): beam N+1 launches during beam N's dwell (`travelMs` 200 / `dwellMs` 180). A named twin, so retuning one cascade never silently retunes the other. |
| **the hold** | ONE `cue`-rank hold per **recipient**, placed pre-paint in the layout effect the beams are scheduled from: `startAt` = that body's **first** contact (`launch + EQUIP_BUFF_LAND_MS`, the beam's `travelMs`), `rollMs` = default, stretched to its **last** contact when the body is hit more than once. A body beamed once gets exactly the hold it always got. |
| **disposal** | every launch timer's clear and every def's retire fn go into the **one** stop list `Recruit` already keeps its other use defs in (`useDefStopsRef = equipBeams.stops`), outside any per-action effect, so a later action never cuts a beam (owner 2026-09-09). Retired when the shop leaves (new phase watcher — before this, use defs were retired on unmount only) and on unmount. Holds are dropped by the store's `dropBoardFx` on the same flip. |
| **`beamedNow`** | untouched: it was already a set over every `use` cue of a flagged Equipment, so N cues cover N bodies and none of them gets the generic pulse. |

`Recruit`'s use-cue loop hands a flagged cue that carries a `targetUid` to the cascade (`const cascaded = …; if
(… && !cascaded …)`) and plays nothing for it, nor measures it: the `findEl` / `getBoundingClientRect` read is
skipped for a cascaded cue, because the cascade measures each recipient at its own launch and a rect read here
would be one no beam ever uses (review 2026-09-22). The aimless guard stays for the target-less cue. The
Equipment's clip, if it had one, rides each beam's launch (`onLaunch`) rather than N-at-once in the loop — moot
today, Spiritbinder names no `useSfxId`, and `equipment-used-up` fires on the charge edge, not per cue.

## Edge cases

| case | what happens |
|---|---|
| Amplified, two different Spirits | two cues; beam 1 at 0 ms → body A, beam 2 at 300 ms → body B; A's badge rolls from 200 ms, B's from 500 ms |
| gilded + Amplified | same, +12/+12 per cue and per hold |
| the SAME Spirit picked twice | two cues, two beams on it, **one** hold of +12/+12 opening at the first contact and rolling to the second contact + 420 ms — a continuous roll spanning both landings |
| extra trigger under an Amplified stack | four cues, four beams, 0 / 300 / 600 / 900 ms |
| a Wrench charge on top of an own Amplified stack | still ×2 (`amplified = ownStack \|\| consumeCalibration`) — two cues, and the charge is **not** spent; a Wrench charge alone is two cues and spent |
| the Shaman as a recipient on one of the fires | its cue names it; the beam leaves the slot and lands on it like any other (pinned by seed search) |
| a fire with no board Spirit between two that do | **unreachable** within one activation: Spiritbinder only buffs, so the board Spirit set cannot change between its fires. Either every fire finds one or none does; the all-none case is pinned |
| the recipient is sold before its beam | that beam is skipped; its hold fails open on the TTL (the card is gone anyway) |
| a second press mid-cascade | its own cascade starts; the first finishes on its own clock. If the second press lands on a body still waiting for a beam from the first, the store's equal-rank re-hold re-times that body's roll to the second contact (one hold per uid), so the earlier beam can arrive on unmoved numbers there; the badge still settles on the truth (review 2026-09-22, same root as the design fork below) |
| End Turn mid-cascade | the phase watcher retires every pending launch and playing def |

## The design fork to surface

**Two visibly separate rolls on one body are not representable today.** `fx/statHold.ts` keeps one hold per uid
and an equal-rank re-hold carries into a single hold with the last call's `startAt`; two naive `holdStat` calls
for two beams on one body would collapse into the sum scheduled at the *second* contact, so beam 1 would land on
unmoved numbers. The aggregated hold above (open at the first contact, roll to the last) gives two beams and one
continuous roll. Two distinct rolls need a multi-segment hold in the store — a per-uid queue of
`{delta, startAt, rollMs}` summed in `heldFor` and stepped independently. The store is shared with combat
(`Card.tsx`, `choreo/score.ts`, `useCombatReplay.ts`), so that is the owner's call, not a bolt-on here.
The same limit reaches across presses: a second press mid-cascade that lands on a body still waiting for a beam
from the first re-times that body's roll to the second press's contact (`holdStat` keeps the carried remainder
but takes the new `startAt`). The multi-segment hold fixes both.

## Tests

- `packages/sim/src/spiritbinderBeamCues.test.ts` — 13 cases: the byte-identical single fire; extra trigger →
  two cues in fire order with the ledgers adding up; two different bodies; the same body twice; Amplified; gilded +
  Amplified; extra under Amplified (four); Wrench on top of a stack (not spent) and alone (spent); the Shaman as
  a recipient; zero Spirits with four fires; the `beamedNow` predicate over every cue; a three-trigger Bloodpot.
  Sabotage-checked: 10 of 13 fail against the old fold (the other 3 pin unchanged behaviour).
- `packages/ui/src/equipBeamCascade.test.tsx` — a mounted harness with the real stat-hold store and `playDef`
  recorded: two beams on two beats with both holds scheduled to their own contact before any timer runs; the
  same-body aggregation; the single cue unchanged; a gone body skipped and never sent to the slot; a later action
  never cutting a beam; the phase flip and unmount retiring everything; and the real sim driven through `reduce`.
  Sabotage-checked: removing the stagger fails 6 of 13.
- `packages/ui/src/spiritbinderBeamGuard.test.ts` — extended: the loop must hand cascaded cues over (`!cascaded`),
  the cascade must be mounted on `run.equipFxSeq` / `run.equipFx`, the stop list must be the cascade's, the
  recipient must be measured with `restingCenterOf`, `EQUIP_BUFF_LAND_MS` (now in the module) still equals the
  def's `travelMs`, the hold still carries the cue's gain, and the loop must not measure a cascaded cue (the
  cascade does, at launch). Sabotage-checked: removing `!cascaded` fails it; so does measuring before the guard.
- Oracle: `R-PRESENT-03` in `packages/rules/src/registry/approved.ts`. The report's two rule-count lines must equal
  the MERGED registry, not this branch's alone: `main` took `R-REPORT-01` (#1632) while this branch was open, so
  after taking `main` in the count is 169 rules / 83 approved (`npm run docbot:report -- --check` is the tripwire).

## Verified in the browser

Dev server on 5218, the Scene Builder sandbox (Set 3, god rules), board seeded through `window.useGame`: Kindled
Sprite `vx` 1/3, Tidebud `vy` 2/3, Knot `vbw` 3/5 played from hand (Spiritbinder granted + selected). Measured
through `window.__fxFires` and the badge DOM; every press with two fires, all four in a row (a charge restored
between presses by clearing `ownChargeSpent`):

| press | fires (`id@ms -> target`) | badges at ~30 ms (state already committed) | badges at ~1.6 s |
|---|---|---|---|
| extra trigger | `spiritbinder@17 -> vy`, `spiritbinder@322 -> vx` | vx **1/3**, vy **2/3** (state 7/9, 8/9) | 7/9, 8/9 |
| Amplified stack (consumed) | `spiritbinder@11 -> vx`, `spiritbinder@316 -> vy` | 7/9, 8/9 (state 13/15, 14/15); a frame caught vx mid-roll at 8/10 while vy still sat at 8/9 | 13/15, 14/15 |
| extra trigger, Knot drawn first | `spiritbinder@21 -> vbw`, `spiritbinder@332 -> vx` | held; two screenshots at ~350 ms show **both beams on screen at once**, slot -> Knot and slot -> vx, badges mid-roll | 19/21, 9/11 |
| Knot alone (vx, vy sold) | `spiritbinder@18 -> vbw`, `spiritbinder@333 -> vbw` | vbw **9/11** (state 21/23); 17/19 at 532 ms | 21/23 |

No `self-buff-burst` fired in any press (the generic pulse stays suppressed on every beamed body), and
`equipment-used-up` fired once per press, on the charge edge, never per cue. The gap between fires measured
305 ± 10 ms against the 300 ms schedule (one frame of timer slack). The one thing a screenshot could not
show is beam 2 *alone*: the Browser pane throttles to ~1-2 fps while it is not painting, so the frames are
sparse; the fire log and the mounted test carry that half.
