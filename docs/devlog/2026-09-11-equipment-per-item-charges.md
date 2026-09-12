# 2026-09-11 — Equipment: per-item own charge + one shared bonus pool

**Owner rule change (2026-09-11), all points ruled explicitly.** Until today Equipment uses were ONE shared
player allowance per turn (`baseActivations 1 + bonusActivations − activationsSpent`): holding Bloodpot and
Titan Hammer, you could activate only one of them per turn. New baseline:

1. **Every Equipment has its OWN charge per turn.** Each held Equipment can be activated once per turn on its
   own; own charges reset at the Start-of-Turn rebuild exactly as the allowance did.
2. **Bonus charges are a SHARED pool** (Equipment Charger's Start-of-Turn grant, gilded = 2, any future
   source). Additive; per-turn only.
3. **Displayed number per Equipment = own remaining charge + the pool**, rendered GREEN while the pool is
   above zero, plain otherwise.
4. **The pool is spent FIRST.** With a pool of 1, activating A drains the pool — every Equipment drops from
   green 2 to plain 1 — and A can still fire once more on its own charge. Only at pool 0 does an activation
   spend the Equipment's own charge.
5. Swapping stays free; Gold cost, `temporaryCostReduction`, `equipmentExtraTriggers`, Choose One on
   Equipment, atomic activation, `lastUsedEquipmentId` and the rebuild's cue/selection rules are unchanged.

## What changed

- **State** (`packages/sim/src/state.ts`): `GrantedEquipment.ownChargeSpent: boolean` (per entry);
  `PlayerEquipmentState.bonusActivations` is now the shared pool GRANTED and `bonusSpent` how much of it was
  drawn. `baseActivations` / `activationsSpent` are gone. `deserialize` heals an old save (drops the legacy
  keys, fills `ownChargeSpent: false` / `bonusSpent: 0`) — a resumed run starts the turn with nothing spent,
  which the next rebuild would have done anyway.
- **Derived, never stored** (`packages/sim/src/equipment.ts`): `equipmentPool(run)` (pool remaining),
  `equipmentOwnChargeOf(run, id)`, `equipmentChargesOf(run, id)` (own + pool — the number the slot prints),
  and `equipmentUsesLeft(run)` now means **the SELECTED Equipment's charges**, so every existing reader
  (StatusBar readiness, the empty cue, tests) keeps its meaning. `spendEquipmentCharge(run, id)` is the one
  write path: pool first, else the own charge.
- **Reducer** `activateEquipment`: refuses on `equipmentChargesOf(selected) <= 0`; spends via
  `spendEquipmentCharge`.
- **Rebuild / expire**: the rebuild re-grants every entry with its own charge fresh and zeroes the pool;
  `expireEquipmentTurn` zeroes the pool and clears every own charge.
- **UI** (`packages/ui/src/StatusBar.tsx` — Mike's package, minimal edit): the `hpb-tally` gets a `boosted`
  class while the pool is above 0, styled green in `styles.css` next to the equipslot tally rule; the tooltip
  reads "N charges left for <Equipment> (K shared bonus)". The rail shows no counts today, so none were added.
- **Tests**: the "shared allowance" cases in `equipment.test.ts` were rewritten to the new law (two
  Equipments each usable once; pool spent first and it un-greens everyone; pool stacks; own charge after the
  pool; nothing carries across turns; old-save heal). `set3Undead.test.ts` and `equipRail.test.tsx` fixtures
  updated. Equipment Charger's test (`set3Neutral.test.ts`) passes unchanged: with one Frank, "own + pool"
  reads exactly as the old allowance did.
- **Docs**: `docs/GAME-RULES.md` gained an Equipment section (it had none); `equipment.ts`'s header records
  the new rule 3; a player-facing patch note was prepended.

## Naming note

The per-entry field is `ownChargeSpent`, not `usedThisTurn`, on purpose: Doc Bot's `turnScopedReset` lane
scans `state.ts` for `*ThisTurn` fields and demands a reset assignment in `reducer.ts` — but this field is
reset inside `equipment.ts` (rebuild + expire), where the rest of the Equipment lifecycle lives.
