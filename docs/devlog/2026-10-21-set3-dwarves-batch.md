# 2026-10-21 - Set 3 Dwarf batch: Coin Counter, Keg Runner, Champion Inu, Foamguard

Owner ask: "create these set 3 dwarf minions and wire their art".

| Card | Id | Tier | Stats | Text |
|---|---|---|---|---|
| Coin Counter | `dw3_coincounter` | 1 | 1/3 | After you play a Dwarf, gain +1/+1. |
| Keg Runner | `dw3_kegrunner` | 2 | 3/2 | Sell: gain 2 additional Gold. |
| Champion Inu | `dw3_championinu` | 5 | 6/8 | After you cast a Dwarven Ale, give your Dwarves +2/+2. |
| Foamguard | `dw3_foamguard` | 5 | 4/8 | Taunt. Ward. The first time this loses Ward each combat, gain +10/+10 and Ward. |

All four were NEW (no card by those names or ids existed, archived or live; "Coin Counter" exists only as a
cosmetic title). Appended to `SET3_DWARVES` (the Goldilox precedent), so they enter `SETS.set3.own` with the tribe.

## How each is built

- **Coin Counter** reuses `tribePlayedBuffSelfInHand` on the `onTribePlayed` trigger. That factory used to be
  hand-only (Dozer); it now fires where its `inHand` param says the watcher lives, which is the same split
  `fireOnTribePlayed` already makes. `onTribePlayed` fires on a real play only (never a token summon), skips the
  played card itself, and tests the tribe with `defIsTribe`, so All-types minions count.
- **Keg Runner** reuses Hoard Whelp's `onSellGainGold` (amount 2, gilded 4).
- **Champion Inu** reuses Scalechanter / Earthbreaker's `spellCastBuffAll` with a new `aleOnly` param.
  "Dwarven Ale" resolved to the Ale FAMILY, `ALE_IDS` (Golden, Reinforcing, Champion's, Defensive and Bloody
  Ale): every card in the game that says "a Dwarven Ale" (Pourman's Keg, Han Gover, Brewer, Bucky) means a random
  or any one of those five, and Edward's "Dwarven Ales" multiplier is scoped to the same list.
  - Shop: `noteSpellCast` passes the cast `spellDef`, so the recruit factory checks it. Runs per cast repetition,
    so Edward's extra trigger pays again.
  - Combat: the bare `spellCast` bus emit carries no spell id, so the combat factory ignores it when `aleOnly`
    is set, and `ctx.spellResolved` (the per-repetition hook that knows the spell) dispatches the Ale watchers.
  - "Your Dwarves" includes itself, like Chef Gary Toast.
- **Foamguard** needed one new primitive, `onLoseWardOnceBuffSelfRegain` (combat-only, since Ward only breaks in
  combat). It rides `onLoseDivineShield`, which fires only on a real break (a Resilient Ward downgrade is not a
  loss), checks it is its own body, latches `wardRegainFired` on the instance (Yeti's `reflectFired` convention:
  a Risen body keeps it spent), then `ctx.buff` (+10/+10, combat-only) and `grantShield` (a `shieldUp` beat).
  Registered in `EffectFactoryId`, the content schema and the presentation policies (`foldedCue` / `react`).

## Art

All four masters matched by exact name in `C:/Game Assets/Ascent Art/Set 3 Minions/Dwarves/` and were wired with
`npm run art:wire -- --only="set-3 minions" --apply`. The run re-encoded every other Set 3 minion and found an
unrequested `u3_skeleton`; those were reverted / removed so only the four new webps ship.

## Oracle

`R-DWARF-1021-01` in `packages/rules/src/registry/approved/triggers.ts`, enforced by
`packages/sim/src/set3DwarvesBatch1021.test.ts`.
