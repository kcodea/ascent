# 2026-09-09 — Set 3 gets its Dwarves: eight new cards, fourteen carried over, and a "gains Attack" watcher

The owner's set-3 Dwarf roster (22 cards). Fourteen are set-2 Dwarves carried over **by id** as shared
definitions (`SET2_DWARVES_IN_SET3`, the Kobold pattern), the five Dwarven Ales come with them (they are
drawable spells, not tokens, so `grantRandomAle` needs them in the pool), and eight are new in
`cards/set3/dwarves.ts`. Set 3 stays disabled. Mountainbond already carried its Kobold second tribe.

## Owner rulings that shaped the engine work

- **"When a Dwarf gains Attack" (Kneel, Tankerchief)** fires in both phases, board only, once *per Dwarf*
  that gained, never for its own gain, and a watcher's grant never re-fires other watchers. Combat rides the
  existing `onGainAttack` bus emit with a re-entrancy depth guard. The shop's `fireOnGainAttack` gained a
  watcher broadcast (an allow-list, because Hunter/Sergeant's shop reactors assume the gainer is `self`),
  and both the action-boundary diff and the End-of-Turn projection now resolve their gainer list *before*
  any reactor runs, so Tankerchief's own +1 Attack is not read back as a fresh gain.
- **Striker and Kringle "repeat for every card played"** as *separate instances*. Each wave now dispatches
  the attack-gain reactors itself (`eotPerCardWaves`) and records the uids in the per-action
  `gainAttackFiredUids`, which the boundary diff and the projection skip. Net effect: Kneel beside a Striker
  pays once per card played, not once per End of Turn. Kringle's behaviour changed with it (patch-noted).
- **Tromboneer's Echo** banks Gold through `bonusEmbersNextTurn` / `playerBonusGold` — deliberately *not*
  capped at 10.
- **Pourman's Keg** casts a random Ale through `castSpell`, looped by `spellCasts` so Edward doubles it like
  a hand-cast Ale. The cast ids ride the `use` EquipFx cue (`spellIds`) and the UI replays the Ale's own cast
  presentation and clip from the slot.
- **Thymepiece** is the first Equipment that touches the clock: `bonusTurnSecondsNextTurn` →
  `bonusTurnSeconds` at the turn flip, added to the recruit timer after the practice multiplier and cap.

## Art

Seven of the eight new portraits, both Equipment icons and Rune of Living Magic wired and optimised. The
set-3 masters for the carried-over Dwarves are byte-identical to set 2's, so nothing was re-wired.
**Tankerchief has no attributed master** — only an un-named UUID file, which the art rule forbids guessing
from; it sits in `ART_PENDING` until `Tankerchief.png` lands.

## Verified

`set3Dwarves.test.ts` (each ruling above, both phases), the scaffold pin (pool order + Ale count), the seven
Doc Bot registries (policies, phase excuses, self-exclusion, this-turn, contracts, art coverage, art count),
typecheck, lint, full suite, `build:web`. Not verified live: the Keg's cast presentation in the browser (set 3
is disabled; it would need a Scene Builder session).
