# 2026-10-08 - Flo Rida says "permanently improve this"

**Owner ask:** "flo rida should add the word permanently to its text so it does not reset per round"

**What changed.** `b2_florida` now reads "When you summon a **Beast**, give it **+5/+5** and permanently improve
this." (Gilded: +10/+10). The +X/+X given to the summoned Beast is unchanged. Patch note in the 2026-10-08 block.
Oracle: `R-FLORIDA-01` (persistence).

**Root cause (investigation).** There was no engine reset to fix. The improve rides the per-instance
`summonBonus` counter (`onSummonTribeBuffFlat`, twin bodies in `recruit.ts` and core `factories.ts`):

- Shop, play and End-of-Turn summons write the board card directly, so they persist.
- Combat seeds the clone from the board card (`minion.ts`), the clone counts combat summons, and
  `carryBacksFor` returns it as `playerSummonBonus`. `settleCombat` (every mode, lobby included) writes it back
  onto the board card by `sourceUid`. Flo is not in `COMBAT_ONLY_SUMMON_BONUS`.
- A triple keeps the two highest copies' improvements (the universal `summonBonus` rule in `checkTriples`).

So the only defect was the text: "improve this" did not say the growth lasts. The new tests pin the behaviour so a
future change cannot quietly make it per-round: 3 rounds of Shop summons (5, 10, 15), a combat Pack Leader Echo
carrying back and feeding the next Shop grant, an End-of-Turn summon, Gilded read-time doubling, determinism, and
the live text on the shared `liveCardText` chain.

**Owner rulings (same day, same PR).**

- **In-place gild: "yes fix".** Flo Rida and Beardsley joined `GOLD_SCALED_ACCRUAL_CARDS` (recruit.ts), so `gildMinion`
  (Indy, Golden Touch, a Shop gild) halves the earned count and the unchanged x2 read gives back exactly the earned
  growth: a plain Flo at count 3 (+20) gilds to +25 (base 10 + earned 15), not +40. Because both cards improve every 1
  Beast, the step now reads the count RAW instead of `floor(count / every)` (both factory halves and
  `summonEscalatingText`), so a half-count (3 -> 1.5) stays exact. `every > 1` cards keep the floor. The combat-only
  gild (Auric Runemaster in a fight) is unchanged, like the other cards on the list.
- **Rise: "rise = reset its number since its not the same minion per se".** The combat Rise already zeroed
  `summonBonus` (R-RISE-01). The gap was the write-back: the carry-back skipped any body at 0, so a risen Flo that saw
  no Beast after rising left the board card at its PRE-combat count, while one that saw a Beast wrote the post-rise
  count. **Choice made:** the board card keeps what the risen body ends the fight with, 0 included (`risenUids` in
  `simulate.ts` lets a risen 0 through). That follows the existing precedents: the shop Rise rebuilds the board body
  from the def, and risen-body results (Second Wind) carry back to the board card. The alternative, "the board card
  keeps the original's pre-death count", is a one-line change if the owner prefers it.
- **Scope note:** the write-back fix is on the shared `summonBonus` channel, so it applies to every summonBonus
  improver that Rises (Kennelmaster, Pack Leader, ...), not only Flo and Beardsley. It never branches on a card id.
  Sergeant's `hpGrantBonus` is also zeroed at Rise and carried back behind the same `> 0` filter, so it still has the
  same gap. It is not changed here.

**Beardsley** shares the same factory and carry-back, so its improve was already permanent. Its text is unchanged
because the owner named only Flo Rida. Both gild and Rise fixes apply to it.
