# 2026-09-09 — Set 3 Neutrals, tranche 3: Highway Hustler, Warband Recruiter, Equipment Charger

Closes the owner's set-3 Neutral roster (tranches 1–2: `2026-09-09-set3-neutrals-1.md`, `-2.md`). Owner rulings
applied: Whiplass-o steals the highest-**Tier** Shop minion (not highest Attack), a gilded Hustler two; Warband
Recruiter's Rally both **summons** a random Rally minion and **gets** a copy in hand; "Equipment Inspector" is
renamed **Equipment Charger**; Start of Turn means "upon re-entering the shop" — the same moment the general
Equipment charge is granted.

- **Highway Hustler** (`n3_hustler`, T2 2/3) — Equip **Whiplass-o (2)**: `stealTavernMinion` grew `pick:
  'highestTier'` (left-most on a tie, no RNG spent) and `count` (gilded 2 via `gildedParams`). Deep Delve Writ's
  random steal is unchanged.
- **Warband Recruiter** (`n3_recruiter`, T4 4/5, `RL`) — `rallySummonAndGetRally` in BOTH phases: combat
  (`ctx.summon` beside itself + `ctx.grantToHand`, carried back at settle) and the shop twin for a triggered
  Rally (a fresh body beside itself + `grantMinionToHandOrBoard`). Pool = the set's drawable Rally minions
  (`isRallyDef`: keyword `RL` + an `onAttack` effect), never the Recruiter itself. Golden: twice. Own-attack gate
  like every Rally.
- **Equipment Charger** (`n3_charger`, T4 6/2) — `startOfTurnEquipmentCharge` on the existing `startOfTurn`
  trigger: `equipment.bonusActivations += count × golden`. The turn's allowance is rebuilt just before
  `applyStartOfTurn` runs, so the bonus sits on top of the base and is zeroed at the next rebuild — a per-turn
  grant, never banked.
- Art wired for all three portraits and the Whiplass-o icon (art ratchet 1110 → 1115). Registrations: factory
  union, schema, policies; contracts registry + docbot report regenerated.

Tests (`set3Neutral.test.ts`): the highest-Tier theft and the gilded double; a combat Rally that summons a Rally
minion (never itself) and grants to hand; the pool rule; the Charger's +1 (golden +2) the turn after, not banked.
