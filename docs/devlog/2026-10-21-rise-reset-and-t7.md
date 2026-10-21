# 2026-10-21: returned bodies reset their per-combat limits; Summit T7 exceptions closed; art file cap dropped

Three owner rulings, one PR.

## 1. A Rise / Rebirth return resets every per-body per-combat limit (R-RETURN-RESET-01)

Owner: "yes", extending the Foamguard ruling (#2198, R-DWARF-1021-02) to every once-per-combat or N-per-combat limit.

- ONE reset: `resetPerCombatLimits(minion, card)` in `packages/core/src/combat/minion.ts`, called from both return
  paths in `killOrReborn` (`packages/core/src/combat/simulate.ts`, the Rebirth branch and the Rise branch), replacing
  the Foamguard-only `wardRegainFired = undefined` lines.
- Fields reset: `pummelFires` (Tauntbreaker, Impossible Todd, Kobe, Han Gover, Goldvein, Maestro Lux), `bredCount`
  (Brood Matron AND Evolving Abomination share it), `whisperCastsUsed` (Whaloo), `attackImmuneLeft` (Immune Iggy,
  Bounty Bot; re-seeded from the card through the new `freshAttackImmune`, which `instantiate` now uses too),
  `grantedRefresh` (Gryphon), `reflectFired` (Yeti), `wardRegainFired` (Foamguard).
- Immune shield FX: the engine stamps `attack.immune` off `attackImmuneLeft`, so the shield follows the reset with no
  FX change. The replay's live "N left this combat" counters (`computeFrame`, `attacksBy` / `whisperCasts`) now restart
  on every `reborn` event, so Iggy / Bounty Bot / Whaloo print the fresh count.
- Left unchanged on purpose: side-wide budgets (Deathtouched Apple, Rune of Dragonscale, Author's Hand, the hero
  Ancient Pummel latch), per-TURN latches whose combat half reads per combat (Candleback Bulwark `rubyRecvTick`
  "(2 times per turn)", Tamby `whisperCopiedThisCombat`, Reflector `reflectorSpread`), and Lord of the Risen's
  Undying regain (`undyingRegained`), which is the guard that stops Rise re-arming itself.
- Yeti: its old doc said a returned Yeti stays spent (an engineering choice, no owner rule). It now resets with the
  rest, per the general ruling. Flagged in the PR.
- Loop safety: a reset needs a spent Rise / Rebirth; nothing reset grants either back to its own body.
- Oracle: new R-RETURN-RESET-01 (keywords.ts); R-PUMMEL-02 and R-DWARF-1021-02 updated.
- Tests: `packages/sim/src/riseResetLimits.test.ts` (per family: control, Rise, Rebirth, two removals, per-life cap
  bound, every Pummel card across a Rebirth, Gryphon, the immune flag, a loop guard; 29 of 37 fail on the old engine)
  and `packages/ui/src/riseResetLiveText.test.ts` (both fail without the replay change).

## 2. Summit rift: default Discover clamp + Elevation Ritual (R-RANDOM-TIER7-02)

Owner: "yes for now, may change this". The two exceptions #2191 left on `maxTierFor(rift)` now read
`discoverElevateCeiling(state)` (`packages/sim/src/cardPool.ts`), which returns `randomTierCeiling(state)`: Tier 7 only
from a Tier 7 Shop. To revert, make that one function return `maxTierFor(state.rift)`. Note it also covers the triple
reward's "one tier up" Discover (it goes through the same default clamp), so a Tier 6 Summit Shop's triple reward is now
Tier 6. Tests appended to `packages/sim/src/randomTier7Ceiling.test.ts` (3 fail on the old clamp).

## 3. Art file count cap dropped

Owner: "we dont care about this". The file-count ceiling test in `packages/ui/src/artNoRedundantMasters.test.ts`
(last 1469, #2194) is gone; the redundant PNG master check stays. `docs/roadmap.md` updated.
