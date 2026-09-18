# 2026-09-18 — Set 3 Neutrals: Shredder, Calibration Master (Calibration Wrench), Rig; Tauntbreaker out

Owner handoff (2026-09-18). Three Equipment-themed Neutrals join set 3's own list; Tauntbreaker leaves the set-1
carry-over (it stays in set 1 / set 2 and resolves globally).

## Shredder — T4 8/4, "End of Turn: give your left-most and right-most minions +4/+4 for every Equipment unused this turn"

No new per-turn record was needed: `GrantedEquipment.usedThisTurn` already existed for Rune of Amplification
("Equipment you do not activate becomes Amplified") and is set by `spendEquipmentCharge` on either the pool or
the own charge. `unusedEquipmentCount(run)` (sim/equipment.ts) counts the held entries without the mark. The
ordering that makes it correct is the one the rune already relies on: `endRecruitTurn` runs `applyEndOfTurn`
(Shredder fires) → `amplifyUnactivated` → `expireEquipmentTurn` (marks cleared). Factory
`endOfTurnBuffEndsPerUnusedEquipment`: one `captureBuffFx` wave per unused Equipment (the per-N End-of-Turn
itemisation rule), both ends in each wave, a one-minion board buffed once; golden doubles.

Live text (`shredderText` in ui/cardText.ts) prints the total right now — `{{+8/+8}}` with two unused — and the
count, on both chains: `unusedEquipment` is threaded through `ShopViewOpts` / `liveOptsFromRun` /
`offerLiveTextParams` / the board + hand `instView` calls (shop, hand, Discover, fly-ins) and `Unit.tsx`
(player side; a foe snapshot carries no Equipment). In combat the marks have expired so it reads the Equipment
the player holds going into the next turn.

## Calibration Master — T5 9/6, Equip Calibration Wrench (1): "your next Equipment activation is Amplified"

**Shape chosen: a pending COUNT beside the per-id stack, spent at activation.** The Amplified machinery keys
stacks by Equipment id (`PlayerEquipmentState.amplified`, `amplifyEquipment` / `consumeAmplified`, cap 1), and
the Wrench cannot know which Equipment the player will press next — amplifying every held id up front would
over-deliver (every one of them would trigger twice) and would collide with the cap. So `equipmentCalibrate`
banks `calibrationPending` (`armCalibration`) and the reducer's `activateEquipment` reads it exactly where it
reads the stack:

```
const ownStack = consumeAmplified(s, def.id);
const amplified = ownStack || consumeCalibration(s, def.id);
```

- `consumeCalibration` refuses `calibration_wrench` itself — the Wrench never Amplifies its own press (two
  Wrench presses bank two, not three).
- Spent only when the Equipment's own stack did not already Amplify the press, so nothing is wasted; either way
  it is one Amplification (×2 at most).
- The pending count survives the Start-of-Turn rebuild exactly like `amplified` (it is Amplification, so it
  carries) — pinned by test.
- Gilded arms 2 through `gildedParams` (the Equipment channel). An Amplified Wrench (a rune stack on it) simply
  fires the factory twice.
- The slot's blue charge (`data-fx="equipment-amplified"`) now reads `equipmentWillAmplify(run, id)` = own stack
  OR (pending > 0 and not the Wrench), so every held Equipment the charge would apply to paints blue; the
  rune-proc credit (`rune_amplification` / `rune_grand_workshop`) still keys off the own stack only.

## Rig — T3 4/4, "When you use Equipment, this gains +4/+4"

New trigger `equipmentActivated` (types.ts `GameEvent`, schema, docbot phaseRegistry = recruit, interactionGraph
= hero-power channel, lexicon "you use/activate Equipment"). Dispatched ONCE per activation by
`fireEquipmentActivated(state, equipmentId)` from the reducer's `activateEquipment` success path — after the
Equipment's own triggers, before any Counterrotation re-fire — to BOARD bodies only (a Rig in hand does not grow).
`fireEquipmentFree` (Dismantling / Counterrotation re-fires) does not dispatch it: that is not the player using
the slot. The Wrench activation counts. Factory `equipmentActivatedBuffSelf`; golden +8/+8.

## Art

`npm run art:wire --only="set-3 minions,equipment"`: Sylus (a new master, replaced in place), Venom (name match
across all cards — the set-1 card, wired from the set-3 folder), Calibration Master, the Calibration Wrench icon,
and Shredder via a new `equipmentshredder: 'n3_shredder'` alias (the master carries the working name). Every
other re-encoded webp reverted; regenerated PNGs deleted; `artNoRedundantMasters` ratchet 1243 → 1246 (+3 new
files). Rig has no master — `ART_PENDING` carries `n3_rig`.

## Tripwires moved consciously

`set3Scaffold` roster pin; `thisTurnRegistry` (n3_shredder conforms); textParse unresolved cap 89 → 90 (the
"for every Equipment unused this turn" scaler has no grammar noun); the balance bot's synthetic-fixture snapshot
(it reads the live set-3 pool); docbot contracts re-extracted, final-report headline numbers updated.
