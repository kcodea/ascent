# 2026-11-13: Set 2 rune batch, Epic tribal slice (10 runes)

One of four slices of the owner's 40-rune Set 2 batch (design: `docs/design/2026-11-12-set2-rune-batch.md`, section
"Epic, tribal"). All ten are `EPIC_RUNES`, `sets: ['set2']`, gated to their tribe. Branch `feat/set2-runes-epic-tribal`.
Oracle: R-SET2-EPIC-TRIBAL-1112-01..06 (`registry/approved/runes.ts`). Tests: `packages/sim/src/set2EpicTribalRunes1112.test.ts`.

| Rune | Tribe, cost | Built from |
| --- | --- | --- |
| Big Spender | Dwarf 4 | `spendGold` rebinds `amount` x(1 + copies) for the trigger lines only (Gold paid, Gold-spent tallies, Indy, the quest objective stay real) |
| Royal Treasury | Dwarf 4 | buy hook: run-long Dwarf meter, every 5th `maxGoldBonus += copies`; badge `x/5 · +N max Gold` |
| Feral Return | Beast 4 | SoC Rise on the left-most Beast without Rise (Rising Graves walk); +5/+5 on a Beast Rise in `runeRiseRunes` (combat-only) and `runeRiseRunesShop` (permanent) |
| Pack Tactics | Beast 4 | wind-up of `performAttack`: the target Beast's `fireFreeRally` |
| Blood Frenzy | Beast 4 | on-kill block (attacker kills an enemy): the left-most `canRally` body's `fireFreeRally` |
| Hellfire | Demon 3 | wind-up (attack half) + `runeFireOnDeath` (death half): `runeVolley(side, 1)` |
| Wildfire | Demon 4 | `runeFireOnDeath`: an enemy whose lethal hit was not an attack exchange; `runeVolley(side, 3)`, budget 3 per copy |
| Elder's Voice | Dragon 3 | `shoutFireCount` records the turn's first Shout body (`eldersVoiceUid`); SoC `fireShout` on the matching `sourceUid` |
| Vein Finder | Kobold 3 | `runeThreshold` `refresh` meter, `per: 3`, `rubyAll` (data only) |
| Gem Rain | Kobold 4 | SoC `playRubyOn(m, m, 2, permanent)` on every living friendly minion |

## New mechanism

- **Attack vs effect damage.** `exchangeHit` marks the four attack-exchange hits; `applyDamage` consumes the mark at its top
  (so anything a hit sets off is effect damage again) and records the lethal hit's kind in `lethalByAttack`, read and cleared
  at the death (`runeFireOnDeath`, called from `avengePacedDeathWatchers`, so every death path incl. Rise / Rebirth).
- **`runeVolley`**: a sourceless all-enemies volley, every hit lands before any death resolves. Sourceless on purpose: not
  Demon damage, so Ruins / Rad Rachel / Pummel do not hear it and Execute never applies.

## Judgement calls (flag to the owner)

- Big Spender doubles TRIGGERS only: the "Spend N Gold" quest objective, the Gold-spent tallies (Patch Job, Spending, the
  Wanderer) and Indy's recharge read real Gold. Copies: x3 with two.
- Feral Return gives Rise to the left-most Beast that does not already have it (a copy is never wasted).
- Hellfire's attack half fires at the wind-up (the Rally moment), so it can kill the target first and spend the swing.
- Hellfire / Wildfire are combat only (no enemies in the Shop). Pack Tactics / Blood Frenzy are combat only (no attacks
  in the Shop).
- Elder's Voice: the first Shout FIRE of the turn (played or triggered); a body that has left the board fires nothing.

## Interactions checked

- **Gem Rain + Engraving Gems**: Gem Rain's Rubies are already permanent, so Engraving adds nothing and does not claim them;
  they carry back once (pinned).
- **Hellfire / Wildfire + Ruins**: the rune volleys are not Demon damage, so Ruins pumps once per Demon SWING, never per
  Hellfire hit (pinned). Hellfire's volley is non-attack damage, so it feeds Wildfire (pinned, bounded by the budget).
  Two Hellfire boards chain Demon deaths across but stay bounded (each body dies once per life).
