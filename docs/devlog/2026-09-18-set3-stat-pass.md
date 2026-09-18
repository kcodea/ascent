# 2026-09-18 — Owner stat pass (35 minions, 5 Equipment costs, Rising Tide / Squatimus, Pillager out of set 3) + the Refrain aimed-Shout fix

**Data-only balance directives from the owner's 2026-09-18 handoff**, applied by name (ids unchanged). Branch
`chore/set3-stat-pass-2026-09-18`.

## What changed

- **35 minion stat lines** (see the patch note for the full list). The two that touched test fixtures the most:
  Cosmo Express 1/1 → 2/1 (the Starform tests' stock 1/1 offer) and Gravestar Seer 3/3 → 0/8 (the stock "3/3
  Celestial" and now the highest-Health offer in every shop it stands in).
- **Equipment `baseCost`**: Blast Pump 1 → 2, Coffin Flop 2 → 3, Deathfibrillator 2 → 3, Comet 4 → 3,
  Prismatic Pick 2 → 1. The OWNING minion's printed `Equip X (N)` follows on Cometius, Robinson, the Blast Pump
  and Prismpick Kobolds. **EMS still prints `(2)`** — it is owned by another agent's text rewrite and was
  excluded from this pass by the handoff; that rewrite must print `(3)`.
- **Rising Tide** +4/+5 → +3/+4 and **Squatimus** +2/+2 → +3/+4 (params + plain/gilded text; both factories
  double for golden).
- **Pillager leaves set 3** (`SET1_UNDEAD_IN_SET3`); it stays in set 1 and as the Rune of Soul Taxes reward —
  `CARD_INDEX` is global, so the grant still resolves.
- "Broad Axe Brakker" on the handoff = `Broad-Axe Brakka` (`dw_brakka`); applied as 5/3.

## The bug the pass exposed — Rune of Refrain vs an aimed Shout

The B4 strategist benchmark (seed 103, set 2) went red: *"pilot strategist ended the turn with a modal open
(pendingTarget)"*. Not a pilot bug: **Rune of Refrain rolled its 25% return-to-hand at PLAY time, before a
targeted Shout opened its aim.** On a hit the body was already back in hand when the prompt opened, every
`battlecryTarget` was refused (the source is looked up on the board), the Shout was lost and the prompt stranded.
A human could escape with End Turn (`endTurnEscapesAim`); a pilot cannot. Fix: the play case and Refrain now
share one `opensBattlecryAim` predicate; an aimed Shout skips the play-time roll and `battlecryTarget` rolls
(`rollRefrainReturn`) after the Shout fires — which is what the rune's text promises ("its Shout already fired,
so replaying it fires again"). Regression test in `runes.test.ts`; Doc Bot's `ENTRY_SITES` key moved from
`reducer.ts#play#hand` to `reducer.ts#rollRefrainReturn#hand`.

## Pins moved (each carries a dated reason in place)

`set3CelestialRoster`, `set3Celestials`, `set3Undead`, `set3Dwarves`, `set3Neutral`, `set3Spirits`,
`set3RunesTrancheA`, `set2Neutral`, `equipment`, `prismaticPick`, `starform`, `set3Scaffold` (roster list),
`combatDifferential` (inert pin 3 → 2: Seedling Spirit at 2/4 now registers in a staged variant), the balance
`aggregate` synthetic snapshot (regenerated), and the Doc Bot contract registry (`contracts:extract`).
