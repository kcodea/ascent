# ASCENT — development log

Newest first. Each entry records **what changed and why**, plus how it was verified. The forward
queue lives in [roadmap.md](roadmap.md); high-level milestones in [../CLAUDE.md](../CLAUDE.md).

## 2026-06-24 (session 3)

### feat: Symbiote hero + 9 new minions (4 Demons, 5 Undead) — universalTribe, undeadBuyAtk, onRoll, fodderConsumedThisTurn

**Hero: Symbiote** — a new hero whose passive grants a 1/1 Magnetic token called **Symbiotic Attachment** at the start of the run and every 4 turns. The token has `universalTribe: true` — it counts as every tribe simultaneously, getting ALL tribe-conditional buffs and magnetizing onto any non-neutral minion (instead of only same-tribe hosts).

**New engine primitives introduced:**

- **`universalTribe?: boolean` on `CardDef`** — causes `isTribe()` (recruit), the `tribeAuras` loop (combat), and `buffOnSummon` / `summonBuffTribeImprove` / `deathrattleBuffTribe` / `deathrattleBuffTribeByTally` factories to match on any non-neutral tribe check. `magnetizesTo()` in reducer.ts also recognizes it (any non-neutral target is valid).
- **`undeadBuyAtk: number` on `RunState`** — the permanent recruit-time attack bonus stacked by Deathswarmer and Forsaken Weaver. Baked into newly bought undead at buy time (buy case in reducer.ts) via an "Undead Bond" tracked buff. Re-applied on Reborn and mid-combat summons via `applyUndeadBonus(m, true)` in simulate.ts (already wired in session 2). Kept separate from `undeadAttackBonus` (Lantern of Souls, combat-only) to prevent double-applying the buy-time bonus.
- **`'onRoll'` GameEvent + `applyOnRoll()`** — fires after every manual tavern refresh (roll action in reducer.ts). Used by Acid. `rollTick` per-instance on `BoardCard` tracks per-card refresh counts; reset each wave in `advanceCombat`.
- **`fodderConsumedThisTurn?: { attack; health }` on `RunState`** — accumulates raw fodder stats consumed in `consumeTavernFodder` each wave. Reset to `{ 0, 0 }` in `advanceCombat`. Passed to `simulate()` as `fodderConsumedAtk`/`fodderConsumedHp` on `CombatContext`; used by Abhorrent Horror's SoC factory.
- **`heroPowerTick?: number` on `RunState`** — tracks how many faceOmen ticks have passed for the Symbiote; every 4 ticks a new token is granted to the hand. Initial token is granted in `createRun`.

**4 new Demon cards:**

- **Acid (T6 7/7, Consume Native)** — `onRoll` / `onRollConsumeShop`: every 4 manual refreshes, consumes a random non-Fodder tavern offer and gains its stats (golden doubles). Wave-scoped via `rollTick`.
- **Trickster (T1 1/3)** — `onDeath` / `deathrattleGiveHealth`: give a random friendly minion this minion's current `maxHealth` (golden picks twice independently).
- **Demonic Anomaly (T4 4/4)** — `onPlay` / `battlecryFreeRollsAndBuffShop`: gain 2 free refreshes and buff the current tavern +3/+3 (golden: 4 refreshes, +6/+6).
- **Abhorrent Horror (T6 1/1, Start of Combat)** — `startOfCombat` / `scGainFodderStats`: gains Attack + Health equal to all fodder consumed this turn (golden doubles). SoC window so Soulfeeder + Anomaly combos can power it up.

**5 new Undead cards:**

- **Deathswarmer (T2 2/2)** — `onPlay` / `battlecryBuffUndeadAttack`: give your Undead +1 Attack wherever they are and stack `undeadBuyAtk` (golden +2).
- **Pillager (T3 3/4)** — `onDeath` / `deathrattleGrantCardToHand`: get a Gold Pouch (cardId `emberpouch`) in hand after combat (golden: 2 pouches).
- **Thundering Abomination (T5 4/7, Engraved)** — `onSummon` / `onSummonSelfBuff` (+3/+3 per friendly summon, golden +6/+6) + `summonOverflow` / `onSummonOverflowBuffTribe` (overflow summons give your Undead +2/+2, golden +4/+4). Stats carry back via EG.
- **Sergeant (T5 6/6)** — `onDeath` / `deathrattleBuffAllHealth` (give all living friendlies +2 Health, tracked in `self.hpGrantBonus`) + `onGainAttack` / `onGainAttackImproveHpGrant` (each time Sergeant gains Attack in combat, its DR grant improves by +2; golden +4). A snowball combo with Engraved-granting effects.
- **Forsaken Weaver (T6 5/8)** — `spellCast` / `spellCastBuffUndeadAttack` (combat half: living Undead get +2 Attack; recruit half: board+hand Undead get +2 and `undeadBuyAtk` stacks; golden +4).

**Token added:** `symbioticattachment` (1/1 Magnetic, `universalTribe: true`, counts as all tribes) in tokens.ts.

**Files changed:** `packages/core/src/types.ts`, `packages/content/src/schema.ts`, `packages/sim/src/heroes.ts`, `packages/content/src/cards/tokens.ts`, `packages/content/src/cards/demons.ts`, `packages/content/src/cards/undead.ts`, `packages/sim/src/state.ts`, `packages/core/src/combat/simulate.ts`, `packages/core/src/effects/factories.ts`, `packages/sim/src/reducer.ts`, `packages/sim/src/recruit.ts`.

**Verification:** `npm run typecheck && npm run lint && npm test` (325/325) + `npm run build:web` all green. No art files matched the new card IDs.

---

## 2026-06-24 (session 2)

### Fix: Crypt Drake live text · Twilight Whelp sequential spawn · Broodmother Taunt in snapshot · Golden Stuntdrake procs twice

Four correctness fixes for the Dragon tribe's newer cards:

**Crypt Drake live text in combat** — Crypt Drake's "Improve this every 3 attacks" buff has always
scaled mid-fight, but the card text never updated in the arena. Added `attackSeen?: number` to
`UnitFrame` (useCombatReplay.ts), detected by watching for the Crypt Drake's self-buff event in
`computeFrame` (its `onAllyAttackBuffAll` factory buffs ALL living friends including itself using its
own uid as source — a uniquely self-sourced buff with `attack > 0`). Added `cryptDrakeText()` to
`cardText.ts` (same pattern as `guelProgressText`): highlights the **current grant** in green and
appends `{{N to go}}` counting down to the next step-up. Wired into `Unit.tsx` text chain + memo
comparator. No new event types needed.

**Twilight Whelp sequential spawning** — the Whelp's Deathrattle (and Sylus extra procs) was
spawning all whelpling tokens in a batch loop, then flushing immediate attacks once after the full
cascade. This meant a second whelpling always overflowed if the first one was alive — it could never
get the chance to spawn into the slot freed by the first one dying. Fixed by:
1. Adding `flushImmediateAttacks?(): void` to `CombatContext` (types.ts) — wired from the local
   function in simulate.ts.
2. In `deathrattleSummon` (factories.ts): call `ctx.flushImmediateAttacks?.()` after each spawn
   when `card.attackOnSummon` is true. Each whelpling attacks (and may die) before the next one
   checks for board space. Correct: on a full board, if whelpling 1 dies → whelpling 2 spawns + attacks;
   if whelpling 1 survives → whelpling 2 overflows. Works for Twilight Whelp's own deathrattle, its
   golden (count=2), and Sylus extra procs (which call the same factory function an extra time per Sylus).

**Broodmother's Twilight Whelps missing Taunt in the summon snapshot** — `deathrattleSummon` was
granting keywords AFTER `ctx.summon()`, but the `summon` event is emitted with the snapshot taken
INSIDE `summonMinion` — so the keyword was on the live `Minion` but absent from the UI's first frame.
Fixed by adding optional `grantKeywords?: Keyword[]` to `ctx.summon` (interface + summonMinion signature),
applied BEFORE the snapshot is taken. `deathrattleSummon` now passes `grantKeywords` directly. The
Taunt emblem appears on Broodmother's spawned Whelps from frame one.

**Golden Stuntdrake procs twice** — golden Stuntdrake was only giving attack to 2 friends once (same
as non-golden except for a bigger Attack). Fixed: `avengeGiveAttack` loops `mul(self)` times (1 for
normal, 2 for golden), rebuilding `pickable` for each proc so targets are independently random. Card
text updated: "2 other friendly minions" (was "2 friendly minions"); added `goldenText` → "…twice."

Verified: typecheck clean, **325/325 tests** pass.

## 2026-06-24

### Feature: spells cast in combat now trigger Archmagus Guel (and count permanently)

Combat can now **cast spells** — Taragosa's Growth is a *real* spell cast, not just a buff:

- New **`ctx.castSpell(side)`** fires the `spellCast` trigger mid-combat (so any combat `spellCast` subscriber
  reacts) and tallies the cast on a running per-side counter. `simulate` now takes the run's **`spellsCast`**
  (seeding the player's counter so Guel's grant scales correctly) and reports the player's in-combat casts via
  **`CombatResult.playerSpellsCast`**.
- **Archmagus Guel** gained a combat half (`spellCastBuffOthers` in core `FACTORIES`, mirroring the recruit
  half): on a friendly combat spell-cast he buffs 2 other random friends +X/+X (X scales +1/+1 per 4 spells, via
  the running tally in the event payload), as a **temporary combat buff**. His existing `{on:'spellCast'}`
  effect auto-registers in combat now that the factory exists — no card change needed.
- **The counter is permanent:** `settleCombat` adds `playerSpellsCast` to the run's `spellsCast`, so spells cast
  in combat improve Guel (and every spell-count payoff) for the rest of the run.
- **Taragosa** now calls `ctx.castSpell` when it casts Growth (golden casts twice → 2 casts). Guel's card text
  updated to *"After a spell is cast (shop or combat)…"* + the live `guelProgressText` to match.
- Tests: Guel fires off Taragosa's combat cast (+1/+1) and carries back (`playerSpellsCast`); Guel scales with the
  passed-in `spellsCast` (start 4 → +2/+2 grant); `settleCombat` bumps the run's `spellsCast` (5 + 3 = 8).
  Verified: typecheck + lint + **322 tests** + `build:web`.
### Content: Nanon (T6 Mech) — a flood-or-pump Deathrattle

- **Nanon** (T6 Mech 6/6) — *Deathrattle: summon 6 Nanobots. For each one that can't fit, give your Mechs
  **+2/+2*** (golden +4/+4). New combat factory `deathrattleSummonOverflowBuff`: it attempts all 6 summons,
  counts the ones a full board rejects (reusing the existing `summonOverflow` path), then buffs every friendly
  Mech by `per-overflow × overflow-count`. **Golden doubles the buff, NOT the summon count** (per the card's
  "+4/+4" note) — so a packed board converts the wasted bodies into a bigger board-wide pump rather than more
  1/1s. The gift lasts the combat (it's a normal combat buff, not carried back).
- **Nanobot** — a 1/1 Mech token (not buyable). Art wired for both; Nanon uses the **`Nanon2`** master (the v1
  sits in the artist's `Unused/` folder).
- Tests: no-overflow (all 6 land, no buff), full-board overflow (5 overflow → +10/+10 to each Mech), golden
  (+20/+20, summon count unchanged). Verified: typecheck + lint + **312 tests** + `build:web`; cards.csv = 67
  minions / 24 spells / 10 tokens.

### Batch fixes: hero-power art + the card-tweaks pass (Hoarder / Sea Urchin / Gryphon / Frontdrake / Mama Bear)

A grab-bag of follow-ups on the 2026-06-24 content, all on `main`-resident cards.

**Art**
- Rewired **Cling Drone / Stuntdrake / Sea Urchin** from updated masters.
- Wired **8 hero-power button arts** (Cassen, Djinn, Drakko, Indy, Myra, Rohan, Soren, Warden →
  `packages/ui/src/art/powers/<heroId>.webp`). *`TitanHP.png` matches no hero (ids are warden/indy/myra/
  soren/rohan/djinn/nadja/cassen/drakko) and Nadja has no power master — both left unwired (flagged).*
- Audited art coverage: **all 99 card ids have art**; the prod build loads with every image intact (no broken
  images, the power webps fetch via the warm-art preloader).

**Content / rules**
- **Hoarder** → **Tier 2, 2/2** (was T1 1/1).
- **Sea Urchin** can no longer Discover **itself** — threaded an `exclude` id through the Discover plumbing
  (`DiscoverSpec.exclude` → `offerDiscover`), set to the source card.
- **Gryphon** now banks a free refresh **per hit, capped at 4 a combat** (was once-per-combat): `grantedRefresh`
  became a counter; golden banks 2 per hit. Text + a `max` param updated to match.
- **Frontdrake** (three interlocking changes):
  - **Djinn** (its replay End-of-Turn) no longer advances the cadence counter, but still pays off **on the turn
    it would proc** — a `replay` flag on the EOT payload skips the increment; the grant fires when
    `(eotTick + 1) % every === 0`.
  - Live text reads **“End of this turn.”** on the proc turn (else “Next in N turns.”).
  - A **triple** keeps the **furthest-along** cadence position (a copy about to proc keeps the “procs this turn”
    timing) — only the cycle position (mod `every`) is carried onto the golden.
- **Mama Bear** triple now **picks up the accrual at its current value** (the highest copy) — no reset, no
  Kennelmaster-style doubling; the bigger +6/+6 per-summon step just falls out of being golden.

**Card-text pass** — Mama Bear shows its live, golden-aware current grant (new `summonImproveText` helper, wired
into the recruit board for both the base and golden text); Frontdrake’s countdown reads naturally; Gryphon’s text
matches the new cap.

Verified: `typecheck` + `lint` + **314 tests** (+5 new: Frontdrake triple, Mama Bear triple, Sea Urchin no-self,
Djinn×Frontdrake on/off the proc turn; Gryphon + cadence-text tests updated) + `build:web` — all green. `cards.csv`
and the opponent pool regenerated (Hoarder’s tier shift moved two pool rows). *Follow-up: Taragosa should also keep
its “all stats are Engraved” line — that card lives on the open Tara PR (#16), so the text tweak goes there.*

### Content: Tara → Taragosa (the ascend dragon) — completes the 2026-06-24 batch

- **Tara** (T2 3/3, Engraved) — counts the stat-grants it's given in combat; after **20**, it **ascends to
  Taragosa** at the next settle, keeping its accumulated stats (like Spirit Pup). Built from **patterns
  already in the engine** — no mid-combat transform: `simulate` tallies grants for any card with `ascendAt`
  (a buff-count map → `CombatResult.playerAscendCount`), and `settleCombat` accumulates onto
  `BoardCard.ascendProgress`, swapping the cardId at the threshold (golden → golden Taragosa; the counting
  needs no combat factory).
- **Taragosa** (token, Engraved) — *All stats are **Engraved**. When a minion attacks, cast Growth (+3/+4 to
  your minions)* — explosive on a wide board (new combat factory `onAllyAttackCastGrowth`; golden casts it
  twice). Its card text leads with the **Engraved** line (it keeps the `EG` keyword, so it restates it like
  Tara). *Flagged:* the in-combat Growth does **not** inherit the run's spell power (combat has no access to it
  — a follow-up needing spell power passed into `simulate`).
- **Art** wired (Tara / Taragosa). Verified: typecheck + lint + **314 tests** + `build:web` all green.
- **Merge repair:** a prior `main`→branch merge had dropped the closing `},` on both **Tara** (dragons.ts) and
  **Taragosa** (tokens.ts), collapsing each into the next card (typecheck failed; the Tara/Taragosa combat
  tests failed because `taragosa` no longer existed as a card). Restored both braces.
- **Last card of the 2026-06-24 batch** — the whole set is now built across the session's PRs.
### Content: Cupcakes (Demon consume-the-tavern spell)

- **Cupcakes** (T5, 4g) — *Choose a Demon — it consumes 3 minions in the tavern.* A targeted spell whose
  chosen friendly **Demon** devours 3 *random* tavern minions through the real **Consume pipeline**: each
  meal feeds the Demon its stats × the Demon's fodder multiplier (Voracious Imp ×2) and fires its on-consume
  effects (Maw's shield, etc.), plus the UI consume-swirl. New cast factory `spellDemonConsumeTavern`
  (mirrors `consumeTavernFodder`, but eats any 3 tavern minions via the *chosen* Demon, not just Fodder via a
  random one). Fizzles on a non-Demon target (flagged).
- **Art** wired. Verified: typecheck + lint + **304 tests** + `build:web` all green; `cards.csv` = 25 spells.
- **Last one remaining:** Tara→Taragosa (the mid-combat Growth cast + combat transform).
### Content: final 3 Beasts (Sporebat, Gryphon, Mama Bear) — combat→run carry-backs + a summon engine

- **Two new combat→run carry-back channels** (`CombatResult.playerFreeRolls` / `playerSpellGrants`, mirroring
  the `fodderGrants`/`maxGoldGain` pattern) + a new **`onDamaged`** bus trigger (emitted by `dealDamage` on a
  hit that lands; a Map-miss when unsubscribed, so the hot path is unaffected).
- **Sporebat** (T4 2/6 Taunt) — *Deathrattle: add a random tavern-tier spell to your hand* (golden 2). The
  tier-bounded pick happens at settle (where the tavern tier is known); combat just banks the count.
- **Gryphon** (T3 3/6 Taunt) — *When it takes damage, gain a free refresh* — **once per combat** (a
  `grantedRefresh` flag; a Taunt soaks many hits, so per-hit would be runaway — flagged, a 1-line change to
  per-hit if wanted). Golden 2.
- **Mama Bear** (T5 6/6) — *When you summon a Beast, give it +3/+3 and improve this by +3/+3* — works **in and
  out of combat** (a `summonBuffTribeImprove` factory on both surfaces; the improve accrues in `summonBonus`,
  carried back; golden doubles; a triple resets the accrual — documented). Live card text TBD (follow-up).
- **Art** wired. Verified: typecheck + lint + **307 tests** + `build:web` all green; `cards.csv` = 65 minions.
- **Remaining (the last 2):** Cupcakes (a chosen Demon consumes 3 tavern minions) and Tara→Taragosa (the
  mid-combat Growth cast).
### Content: Twilight Whelp line + a new attack-on-summon combat mechanic (replaces Ember Whelp)

- **New mechanic — attack-on-summon.** A `CardDef.attackOnSummon` flag (+ schema); when a flagged minion is
  summoned mid-combat, `simulate` queues it (`pendingAttackOnSummon`) and `flushImmediateAttacks()` has it
  strike once, **out of turn order**, right after the spawning attack's death cascade settles — modeled on the
  existing `flushResummons()` drain (also run once pre-rotation for SC/Reclaimer summons). A Whelp's hit can
  spawn the enemy's Whelps (a chain), bounded by `IMMEDIATE_ATTACK_GUARD`; combat stays deterministic.
- **Twilight Whelp** (T1 1/1, replaces Ember Whelp) — *Deathrattle: summon a 3/3 Whelp that attacks
  immediately* (golden → 2). The **Whelp** (`whelpling`, a 3/3 Dragon token with `attackOnSummon`) is the payoff.
- **Twilight Broodmother** (T4 2/5) — *Deathrattle: summon 2 Twilight Whelps with Taunt* (golden → 4). Extended
  `deathrattleSummon` (combat + recruit) with an optional `keyword` grant for the Taunt. *(Minor: the Taunt is
  applied post-summon, so it works in combat but isn't on the summon-event snapshot — a cosmetic follow-up.)*
- **Ember Whelp removed** — it was the only `scDamage` user (the primitive stays available, untested-by-a-card
  now). Regenerated the opponent pool (`npm run pool` → 0 stale `whelp` boards, new cards included), repointed
  ~15 generic `whelp` test fixtures → `frontdrake`, dropped the SC-scorch test, deleted the orphaned `whelp.webp`.
- **Art** wired (twilightwhelp / whelpling / broodmother). Verified: typecheck + lint + **305 tests** +
  `build:web` all green; `cards.csv` = 63 minions / 24 spells / 9 tokens.
- **Hard tail remaining:** Sporebat (tier-aware spell carry-back), Tara→Taragosa (mid-combat Growth cast), and
  the gated Gryphon / Cupcakes / Mama Bear.

### Lunge feel re-tune + Tribes Choice no longer hands out neutral glue

- **Combat lunge defaults re-tuned (shipped from the live tuner).** New `DEFAULTS` in `lungeConfig.ts`:
  `windupDur 0.37`, `windupDepth 0.1`, `strikeDur 0.16`, `strikeDist 1.44`, `smackLead 0.005`,
  `settleDur 1.06`, `attackGap 0.22` — a weightier, more deliberate swing (longer wind-up + slow elastic
  settle, shorter inter-swing breather). These came from dialing the DEV Lunge tuner by eye, then committing
  the values as the new shipped defaults. **Stale-comment fix:** the file header warned to "keep
  windup+strike near 0.33s or retune `DELAY.attack`" — no longer true. Since the "damage lands at the lunge
  connection" change, the scheduler derives the attack-beat hold *live* from `windupDur + strikeDur -
  smackLead` (`useCombatReplay.ts`), so the damage float always lands on contact however these are dialed
  (the new sum is 0.53s and still connects correctly). Updated the comment to match.
- **Neutral is no longer a minion "type" for type-rolls.** Neutral cards still appear in shops/Discover as
  glue, but effects that "give a card of a type" no longer hand out neutrals. Concretely: **Tribes Choice**
  cast on a *neutral* target now fizzles (no conjure) instead of rolling a random neutral — `tribe ===
  'neutral'` short-circuits `spellGainOfTargetTribe` in `recruit.ts`. This mirrors `dominantBoardTribe`
  (Cassen / the upcoming Tribe Portal), which already excluded neutral. Audited the other type-rolls
  (Undead Army, Cassen's top-type grant) — they key off a fixed/dominant non-neutral tribe, so no neutral
  could leak there. Added a `run.test.ts` case asserting the neutral-target fizzle. Verified: typecheck +
  lint clean, 288 tests pass (run.test 199 → 200), `build:web` green.
- *(Note: "remove Ember Whelp" was deferred from this batch into the upcoming Dragons PR — `whelp` is a
  generic dragon test fixture in ~12 spots + baked into the generated opponent pool, and there's no other
  T1 dragon to repoint to until Twilight Whelp / Frontdrake exist. Cleaner to remove it there.)*
### Lunge feel retune — weightier swing, damage beat kept on contact

- **New shipped lunge defaults** (`packages/ui/src/lungeConfig.ts`), tuned by eye in the DEV Lunge tuner:
  `windupDur 0.22→0.37`, `windupDepth 0.14→0.1`, `strikeDur 0.11→0.16`, `strikeDist 1.22→1.44`,
  `smackLead 0.03→0.005`, `settleDur 0.55→1.06`, `attackGap 0.56→0.22`. Net feel: a longer, heavier
  wind-up driving a deeper lunge into the target, a slower springy settle, and a shorter breather between
  swings.
- **Kept the damage number/recoil ON contact.** The lunge now connects at `windupDur + strikeDur = 0.53s`
  (was 0.33s), so the result-beat schedule had to move with it or the damage would pop ~0.2s early (the
  regression PR #2 just fixed). Bumped `DELAY.attack` 220→353 in `useCombatReplay.ts` (353 × SPEED 1.5 ≈
  530ms = the new connection time). Added cross-references in both files so the two stay locked when retuned.
- **Tradeoff:** each attack beat is ~60% longer, so combat pacing is slightly slower — intentional, matches
  the heavier swing.
- **Verified:** typecheck + lint clean, **287 tests** pass, `build:web` succeeds, app boots clean (no console
  errors); feel confirmed live in the arena. localStorage tuner overrides still win for a dev who has saved
  values (hit Reset in the panel to fall back to these new defaults).
### Content: 4 new Dragons (Frontdrake, Supporter, Bronze Warden, Stuntdrake)

- **+4 Dragons** (Dragon pool 6 → 10) — purely additive. *Ember Whelp stays for now;* its removal was
  pulled out of this PR and folded into the upcoming Twilight Whelp PR, where the new "whelp" token replaces
  it as the generic T1-dragon test fixture (it's used in ~12 spots + baked into the opponent pool) and the
  pool regenerates once. The four cards:
  - **Frontdrake** (T1 2/1) — *Every 3 turns, get a random Dragon* (tier ≤ tavern, golden → 2). New recruit
    primitive **`endOfTurnGrantTribe`** + a per-card **`BoardCard.eotTick`** counter that advances once per
    turn (on Chronos proc 0, so Chronos adds extra grants on the cadence turn without speeding the count up).
    The card shows a live green **"Next in N turns"** countdown (`cadenceProgressText`, wired into Recruit's
    text chain).
  - **Supporter** (T2 2/3, Rally) — *Rally: give 2 friendly Dragons +1/+2* (golden +2/+4). Extended the
    previously-unused combat **`rallyBuff`** factory with an optional `tribe` filter + `count` cap (random
    pick among eligible). Backward-compatible (no params = buff all friends, the old behavior).
  - **Bronze Warden** (T3 3/3) — a vanilla **Divine Shield** wall (data only, keyword-only text).
  - **Stuntdrake** (T5 3/7) — *Avenge (3): give this minion's Attack to 2 friendly minions*. New combat
    primitive **`avengeGiveAttack`** (hands self's *current* Attack to N random friends; a golden's bigger
    Attack flows through automatically).
- **Art** wired for all four (masters → `npm run optimize-art` → webp; confirmed bundled by `build:web`).
  Also hardened the optimizer to skip a missing sub-dir — it crashed on an absent `art/effects/`, which the
  next art-wiring step in this content batch would have hit too (one-line `existsSync` guard).
- **Shared types/schema:** `EffectFactoryId` (core) + the zod `EffectFactoryIdSchema` (content) gain
  `endOfTurnGrantTribe` + `avengeGiveAttack`; `BoardCard` gains `eotTick?`.
- **Tests:** Supporter rally + golden rally and Stuntdrake's attack-gift (combat, `simulate.test.ts`);
  Frontdrake's 3-turn cadence (`run.test.ts`, driving `applyEndOfTurn` directly); `cadenceProgressText`
  countdown (`cardText.test.ts`). `cards.csv` regenerated (Dragon 6 → 10; 57 minions). Verified: typecheck +
  lint + **292 tests** + `build:web` all green.

### Stop honoring `prefers-reduced-motion` (it made the game unreadable)

- **The game now animates the same regardless of the OS "reduce motion" setting.** Removed the global
  `@media (prefers-reduced-motion: reduce)` rule in `styles.css` that near-instant'd (`animation-duration:
  0.001ms !important`) *every* animation. The problem: ASCENT's animations carry essential **information** —
  damage numbers, death pops, the Fodder-consume swirl, buff flashes — not just decoration. With reduce-motion
  on, all of that flashed-and-vanished, so the game looked broken ("no animations, fodder doesn't work, dmg
  numbers don't show"). This was the cause of a co-dev's "nothing works" report — he had the OS setting on; it
  reproduced on dev + itch for him, but not for anyone without the setting. Replaced the rule with a comment
  documenting the decision (and how to revisit it properly: calm *motion*, never suppress the informational
  floats). Perf on low-power machines stays handled the right way — compositor-only transform/opacity, no
  paint-property loops (see `docs/performance.md`, updated). Verified: rule gone from the loaded CSS (0
  matches), app boots clean.

### Version badge (bottom-right, above the gear)

- **In-game build badge.** A small `v{version} · {sha}` label sits just above the settings gear (bottom-right,
  scales with `--u` so it always clears the gear). Sources: the package version (bumped `0.0.0 → 0.1.0`) and
  the **short git SHA**, both injected at Vite config load via `define` (`__APP_VERSION__` / `__BUILD_SHA__`;
  SHA falls back to `dev` if git's absent). Hover shows the full `ASCENT v0.1.0 · build <sha>`. The SHA makes
  it unambiguous *which* build is live — directly addresses the "is this last night's version?" confusion.
  Ambient types in `packages/ui/src/buildinfo.d.ts`. Verified live: badge reads `v0.1.0 d2c8bf5`, above +
  right-aligned to the gear, no console errors.

### Damage lands at the lunge connection (combat-feel) — first PR through branch protection

- **The hit now reads on contact.** When a minion attacks, the sim emits the `attack`, then its on-attack
  effects (Better Bot's mech-buff, a Rally pulse / rally-summoned token), *then* the damage. The replay used
  to make a separate beat out of those buffs, so the damage number/recoil landed a beat **after** the buff
  animation — disconnected from the lunge that already connected. Now an `attack` beat **absorbs** its
  on-attack flash events (`buff`/`rally`/`summon`/`reveal`/`improve`) into the **wind-up**, so they animate
  while the attacker leans in and the **damage beat is the very next one — landing right at the lunge's
  contact frame** (where the smack already fires). Pairs with the earlier audio fix (smack only from the
  lunge), so sound + number now hit together.
- **How (safe by construction):** extracted the beat builder into a pure, tested module
  (`packages/ui/src/combatBeats.ts` — `buildBeats` + `RESULT_TYPES`). The change only alters how events are
  **grouped into beats**, never their order — so `computeFrame` (which folds the log in order to derive HP)
  is unaffected; final and intermediate state are identical, only the beat boundaries (and thus timing)
  move. 5 unit tests (`combatBeats.test.ts`) lock the grouping: plain attack, attack+buff, a rally+summon+buff
  run, a standalone buff run, and an SC cast.
- Verified: typecheck + lint clean, **287 tests** (5 new), app boots clean (no console errors). The *feel*
  across rally/cleave/windfury/deathrattle is for live review on this PR.
- **Process first:** this is the **first change through the new branch-protection flow** —
  `feat/damage-at-connection` → PR → CI gate → review, no direct push to `main`.
- **Follow-up (review feedback — same PR):** grouping wasn't enough; the damage was still late and dying
  units showed no number. Three fixes: **(1)** the replay clock now hands the wind-up beat off to its impact
  **the moment the lunge connects** — the scheduler holds an `attack` beat only for `windup+strike−smackLead`
  (read live from the lunge config) instead of the next beat's DELAY, so the damage number/recoil land on
  contact (was ~360ms late, because the wind-up beat had been held for the *dmg* beat's DELAY ≈ 690ms while
  the lunge connected at ~330ms). **(2)** floats **linger longer** (`FLOAT_MS` 1450→1950, `floatup` 1.4→1.8s,
  longer readable plateau). **(3)** **killing-blow damage now shows on death** — an in-unit float was clipped
  as the dying unit collapses (`.unit.dying` width→0); damage floats on units that die this beat are now
  captured at the unit's screen position and rendered in a **board-level overlay** (`DeathFloat` →
  `.deathfloat`) that outlives the unit and lingers. Verified: typecheck + lint + 287 tests + clean boot;
  feel is for live review.
- **Follow-up 2 (review feedback):** with damage now on contact, attacks fired too quickly and floats
  lingered too long. (a) **Inter-attack breather restored, correctly + tunable.** The old `+200` breath was
  applied to the wrong beat (off-by-one) and the connection fix dropped it; now, when an impact beat is
  followed by an attack, the scheduler adds a real pause before the next swing. It's a new **`attackGap`**
  knob in the lunge config + DEV Lunge tuner (default 0.25s) so the cadence is dialable by feel. (b) **Linger
  trimmed:** `FLOAT_MS` 1950→1500 + `floatup` 1.8→1.4s; **death floats clear faster** (`DEATH_FLOAT_MS` 1000,
  `.deathfloat .float` ≈0.9s) so a lone killing-blow number over a vanished unit doesn't hang.
- **Follow-up 3 (review feedback):** (a) **`attackGap` default → 0.56s** (tuned by ear — a clear beat between
  swings). (b) **Audio burst on tab-in fixed:** the beat clock now **pauses while the tab is hidden**
  (`visibilitychange` → a `hidden` gate on the scheduler) so beats + GSAP lunges don't pile up in the
  background and fire as one loud burst on return; `sfx` playback is also suppressed while hidden as a
  backstop. (c) **Final kill no longer cut off:** the replay reports `done` only after a short hold
  (`FINAL_HOLD_MS` 900ms) on the last beat (`done` now lags a `finished` flag) — so the killing blow's death
  collapse + damage float fully play before cleanup + the round-end UI (Climb On / settleCombat) take over.
  Verified: typecheck + lint + 287 tests + clean boot; combat feel for live review.

### Two-dev setup (CI + collaboration rules) · combat damage audio (SC zap, no default smack)

- **CI gate for two-dev work.** Added `.github/workflows/ci.yml` — on every PR (and pushes to `main` as a
  safety net) it runs typecheck + lint + test + `build:web`, so a broken build is unmergeable. Added a
  **Collaboration (2 devs)** section + **ownership map** to `CLAUDE.md` (the sim↔presentation seam: Kevin owns
  `core`/`content`/`sim`/`tools`, Mike owns `ui`/`apps/web`; shared boundary = `core/types.ts` + package
  entrypoints), plus the hot-file list to serialize. NOTE: GitHub **branch protection isn't available on this
  private repo without Pro** (or making it public) — until then "never commit to main" is a convention CI +
  review back up, not a hard gate. Owner action items in the session summary. **Update:** owner invited the
  2nd dev (Mike) + is upgrading to GitHub Pro to enable branch protection. Added **`ONBOARDING.md`** (repo
  root) — a step-by-step clone → install → verify → rules guide written for Mike's Claude Code to execute;
  linked from `CLAUDE.md` (Collaboration) + the README.
- **Combat damage audio reworked (notes 1 + 2, audio half).** The physical "smack" now comes ONLY from the
  attack lunge's GSAP timeline (at the contact frame) — the beat-driven `dmg` smack was removed entirely. So
  (a) **Start-of-Combat damage no longer smacks** — Ember Whelp & co. play a new `sfx.cast` zap on the `sc`
  beat instead; (b) the **double-smack is gone** — when an on-attack buff (Better Bot/rally) emitted a `buff`
  event between the `attack` and its `dmg`, the old positional guard (`beats[beatIdx-2]`) missed and the dmg
  beat fired a second, late smack; with no beat-driven smack at all, the lunge is the sole, on-contact smack.
  Non-attack damage (deathrattle AOE, poison) is briefly silent until it gets its own cue (tracked in
  `docs/sfx-events.md` gaps) — deliberately not defaulting to smack, per the note.
- **Deferred (note 2, visual half):** making the damage *number/recoil* land at the lunge contact (not a beat
  later when on-attack buffs interleave) is a replay-pipeline reorder — `computeFrame` derives HP by event
  order == beat order, so it needs an event-level reorder + live verification across rally/cleave/windfury/
  deathrattle. Queued as a focused next pass.
- Verified: typecheck + lint clean, 282 tests pass, live load clean (no console errors).

### DEV panels draggable + resizable

- **The SFX mixer + Lunge tuner can be moved and resized.** New shared `useDraggablePanel` hook: drag by the
  header (persists `left/top`), and the browser's native `resize: both` corner grip (persists `width/height`
  via a ResizeObserver). Position is React-controlled; size is owned by the browser and only *recorded* (never
  re-applied by React), so the resize grip and React never fight. Both persist to
  `localStorage['ascent.devpanel.<sfx|lunge>']` and restore when the panel re-opens (off-screen positions are
  clamped back in). DEV-only, so it ships nowhere. Verified live: a simulated header drag moves the panel by
  the exact delta and persists; `resize: both` active on both panels; no console errors.

### UX pass: hero-power line from the button · Bane purple haze · lunge dev tuner · player-name pill · dev cluster

- **Hero-Power aim line now starts at the button.** The targeting line was anchored to the hero *frame*
  (`.statusbar .hero .f`); it now anchors to the hero-power *button* (`.statusbar .heropowerbtn`, frame
  fallback), so the line draws from the thing you pressed. Verified the selector resolves live.
- **Bane's proc is a purple haze (not the orange flame).** The battlecry-trigger flash now renders per card:
  Karwind's Dragons keep the orange `karwindflame`; Bane + the board Fodder it enchants get a soft purple
  `fodderhaze` (one-shot opacity/transform glow swelling from under the card — the Fodder/Demon colour,
  matching the consume swirl & Ritualist wash). The `karwind` Card prop became `'flame' | 'haze' | false`.
- **Combat lunge dev tuner + slight default tweaks.** Extracted the lunge tunables into
  `lungeConfig.ts` (persisted to `localStorage['ascent.lunge']`); `playAttackLunge` reads it at call time.
  A DEV `LungeTuner.tsx` panel (🗡️, bottom-right) sliders wind-up dur/depth, strike dur, lunge distance,
  smack lead, settle — Copy/Reset; applies to the next attack. Shipped defaults nudged per the ask: **smack
  ~30ms earlier** (`smackLead 0→0.03`, fired before the strike completes), **wind-up longer** (0.2→0.22),
  **strike faster** (0.13→0.11), **lunge further** (1.15→1.22). Wind-up+strike still sums to ~0.33s, so the
  result beat still lands on contact (no `DELAY.attack` retune needed).
- **Player name moved to its own pill** below the ASCENT/Wave boxes (left), mirroring the opponent frame
  (below-right) — out of the ASCENT wordmark box. Absolutely positioned so it never reflows the top row.
- **DEV tool buttons clustered bottom-right** next to the settings gear: `[🗡️ lunge][🔊 sfx][⚙ gear]`
  (the SFX mixer moved from bottom-left). Panels open above, anchored right.
- Verified: typecheck + lint clean, 282 tests pass, live — no console errors, player pill + dev cluster
  positions confirmed, hero-power button + lunge-tuner sliders (new defaults) present.

### Art preload (itch pop-in) · Soulsman combat proc · Bane proc flash · Fodder consume never lost

- **Art preload kills the cold-load pop-in.** Card/hero/power webps were only fetched when an `<img>` first
  rendered, so on a cold load (esp. the itch CDN) each card's art "popped in" a beat after its frame.
  `art.ts` now exports `warmArt()` — on idle (`requestIdleCallback`), it kicks off a fetch + `decode()` of
  every bundled art URL into a detached `Image`, so the cache is warm before the first shop. Called once from
  `Game`'s mount effect; idempotent + non-blocking (never competes with first paint). Platform-independent —
  fixes the web + itch-embed build, not just a future desktop wrap. Verified live: **157 webps fetched on the
  title screen** (the whole set), no console errors.
- **Soulsman is now tracked + felt in combat.** Its Avenge (every 4 friendly deaths → +1 max Gold, golden
  +2) raised max Gold silently — no event, no cue. Added a `maxGold` combat event (core: emitted from
  `avengeMaxGold`, player-side only — enemies have no economy) so the UI replay can show it: a gold pulse
  (`goldproc`) on Soulsman, a "+N max gold" gold float, a rising coin-shimmer `sfx.maxGold`, a narration line,
  and a **Max Gold** section in the per-fight Procs report. Determinism preserved (it only adds log entries;
  run state was already counting the gain). Test extended: the 8-deaths case now asserts 2 `maxGold` events
  (player, +1 each).
- **Bane shows a proc.** Bane (a Battlecry trigger → enchant the Fodder card type run-wide) had no visible
  cue — with no Fodder on the board, nothing happened on screen. `onBattlecryBuffFodder` now flashes Bane
  itself (and any board Fodder it just buffed) via the existing battlecry-trigger flame flash. Test asserts
  `karwindFlash` includes Bane after a Battlecry resolves.
- **Fodder consume animation never gets lost.** The swirl effect marked its sequence "seen" and then bailed
  if the tavern row wasn't in the DOM yet — so a consume that procced before layout was lost forever (the seq
  never replays). It now **retries across frames** (`requestAnimationFrame`, up to ~40) until the tavern is
  measurable, then plays; cleanup cancels the rAF + timers. No more dropped swirls.
- Verified: typecheck + lint clean, **282 tests pass** (Soulsman + Bane assertions added), `npm run perf`
  within budget, live load clean (no console errors, full art set preloaded).

## 2026-06-23

### Tavern Up sourced clip · hardened board export for the itch iframe · SFX reference refresh

- **`tavernupgrade` clip wired.** The Tavern Up action now plays the sourced `tavernupgrade.mp3`
  (`packages/ui/src/audio/`), with the old rising-triad synth chord kept as the decode/missing fallback —
  same pattern as every other sourced clip. Registered in `SAMPLE_VOL_DEFAULTS` (vol 0.50) + `SFX_PREVIEW`,
  so it's tunable in the dev mixer. The `upgrade` action already dispatched `sfx.upgrade()` (store.ts), so no
  trigger change. Verified live (fresh server → the dev mixer lists `upgrade` as the 13th sourced key; no
  console errors). That's **14 logical sourced sounds / 17 mp3 files** now wired.
- **Board export hardened for itch's iframe.** itch embeds HTML games in a sandboxed iframe that can silently
  block file downloads. The Export-my-boards button now (a) appends the `<a>` to the DOM before `click()` and
  delays `revokeObjectURL` (a detached anchor or immediately-revoked URL drops the download in some browsers /
  the sandbox), and (b) detects an iframe (`window.self !== window.top`) and, when framed, tells the friend to
  **open the game fullscreen on itch** (the ⛶ button — loads first-party, where downloads work) if no file
  appeared. Import (file picker) already works inside the iframe. Empty-library guard moved up so "no boards
  yet" no longer triggers a junk download.
- **`docs/sfx-events.md` rewritten** to denote **all current + potential SFX**: a full per-key table (sourced
  vs synth, file(s), default vol, trigger), the 17 sourced files on disk, the synth keys that want a real
  sample (prioritized), and the still-silent combat/recruit events (with the top "missing sound" gaps). The old
  doc predated most of the wired clips (it still called everything "synthesized placeholders").

### Orangez's real boards baked into the pool · frozen-tavern ice effect · pulse cue

- **First real friend boards shipped.** Imported Orangez's export (300 boards / 22 runs), **filtered out the
  one test run** (a single injected board at wave 20 — kept only multi-board runs that terminated in a
  win/lose), retagged as `origin:'friend'`/author Orangez → `docs/board-exports/orangez.json`. `npm run pool`
  now bakes **323 boards across waves 1–20** (was 196, waves 1–9) — Orangez's runs fill the high waves the bot
  can't reach. Also taught the pool tool to **prefer real boards** when capping per wave (`curateWave`: real
  first, then house). Verified live: at wave 12 the pool serves an "Orangez" board.
- **Frozen-tavern ice effect.** When you freeze the tavern, each held shop card ices over — an icy-blue
  frosted overlay (`[data-zone="tavern"].frozen .card::after`) that **ramps up** from the top edge down
  (clip-path reveal) with a slight per-card stagger so the freeze sweeps across the row. One-shot (not a
  loop → cheap); recruit-only so combat units never frost. Verified live (computed `::after` = the frost +
  `frostin` animation).
- **`pulse` cue wired** — choosing a hero (the Choose button) and pressing the hero-power button both play
  `pulse` (replacing the old `temper` placeholder; the button press is the cue, so no per-action sound). Added
  to the tunable registry + dev mixer.

### Matchmaking back to WAVE-based + dev SFX mixer + tunable clip volumes

- **Reverted matchmaking from wins → WAVE.** Win count isn't development stage: a player at wave 5 with 0 wins
  (a losing run) has a developed Tier-2+ board but still "0 wins", so win-matching dropped that board on a
  turn-1 player (faced T2 units on wave 1). `pickOpponent` matches by **wave** again (same amount of shopping),
  still preferring real player/friend boards and using power as the fairness tiebreak. `nextOpponent` passes
  `s.wave`. (`wins` stays on the snapshot as harmless metadata.) Verified live: at wave 1 the pool serves a
  Tavern-tier-1 board, not an over-developed one.
- **Tunable sourced-clip volumes + a dev SFX mixer.** Per-clip gains moved into a registry (`sampleVol`,
  persisted to `ascent.sfxvol`); `SfxMixer.tsx` is a DEV-only floating panel (🔊 button, bottom-left) with a
  slider + ▶ preview per clip and a **Copy values** button (grab the JSON → paste back → it becomes the shipped
  default in `SAMPLE_VOL_DEFAULTS`). Stripped from production. So audio levels can be dialed in by ear without
  code round-trips.
- **reorder clip −55%** (0.5 → 0.225, the shipped default).
- Verified: typecheck + lint clean, 282 tests pass (pickOpponent test now asserts wave-matching), no console
  errors; live (mixer renders all 7 clips, wave-1 serves a tier-1 board).

### Audio: warm-up fix + sourced buy/cardlanding/discover/taunt/reorder cues

- **Fixed "sourced SFX only kick in after a hero power."** The audio context + sample decoding only started on
  the first SOUND, so the first buy/play was a silent/synth fallback while things warmed up. Now a one-time
  first-gesture listener (any click/keypress) creates + resumes the context and prefetches every mp3, so clips
  are decoded and ready by the first buy. Verified live: a single pointerdown prefetches all 11 samples.
- **New sourced cues wired:** `buy` → random `buy1`/`buy2`; a MINION landing → `cardlanding` (distinct from a
  SPELL cast — `castSpell`, its own sound, per-spell later); a **Discover** opening → `discover` (fires when an
  action sets `run.discover`); a friendly minion **GIVEN Taunt** → `taunt` (a board minion that gains the `T`
  keyword it didn't have — skips minions bought/played already-Taunt); a card **reordered** (warband/shop) →
  `reordercard`. All with synth fallbacks. (SFX live in `packages/ui/src/audio/`, lowercase — the only folder
  the glob reads; adding files needs a dev-server restart.)
- Verified: typecheck + lint clean, 282 tests pass, no console errors.

### Win-based matchmaking + friend board import/export + player name in the HUD + audio

The "real player boards" loop, end to end: name yourself, face boards by win count (real ones preferred),
and share boards with friends via a file.

- **Win-based matchmaking.** `BoardSnapshot` gains `wins` (combats won before that board fought); `pickOpponent`
  now matches by WIN COUNT (you face a board at the same point in its climb, not the same wave), then **prefers
  real player/friend boards** over house/synthetic, then biases toward similar power for a fair fight. Widens
  to the closest win count if none match; null only on an empty pool. `nextOpponent` passes the player's wins.
  Verified live: at 1 win, the pool serves the captured player board ("by TestPlayer · date") over 24 house
  boards. Pool regenerated so committed boards carry `wins`; legacy boards fall back to `wave`.
- **Friend import/export** (Settings → Shared Boards). Export downloads a shareable `{author, exportedAt,
  boards}` file; Import reads a friend's file, tags the boards `origin:'friend'` (+ their name/date), merges
  into your library (deduped) AND registers them live — you face them immediately, no reload. Same shape works
  in `docs/board-exports/` for `npm run pool`. Verified live: a friend file imports, tags `friend`, persists.
- **Player name in the top-left** HUD (under the ASCENT wordmark), in the accent colour.
- **Audio.** `buy` → random sourced `buy1`/`buy2`; a MINION landing → `cardlanding` (at the smack level), kept
  distinct from a SPELL cast (`castSpell`, its own sound — per-spell sounds later). All synth-fallback until the
  clips are dropped in `packages/ui/src/audio/` (`cardlanding.mp3`, `buy1.mp3`, `buy2.mp3` — not yet present).
- Verified: typecheck + lint clean, 282 tests pass (win-matchmaking test: matches by wins, prefers real,
  widens, null on empty pool); live (name top-left, win-matched real board served, import round-trip).

### Power framework — simulate-derived board rating (Stage 3 foundation)

The basis for true-strength matchmaking + power-band synthesis. `power = Σ(attack+health)` ignores keywords
and synergy; the new rating is a real fight.

- **`rateBoard(board, tier)` → 0..1** (`packages/sim/src/rating.ts`): the fraction of a fixed 8-rung
  CALIBRATION GAUNTLET (weak 2×1/2 → strong 7×9/16 DS+Windfury) the board beats in `simulate()` (draw =
  0.5). Keyword/synergy-aware (DS, Windfury, Venomous, Reborn, deathrattles, golden ×2 all move it),
  deterministic (fixed gauntlet + seed), ~8 sims/board. `ratingBand(r)` buckets it into `BAND_COUNT` (8)
  bands for matchmaking + synthesis targeting.
- **Baked into the committed pool.** `BoardSnapshot` gains optional `rating`; `npm run pool` computes it for
  every board and reports the band distribution. First bake: the bot pool (waves 1–9) spreads across bands
  0–3 — the gauntlet's top rungs are calibrated for much stronger boards, so high bands await real player
  boards from deep runs. Optional + back-compat (runtime/legacy boards lack it → fall back to `power`).
- Tests: rating is monotonic in strength, deterministic, 0 for empty, and **DS+Windfury rate higher than the
  same raw stats** (proving it captures what Σ power can't). 199 sim tests pass.
- **Queued next (the rest of the power framework):** (a) flip matchmaking to rating-based (rate the player's
  start-of-turn board, serve the closest-rating opponent within the wave) — balance-affecting, so it gets a
  focused validation pass; (b) **synthesize boards within a band** (`origin:'synthetic'` — mutate/recombine
  real boards, keep those whose `rateBoard` lands in the target band) to fill sparse bands/high waves; (c)
  in-game friend export/import UX.

### Committed opponent pool + board attribution (`npm run pool`) — real boards ship with the game

Until now, captured boards lived ONLY in browser `localStorage` (`ascent.boards`, written when a run ends);
the committed `OPPONENT_POOL` was empty and the app loaded a bootstrap pool recomputed from seeded bot runs at
every launch. So no real boards shipped, and nothing carried provenance. This lays the foundation for the
intended "you → friends → computer-built" opponent pool with attribution.

- **Schema — provenance.** `BoardSnapshot` gains `origin` (`'self' | 'friend' | 'house' | 'synthetic'`),
  `author` (display name), `capturedAt` (ISO date). All optional + back-compat (missing → 'house'); the
  wall-clock date is stamped by the UI/tool layer, never inside the pure `snapshotBoard`.
- **`npm run pool`** (`packages/tools/src/build-pool.ts`) bakes a curated `BoardSnapshot[]` into
  `packages/sim/src/opponentPool.data.ts` (loaded at startup via `OPPONENT_POOL_DATA`). Sources: house bot
  boards (60 seeded runs × every hero, deterministic, tagged `origin:'house'`) + any board exports dropped in
  `docs/board-exports/*.json` (your localStorage export and friends' boards, with name/date). Curation: drop
  empty/unservable, dedupe, cap per wave with an even power spread. First bake: **196 boards, waves 1–9** (the
  greedy bot rarely survives past 9 — high waves still fall back to procedural until real player boards +
  synthesis fill them). `docs/board-exports/README.md` documents the export/contribute flow.
- **Attribution wired end to end.** A persisted player **Name** (Settings → Player, `ascent.playername`);
  `saveRunBoards` stamps your runs `origin:'self'` + name + date; the opponent frame shows "by {author}" (self/
  friend) or "House board" / "Forged board", with the date. Verified live: the committed pool serves a real
  board at wave 1 ("Djinn … House board · {date}"), and a finished run stores `origin:'self', author, capturedAt`.
- Replaced the runtime `buildBootstrapPool()` startup call with the committed `OPPONENT_POOL_DATA` (+ this
  browser's own captured boards); `registerOpponents` still drops any board referencing a removed card.
- Verified: typecheck + lint clean, 279 tests pass; live (pool serves attributed boards, name persists, self-
  capture stamps provenance). **Next stages (queued):** simulate-derived strength rating + power bands, then
  computer-built boards synthesized within a band, then in-game friend export/import UX.

### Perf: the per-second turn timer no longer re-renders the whole board (heavy-board frame drops fixed)

Follow-up to the perf pass — the user still felt frame drops on a full wave-14 board (golden + Divine-Shield
Mechs) on the dev server. **Measured it in-browser** (injected a 17-card heavy board via `window.useGame`,
sampled `requestAnimationFrame` deltas): at rest the board was fine, but a **full Recruit re-render cost
~8–17ms** (p95 16.7ms — at the 60fps budget), **doubled by StrictMode in dev**. The culprit: `seconds` (the
round timer) lived in `useState` **inside Recruit**, so its tick re-rendered the entire recruit tree — board +
hand + shop, ~17 cards — **once per second**. On a slower machine that ~17ms doubles to a dropped frame every
second: the "frame droppy" feel.

- **Fix — external turn clock.** Moved the countdown to a tiny external store (`turnClock.ts`, via
  `useSyncExternalStore`). Now only the two small displays subscribe to live seconds (`useTurnSeconds` → a new
  `<TurnRing>` + `<TurnRope>`); Recruit subscribes only to the derived `timeUp` boolean (`useTurnTimeUp`), which
  flips once per turn. The per-second tick reads/writes the store directly (no React state), so it never touches
  the card tree. The countdown is a self-scheduling loop (no longer keyed on `seconds`); the reset is a
  `useLayoutEffect` so the clock is full before first paint (no "0"-flash).
- **Verified live** (same heavy 17-card board, timer actively ticking 65→62 over 3s): **avg 4.17ms, max 4.3ms,
  zero frames over 16.7ms** — vs. before, avg 8.3ms with periodic ~12.5ms spikes from the per-second re-render.
  Timer still counts down, the ring/rope update, and `timeUp` still locks actions at 0. 279 tests pass,
  typecheck + lint clean.
- **Context:** the dev server (5173) is the worst case (StrictMode double-render + unminified Vite); the packed
  build is materially smoother. This fix helps both, and removes the periodic dev hitch outright.
- Documented the pattern in `docs/performance.md` (isolate high-frequency state from large trees). Left as
  documented low-pri (measured negligible — 0 dropped frames even on the heavy board): `endpulse`'s small
  no-blur box-shadow pulse + the rope's `drop-shadow` loops.

### Performance north star: glow repaint fix + render-cost audit + `npm run perf` · win = 15 WON combats · Front to Back improve scales

**Performance is now the project's stated north star** (CLAUDE.md + new `docs/performance.md`): the game must
feel snappy at all times; a frame drop is a defect. Two adversarially-verified audit passes (a UI-render pass
and a cross-app pass — ~40 candidate findings, 19 confirmed) drove the fixes below.

- **The frame-drop culprit (magnetic-heavy boards): animated `box-shadow` glows.** `dsglow`/`rebornglow`/
  `venomglow`/`tripglow`/`tripleglow` animated box-shadow **blur+spread** on an infinite loop, forcing a full
  repaint of each glowing card every frame. Divine Shield is the canonical Mech magnetic, so "tons of magnetics"
  = a board of `.dscard` cards each repainting 60×/sec, *during the combat replay too* (shared `.card`). Fix:
  the card keeps a **static** halo; the breathing pulse moved to an **opacity-only `::before`** layer
  (`@keyframes kwglow`, `will-change: opacity`) — compositor-only, zero per-frame repaint. Verified live: a
  shielded card's `::before` runs `kwglow` and no longer paint-flashes at rest.
- **Combat re-render: memoized `Unit`.** `Unit` wasn't `React.memo`'d and rebuilt a fresh `view` object each
  render, so all ~14 units reconciled every beat. Now `React.memo` with a **value** comparator (the combat
  frame rebuilds fresh `UnitFrame`s each beat, so reference compare misses), and `floatsFor` hands out a shared
  `EMPTY_FLOATS` for float-less units so their prop stays referentially stable. Only changed units re-render.
- **Reducer: stop deep-cloning the event log.** `reduce()` `structuredClone`d the whole `RunState` — including
  `lastCombat` (the entire prior fight's event log) — on every dispatch, though the reducer never mutates it.
  Now `lastCombat` is shared by reference; the per-dispatch clone drops ~80–90%. `npm run perf` confirms a
  populated-`lastCombat` dispatch stays ~0.014ms.
- **Drag: killed the last per-frame reflow.** `warbandIndexAt`/`shopIndexAt` called `getBoundingClientRect` in
  the render body every drag frame (a read-after-Flip-write thrash) — the one drag path not yet on the cached-
  rect pattern. Now the resting slot left/width are cached once per drag in `insertRectsRef` (live-DOM fallback
  kept).
- **Cheap wins:** `decoding="async"` on card art (off-frame webp decode on rerolls); global
  `prefers-reduced-motion` rule (was 3 selectors → now `*` near-instants every loop, incl. the glow `::before`
  and particle layers — accessibility + paint win). Confirmed false positives left alone (backdrop-filter
  re-blur, `computeFrame` O(events²) measured at ~0.01ms, stable Zustand selectors).
- **Monitoring: `npm run perf`** (`packages/tools/src/perf.ts`) — times `simulate()` across board archetypes
  (incl. a keyword-heavy 7v7 "tons of magnetics"), `reduce()` per dispatch with a populated `lastCombat`, and
  full greedy-bot runs, each with a regression-tripwire budget; exits non-zero on an algorithmic regression.
  `docs/performance.md` documents the harness + the manual DevTools render-profiling routine (Performance panel,
  Paint flashing, Layers, FPS) we run together, + the anti-patterns.

- **Win condition fixed: 15 WON combats, not 15 waves reached.** Victory checked `s.wave >= CONFIG.maxWave`, so
  a non-perfect run (some losses — a loss costs Resolve but the climb continues) wrongly ended in victory at
  wave 15. Now it counts wins in `history` against new `CONFIG.winsToWin` (15); `maxWave` is repurposed as the
  balance-tools' wave-reporting horizon. The natural failure is Resolve hitting 0. Rewrote the PvE-win tests to
  be wins-based (victory decoupled from wave; reaching the horizon with fewer wins keeps climbing).
- **Front to Back: "Improve this by" now scales with spell power.** The card shows both the live grant (base 2 +
  accumulated escalation + spell power) **and** the per-cast improvement (base step 2 + spell power) — both
  greened when boosted; only the grant takes escalation. With +1 spell power the card reads
  "Give a minion +3/+3. Improve this by +3/+3" (matching the in-game screenshot). `spellDisplayText` now
  substitutes both `+N/+N` slots via a counted regex; tests exact-match both.

- Verified: `typecheck` + `lint` clean, **279** tests pass, `npm run perf` all within budget; live in the
  preview (recruit + combat render, units animate, glow `::before` pulses, combat→recruit advance after a loss,
  no console errors).

### Smack on contact (frame-accurate) · lunge 1.15 · volume slider + level pass

- **The smack now lands exactly on connection.** Root cause: the impact sound fired from a React beat-effect
  that runs ~2 frames *behind* `setBeatIdx`, while the lunge is frame-accurate GSAP — so the smack always
  trailed the visual, and the gap widened as the lunge grew longer. Moved `sfx.hit()` into the lunge's GSAP
  timeline (`playAttackLunge`'s impact `.add()` callback in `useCombatReplay.ts`), so it's emitted on the exact
  contact frame. To avoid a double-hit, the beat-driven smack is now **skipped when the damage came from an
  attack** (`fromAttack = beats[beatIdx-2]?.primary.type === 'attack'`) but still fires for non-attack damage
  (Start-of-Combat AOE, poison, deathrattle) — which has no lunge of its own.
- **Lunge strike 0.9 → 1.15** of the attacker→defender gap: the attacker now overdrives all the way into the
  target for a fuller, overlapping connect. `DELAY.attack` 340 → **220** so the result beat (damage floats +
  recoil) keeps landing in step with the (now earlier) GSAP contact.
- **Master volume slider** (was never present — the only audio control was the HUD mute speaker, which sits
  behind the enemy "NEXT" frame top-right). Added `masterVol` to `sfx.ts` (0–1, persisted to `ascent.vol`,
  multiplies every sound — both the synth `tone()` gain and the sourced `playSample()` gain) with
  `getVolume`/`setVolume` exports, and an **Audio** section at the top of the Settings (Esc) modal: a styled
  range slider + a mute toggle that disables the slider and reads "Off". A modal nothing can obscure.
- **Levels dialed down:** combat smack 0.7 → **0.39**, sell clips 0.6 → **0.51**.
- **Phantom-smack guard.** Gated the combat float + SFX beat-effects on `active` (live replay only), so a stale
  beat at the recruit↔combat phase swap can no longer fire a ghost smack/float.
- Verified: 278 tests, typecheck + lint clean; live in the preview — the slider drives volume and persists
  (`ascent.vol`), muting disables the slider + shows "Off", Settings modal renders the Audio section above
  Cards/Display, no console errors.

### Sourced SFX (sell + combat smack) + attacks overlap on contact

- **First sourced sound effects wired.** Added a Web-Audio sample player to `sfx.ts` (`import.meta.glob`'d
  `./audio/*.mp3` → decoded AudioBuffers, played via fresh BufferSources so they overlap cleanly; synth blip is
  the fallback until a clip decodes). **Sell** now plays one of `sell1–4`.mp3 at random; the **combat impact**
  (`hit`) now plays `smack`.mp3. Files live in `packages/ui/src/audio/`. Verified: all 5 mp3s resolve via the
  glob + fetch 200, decode on the first audio gesture, no console errors.
- **Attacks overlap on contact.** Lunge strike 0.75 → **0.9** of the attacker→defender gap, so the attacker
  drives into the defender and they visibly connect right as the `smack` lands.

### Attack "smack" + passive-hero power button

- **Attacks drive into the target.** The lunge strike covered ~55% of the attacker→defender gap (it stopped
  short at the edge); bumped to **~75%** so the attacker drives into the defender for a real smack, and the
  defender knockback on impact 0.09 → **0.14** so the hit reads harder.
- **Passive heroes get a power button too.** Rohan / Cassen / Drakko now show the hero-power button (so every
  hero displays its power art slot) — but it's **disabled and never glows** (no ready pulse / armed glow), with
  the game's non-action cursor, since there's nothing to activate. Active powers still pulse when ready; an
  active power on cooldown still dims (passive stays full opacity — it's always on, just not clickable).
- Verified live (passive button renders static + disabled; combat smack plays; no console errors).

### Combat feel + hero-power UI: punchier attacks · Cassen counter fix · spell-buff tooltip · bigger power button · SFX inventory

- **Punchier attacks.** `playAttackLunge` windup 0.16s → **0.20s** (more anticipation, a touch deeper pull-back)
  and strike 0.20s → **0.13s** (faster snap into the hit), so attacks read as wind-up-then-crack rather than a
  uniform slide.
- **Cassen counter double-count fixed.** The live in-combat Collision counter briefly showed 2/5 for 1 kill on
  the End-Combat screen: once combat *settled*, the kills were banked into `run.cassenKills` but the live
  `combatEnemyDeaths` bridge wasn't cleared until you left combat, so the HUD added both. Now the bridge zeroes
  the instant `combatSettled` flips — reads 1/5 consistently (verified live).
- **Hero spell-buff tooltip.** Hovering the hero now shows a "Your spells get +X/+Y" line (hero amplify + Harry
  Botter auras + Skullblade), green, hidden when zero — like the gold-next-turn tooltip.
- **Hero-power button +30%** (58u → 75u, ~86px) and the **hero frame's golden outline removed** (the ready
  pulse, armed glow, and hover accent border) — the ready/armed cue now lives entirely on the button, which is
  the click target. **Wired a hero-power art pipeline:** `heroPowerArt(heroId)` from `art/powers/<heroId>.{png,webp}`
  (added to `optimize-art`), rendered in the button with the glyph as fallback. Art spec: **512×512 square,
  transparent, subject centred** (the button is a circle / `object-fit: cover`) — see `art/powers/README.md`.
- **SFX inventory** → new `docs/sfx-events.md`: every combat + recruit event/animation, its on-screen length,
  and whether it currently has SFX (all current sounds are synthesized placeholders) — a reference for sourcing
  audio, with the priority gaps flagged (DS break, Start-of-Combat cast, poison, reborn, Fodder eat, magnet weld).
- Verified: 278 tests, typecheck + lint clean; live (bigger button, neutral frame, spell tooltip, Cassen 1/5,
  no console errors).

### Bug fixes (rally per-hit · cling legibility · fodder float) + codebase audit (dead code · redundancy · perf)

**Three reported bugs:**
- **Rally fires per hit.** Better Bot's `rallyMechAtk` fired once per attack-*turn* (before the swings loop);
  moved it inside the loop so it fires per swing — a Windfury body now rallies twice if it survives the first
  swing, matching Deathsayer's `onAttack` rallies. New test: a Windfury Better Bot → exactly 2 rallies.
- **Cling Drones legibility.** The cling +1/+1-per-magnetization growth was *correct* (manual magnetize / buy /
  conjure all verified) — but with the new random Combinator it rarely rolls a Cling, so growth was invisible.
  Per the live-text rule, the Cling Drone card now shows its current accumulated bonus ("Now +3/+3").
- **Fodder-consume float.** A Demon eating Fodder buffs itself, but the +X/+X float was masked when it fired at
  wave-start. The consume record now carries the eater's actual gain (× multiplier) and floats it as the Fodder
  swirls in — verified live (Voracious Imp ate 2 Fodder → "+4/+4").

**Codebase audit** (driven by a 6-agent analysis — 45 findings). Applied the safe, high-confidence wins:
- **Dead code removed:** `Legend.tsx` + `Omen.tsx` (superseded by OpponentFrame; −74 lines), the orphaned
  `effectArt`/`FX_ART` glob + `divineshield.webp` (drawn via `<Icon>` now; −5 lines + **−87 KB** off the web
  build), `Threat.punishes` (dead data), `SfxName` (zero refs), and the dead `onSell` + `onDamaged` GameEvents.
- **Performance (combat hot path — `simulate()` runs ~1001×/faceOmen):** the main attack-loop guard now uses a
  non-allocating `countLiving()` instead of `living(side).length` (the guard ran up to ~600×/sim → ~**600k
  fewer throwaway-array allocations per faceOmen**); the Sylus reaper count, Echo-Warden count, and Better Bot's
  per-swing rally now iterate the board directly instead of allocating a `living()` array each death/summon/swing;
  `applyUndeadBonus` early-outs when no Lantern is active (the common case); and `reAttackOnKill` is memoized per
  CardDef instead of re-scanning `effects` on every minion clone (tens of thousands of scans/faceOmen). These cut
  GC churn (most visible on death-heavy late-game boards); faceOmen stays well under 100 ms (~33 ms measured).
  All guarded by the determinism golden tests — combat outcomes are byte-identical.
- **Redundancy:** `drummerRepeats`/`chronosRepeats` collapsed onto one `bestCopyRepeats` helper (the
  "best-single-copy, golden=+2, no-stacking" rule); `magnetizeTargets` now uses the existing `isTribe` helper
  instead of an inline dual-tribe check.
- **Verified:** 278 tests, typecheck + lint clean; app loads + combat resolves live with no console errors.

**Deferred (documented for a focused follow-up — all inert or higher-risk):** removing the **20 dead effect-factory
ids** + bodies (`avengeBuff`, `rallyBuff`, the `onShieldBreak*` trio, `scSplitDamage`/`scAoePerTribe`/`scDestroyHighestAttack`/
`scGrantShieldTribe`, `deathrattleBuffTribe`/`deathrattleBuffRandom`/`deathrattleFillTribe`, the `onConsume*` trio,
`onKillBuffSelf`, `onFriendDeathBuffRandom`, `endOfTurnBuff`, `castSpell`-factory, `spellCastBuffSelf` — ~190 lines,
never dispatched so zero runtime cost) + the now-dead `onConsume`/`onLoseDivineShield` events they hung off; the
**`quiet`/odds-only `simulate()` flag** (skip the event log + snapshots + carry-backs for the 1000 odds sims — the
single biggest allocation win, but invasive); shared `num`/`str`/`highestAttack`/`makeHandCard`/`dominantTribe`
helpers (cross-package/multi-site); the `instView` 13-param → options-object refactor (no test coverage → risky);
and a drag-frame rect cache for `warbandIndexAt`/`shopIndexAt`. (The event-bus `[...list]` snapshot was flagged but
is **intentional** — a minion summoned mid-emit must not handle the in-flight event — so left as-is.)

### Live card text (Guel) · shop buff floats · Combinator attribution · hero-button cursor

Refinements on the two batches below (same day):
- **Live card text rule + Archmagus Guel progress.** Established the convention (saved to memory) that scaling
  "quest/ascension" minions keep their tooltips **live + accurate**. Applied it to Guel: a new
  `guelProgressText` (cardText.ts) shows his *current* grant (+X/+X, golden-aware) and the **countdown to the
  next step** (4→3→2→1), both green via `{{…}}`; wired into `instView` (board + hand) with `run.spellsCast`
  threaded through, including the golden path (Card shows `goldenText`, so the helper output is set there too).
- **Buff floats in the shop.** Recruit-phase buffs now float the actual **+X/+X** above the minion, exactly
  like combat (`.float.buff`), in addition to the green flash. The buff-detect effect now tracks per-card
  attack+health (not just the total) to derive the delta; `Card` gained a `buffFloat` prop (keyed so a repeat
  buff remounts the rise). Shows the *net* gain per action — e.g. casting Spirit Fire next to Guel reads
  "+6/+6" (the +4/+4 spell plus Guel's +2/+2 reaction), matching how combat collapses a beat's buffs.
- **Combinator buff attribution.** A Combinator weld is now credited to the **welded magnetic** in the inspect
  breakdown ("Harry Botter ×2"), not to "Combinator" — its weld `source` is the picked mech's name, and
  `addBuff`'s `count` + Inspect.tsx's `{source} ×{count}` render handle the rest (matches a manual magnetize).
- **Hero-power button cursor.** A *disabled* power button showed the bare OS arrow (my `:disabled { cursor:
  default }`); now it uses the game's custom `gauntlet_default` cursor like the other control buttons.
- Tests: +1 (`guelProgressText` grant/countdown/golden). **279 green**, typecheck + lint clean; verified live
  (Guel reads "+2/+2 … 3 to go"; a cast floats "+6/+6"; disabled button cursor is the custom default; a
  Combinator weld inspects as "Harry Botter"). No console errors.

### Magnetic mechs · triple keeps welds · Guel scaling · win counter · button-only hero power · art

A follow-up pass on the content batch below (same day):
- **Sheldon / Speedy / Harry Botter are now Magnetic.** Sheldon welds Divine Shield, Speedy welds Windfury,
  Harry Botter welds its spell-power aura. Keywords + stats weld through the existing path; the *aura* needed
  new plumbing so it survives being welded into a host: a new `CardDef.spellAura` (Harry Botter = 1) +
  `BoardCard.spellAuraBonus`, threaded through `MagnetPayload`/`applyWeld`, the magnetic-play payload, the
  Combinator weld, and `spellStatBonus` (now generic over `def.spellAura` + welded `spellAuraBonus`, so the
  old hard-coded Harry Botter special-case is gone and future aura cards fold in for free). Combinator's random
  magnetic pool now naturally includes all three.
- **Triple keeps welded magnetic attachments.** `checkTriples` absorbed `manaBonus` (Money Bot) but dropped
  `rallyMechAtk` (Better Bot) and the new `spellAuraBonus` — so a tripled host lost its welded Rally/aura.
  Now it sums all three welded fields into the golden (matching the Money Bot path the owner confirmed works).
- **Archmagus Guel scales.** His +atk/+hp grant now improves by **+1/+1 per 4 spells cast this run** (golden
  **+2/+2** per 4) — `step = floor(spellsCast / 4)` added to the base before the golden multiplier. Card text
  updated. Makes a T4 a build-around spell payoff that stays relevant late (a balance-direction goal).
- **Win counter in the HUD.** A gold crown + count of combats won this run, read straight off `run.history`
  (the per-combat W/L/D log) — no new state, always agrees with the end-screen summary.
- **Hero power fires from its button only.** Clicking the hero *frame* no longer arms/fires — the power circle
  on the frame's right is now the sole trigger (a real `<button>`, disabled when unusable, keyboard-focusable);
  the frame's action cursor was removed so it no longer reads as clickable.
- **Art.** Wired Spirit Worgen (`spiritworgen`) + Archmagus Guel's new art (`guel`→`guel2` alias).
- Tests: +3 (magnetic welds for the three mechs, triple-keeps-welds, Guel scaling); updated the Combinator-fork
  test to derive valid welds from the live magnetic pool. **276 green**, typecheck + lint clean; verified live
  (new art renders, win counter reads, frame-click inert / button-click arms, no console errors).

### Content batch (6 minions + reworks) · Mana→Gold · Combinator rework · hero-power button · **End-Turn freeze fix**

**The End-Turn freeze (the headline fix).** The owner reported two consecutive late-game runs (wave 6 vs
Drakko, wave 10 vs Cassen) that "hung up and froze on End of Turn" — the recruit screen stuck with the shop
visible and the button dead. Ruled out every loop first: `simulate` is fully bounded (iteration guard 300,
re-attack guard 50, summon cap 7, echo bounded — a hand-built 300-iteration stalemate is 900 events and 1000
odds sims run in **100ms**); `faceOmen`/the odds loop are fast; the End-Turn beat telegraph + the combat
replay are bounded `setTimeout` chains that can't synchronously freeze a tab. **Root cause:** the previous
balance patch *removed* Corrupted Lifebinder, but the opponent pool is hydrated at startup from the player's
**localStorage board library** (`loadStoredBoards`), which validated snapshot *shape* but never that each
minion's `cardId` still exists. A board captured by an older build (containing `lifebinder`) loaded into
`OPPONENT_POOL`; when `faceOmen` served it, `instantiate` threw `Unknown card: lifebinder`. That throw lands
inside the End-Turn beat chain's `setTimeout`, so it's uncaught — the phase never flips to `combat`, the turn
stays stuck in recruit, and the bad board **persists across runs** in localStorage (why it hit two runs in a
row, only at deep waves where captured boards are served). Fixed at two layers:
- **`registerOpponents` now filters out unservable boards** (`isServableBoard`: every minion's `cardId` must
  exist in the current `CARD_INDEX`). Both sources — the bootstrap pool and the persisted player boards —
  route through it, so a stale capture can never enter the pool. On the owner's next load this clears their
  poisoned localStorage entry automatically.
- **`faceOmen` got a belt-and-suspenders fallback:** the served-board combat (+ its odds) is wrapped in
  `try/catch`; on *any* serve-time failure it re-resolves against the procedural threat board, so combat
  **always** resolves and End Turn can never hard-lock on a bad opponent again. Refactored the enemy build
  into `proceduralEnemy()` + `resolveCombatVs(enemy, tier)` to share the path cleanly.
- Tests: `isServableBoard` accept/reject, `registerOpponents` drops a stale board, and a `faceOmen` test that
  force-pushes a `lifebinder` board past the filter and asserts it does **not** throw, reaches `combat`, and
  falls back to a fightable enemy with odds. **273 green.**

**6 new minions + carry-back plumbing.** Better Bot (T5 Mech 6/4, `Magnetic`+`Rally`: on attack gives your
other Mechs +5 Attack via a new `rallyMechAtk` field that *stacks* when welded — `applyWeld` accrues it, so 5
welded onto one Mech → +25; combat applies it in `performAttack`); Sheldon (T3 Mech 2/4 Divine Shield);
Speedy (T4 Mech 4/4 Windfury); Harry Botter (T4 Mech 1/5, passive aura — `spellStatBonus` adds +1/+1 to
stat-granting spells while it's on board, golden +2/+2); Burial Imp (T2 Demon 3/3, Deathrattle queues a
Fodder to the next tavern via new `deathrattleAddFodder` → `CombatResult.playerFodderGrants` → `settleCombat`,
golden 2); Soulsman (T3 Undead 2/5, `Avenge (4)` raises max Gold by 1 via new `avengeMaxGold` →
`playerMaxGoldGain` → `settleCombat` bumps `maxEmbers`, golden 2). Two new combat carry-back channels +
factories (`grantTavernFodder`, `grantMaxGold` on `CombatContext`).

**Gnasher rework + Maw → T3.** Gnasher, the Overrun is now "when it kills a minion it **attacks again** and
your spells permanently gain **+1/+1**" (`reAttackOnKill` + a new `onKillBuffSpellPower` factory — separate
from `deathrattleBuffSpellPower` because `onKill` carries `attacker`, not `minion`). Maw of the Pit moved T4→T3.

**Combinator → random Magnetic Mech.** Instead of always welding a Cling Drone token, Combinator's End of
Turn now magnetizes a **random Magnetic Mech** (Cling / Money Bot / Better Bot…, rolled on its own seeded
stream) onto a random friendly Mech — so the welds vary turn to turn (a Cling stacks the Cling enchant, a
Money Bot welds income, a Better Bot welds stacking Rally). The host selection is unchanged (still seeded via
`magnetizeTargets`, matching the UI's electrify telegraph). Card text + the hover reference popup updated
(now shows all three magnetic mechs). Rewrote the two cling-specific Combinator tests to the random-fork
behavior; cling-improvement stays covered by the play-path tests.

**Mana → Gold, once and for all.** All user-facing "Mana" → "Gold" (card text, spell names — Mana Pouch →
**Gold Pouch**, Mana Font → **Gold Font** — Nadja's power, StatusBar labels + tooltips, live card text). Card
ids are unchanged (`emberpouch`, `manafont`, power kind `gainMaxMana`). The cost color (`--mana`) is now gold,
and the `mana` Icon glyph was redrawn from a teal droplet to a **gold coin** (disc + stamped rim/sparkle +
shine) — shows in the Gold chip, the projected-gold rows, and the coin cost badges.

**Hero-power button.** Added a circular hero-power button **attached to the right side of the hero frame** (in
the StatusBar), with a placeholder glyph (dedicated artwork to come) and ready/armed states; clicking it
bubbles to the frame's existing arm/fire handler. (Replaces the earlier placement off the control frame.)

**Art.** Wired the 6 new minions + new art for Heckbinder (`heckbinder2`) and Combinator (`combinator2`) via
the `ART_ALIAS` map, plus the owner's new Gold Font / Gold Pouch art (alias `manafont`→`goldfont`,
`emberpouch`→`goldpouch`). Optimized 10 masters (21.8MB → 0.56MB). Verified live (fresh dev server — new art
needs a restart, not a reload): all 10 art files resolve, the coin + hero circle render, and End Turn →
combat resolves cleanly with zero console errors.

**Docs.** `docs/cards.csv` regenerated from `@game/content` via `npm run dump-cards` (53 minions, 19 spells,
7 tokens). Per the owner, `docs/balance-handoff.md` is intentionally **not** updated (inaccurate / not a
priority).

## 2026-06-22

### Balance patch v1: Yazzus targeted-only · remove Corrupted Lifebinder · 15-round win
First pass on the owner's balance list (the "tractable trio"; the deeper T1–4 + decision-diversity work is
deferred — see `docs/balance-handoff.md` §9).
- **Yazzus → aimed spells only.** It doubled *every* spell, including economy/utility/Discover — degenerate.
  A new `spellCasts(state, def)` gates the multiplier on `def.target` being set: only spells you aim at a
  minion (Spirit Fire, Shatter, Front to Back, Aresmar, Tribes Choice…) cast twice (3× golden); untargeted
  spells (Growth, Mana Pouch, Sprout, Help Wanted…) always cast once. Wired through the reducer cast path,
  the Sprout/Help Wanted Discover paths (no longer Yazzus-multiplied), and the UI cast-spark replay. Card
  text → "Your **targeted** spells cast twice."
- **Removed Corrupted Lifebinder + the entire linked-mirror system.** Cut the card (content + zod schema)
  and every trace of the mirror: `linkUid`/`linkBase`/`linkApplied` (core `BoardMinion`/`Minion`/
  `MinionSnapshot` + sim `BoardCard`), the combat `mirrorLink` + the start-of-combat linkUid remap
  (`simulate.ts`), the `battlecryLinkDemon` factory + `syncLifebinders` (`recruit.ts`) and its two reducer
  calls, and `minion.ts`'s linkUid pass-through. The `reduce()` wrapper (whose only job was the post-action
  sync) collapsed into `reduceCore`. Swingy payoff + a fragile system (the same machinery that sat next to
  the recent crash hunt). (Art asset + README art-table row left in place, harmless.)
- **Curve → 15-round win.** `CONFIG.maxWave` 20 → 15: you win the run by clearing round 15 (a perfect run
  wins all 15). Cuts the drag, and the shorter arc lowers the finale's stat peak. Left `curve.statScalePerWave`
  (0.16) as the difficulty dial to tune by feel for the new length.
- Tests: rewrote the Yazzus tests (Help Wanted no longer multiplied; the resolve-twice test now uses Spirit
  Fire; added an untargeted-Growth exclusion) and removed the 9 Lifebinder tests. **265 green**, typecheck +
  lint clean.

### Fix the End-Turn hard lock (stale combat-replay beat index) + add a render error boundary
- **Symptom:** late-game (waves 7 & 10, two consecutive runs) the game hard-locked — End Turn did nothing,
  the board frozen. **Root cause:** `useCombatReplay`'s `processedEnd = beats[beatIdx - 1]!.end`. `beatIdx`
  can outlive its beats: when a new (often **shorter**) combat's event log replaces the previous one, the
  component renders once with the **old, larger `beatIdx`** *before* the `setBeatIdx(0)` reset effect fires.
  `beats[beatIdx - 1]` is then `undefined`, `.end` throws **during render**, and — with **no error boundary** —
  React unmounts the tree and the app freezes on its last frame. It triggers specifically when **a long fight
  is followed by a shorter one** (common late game), which is why it looked random and hit deep runs.
- **How it was found:** ruled out every sim path first — fuzzed combat 120k matchups (caps ~500 events, the
  iteration guard bounds it), timed the 1000-sim odds loop (126ms even grindy), confirmed end-of-turn
  projection + `chronosRepeats` (≤3) are bounded, and `useCombatReplay` is timer-driven (no sync loop). Then
  drove the live store (`window.useGame`) to reproduce: injecting a board + End Turn surfaced the exact
  `TypeError: Cannot read properties of undefined (reading 'end')` at `useCombatReplay.ts:540`.
- **Fix:** guard the stale lookup — `beats[beatIdx - 1]?.end ?? events.length` (and the matching `?.start ?? 0`).
  The transient stale render now shows the final frame for one tick, then the reset effect lands `beatIdx = 0`
  and it re-renders cleanly. Verified live: the exact pre-fix crash sequence now logs **zero** render errors.
- **Defense in depth:** added an `ErrorBoundary` (wraps the game in `Game.tsx`). A render crash now shows a calm,
  recoverable fallback ("Try to continue" / "Reload") instead of a silently frozen app — the console had been
  explicitly flagging the missing boundary. Verified it catches a forced render error and renders the fallback.
- Typecheck + lint + 273 tests green.

### Two gameplay fixes: tavern buffs feed Fodder (Staff of Guel) + conjure spells check for triples
- **Staff of Guel now also buffs Fodder.** Its effect (`spellBuffShop`) set the run-wide tavern-buy bonus
  (`tavernBuyBonus`) but skipped Fodder — which is never *bought*, it's *eaten* — so a Demon engine got nothing
  from it. Now `spellBuffShop` also enchants the Fodder card type run-wide via `buffFodderRunWide` (same +A/+B,
  spell power folded in), exactly like Ritualist's End-of-Turn enchant: every Fodder from any source (tavern,
  Soulfeeder, conjure) carries it, Fodder already out gets it immediately, and Demons eat the bigger stats.
  To avoid double-applying on the rare *directly-bought* Fodder (cardBuff already holds the Staff buff), the
  reducer's buy path and `shopView`'s offer display both skip the `tavernBuyBonus` fold for `FD` cards. (Staff
  of Guel is the only run-wide tavern buff; Ritualist already fed Fodder — so "tavern buffs feed Fodder" holds.)
- **Conjure spells now complete triples.** The reducer's spell-cast branch returned without calling
  `checkTriples`, so a spell that *hands you minions* — Undead Army (2 copies of a random Undead), Summon Stone —
  could give you a 3rd copy that never combined into a golden. Added `checkTriples(s)` after the cast resolves
  (a no-op when there's no triple), so conjured copies combine just like a buy / play / Discover does.
- Tests: +2 (Staff of Guel → Fodder enchant + no-double-on-buy; Undead Army completing a triple). **273 green**,
  typecheck + lint clean.

### Drag feel: real "size pop" cause found (drop-slot width) + hand lift-out + quicker snap + EOT banner
- **The "cards take more space" on pick-up was real — and the cause was the drop-slot, not the lifted card.**
  Rendered shop/warband/hand cards are `.card.compact` sized to `--ccw` (`= --cw * 0.85`), but `.dropslot`
  was sized to `--cw` — i.e. **17.6% wider** (and `--ch` tall vs the card's `--ccw`-square box). So the gap that
  opens when you lift a card was a 274.5px slot replacing a 233.3px card → the center-justified row shoved the
  neighbours outward. Fixed: `.dropslot` is now `--ccw × --ccw` (`flex-basis`, `width`, `height`) with the card's
  `--arch-radius`. Verified in-page: an injected slot beside cloned compact cards now measures **233.3×233.3 ==
  the cards** (was 233.3 vs 274.5). Supersedes the prior (wrong) "no real horizontal shift" diagnosis note below.
- **Hand "ghost" gone — lifted out like shop/warband.** The dragged hand card kept a faint `dragsrc`
  `opacity: 0.3` copy in the fan, so during a hand→board drag (and especially the snap-back) you saw a dim
  "copy" *plus* the floating `.dragcard`. Now `.card.dragsrc { opacity: 0 }` — the source is fully hidden (no
  ghost) while its slot stays reserved, so the fan never reflows and the floating card is the only visible copy.
- **Snap-back is quicker.** Invalid-drop return: `.dragcard.snap` transition `0.16s → 0.1s` and the JS
  cleanup timeout `150ms → 110ms` — snappier "rejected" feedback (the delay read as sluggish).
- **"End of Turn" banner moved up off the warband.** It was `place-items: center` on a full-screen overlay →
  dead-centre, eclipsing the player's warband as end-of-turn effects resolved. Now anchored to the top `62vh`
  and centred within it, so the text lands over the shop / enemy-board region (which is closing during the
  transition anyway) and clears the warband below. Verified: text bottom 460 < warband top 630 (1352-tall vp).
- Typecheck green; verified live on the dev server (computed-style measurements + screenshots).

### Drag feel: clean the snap-back + stop the hand bobbing mid-drag
- **Snap-back** (an invalid drop returning the card to the hand) dropped the `cubic-bezier(0.34, 1.2, …)`
  overshoot — that `1.2` bounce was the "slow/janky" feel. Now `cubic-bezier(0.4, 0, 0.2, 1)` (clean ease-out).
- **Hand stops reacting mid-drag:** `.dragcard` is `pointer-events:none`, so while dragging, the cursor still
  "hovered" the hand cards underneath → they bobbed (the `:hover` `translateY` lift). `body.dragging
  .row.hand .card:hover` now holds them at rest — no bob/jitter while dragging.
- Diagnosis note: the grabbed card's slot was already fully reserved (`dragsrc` = `opacity: 0.3`, same
  size), so there was no real horizontal shift on pick-up — the "takes more space" is the lifted card going
  full-size vs its fanned/overlapped slot. Flagged for the user to confirm.

### Drag FLIP: split the easing — gentle glide while dragging, snappy settle on drop
- The during-drag side-to-side felt janky sharing one ease with the landing. `Flip.from` now branches on
  `dragRef.current?.active`: a **live drag** uses `0.25s / power2.out` (smooth side-to-side tracking under the
  cursor); a **committed change** (drop / play / buy / sell) uses `0.18s / power2.out` (snappy settle).

### Front to Back text + remove Razorscale Warlord + ease the drag FLIP
- **Front to Back** dropped the redundant "Each Front to Back you cast gives +2/+2 more" note — the grant
  already renders the live scaled value (base + escalation + per-stat spell power) in green, so the sentence
  was noise. Text is now just "Give a minion **+2/+2**" (which `spellDisplayText` substitutes with the scaled
  `{{+A/+B}}`).
- **Removed Razorscale Warlord** (`razor`, Dragon T4). Repointed its generic references: the combat tests +
  harness used it as a vanilla 4/4 → `sandbag`/`cleric`; the discover-filler → `weaver`; the Bane test's 3rd
  Battlecry minion → a 2nd `cleric` (keeps 3 battlecries → Fodder +3/+3). (The user wrote "Warden"; the card
  was "Warlord" — flagged.)
- **Eased the GSAP Flip** drag/reorder animation: `0.28s power2.out` → **`0.42s power3.out`** — gentler, less
  aggressive landing as a card settles onto the board. A one-line knob to tune further.
- 271 tests + determinism harness green; dev preview clean on HMR.

### Drag/reorder FLIP → GSAP Flip plugin (slide *during* the drag, not after the drop)
- Replaced the hand-rolled FLIP (~35 lines of manual measure/invert/CSS-transition in a `useLayoutEffect`)
  with GSAP's **Flip** plugin (already on gsap 3.15; `gsap/Flip` is free + bundled, registered once at module
  scope). `flipStateRef` holds the layout state captured before each change; `Flip.from` animates every card
  from there to its freshly-committed spot — batched reads, GPU transforms, native interruption handling.
- **Re-enabled the during-drag gap animation** (`flipKey` carries the drop-slot index again), so cards slide
  as the gap moves and a reposition resolves *while dragging* instead of snapping then animating after the
  drop (the reported "swap happens after I drop it"). The hand-rolled FLIP couldn't do this — it stormed on
  rapid gap moves (the "card dancing"); GSAP blends interruptions, so it stays smooth.
- Freshly bought/played cards pop in (cardpop) rather than sliding from nowhere (not in the prior state);
  sold cards just leave. Verified: typecheck + lint clean; `gsap/Flip` resolves at runtime (Flip.js present);
  recruit renders clean; a shop reroll runs `Flip.from` with no error or displacement. Drag *feel* is the
  user's call to confirm.

### Drop Reborn from Grave Knit
- Per the user: Grave Knit (`knit`) is no longer Reborn by default (`keywords: []`); the global death-buff
  stays. The Lantern-Reborn test now grants `['R']` inline (the other two Reborn tests already did). 271 tests.
- **Queued (design call):** if a Grave Knit is ever *granted* Reborn, the reborn copy should carry the
  accumulated death-stacks instead of resetting to printed base (current `killOrReborn` behaviour). Clean
  plan: in `killOrReborn`, after the base reset, add the combat's accumulated `cardBuffGains[cardId]` to the
  reborn copy for a death-buff card — doesn't disturb the generic "Reborn → base" path (no stacks ⇒ base).

### Fix: spell cards now reflect the per-stat spell power + wire Cinderwing art
- The spell-power rework made the bonus per-stat (`spellAttackBonus`/`spellHealthBonus` = hero amplify +
  `RunState.spellBonus`), and the cast *application* used it — but the Recruit UI still computed the spell
  card **display** off `spellStatBonus` (hero-only) and called `spellDisplayText` with 3 args (symmetric).
  So Cinderwing's +Health / Skullblade's +Attack never showed on the cards. Threaded
  `spellAttackBonus`/`spellHealthBonus` through `shopView`/`instView` + `spellDisplayText`'s 4th `bonusH`
  arg (and the useMemo deps, so the text updates when either bonus changes).
- Wired **Cinderwing Matron** art (master now provided) → `cinder.webp`.
- Verified: typecheck + lint + 271 tests; dev preview reloads clean.

### Minion batch — 4 reworks + Skullblade + 2 cuts + Bane dual-typing + a spell-power system
- **Reworked 4 existing minions** (the user's message said "updates and additions"): **Hoard Cleric**
  (`cleric`) → Dragon T3 3/4, Battlecry **+2/+3** to Dragons (was T2 1/3, +1/+1); **Cinderwing Matron**
  (`cinder`) → Dragon T4 5/5, Battlecry **+1 spell Health** (was T3 tribe buff); **Toxin Tender** (`toxin`)
  → T5 3/1, Battlecry grants Venomous to a friendly **Undead** (was any friendly); **Grave Knit** (`knit`)
  → T2 3/2, **kept Reborn**, added a global death-buff. (A first delegation mistakenly added these as
  duplicate *new* ids that collided on name with the existing cards — caught + repointed onto the originals.)
- **New: Skullblade** (Undead T3 5/1) — Deathrattle: **+1 spell Attack** for the run.
- **New spell-power channel.** There was no run-state spell power (only a hero-amplify scalar). Added
  `RunState.spellBonus {attack, health}`; `spellAttackBonus`/`spellHealthBonus` = hero amplify **+** the
  bonus; the 5 stat-granting spell factories now fold Attack/Health independently. Cinderwing bumps it at
  recruit; **Skullblade carries it back from combat** (new `CombatResult.playerSpellPower` → `settleCombat`,
  mirroring `playerHandGrants`).
- **Grave Knit's run-wide death-buff** carries a combat death back as a card-type buff
  (`CombatResult.playerCardBuffs` → `buffCardTypeRunWide('knit', +3/+2)`, a by-cardId sibling of
  `buffFodderRunWide`). Stacks per death.
- **Bane is now a proper Dragon/Demon dual-type.** A shared `isTribe(card, tribe)` (checks `tribe` +
  `CARD_INDEX[id].tribe2`, matching the existing Mech convention) gates the Demon systems — so Bane eats
  tavern Fodder (Consume) and is a valid **Corrupted Lifebinder** target (sim + the Recruit targeting UI).
- **Cut:** Rot Weaver + Webspinner Matron (the `onFriendDeathBuffRandom` primitive is kept, content-unused).
- **Art:** wired Bane + Taurus (last batch's two that were never copied into the build dir), plus Hoard
  Cleric, Skullblade, Toxin Tender, Grave Knit — masters → WebP via `npm run optimize-art` (13.4 MB → 0.36 MB).
  **Cinderwing Matron has no master** (`Ascent Art\Minions\CinderwingMatron.png` absent) → dragon sprite for now.
- 3 new factory ids (`deathrattleBuffSpellPower`, `deathrattleBuffCardTypeRunWide`, `battlecryBuffSpellPower`)
  registered in core + content. Updating the 4 cards broke 14 pre-existing tests (cleric was a heavy +1/+1
  fixture; knit's base/Reborn; toxin's any-friendly target) — all repointed to the new specs. Verified:
  typecheck + lint + **271 tests** + determinism harness.

### Drag perf, take 2 — kill the FLIP storm + cache spell-targeting hit-tests (the real fix)
- **The FLIP storm was the actual culprit** (prod stuttered identically with the earlier zoneAt cache, which
  ruled out the re-render + dev tax). The FLIP effect re-measures every shop+warband card and restarts a 0.2s
  slide on each `flipKey` change — and `flipKey` included the live drop-slot index. So dragging a card over
  the board re-ran the entire FLIP every time the gap moved, each frame interrupting the previous animation:
  this *was* the "card dancing" + the hand→board sluggishness. `flipKey` now tracks only row composition+order
  (uids); the drop slot moves **instantly** (snappy), and the FLIP animates only discrete changes
  (buy / play / sell / reposition / lift-out).
- **Spell targeting** (`boardUidAt` / `shopUidAt`) called `elementFromPoint` every frame while aiming. The
  board/shop don't shift during a spell drag (a spell opens no insertion gap), so the candidate card rects are
  cached at drag-start and hit-tested arithmetically — no per-frame layout-forcing while aiming a spell.
- Verified: typecheck + lint clean, no console errors. Combined with the earlier zoneAt-rect cache, the
  per-frame drag path no longer forces a synchronous layout (only the occasional gap-change reflow remains).

### Drag perf — hit-test cached zone rects (drop the per-frame `elementFromPoint`)
- During a drag, the zone under the pointer was found via `zoneAt` → `document.elementFromPoint`, and the
  sell/buy line via `warbandTop()` → `getBoundingClientRect` — called on **every** pointermove. Both force
  a synchronous layout, a per-frame cost behind the drag micro-stutter (worst when repositioning on the
  board). The zone *containers* hold their position during a drag (only the cards inside shift), so we now
  measure them once at drag-start and hit-test cached rects (pure arithmetic). Behaviour-equivalent — the
  floating drag card is `pointer-events: none`, so `elementFromPoint` was already returning the zone behind it.
- Remaining per-frame cost (honest): the live insertion-gap reflow (cards shifting *is* the visual feedback)
  and the React re-render. The latter is heavily inflated in dev — **StrictMode double-renders every frame**
  and the bundle is unminified — so a production build (`npm run build:web` → `npm run preview`) is the real
  test. If it still stutters there, the next lever is taking the floating-card position fully imperative
  (ref + direct transform) so a move doesn't re-render the recruit tree at all between gap/zone changes.

### Choose One is its own keyword — not a Battlecry (no Drakko / Karwind / Bane synergy)
- Playing a Choose One minion (Wildwood Shaper) and picking an option used to run through the Battlecry
  machinery: `applyChooseOne` applied `drummerRepeats` (Drakko the Drummer **doubled** the chosen effect)
  and fired `battlecryTriggered` (proccing Karwind / Bane). Choose One is its own keyword, **not** a
  Battlecry — the chosen option now resolves exactly once, with no doubling and no battlecry-triggered procs.
- `hasBattlecry` no longer counts a Choose One card, so a Choose One minion doesn't advance Drakko's quest
  or appear in Help Wanted's Discover-a-Battlecry filter. (Wildwood Shaper already had `keywords: []`, no
  Battlecry badge — so the card display was already correct.)
- Test added: with Drakko the Drummer on board, a Choose One buff lands once (+1/+1), not doubled. 258 tests.

### Card-art → WebP: 71 MB → 4.3 MB (−94%)
- The illustrated card/hero/spell art was **78 PNGs totaling 71.4 MB** (640×640 or 512×512 but poorly
  compressed — ~1 MB each). Converted all to **WebP** (downscaled to ≤512px — cards display at ~290px —
  quality 85, alpha preserved) via a new sharp-based `npm run optimize-art` (`scripts/optimize-art.mjs`):
  **71.4 MB → 4.33 MB, −93.9%** (each card ~1 MB → ~40–90 KB). The high-res masters under
  `C:\Game Assets\Ascent Art\` are untouched; the in-repo build copies are now `<id>.webp`.
- `art.ts` globs now match `*.{png,webp}` and prefer the WebP copy, so a freshly-dropped PNG still shows
  immediately and the optimizer converts it later with no rewiring. **Gotcha logged in the file:**
  `import.meta.glob`'s options must be an *inline literal* — a hoisted const fails Vite's static glob
  analysis with "Invalid glob import syntax"; `tsc` doesn't catch it (the dev server / build does), which
  the live restart-and-check surfaced.
- Verified live: dev server restarted (the eager glob re-resolves only on restart, not reload), hero-select
  renders all portraits as loaded 512×512 `.webp`, crisp at display size, no console errors. This is the
  likely fix for the "RAM feels bogged down" symptom — the browser now holds ~4 MB of art, not ~71 MB.

### Perf round 2 — rAF-throttle the drag move + dev-vs-prod guidance
- **rAF-throttle the drag:** a high-Hz pointer (120/144Hz) fires `pointermove` far more often than the
  screen repaints, and each one re-rendered Recruit (the live insertion-gap + spell-targeting line read
  `drag.x/y`, so they can't be ref'd out of React). `onMove` now stashes the latest position and schedules
  a single `requestAnimationFrame` flush — coalescing the burst into one `setDrag` per frame, capping
  re-renders at the refresh rate. The pending frame is cancelled on drag-end (effect cleanup). `onUp`
  recomputes "did it move" from the up event (a flick finished inside one frame may not have flushed
  `active` yet) so a fast drag still registers as a drop.
- **Why this is the right knob (profiling):** the per-card `Sprite` canvas only redraws inside a
  `useEffect` keyed on `[name, scale]`, so card re-renders don't repaint canvases — a drop is cheap React
  reconciliation, not paint. So I did *not* add a content-aware Card comparator (its stale-render risk
  outweighed the small gain). The remaining drag cost was purely re-render *frequency*, which the throttle caps.
- **Dev vs prod:** StrictMode double-invokes renders in dev and Vite serves an unminified bundle; the
  production build (`npm run build:web` → 135 KB gzip JS, <1s) strips both. Feel-test there (`npm run preview`
  in apps/web).
- **Flagged:** card-art PNGs are ~1.2 MB each (many) — a likely RAM/load contributor; downscale/WebP is a
  worthwhile follow-up.
- Verified: typecheck + lint clean; prod build green; Cassen counter display confirmed live ("Collision · 0/5").
  The drag itself needs a real-pointer feel-test — synthetic pointer dispatch couldn't drive React's delegated
  handler in the preview harness; the change is isolated to the move handler (drag-start untouched).

### Add Taurus the Ancient + Bane (T6 minions) + Engraved carry-back honors sc-granted EG
- **Taurus the Ancient** (Neutral T6 6/8): new `scEngraveNeighbor` Start-of-Combat factory grants the
  Engraved (EG) keyword to the minion on Taurus's **left** (golden: **both** adjacent). That neighbor then
  keeps whatever stats *it* gains in the fight — e.g. a Beast next to Taurus keeps a Grim deathrattle buff.
  The grant is combat-time (pushed onto the per-combat clone's keywords, never a `CardDef`), so it only
  sticks for fights where Taurus is adjacent at the bell. No-op if the neighbor is absent/dead/already-EG.
- **Engraved carry-back fix (the subtle part):** the EG carry-back labelled the run-board buff by
  re-checking the run-board *card's* keywords (`card.keywords.includes('EG')`) — but a Taurus neighbor's
  card has no EG (it's granted on the combat clone), so its gain was mislabelled "Flowing Monk".
  `playerPermaBuffs` now carries an `engraved` flag read off the *combat* Minion's live keywords, and
  `settleCombat` labels off that. The stats always carried back (the `if (card)` guard never gated on
  keywords); this only fixes the label. Native EG (Gnasher) + Flowing Monk paths are unchanged.
- **Bane** (Dragon/Demon dual-type T6 12/12): new `onBattlecryBuffFodder` recruit factory — every Battlecry
  you trigger permanently enchants the **Fodder** card type +1/+1 run-wide (golden +2/+2), reusing
  Ritualist's mechanism (extracted to a shared `buffFodderRunWide` helper). Fires per battlecry *fire* via
  the existing `battlecryTriggered` hook (Karwind's path), so Drakko doubling double-procs; multiple Banes
  stack. Bane has no battlecry of its own, so it never self-procs.
- New factory ids `scEngraveNeighbor` + `onBattlecryBuffFodder` registered in both `EffectFactoryId`
  (core/types.ts) and `EffectFactoryIdSchema` (content/schema.ts). Verified: typecheck + lint + 257 tests
  (8 new — Taurus left-neighbor + golden-both + non-adjacent guard + native-EG regression carry-backs;
  Bane +N/+N over N battlecries + golden + Drakko-doubled). Built by a subagent; carry-back path reviewed
  line-by-line before commit.

### Fix Cassen's in-combat Collision counter (live count + display)
- The live in-combat counter re-derived enemy kills from an enemy-uid set (initial.enemy + enemy summons),
  which could diverge from simulate's authoritative `minion.side === 'enemy'` tally on uid/reborn/summon edge
  cases. The `death` combat event now carries **`side`**, and `useCombatReplay.enemyDeaths` counts
  `side === 'enemy'` deaths directly — so the live count matches the settled total exactly (no uid-matching).
- The display used `(cassenKills + combatEnemyDeaths) % 5`, which rolled 4→0 mid-combat (the grant only fires
  at settle) and read as "wrong." Now `min(5, cassenKills + combatEnemyDeaths)`: a clean climb to **5/5**
  (grant ready), dropping to the post-grant value when settleCombat banks + grants.
- Verified: typecheck + lint + 249 tests.

### Feel pass (round 1): drag card tracks the cursor 1:1; faster landing pop
First, lowest-risk lever on the drag/buy/sell snappiness.
- **Removed the deliberate 0.08s drag "float."** `.dragcard` had `transition: transform 0.08s ease-out` —
  intentionally easing the card *after* the cursor ("floats instead of rigidly pinned"). That was the main
  "not snappy" feel. Removed it so the card tracks the cursor 1:1 (the `.snap` invalid-drop + `.magslide`
  release animations keep their own transitions, so those still animate).
- **Faster landing pop.** `cardpop` (a freshly bought/played card popping in) 0.26s → 0.15s.
- **Profiled the state-change path:** a `dispatch` is ~1.2ms (reducer + setState), so the React re-render
  isn't the obvious bottleneck — the animation timing was. (The preview's rAF is background-throttled, so
  a to-paint number isn't trustworthy there.) DRAG_THRESHOLD is already a tight 5px.
- **Next levers (pending your feel-test):** if the drag/drop still feels heavy, cap per-frame re-renders
  (rAF-throttle the move) and make a drop re-render only the changed cards (content-aware Card memo).

### Discover-queue (Yazzus → Help Wanted/Sprout, Drakko → Brian) + Hoarder triple keeps the oldest + Eyes targeting
- **Discover queue.** Discovers now QUEUE behind the open one (`RunState.discoverQueue: DiscoverSpec[]`,
  serializable — `{kind:'spell'}` or `{kind:'minion',tier,exactTier?,filter?}`) instead of overwriting.
  `queueDiscover(state, spec)` opens it or queues; the `discover` case drains the queue after each pick.
  Replaces the spell-only `pendingSpellDiscovers`. `offerDiscover`/`hasBattlecry` moved reducer→recruit so the
  import direction stays clean. Backbone for the two below.
- **Yazzus multiplies Help Wanted + Sprout** (the player-cast Discover spells) — casting them with a Yazzus out
  opens 2 (3 if golden) sequential Discovers. **Triple Reward stays single** (it's not a player-cast spell).
- **Drakko the Drummer → Black Belt Brian Discovers 2.** The drummer's Battlecry-doubling (`drummerRepeats`)
  already fired Brian's Battlecry twice, but `battlecryDiscoverSpell` *overwrote* the open Discover on the 2nd
  fire — now it queues, so Brian + Drakko opens 2 spell-Discovers (golden Brian + Drakko → 4). The drummer was
  never actually inert; its stale "deferred / no factory" comment is corrected.
- **Hoarder triple keeps the oldest copy.** `checkTriples` now sets the golden's `boughtWave` to the MIN
  (earliest) of the merged copies, so a tripled Hoarder keeps the highest sell value as its starting point.
- **Eyes of Aresmar targeting (UI).** A tier-gated spell (`targetMaxTier`) snaps back without casting if dropped
  on a >T4 minion or a tavern offer — only a valid-tier friendly *board* minion is a legal target.
- Verified: typecheck + lint + **249 tests** (7 new: Yazzus×Help-Wanted/Triple-Reward, Drakko×Brian, golden
  Brian×Drakko=4, Battlecry-fires-twice-via-drummer, Hoarder-triple-min-boughtWave).

### Fix Junkyard Titan grant doubling at combat-end + Hoarder live "Sells for X" line
- **Junkyard Titan (and any Deathrattle hand-grant) doubled at combat-end.** The combat view renders the flying
  `handGrantsShown` cards while `inCombat`, but settleCombat fires at replay-end and adds the grants to the REAL
  hand while still in the combat view — so both the real-hand copies and the flying copies showed at once (e.g.
  4 Magnetic minions read as 8). Gated the flying copies on `!run.combatSettled`, so they vanish exactly when
  the real hand receives them. (Latent for Arcane Weaver too; fixed for every Deathrattle hand-grant.)
- **Hoarder shows its live sell value.** `instView` now renders "Sells for **+N Mana** per turn you hold it.
  {{Sells for X Mana now.}}" for Hoarder, where X = `(wave − boughtWave + 1) × (golden ? 2 : 1)` — the exact
  value the sell case pays. Threaded `run.wave` into instView; golden uses an explicit `goldenText` (so the
  naive golden-text doubler doesn't double the already-scaled value — it was showing +4/turn before).
- Verified: typecheck + lint + **243 tests**; live — Hoarder reads +1/turn (non-golden) and +2/turn (golden)
  with the live "Sells for X Mana now" value.

### Tuning: Junkyard Titan → T4; Black Belt Brian golden Discovers 2 spells (a real two-pick)
- **Junkyard Titan** dropped tier 5 → **tier 4**.
- **Golden Black Belt Brian now Discovers TWO spells for real** — was a shortcut (the pick + a random spell
  added to hand). New `RunState.pendingSpellDiscovers` + an exported `offerSpellDiscover(state)` helper: golden
  Brian opens the first spell-Discover and queues one more; the reducer's `discover` case re-opens a fresh
  spell-Discover after each pick while the queue remains (base Brian still Discovers 1). goldenText →
  "Discover **2** spells."
- Verified: typecheck + lint + **243 tests** (the golden-Brian test rewritten to walk the two-pick chain).

### Three new neutral minions (Hoarder, Black Belt Brian, Yazzus) + Junkyard Titan rework
- **Junkyard Titan** (Mech T5) reworked → **"Deathrattle: Add a random Magnetic minion to your hand"** (golden:
  two). New combat factory `deathrattleGrantMagnetic` — mirrors Arcane Weaver's `deathrattleGrantSpell` (picks a
  random Magnetic-keyword minion via `ctx.rng`, grants to hand + emits the `toHand` event so the replay flies it
  over; golden grants 2 independent picks). Added a `ctx.allCards()` combat primitive so the factory enumerates
  the card pool data-drivenly. Magnetic pool (`'M'` keyword) = Cling Drone, Money Bot, Heckbinder.
- **Hoarder** (Neutral T1 1/1) — "Sells for **+1 Mana** per turn you hold it" (golden +2). `BoardCard.boughtWave`
  is stamped in the buy case; the sell case pays `(wave − boughtWave + 1) × (golden ? 2 : 1)` for a Hoarder
  instead of the flat sell value (same-turn buy+sell = 1).
- **Black Belt Brian** (Neutral T5 3/5) — "**Battlecry:** Discover a spell" (golden: the picked spell **plus** a
  second random one added to hand). New recruit factory `battlecryDiscoverSpell` — offers 3 distinct random
  spells through the existing Discover flow (which resolves a spell card straight into the hand).
- **Yazzus** (Neutral T6 6/8) — "Your spells cast **twice**" (golden: three times). New `spellCastMult(state)`
  helper (3 if a golden Yazzus is on board, 2 if a non-golden, else 1); the reducer's play-spell path resolves
  the cast that many times (the card is consumed once). Channeling the Devourer's `singleCast` is exempt (never
  multi-fires), and the Discover-spells are exempt (single pending discover). The UI fires the cast spark once
  per resolution (staggered 200 ms, via a `castSparks` helper reading `spellCastMult`) so a doubled cast visibly
  procs more than once.
- Both new factory ids registered in `EffectFactoryId` (core) + `EffectFactoryIdSchema` (content). Art wired for
  all three (Hoarder / Yazzus / Black Belt Brian — the `BlackBeltBrian.png` master existed, no fallback needed).
- Verified: typecheck + lint + **243 tests** (8 new — Hoarder sell math, Brian/golden discover, Yazzus 2×/3×,
  Junkyard Titan grant/golden/enemy-side); live — all four render with art + correct text, hand reads clean.

### Revert the hand layout (card placement broke), remove Arclight Reactor, rewire 3 spell arts
- **Reverted the hand-fan rework.** The uniform-height change (absolute drawer) + this session's raise pushed
  the hand UP into the warband drop zone on short/wide viewports — drops landed on the hand instead of the
  board (couldn't play cards) and the hand crowded the centre of the screen. Restored the original, proven CSS
  exactly (in-flow drawer, `bottom: calc(var(--bar-y) - 26px)`, hover `translateY(-5%)`): the hand sits at the
  bottom below the warband again and placement works. **Uniform-height + hover-pop is shelved** — it needs a
  compact-at-rest fan that survives a short viewport, not a raised full-text hand.
- **Removed Arclight Reactor** (`arc`, Mech T4: "when a friendly Mech Shield breaks, deal 3"). Dropped the card
  def (mechs.ts), its combat test (simulate.test.ts), and the stale tribe-blurb mention. The
  `onShieldBreakDamage` factory stays as a reusable primitive (nothing references it now, but it's harmless).
- **Rewired 3 spell arts to the v2 masters** — Eyes of Aresmar → `EyesOfAresmar2`, Growth → `Growth2`, Staff of
  Guel → `StaffOfGuel2` (copied over the in-repo build copies + downscaled to 640px).
- Verified: typecheck + lint + 235 tests (the Arclight test removed); live — hand sits at the bottom with the
  warband clear (placement restored) at both 16:9 and a wide-short viewport.

### Bug fixes: Warden opponent-pin, uncapped Mana Font, hand fan position, Cassen live counter, missing spell art
- **Next opponent no longer shifts mid-turn.** `nextOpponent` matched on the LIVE board power, so any board
  change — buying, selling, or using a Hero Power (Warden's Fortify) — re-rolled the telegraphed foe. The match
  power is now pinned at TURN START (`RunState.turnStartPower`, set in the wave advance + createRun + healed in
  deserialize), so the opponent stays fixed for the whole turn.
- **Mana Font + Nadja's Mana Font are uncapped.** Both clamped max Mana to the cap (10); now they raise it with
  no ceiling. The per-wave growth uses `Math.max(maxEmbers, min(cap, …))` so an over-cap bonus persists instead
  of being clamped away next wave; the StatusBar Mana projection got the same guard.
- **Hand cards sit above the status bar again.** The previous entry's absolute drawer collapsed each card to its
  arch height, so bottom-aligning dropped the arches behind the (z-40, bottom-pinned) status bar. Raised the hand
  zone (`bottom: calc(var(--bar-y) + var(--ch) * 0.78)`); on hover a card lifts + scales and its text drawer flips
  ABOVE the arch, so the full card reads at once.
- **Cassen's Collision counter ticks live in combat.** `useCombatReplay` now exposes `enemyDeaths` (enemy deaths
  landed up to the current beat); Recruit bridges it to the store (`combatEnemyDeaths`) and the StatusBar shows
  `(cassenKills + combatEnemyDeaths) % 5`, so the counter climbs as kills happen (cleared out of combat —
  settleCombat still banks the real total + fires the grants).
- **Wired the missing spell art** — Undead Army, Lasso, Mend (copied from the masters, downscaled to 640px).
- Verified: typecheck + lint + 236 tests (the Mana-cap tests flipped to assert the uncap); live — hand fan + the
  hover reveal, the opponent stays put through a Hero Power, dimmed picker intact. (The Cassen live tick is
  code-verified — combat wasn't driven live this pass.)

### UI/content polish: uniform hand height, Engraved text, Nadja active power, end-of-turn lock, picker backdrop
A grab-bag pass from live playtest feedback.
- **Hand cards now sit at a uniform height.** A forceFull card's text drawer was *in flow* below the fixed
  arch, so a longer drawer (e.g. Gnasher) shoved its arch upward — the hand's arches were ragged. Fix: pin
  the drawer absolutely below the arch **in the hand only** (`.row.hand .card.compact.showtext .drawer {
  position: absolute; top: 100% }`, specificity (0,6,0) to beat the base `.card.compact.showtext .drawer {
  position: relative }`). Every hand card collapses to the archbox height → arches align (verified live: both
  archboxes at y=555, 141 px tall). Drawers hang below as before (full text on hover/inspect).
- **Engraved keyword** no longer self-explains. Gnasher reads "…attacks again and gains **+5/+5**
  **Engraved**." (was "(Engraved — kept after combat)"); the keyword tooltip carries the meaning.
- **Nadja's Mana Font is a proper active power now.** It fires on click (**untargeted** — no minion to pick;
  new `HeroPower.untargeted`) and **costs 3 Mana** (new `HeroPower.cost`; the reducer gates on `embers >= cost`
  and spends it on use). StatusBar dispatches `{type:'heroPower'}` directly for untargeted powers and shows the
  cost ("Mana Font · 3 Mana" / "need 3 Mana"); the `heroPower` action's `uid` is now optional. Verified live:
  click → maxEmbers +1, embers −3, heroReady false, **no targeting line**.
- **Myra** drops the "Locked until turn 3." sentence (the picker's **UNLOCKS TURN 3** chip already says it).
- **Sporeling reworked.** Deathrattle was "+1/+1 a random friend"; now **"Give all friends +1 Attack or +1
  Health (random)"** — a new combat factory `deathrattleBuffAllRandomStat` coin-flips a stat (one flip per
  proc) and buffs every living friend by +amount of it (golden doubles the amount). The Deathsayer/Sylus/golden
  rally tests (which used Sporeling as a 1-buff-per-proc probe) updated to **procs × friends**.
- **End-of-turn action lock.** Rolling/buying/etc. was possible *while the EoT proc beats animated* before
  combat. A new store flag `endTurnAnimating` (set around the beat sequence in `Recruit.endTurn`) disables
  roll/upgrade/freeze, blocks card drags (the pick handler reads `useGame.getState().endTurnAnimating`), and
  locks the hero panel (`canHero`); a stray armed Hero Power is disarmed before the beats. Verified live: with
  the flag forced, all three controls `disabled` + the hero panel reads "spent".
- **Hero picker backdrop** is now the **board art (`/board4.png`) heavily dimmed** instead of a flat tint —
  some texture behind the panels (`.heroselect:not(.endscreen)`; the end screen keeps the flat tint, and the
  now-redundant "show only the blank board" reveal rule was dropped).
- Verified: typecheck + lint + **236 tests** (2 new Nadja hero-power tests: untargeted +1 max / −3 Mana, and a
  can't-afford no-op); live (Nadja run) — hand arches aligned, Gnasher/Myra/Nadja text correct, Nadja click
  fires, EoT controls lock, picker shows the dimmed board art.

### Hero/UI tuning: Cassen tier-cap + no-neutral + kill counter, Myra re-gated, hero-pick hides the chrome
Follow-up tuning on the hero batch + a hero-select polish (from live playtest).
- **Cassen (Collision)** — the grant is now **bound by your tavern tier** (`grantTopTypeMinion` filters
  `c.tier <= state.tier`; no T6 minion at T2 — the same cap was added to **Undead Army**'s conjure); **neutral
  no longer counts as a "type"** (`dominantBoardTribe` skips it, so a neutral-only board grants nothing); and
  the StatusBar shows the live **kills-to-go counter** (`Collision · N/5`).
- **Myra (Pulse)** re-gated to **turn 3** (`unlockWave: 3` restored); the description reads "Locked until turn 3."
- **Hero pick** now shows ONLY the blank board behind the picker — the HUD, tavern, timer, and hero panel are
  hidden until a champion is chosen (`body:has(.heroselect:not(.endscreen)) .app { visibility: hidden }` +
  reveal `[data-zone="warband"]`; the end screen, which reuses `.heroselect`, is excluded).
- Verified: typecheck + lint + **234 tests** (Myra tests moved to turn 3 + a gate test; the Cassen test now
  uses a Beast board + asserts the tier cap); live — the picker hides the chrome, board visible.
- **Still queued:** the Cassen grant should fly out of the hero panel into the hand (mirroring the mid-combat
  hand-grant flourish). The card is added + the `N/5` counter shows; the fly animation is a follow-up.

### Hero roster expansion + retheme + 3 spells (M2 content / M3 heroes)
- **9 heroes now** (was 7). Fresh art for the whole returning roster; **Oner → Indy** and **Sporen → Soren**
  (renamed id + name + art — every reference updated, no functional `oner`/`sporen` left). Two new heroes:
  **Nadja** (active *Mana Font* — press for +1 max Mana; new `gainMaxMana` power kind) and **Cassen** (passive
  *Collision* — new `collision` kind: `simulate` now returns `enemyDeaths`; `settleCombat` banks them on
  `RunState.cassenKills` and every 5 conjures a minion of the board's most-common tribe via
  `grantTopTypeMinion`, keeping the bank if the hand is full). All hero-power names/text reset to the
  canonical wording; Myra's *Pulse* drops its old turn-3 gate (now once-per-turn from turn 1).
- **Tribes Choice** is now `target: 'any'` — cast it on a tavern offer to conjure a minion of that offer's tribe.
- **3 new spells:** **Mend** (T2/4 — heal the hero 5, no overheal; `healHero`), **Undead Army** (T4/4 — conjure
  2 copies of a random Undead; `conjureTribeArmy`), **Lasso** (T3/2 — steal a random tavern minion to hand;
  `stealTavernMinion`). Spell pool 16 → 19.
- Verified: typecheck + lint + **234 tests** (new hero/spell coverage); live — every hero renders its new art
  after a dev-server restart (the `import.meta.glob` re-resolves), and the picker shows Indy/Soren/Nadja/Cassen.
  Built by a subagent to spec; lead reviewed the renames + Cassen carry-back + factories and re-ran the gate.

### Async-PvP groundwork: persist your own boards + friendly/any tavern targeting (M3)
Two framework rigs (balance/content-depth running on the side).
- **Persist your own finished-run boards into the opponent pool.** A finished run is `{ seed, heroId,
  actions }`; on game-over/victory the store re-derives its per-wave boards via `replayRun` (deterministic)
  and appends the non-empty ones to `localStorage['ascent.boards']` (FIFO-capped at 300). At startup the
  store loads them alongside the bootstrap pool (`registerOpponents([...bootstrap, ...stored])`), so future
  runs face boards you actually built. Replay-safe by construction: loaded once at startup (a static session
  pool), only *written* at run-end, never mutated mid-run. New `packages/ui/src/boardLibrary.ts`
  (`loadStoredBoards` / `saveRunBoards`). Verified live: an empty-board run to wave 8 wrote 8 valid snapshots;
  the load re-injects them next startup. This is the localStorage stand-in async-PvP later swaps for a backend.
- **Friendly/any spell targeting — `target: 'any'` can hit tavern offers.** New scope on `CardDef.target`
  (`'friendly' | 'any'`; zod + core types). **Shatter** and **Front to Back** (text says just "a minion", not
  "a *friendly* minion") are now `'any'`: drop them on a **tavern offer** to buff it before you buy. New
  `castSpellOnOffer` (recruit) runs the normal cast effects against a throwaway BoardCard built from the
  offer, then folds the net stat + added-keyword change onto the `ShopCard` (so `buy` bakes it in, like the
  Fortify hero power). UI: a `shopUidAt` drop-target helper (mirrors `boardUidAt`, excludes the pinned spell);
  `castingSpell` / `castTargetUid` / the drop handler + the offer highlight all extended to `'any'`. Verified:
  a unit test (Shatter on an offer → +2/+4 + Taunt → a 3/5 Taunt minion on buy) + the selector matches the 3
  minion offers and excludes the spell. Stat/keyword spells only; gild/devour/tribe-read stay `'friendly'`. (A
  spell that *removes* a base keyword can't subtract it from an offer — a rare edge that resolves once bought.)

### Spell/UX polish: Lantern global aura, Staff buy-buff, DS glow, live spell values, drag fix (M2)
A follow-up pass on the spell batch + VFX, driven by live-playtest feedback.
- **Divine Shield / Reborn made unmistakable.** The compact arched frame sets `box-shadow: none`, so the
  old card-level glow never rendered on resting tiles — and even fixed, a soft halo was too subtle. So a
  shielded unit now gets the full treatment: a **recoloured frame** (bright-gold art border, electric-blue
  for Reborn) + an **inner edge-glow** over the art + a strong pulsing **outer halo** (`.card.compact.dscard`,
  riding the arch) + a big **status badge** (gold shield / blue reborn icon, top-right like the Taunt ward;
  the Taunt ward slides left via `:has` when both are present). Verified live on a shielded Mech: gold frame
  (`rgb(255,210,58)`), 66px badge, and inner/outer glow all render. **Venomous** (the `V` keyword) gets the
  identical treatment in toxic **lime** — recoloured frame + inner glow + outer halo + a lime poison badge;
  a 2nd ward (e.g. Venomous + Divine Shield) stacks below the first via the `~` sibling combinator. When a
  Venomous minion **spends** its venom in combat (the `venomLost` event, already emitted by `simulate`), it
  now flashes lime + a ring puffs out, then sheds the green glow — a guarded impact-merge keeps the
  same-beat retaliation `struck` from clobbering the flourish (a death still wins). Simpler than the
  shield-break shatter. **Tuned 2026-06-22:** the pulsing halo on all three keywords is now a gentle,
  slower breath (smaller range + lower intensity) — the recoloured frame + badge carry the at-a-glance
  signal — and the late-popping `◇` (Divine-Shield break) + `♻` (Reborn) floats were removed (the
  break/reborn ring already reads on its own).
- **Lantern of Souls is now a true global Undead aura** — active in **shop offers, warband, hand, and
  combat** (was combat-only). It **scales with spell power**: base +3 Attack, with spell power folding
  +X/+X onto both stats (so +1/+1 spells → **+4/+1**). New `RunState.undeadHealthBonus`; the recruit
  `shopView`/`instView` overlay it on Undead; `simulate` applies both atk + hp (+ maxHealth) at start /
  on summon / on reborn. The card shows the live value.
- **Staff of Guel → permanent tavern-buy buff.** Was a one-shot buff to the *current* offers; now every
  minion you **buy** from the tavern (not Discovered/conjured) gets +2/+2 for the rest of the run,
  stacking + scaling with spell power. New `RunState.tavernBuyBonus`; baked on buy via `addBuff`, shown
  folded onto offers in `shopView`.
- **Live card values everywhere.** `spellDisplayText` now also renders **Front to Back**'s escalating
  grant (base + accumulated `frontToBackBonus` + spell power) and **Staff**'s spell-power-scaled value —
  threaded through `instView`/`shopView` — so a card always reads its real current value.
- **Mana Font:** raises *max* Mana only; current Mana is no longer topped up that turn.
- **Refresh:** shows **0** (and stays enabled) while free rerolls are banked.
- **Spell drag fix:** a targeted spell now only applies on an **explicit drop** onto a minion — the old
  `carryUid` auto-target silently buffed a random minion when released in empty space.
- **Hero-select** panels + the title/eyebrow above them sized up **~30%**.
- **Art "not wired"** was a stale Vite `import.meta.glob` in the running dev process (a browser reload
  doesn't re-run it) — a real process restart picks up the new spell/hero art; the build always had it.
- Verified: typecheck + lint clean, **226 tests** (Mana-Font/Staff updated for the new behaviour; Lantern
  health + spell-power scaling and Front-to-Back/Staff live display added).
- **Still queued:** the friendly/**any** tavern-targeting rule — dropping a non-"friendly" spell (Shatter,
  Front to Back) onto a tavern offer to buff it pre-buy. See roadmap.

## 2026-06-21

### 11 new spells + Drakko (7th hero) + UI polish (M2 content / M3 heroes)
A big content drop — the spell pool more than triples (5 → 16) and a quest hero lands.
- **Spells** (all art-wired): **Shatter** (T3, +2/+4 + Taunt toggle), **Tribes Choice** (T2, conjure a random
  minion of the target's tribe ≤ tavern tier), **Refreshing Texts** (T2, 2 free rerolls), **Eyes of Aresmar**
  (T6, gild a ≤T4 minion), **Mana Font** (T2, +1 max Mana permanently), **Sprout** (T1, Discover a T1), **Staff
  of Guel** (T3, +2/+2 to the whole tavern), **Summon Stone** (T1, a random T1 to hand), **Front to Back** (T4,
  +2/+2, +2/+2 more per cast this run, + spell power — linear), **Help Wanted** (T4, Discover a Battlecry
  minion), **Lantern of Souls** (T4, your Undead get +3 Attack for the rest of the game — re-applied every
  combat to current + summoned + reborn Undead).
- New spell factories (`recruit.ts`): `spellBuffTarget` gains a `toggleKeyword`; + `spellGainOfTargetTribe`,
  `spellGainRandomMinion`, `grantFreeRolls`, `gainMaxMana`, `spellBuffShop`, `spellGildTarget`,
  `spellBuffTargetEscalating`, `spellGrantTribeAttack`. New `RunState`: `freeRolls`, `frontToBackBonus`,
  `undeadAttackBonus`, `drakkoBuys`. `offerDiscover` generalized (fixed tier / card filter) for Sprout +
  Help Wanted. Lantern threads `undeadAttackBonus` into `simulate` (baked into player Undead at start + on
  summon/reborn). New `CardDef.targetMaxTier` gates Eyes' gild to ≤T4. (The core `EffectFactoryId`/`CardDef`
  TS types are a second source of truth alongside the zod schema — both updated.)
- **Drakko** (7th hero, 30 HP) — a new `quest` power: buy 5 Battlecry minions → a free **Drakko the Drummer**
  (StatusBar shows N/5).
- **UI:** removed the hero-select flavor text; **Grim** shows its *live* Deathrattle value (the printed
  "+1/+1" becomes the current "+N/+N" from the run tally, via `tallyBuffText`).
- Built by a subagent to a detailed spec, then reviewed + verified here. Verified: typecheck + lint clean;
  **224** tests (+17 for the new mechanics: Front to Back escalation, Lantern combat bonus, free rolls, Mana
  Font, Drakko quest, Eyes ≤T4 gate, Tribes Choice, Shatter toggle, Grim live text); live — app loads clean,
  flavor gone, no console errors. Art for all 12 copied + downscaled to 640px (also shrank ~16 oversized
  existing PNGs — minions art 87 → 55 MB).
- Flags: Eyes of Aresmar's ≤T4 restriction is **factory-enforced** (a >T4 pick is consumed + no-ops), not yet
  UI-gated. Tribes Choice on a neutral target conjures a neutral minion.

### Damage-dealt system + combat-flow fixes (M3 — difficulty from real boards, steps 4–5)
Real boards now hit back, the combat flow is fixed, and a finite-pool hole is closed.
- **Loss damage** = the opponent's **tavern tier + Σ(tiers of their surviving minions)** (`simulate`, new `enemyTier`
  param; a tier-4 board surviving with a T4 + T3 → 4 + 4 + 3 = 11). `faceOmen` passes the served board's tier (the
  player's tier for the procedural fallback). **Round cap** (`lossDamageCap`, run-side): 5 through wave 3, 10 through
  wave 6, 15 from wave 7.
- **Damage is dealt at the end of combat, not on shop return.** Split the post-combat reducer into `settleCombat`
  (outcome + damage, fires on `replay.done` — Resolve drops in the combat view) and `advanceCombat` (terminal check +
  next wave, on "End Combat"). `resolveCombat` settles-then-advances, so skipping the replay still applies the hit.
  New `RunState.combatSettled` + a phase-guard exception for `settleCombat`.
- **Combat-skip restart fixed.** `settleCombat` runs through the reducer's `structuredClone`, minting a new
  `lastCombat` reference; the replay hook + combat-stage effect key on it and reset → the combat replayed from the
  top (damage applied once, since settle is idempotent — hence "no extra damage"). Fix: `settleCombat` preserves the
  original `lastCombat` reference (it never changes its content).
- **Enemy death reflow fixed.** The `enemyarrive` rule was more specific than `.unit.dying` / `.unit.summoned`, so it
  overrode their collapse/expand on enemy units (the warband has no arrival rule, so it reflowed). Excluded
  dying/summoned units from the arrival rule.
- **Discover / finite-pool hole fixed (the "8 Grim").** `offerDiscover` offered cards regardless of remaining pool
  copies; picking an exhausted one gave a *free* copy beyond the stock (`takeFromPool` floors at 0). It now offers
  only cards with copies left — you can't exceed `POOL_QUANTITIES`.
- Verified: typecheck + lint clean; **207** tests (formula, round cap, `lossDamageCap`, `settleCombat`-reference,
  Discover-pool); live — Resolve drops in the combat view (30→28) with no restart (board combat: `fighting` stayed
  stable), and an enemy `.unit.dying` now resolves to `dyingcollapse`.

### Serve real player boards + opponent-intel frame (M3 — difficulty from real boards, steps 2–3)
The game now fights **real captured boards** instead of procedural omen blobs, with a telegraph of who's next.
- **Bootstrap opponent pool** (`snapshot.ts`): `buildBootstrapPool()` greedily auto-plays a fixed set of
  seeded bot runs (one per hero, for varied portraits) and captures the per-wave board each fought — real,
  buildable `BoardSnapshot`s. Deterministic (fixed seeds + seeded engine), so the pool stays *static* the way
  `OPPONENT_POOL` requires (replay-faithful). `registerOpponents()` appends to the pool, and the **store
  injects the bootstrap once at startup** — the headless harnesses + tests leave the pool empty (procedural
  baseline, zero test churn), so only the app serves real boards.
- **Serving** was already wired in `faceOmen` (`pickOpponent` → `opponentBoard`, else procedural). Extracted
  the pick into **`nextOpponent(s)`** (the board the next fight serves at the current board power, or null →
  procedural) so the opponent frame previews exactly what the fight resolves; byte-identical fallback.
- **Opponent-intel frame** (`OpponentFrame.tsx`, top-right under the tribes): the next opponent's **hero
  portrait + HP**, with **tavern tier · triples · top tribe** (`dominantTribe`) on hover. A real captured
  board when the pool matches; the threat name as a light telegraph on the procedural fallback. Recruit-phase
  only, and it firms up as you build (the match is power-based).
- Verified: typecheck + lint clean; **202** tests (a bootstrap-pool determinism test + an end-to-end
  `faceOmen`-serves-a-real-board test; the old "pool empty → omens" test kept as the headless baseline); live
  — the wave-1 enemy was a real Spare Part Drone (not an omen), and the frame showed "Oner — 30 HP, Tavern
  tier 1, 0 triples, 1 mech".
- Deferred: **persisting your own boards** into the pool — it must stay static (load-at-startup), not
  live-accumulating, or replays stop being byte-identical. Next: the **damage-dealt system** (loss damage from
  opponent tier + surviving minions) so the served boards become consequential.

### Snapshot enrichment + run-wide triples counter (M3 — difficulty from real boards, step 1)
First step of the real-player-board opponent arc: make `BoardSnapshot` a complete *opponent-intel* atom.
- **Run-wide triples counter** — new `RunState.triplesMade` (init 0), incremented in `checkTriples` each
  time a golden is formed (once per merge, including chained merges in the guard loop). It's plain run
  state, so the full-state `serialize` persists it through save/resume + replays automatically.
- **Enriched `BoardSnapshot`** (`snapshot.ts`) with the three fields the opponent frame needs that weren't
  captured: `resolve` (the run's HP at capture — full pre-combat), `tier` (tavern tier at capture), and
  `triples` (`triplesMade` at capture). `snapshotBoard` populates them; the schema stays `v: 1` (no
  snapshots are persisted yet — they're regenerated from the replay, so there's nothing to migrate).
- **`dominantTribe(snap)` helper** — the "5 undead" readout. Snapshot minions carry only `cardId`, so it
  resolves tribes via `CARD_INDEX`, counts **dual-types for both** their tribes, and returns
  `{ tribe, count }` (ties → first seen on the board) or null for an empty board. Exported via the package
  index, so the frame can call it directly.
- Verified: typecheck + lint clean; **200** tests — `triplesMade → 1` asserted on the Spirit-Pup triple
  test, a new snapshot test checks resolve/tier/triples + `dominantTribe`, and the opponent-pool test's
  hand-built snapshot literal updated for the new fields. No UI yet (the frame that reads these is step 3).
- Next in the arc: step 2 — populate the (already-present) `OPPONENT_POOL` from seeded runs via `replayRun`
  and wire `buildEnemyBoard`/`pickOpponent` to serve wave-matched real boards (procedural = thin-pool fallback).

### Remove Cleaver · Spirit-Pup triple keeps spell counter · demon-gated Fodder · buy-below-line + buy zone (M2)
- **Removed Ravenous Cleaver** (the lone default **Cleave** minion). Gone from `beasts.ts` and
  `docs/cards.csv`; the ~7 test/harness spots that used it as a generic vanilla beast now use **Alleycat**
  (its only effect is a recruit-time Battlecry — inert in combat), and the Cleave combat test keeps an
  explicit `keywords: ['C']` so the keyword + cleave logic stay covered. *Flag: no card carries Cleave by
  default now; the keyword still works on anything granted `['C']`.*
- **Tripling Spirit Pups keeps the best spell counter.** `checkTriples` now gives the golden the
  **highest `spellProgress`** of the three copies (= the lowest spells-left): a Pup 2-from-evolving merged
  with one 8-from-evolving yields a golden 2-from-evolving. (`spellProgress` counts *up* to 10, so
  max-progress = min-remaining — `Math.max(...combined.map(c => c.spellProgress ?? 0))`.) New test: 8/2/5
  → golden 8.
- **Fodder only enters the tavern with a Demon to eat it.** `injectPendingTavern` now gates on a Demon
  being on board: with one, queued Fodder is injected and immediately consumed (as before); with none, the
  Fodder is **wasted** — not added to the shop, and never stored (`pendingTavern` is always cleared). Stops
  Fodder-spawning cards from cluttering a Demon-less tavern with un-buyable garbage. The no-Demon test
  flipped to assert waste + empty `pendingTavern`.
- **Buy by dropping anywhere below the warband line.** New `inBuyRegion` mirrors `inSellRegion`: a shop
  card released *below* the warband line — the whole lower screen (warband row, the gap, or the hand) —
  buys it, instead of only a pinpoint drop on the hand zone. It resolves to `zone: 'hand'`, so the existing
  buy path (`source 'shop' && zone 'hand'`) fires and the hand glows as confirmation. Bounded by the screen
  bottom (can't go too low), just as the sell region stops at the line.
- **Buy zone box (mirror of the sell zone).** Added a `.buyzone` overlay — vertical mirror of `.sellzone`:
  bottom-anchored (`top` set inline to the warband line, `bottom: 0`), accent tint strongest at the bottom,
  dashed boundary at the **top** (the warband line), and a **"BUY" pill** at bottom-center; lights up
  (`.on`) once a shop card crosses below the line. `buyTop` is measured on shop-drag start (like `sellTop`).
- Verified: typecheck + lint clean; **199** tests (cleaver→alley swaps, fodder test flipped, +1 Spirit-Pup
  triple test); live in the dev preview — a shop card dropped 60px below the warband line bought it (hand
  `0→1`, shop `4→3`, hand glowed), and the buy-zone box renders mirroring the sell box, no console errors.

### Flowing Monk references Engraved · Beatboxer stacks Clings · Combinator nerf (M2)
- **Flowing Monk** text now references **Engraved** ("…give a random friendly minion +3/+3 (Engraved —
  kept after combat)"). Its gift was already permanent; the text just didn't say so.
- **Beatboxer counts toward Cling stacking** — its mimicked Cling copies are magnetizations too, so each
  bumps the Cling Drone improvement. Cling-stacking now routes through `weldMagnetic` (host weld + each
  Beatboxer copy, ×golden) so it's counted in one place; the separate caller increments were removed. A
  golden Beatboxer's two copies both stack.
- **Combinator nerf** — golden now scales the **number of Mechs** (1 → 2), not Clings-per-Mech: non-golden
  magnetizes 1 Cling onto 1 Mech, golden onto 2 (was: 1 Cling onto 2 Mechs, golden 2 Clings onto 2).
- Verified: typecheck + lint clean; **198** tests (Combinator tests updated for the nerf + 2 new Beatboxer
  cling-stacking tests); live (Flowing Monk renders the Engraved reference).

### Grim → +1/+1 per Deathrattle triggered this game (M2)
Grim's Deathrattle now scales: your Beasts get **+1/+1 for each Deathrattle triggered this game**
(whole-run), instead of a flat +6/+6. A run-wide counter (`RunState.deathrattlesTriggered`) tallies your
Deathrattles as they fire and persists across fights (accumulated in `advanceAfterCombat` from each
combat's `playerDeathrattles`); it's threaded into `simulate` as a base, and Grim snapshots the live total
(base + this fight's player Deathrattles, including its own death) when it dies, registering a +X/+X
rest-of-combat aura. New factory `deathrattleBuffTribeByTally` + `ctx.deathrattleTally()`. Golden = +2/+2
per Deathrattle. Verified: tests (run-wide base 5 + Grim → +6/+6; the 4 existing Grim-buff tests updated
to the new scaling); live (base 4 + Grim → +5/+5). *Flag: scales hard late-run — tunable via `per`/a cap.*

### Blaster blast VFX + Taunt, Cling Drone escalation, revert to procedural omens (M2 / M3)
- **Blaster** gained **Taunt**, and its Deathrattle now fires **purple blast bolts** at everything it
  hits: the replay detects a Blaster `death` event (via a uid→cardId map) and shoots a `.proj.blast`
  bolt from the dying Blaster to each AOE-damaged target in that beat — parallel to the SC-bolt path,
  styled purple (`kind: 'blast'`). Verified live: bolts render (up to 6 at once), no console errors.
- **Cling Drones improve +1/+1 per magnetization** — a persistent `cling` run enchantment
  (`improveClingDrones`, modeled on Ritualist's Fodder): each Cling welded bumps it +1/+1 and grows any
  Clings already in hand / on board; future Clings (shop or Combinator) carry it. **Combinator** welds
  Clings at their enchanted stats and scales the enchantment by however many it welds, so a Combinator
  board ramps Clings fast (the "scales with Combinator procs").
- **Reverted to procedural omens for every wave** — `OPPONENT_POOL` is now empty, so `pickOpponent`
  returns null and `faceOmen` always falls back to `buildEnemyBoard`. The step-4 seam stays intact;
  real boards return by populating the pool (the board library, soon).
- Verified: typecheck + lint clean; **195** tests (added Cling enchantment ×2; updated the step-4 +
  Gnasher-damage tests); live (blast bolts render).

### Engraved keyword + 4 new cards + tier-gated spell offers (M2)
- **Engraved (keyword `EG`)** — a minion with Engraved keeps the stat gains it accrues in combat: every
  `ctx.buff` on it accumulates into `permaGain`, which the run loop carries back to the board after the
  fight. Generalizes Flowing Monk's permanent gift (the Monk now records `permaGain` only for its
  *non*-Engraved recipients, since `ctx.buff` already accrues it for Engraved ones). Carry-back is
  labelled "Engraved" (vs "Flowing Monk" for the Monk's own gift). UI: pill + anvil glyph.
- **Gnasher → T6**, now **Engraved** with an on-kill **+5/+5** (`onKillBuffSelf`, fired by the existing
  `onKill` event) — it snowballs permanently as "the Overrun." (Side effect of Engraved: *all* of
  Gnasher's combat gains persist, not only the on-kill — deliberate, easy to narrow later.)
- **4 new cards** (+ art): **Beatboxer** (T6 Mech 8/8) mimics every magnetization that lands on another
  unit — the player's magnetic-drop (reducer) and Combinator's weld (recruit) now both route through a
  new `weldMagnetic(state, host, mag)` helper that also mirrors onto any Beatboxer (golden = 2×; a weld
  directly onto a Beatboxer counts once). **Blaster** (T4 6/3) Deathrattle deals 3 to ALL minions on both
  sides (`deathrattleDamageAll`). **Jenkins & Fi** (T5 3/2) Deathrattle destroys the killer — `killOrReborn`
  + the `onDeath` event now thread the `killer` (the source of the lethal hit) → `deathrattleDestroyKiller`.
  **Venom** (T3 1/1 Venomous).
- **Omega Bulwark removed** (its `scGrantShieldTribe` primitive is kept but now unused — a future Mech
  shield-wall card can reuse it). **Selfless Sentinel** art re-wired — the previous file was corrupt;
  re-copied clean from source (renders correctly now).
- **Spell offers respect the tavern tier** — `drawSpellId` filters `SPELL_CARDS` to `tier ≤ tavern tier`,
  so a T2 shop no longer offers the T5 Devourer (now gated like minions).
- Verified: typecheck + lint clean; **193** tests (added Engraved/Gnasher, Blaster, Jenkins, Beatboxer ×3,
  spell tier-gate); live on a fresh build — all five arts render (incl. the Selfless fix), Engraved +
  Venomous pills show, Gnasher/Beatboxer/Blaster/Jenkins read T6/T6/T4/T5.

### Step 4 — serve real opponent boards + Grim persistent aura + board4 (M3 / M2)
- **Serve real boards (M3 step 4)** — new `packages/sim/opponents.ts`: a STATIC, versioned `OPPONENT_POOL`
  of `BoardSnapshot`s + `pickOpponent(wave, power, rng)` (matches by wave ±1, then closest power within a
  tolerance; returns null → procedural fallback, so a thin pool degrades gracefully). `faceOmen` now serves
  a strength-matched real board when one exists, else the procedural threat — getting us off the random
  `omen` blobs for matched waves. The static pool keeps opponent selection deterministic / replay-faithful
  (a live pool would break byte-identical replays); the board library grows it in batches. Seeded with
  bootstrap real-card boards (waves 2–5). `pickOpponent` consumes the rng only when it serves, so an
  empty/no-match pool leaves the procedural board byte-identical.
- **Grim → persistent aura** — `deathrattleBuffTribe` registers a rest-of-combat tribe aura
  (`ctx.addTribeAura`) that the summon path applies to every matching friend summoned *afterward*, so a
  Beast summoned post-Grim also gains +6/+6 (Reborn-safe; multiple Grims stack). The card text already
  said "for the rest of combat" — the code now matches it.
- **board4** wired as the board background (`apps/web/public/board4.png` + the `.app` CSS), as a swap-test.
- Verified: tests (Grim aura isolation — Pups summoned after Grim still get +6/+6; `pickOpponent` matching
  + `faceOmen` serving real cards); live (board4 renders; the Grim/opponent logic is engine-tested).

### Golden Corrupted Lifebinder mirrors double its partner (M2)
A golden (tripled / Gilded) Corrupted Lifebinder now gains **2×** its linked demon's stat gains, in
both phases: recruit (`syncLifebinders` — `linkApplied` tracks the mirrored magnitude, so flipping to
golden mid-link tops it up to 2×) and combat (`mirrorLink` doubles the buff when the Lifebinder is
golden). Tests: a golden Lifebinder mirrors a +1/+1 Fortify as +2/+2 (recruit) and Grim's +6/+6 as
+12/+12 (combat). **185** tests pass; typecheck + lint clean.

### Content + combat + UX batch — spells, hero-power triples, juice, cursors, art (M2)
A large multi-session batch, committed together. Highlights by area:

**Spells & the cast system.** A spell-power-aware cast pipeline (`castSpell` → `applyCastEffects`
iterating `cast` effects; `spellStatBonus` amplifies stat grants — e.g. the Spellbinder hero). Two new
spells: **Growth** (T4 neutral, +3/+4 to your whole board, **scales with spell power**) and
**Channeling the Devourer** (T5 neutral, `singleCast`: devour a targeted friendly minion and transfer
its full stats to a random *other* friend, animated as a GSAP stat-projectile). The `singleCast` flag
(schema + `CardDef` + the cast factory) blocks spell-quantity multipliers from double-firing the
devour. **Spirit Fire** retuned to T2 +4/+4. Display text substitutes the spell-power-boosted "+A/+B"
with a highlight (`spellBuffAll` now included alongside `spellBuffTarget`).

**Triples after hero powers (bug fix).** Every card-adding path (`buy` / `play` / `chooseOne` /
`battlecryTarget` / `discover`) ran `checkTriples`, but the `heroPower` case did not — so Myra's
Encore summoning a 3rd Stray (a replayed Alleycat Battlecry) never combined into a golden. Added
`checkTriples` to the heroPower case; safe because `replayBattlecry` / `replayEndOfTurn` resolve with
an auto-target fallback and never leave a pending pick. Regression test added (`run.test.ts`).

**Combat rules & juice.** 0-Attack units skip their attack (no dead swing) and Attack now clamps at 0
(no negatives). **GSAP attack lunge** — wind-up → strike (`power3.in`) → defender knockback → elastic
settle, with GSAP owning the attacker transform so React never fights it. **Flowing Monk's** mid-combat
+X/+X gifts are now permanent (carried back to the run board as a tracked buff). **Death reflow**
reworked from a two-phase JS FLIP (death pop one beat, slide the next — read as janky) to a single
synchronized CSS slot-collapse: the dying `.unit` collapses its own flex slot (width→0; a −22px end
margin swallows one row-gap so the eventual unmount doesn't snap) *as* it plays the death pop, so the
survivors glide into the gap in one phase. Verified smooth with an `offsetLeft` sampler (max ~21px /
frame, zero >40px jumps; the old behaviour snapped ~125px). Reborn-safe — a reborning minion emits
only `reborn`, never `death`, so it never gets the collapsing class.

**UI/UX.** Round timer reworked: **18s on wave 1, +4s/round, cap 80**. End screen gained the **hero
portrait** + right-click/hover board **inspect**. Cursor fixes: hero-select flicker, and the
end-screen cards + Play-Again button now use the **gauntlet cursors** (they were pinned to the OS
`default` / `pointer`). Top-UI **tooltip z-index** (tips no longer hide behind elements); the hero
panel no longer shrinks on power-select (larger art); a more detailed **procs log** (Echo Warden impact
attributed); the **warband holds its position shop→combat** (the rope no longer pushes it down; rope
re-centered); hand cards sit a bit lower.

**Maw of the Pit** reworked → "at the end of your turn, add a Fodder to the next refresh."

**Content removals/renames.** Removed Ghastweaver, Plaguebringer, Bristleback Matron, Ravening
Glutton; Pack Scrounger → **Mama Pup**.

**Art wired.** Mama Pup, Omega Bulwark, Maw, **Gnasher** (`gnash`), **Karwind** re-pointed to the new
**Karwind2**, Growth, Devourer (+ pup / pup2 / junk / selfless / pack variants).

**Tooling.** Added **GSAP** (`gsap` 3.x) to `@game/ui`. Added **context7** as a project MCP server
(`.mcp.json`, hosted HTTP transport) for up-to-date library docs.

Verified: typecheck + lint clean; **183** tests pass (incl. the new hero-power-triple regression); live
— end-screen cursors (computed-style), gnash + Karwind2 art rendering, the reflow `offsetLeft` sampler,
and both new spells casting correctly.

## 2026-06-20

### Board snapshot + replay pipeline (M3 — difficulty learns from real boards · step 2)
The capture foundation for the player-board → async-PvP arc:
- **`@game/sim/snapshot.ts`** — a serializable **`BoardSnapshot`** (the fought board as a clean
  `BoardMinion[]` + wave / hero / tribes / threat / result / Σpower / seed; run-specific instance refs
  dropped, so it drops straight into `simulate` as a strength-matched enemy), `snapshotBoard(run)` to
  extract it, a **`Replay`** = `(seed, heroId, action-log)`, and **`replayRun(replay)`** which re-runs
  the log deterministically and yields the per-wave snapshots. The engine is fully seeded, so a whole
  run is **~1 KB** (not a board dump) and replays byte-identically.
- **Store** — records the run's action log (`replayActions`, reset per run) + **`exportReplay()`**
  (DEV: grab a real run via `useGame.getState().exportReplay()`). Verified live: 3 actions → a 117-byte
  replay.
- **`npm run replay`** (replay-harness.ts) — records a bot run → replays it → verifies it's
  byte-identical → dumps the per-wave board snapshots. Faithful across seeds (1.1–1.6 KB replays).
- Tests: `snapshot.test.ts` (round-trip fidelity + determinism). typecheck + lint clean; **179** pass.
- *Next:* step 3 — the board library (persist + index by wave/power/tribe + a `pickOpponent` query).

### Compact "Pixel Arena" card overhaul — arched frame + text drawer (M1/M2 UI)
A full pass on card presence (the player loved the direction; locked in). Every card is now one
universal **arched frame** with a `density` model instead of the old always-on rectangle:
- **Compact at rest** (shop / board / combat): a shrunk (`--ccw` = 0.85×`--cw`), arch-shaped art tile —
  the sprite fills an arched frame (tribe-coloured border + gold inner line) in a fixed-square
  `.archbox`, with gold-set circular attack/health badges in the corners, the tier pill on top, and a
  **mechanic medallion** (the card's primary keyword/trigger glyph) eclipsing the arch base. Name,
  pills, rules text and the flat minion cost are all gone at rest.
- **Full = arch + drop-down text drawer**: on hover (the reveal popup), in hand, on right-click inspect,
  or with the always-on-text setting, a text drawer (name → pills → rules text → tribe) drops down from
  the frame. Right-click always shows the full card regardless of the compact setting. Combat cards are
  the same size as the shop (the `.unit` wrapper was stretching them to full height — fixed).
- **Glyph set completed** (all 13 keywords have an SVG) and consolidated; the hover reveal shows the
  full card + any referenced cards trailing to its right. An Esc-menu **Compact / Full-text toggle**.
- **Dual-type** frames now split tribe1→tribe2 as a gradient arch border (the old squared rim is gone).
  **Spell** label is a readable white banner. **Golden/tripled** cards get a gold arch frame + crown
  emblem (easy to pinpoint in a row, not loud). **Discover** panel is transparent with arched cards.
- **End-of-run screen** scaled ~2.5× with single-row pips + warband (no wrap).
- New **Spirit Pup / Worgen** art rewired.
- Verified live across shop / hover / hand / inspect / combat / discover / end-screen; typecheck + lint
  clean. (A few transient `<Card>` console errors during editing were intermediate-HMR / synthetic-test
  artifacts — a clean reload renders with zero errors.)

### Balance tooling — enemy + player difficulty curves (M2)
Two headless analysis tools (deterministic, re-run after any tuning):
- **`npm run curve`** (`enemy-curve.ts`) — per-wave enemy board power Σ(atk+hp), width, unit stats, the
  narrow→wide threat-power spread, and a fixed reference board's win%. Found: power is ~linear (4→255
  over w1–20), a sharp **wave-6 wall** (power 45→75, ref win% 56%→23%), discrete +1-unit steps at
  w6/12/18, and ~4× threat variance (Glass ≫ Venom).
- **`npm run player`** (`player-curve.ts`) — a competent-but-naive greedy bot (best buy, tavern-up,
  sell-up, Hero Power; no synergy/triples) plays full runs × all heroes; snapshots the board it fought
  each wave + outcome, printed against the enemy curve. Found: naive play floors at ~wave 9.3, bleeds
  the early game (win% 7–31%, 0% at w6), and the late game is survivorship. A floor, not the ceiling —
  motivates the replay tool for real human curves.

### Direction set: PvE/PvP difficulty learns from real player boards
North star recorded in the roadmap: capture player boards → a strength-indexed library → serve them as
strength-matched enemies (procedural threats become the bootstrap/fallback) → **async PvP** (every wave
a friend's snapshot; win = 10–15 wins without dying; tiny shared backend). This **demotes manual
counter-matrix tuning** — captured boards drive difficulty; the curve tools become its validation harness.

### Spirit Worgen procs in combat too + spell-pool target set to ~40
- **Worgen combat proc.** The Worgen's "+X/+X per Beast/Dragon summoned" was **recruit-only**; now it
  also fires **mid-fight** when a friendly Beast/Dragon is summoned (deathrattle tokens, etc.). Added a
  **combat-side `summonBuffSelfTribe`** factory in `@game/core` (the same effect id already had a
  recruit factory — so the one card def fires in both phases). X = `1 + spellsThisTurn`, threaded into
  combat via a new optional `simulate(..., spellsThisTurn = 0)` param + `CombatContext.spellsThisTurn`
  (frozen at combat start; faceOmen passes `s.spellsThisTurn`). The combat gains are **temporary** —
  combat is a simulation, so they never touch the run board and the Worgen is back to its recruit stats
  next shop. Interpreted the user's "reset back to 1/1" as "back to its recruit-phase stats" (flagged to
  confirm). The eventual T6 ("adjacent units keep combat buffs") will be what carries these back.
- **Spell-pool target: ~40** (was 3). Recorded in `card-audit` (a `need` column for spells) + the
  roadmap — spells are a core pillar feeding the Pup/Worgen + Rohan archetype, so the pool wants depth
  across tiers.
- Verified: `typecheck` + `lint` clean, `test` **176** pass (+3: combat proc scales +5/+5 with 4 spells
  / +1/+1 with none, and the gain is temporary — run board unchanged after combat); determinism harness
  OK (existing callers default `spellsThisTurn` to 0). *(Live check skipped — it's a combat-internal
  effect the buff-event tests cover directly; the dev server was down with the user away.)*

## 2026-06-19

### Lifebinder mirrors End-of-Turn gains before combat + Spirit Worgen reworked to per-turn scaling
Two fixes from playtest feedback:
- **Corrupted Lifebinder timing bug.** A Lifebinder bound to a minion that an **End-of-Turn** effect
  buffs (e.g. Combinator magnetizing onto a Demon/Mech) didn't mirror the gain until the *next* turn —
  so it fought that combat without it. Root cause: `syncLifebinders` only ran in the reduce wrapper,
  *after* `faceOmen` had already snapshotted the combat board. Fix: call `syncLifebinders(s)` inside
  `faceOmen` right after `applyEndOfTurn`, before the snapshot. Now the mirrored gain is in the board
  the Lifebinder fights with. (Regression test: Ritualist EoT buffs a linked Fred → the Lifebinder is
  +1 in `lastCombat.initial`.)
- **Spirit Worgen reworked: per-turn, not per-game** (the old all-game spell buff was too strong, per
  the user). New text: **"Gains +X/+X each time you summon a Beast or Dragon — improves per spell cast
  this turn,"** where **X = 1 + spells cast this turn**. So cast 4 spells then play an Alleycat (it +
  its Stray = 2 Beast summons) → +10/+10. New `RunState.spellsThisTurn` (incremented on cast, reset each
  wave) drives it; `summonBuffSelfTribe` now scales with it, the transform no longer applies a
  retroactive buff (it just keeps the Pup's stats), and the card shows its **current** +X/+X live
  (`summonScalingText`, green). The Pup's "10 spells → transform" countdown is unchanged.
- Verified: `typecheck` + `lint` clean, `test` **174** pass (Worgen suite rewritten: scales with
  spells-this-turn, the Alleycat+Stray = +10/+10 case, resets each wave, ignores neutrals; + the
  Lifebinder timing test). Live: the Worgen reads "+1/+1" → "+5/+5" after 4 spells, and a played Dragon
  took it 4/6 → 9/11.

### New minion: Spirit Pup → Spirit Worgen (a transform card + spell payoff)
First **transform** card, and a meaty spell-synergy build-around (Beast pool 8→9).
- **Spirit Pup** (T5 **Beast/Dragon**, 4/6): cast **10 spells with it on board** to transform into the
  Spirit Worgen. A new per-instance counter (`BoardCard.spellProgress`) ticks on each `spellCast`
  while the Pup is on the board; the card text shows a live **"N to go"** countdown (green, via the new
  `transformProgressText`).
- **Spirit Worgen** (T5 Beast/Dragon): **keeps the Pup's stats** at transform (only the cardId swaps →
  new art + effects), and **gains +1/+1 per Beast or Dragon summoned** *and* **+1/+1 per spell cast this
  game**. The spell buff is **retroactive** — at transform it applies the *global* all-game spell tally
  (e.g. 3 spells before the Pup + 10 with it → +13/+13), not just the 10 toward the transform; then it
  keeps climbing +1/+1 per future spell. (It's a non-buyable `token: true` card — obtained only via the
  Pup — so it stays out of the shop pool while living in `CARD_INDEX` for the transform + its art.)
- **New reusable primitives:** `spellCastTransform` (tick → transform at a threshold, keeping stats +
  applying a retroactive per-spell buff), `spellCastBuffSelf` (+atk/+hp per spell), `summonBuffSelfTribe`
  (+atk/+hp when a friendly minion of given tribes is summoned). Added to `EffectFactoryId` + the zod
  enum. Art wired (`spiritpup.png` / `spiritworgen.png`).
- Judgement calls (flag if any should change): the Worgen's base 4/6 is just the schema floor (it keeps
  the instance stats); **"summoned" counts recruit-phase plays/token-summons** (so the buff is permanent),
  not combat summons; the Pup only counts spells cast while on the **board** (not in hand).
- Verified: `typecheck` + `lint` clean, `test` **172** pass (+4: transforms at 10 keeping stats +
  retroactive; retroactive counts all-game spells; Worgen +1/+1 per spell; +1/+1 per Beast/Dragon, not
  neutral). Live (fresh server re-globs the art): the Pup shows "10 → 5 to go" as spells cast, then
  transforms into the 14/16 Worgen with its art + dual-tribe footer.

### End-of-run screen (final board + W-L-W summary) + hero choices 3→2 + Sporen verified
- **End screen.** `GameOver` + `Victory` are unified into one **`EndScreen`** styled like the hero
  picker: the outcome title (gold "VICTORY" / red "FALLEN"), a round-by-round **W-L-W** pip strip, the
  **final warband** (the real Cards, shrunk via `zoom`), and **Play Again** (→ picker). New
  `RunState.history: CombatOutcome[]` records every combat's result in `advanceAfterCombat`; the pips
  read it (green W / red L / grey D). Verified live both ways (FALLEN wave 8 with "WWLWWLWL"; VICTORY
  "Survived all 20 waves", gold title).
- **Hero picker offers 2** now (was 3) — `HERO_SELECT_COUNT`.
- **Sporen ("Reclaim") — investigated, it works.** Confirmed end-to-end that the marked minion is
  destroyed at start of combat (Deathrattle fires) and an **exact copy is resummoned when there's
  room** — proven by a live combat (the resummoned Pack Scrounger 20/39 stood on the board beside its
  2 Pups) and the sim across every board state. The one no-copy case is a **full board**: the freed
  slot goes to a summoned token (precedence, as specced), so no room for the copy. Locked it with two
  regression tests (vanilla-with-room → 1 copy; full-board → 0 copies, a Pup takes the slot). No sim
  change was needed. *(The blank-screen / `<Recruit>` errors seen while probing were my forced
  mid-combat `setState`, not a real bug.)*
- Verified: `typecheck` + `lint` clean, `test` **168** pass (+2 Sporen regression). Live: end screen
  both outcomes, 2-hero picker, clean normal flow.

### Echo Warden works for *any* summon (moved to the summon chokepoint) + per-unit "copy"
- **Text:** "In combat, your summon effects **summon 1 more copy**" (golden: 2 more copies) — was
  "make 1 more **token**".
- **Now general, not token-only.** The echo moved from being read inside specific token-summon
  factories (`deathrattleSummon`, Brood Matron's `onFriendDeathSummon`) into the **single summon
  chokepoint** — a new `summonMinion()` in `simulate()`. So *every* combat summon is echoed, including
  non-token ones like `deathrattleFillTribe` (which summons real minions and was previously ignored),
  and any future summon effect — automatically. Recursion-guarded by an `isEcho` flag so the copies
  don't echo themselves; respects the board cap. Removed the now-unused `echoBonus` helper + the
  per-factory coupling.
- **Semantics: additive → per-unit.** Each summoned *unit* now gets one more copy per living Echo
  Warden (golden = 2), rather than "+1 token per effect". So Pack Scrounger (2 Pups) + one Echo Warden
  is now **4 Pups** (was 3), and **6** with a golden Echo (was 4) — i.e. "echo each summon", matching
  "any unit summoned → 1 more copy". *Flag:* this is a real buff to Echo-Warden summon boards.
- **Boundary:** this covers minion **summon effects** (the `ctx.summon` path). Sporen's hero-power
  start-of-combat resummon uses a separate copy path and isn't echoed — a sensible line (it's a hero
  power, not a summon effect), easy to include later if wanted.
- Verified: `typecheck` + `lint` clean, `test` **166** pass (the two Echo tests updated to 4 / 6),
  determinism harness OK; live a staged Pack Scrounger + Echo Warden produced **4 Pups** and the card
  reads the new text.

### Heroes named + all six portraits wired
The three placeholder heroes got real names and the full roster got art:
- **Renames:** "The Warden" → **Warden**; the resummon/Deathrattle hero (`reclaimer`) → **Sporen**; the
  spell-amplify hero (`spellbinder`) → **Rohan**; the End-of-Turn hero (`dusk`) → **Djinn**. The three
  new heroes' **ids were aligned to the names** (`reclaimer→sporen`, `spellbinder→rohan`, `dusk→djinn`)
  since they were placeholders — contained to `heroes.ts` + `run.test.ts` (the UI reads `heroId` via
  `getHero`, no hardcoded ids). Gendered pronouns in two blurbs were neutralized (names' intent unknown).
- **Art:** all six source portraits (`Warden/Oner/Myra/Rohan/Djinn/Sporen.png`) are now wired — the new
  three copied to `art/heroes/{rohan,djinn,sporen}.png` and downscaled to 640px. The picker + HUD show
  real portraits for every hero (no more anvil fallback).
- Verified: `typecheck` + `lint` clean, `test` **166** pass; live (fresh server so Vite re-globs the
  art) all six render with correct names + portraits.

### Card-spread audit tool (`npm run audit`)
A re-runnable tally of the buyable minion pool by tribe × tier (+ spells), vs the target of **13–15
minions per tribe** across the 6 tiers, weighted toward tiers 3–5 (`packages/tools/src/card-audit.ts`).
**Design intent (per the user):** the pool stays deliberately tight — run-to-run variety + complexity
come from the **meta layer (heroes + quests/trinkets)**, not pool size. A small curated set is cheaper
to balance and makes each card matter. Current snapshot: **47 buyable minions** — Beast 8, Dragon 6,
Undead 8, Mech 8, Demon 8, Neutral 9 — so each tribe is **+4 to +7 short** of 13 (≈ +33 to reach ~84
total). Aggregate tier shape already skews mid (T1 6 · T2 9 · T3 7 · T4 10 · T5 10 · T6 5) but is thin
per-cell, with two holes: **Dragon T5 = 0** and **Neutral T6 = 0**. Spells: 3, all T1. The tool's
`need` column shows each tribe's gap; re-run as the set grows.

### Spell cards show their real value (modifiers reflected) — one source of truth
Spell cards now display their *effective* stat value, not the printed base — so as the Spellbinder on
turn 1, Spirit Fire reads **+4/+4** (green), and a cast grants exactly that. Wired for the cards that
will buff spells later:
- **`spellStatBonus(state)`** (new, `@game/sim`) is the single source of truth for the +X/+X bonus to
  stat-granting spells, summing all active sources (the Spellbinder hero now; spell-buff cards just
  fold in here). The reducer's `spellBuffTarget` applies it (replacing the old inline hero check), and
  the UI reads the *same* function — so the displayed number always equals what a cast actually does.
- **`spellDisplayText(cardId, bonus)`** (new) returns the spell's text with its `+A/+B` substituted to
  the effective value and highlighted green via `{{…}}` (the existing `.descup` treatment). The tavern
  spell slot (`shopView`) and held spells (`instView`) both run it; non-stat spells (Mana Pouch) and a
  zero bonus pass through unchanged. Convention: a stat spell's text shows its value as `+A/+B` matching
  its `spellBuffTarget` params so it can be substituted.
- Verified: `typecheck` + `lint` clean, `test` **166** pass (+3: `spellStatBonus` per hero/wave,
  `spellDisplayText` substitution incl. the non-stat + no-bonus cases, and that the shown value equals
  the cast result). Live: as the Spellbinder, the tavern Spirit Fire renders "+4/+4" in green.

### Three new heroes (placeholder names): The Reclaimer, The Spellbinder, Dusk
Added the three spec'd heroes — names are **placeholders**, rename freely. Each needed a different
piece of new plumbing, all now reusable:
- **The Reclaimer — "Reclaim" (once per turn):** mark a friendly board minion; at the **start of
  combat** it's destroyed (its Deathrattle fires) and an **exact copy** (stats + granted keywords +
  golden) is resummoned if there's room. This is the first hero power that drives the **pure combat
  simulator**: a `resummon` mark on `BoardCard` → `BoardMinion` → `Minion` (via `instantiate`), and a
  new start-of-combat step in `simulate()` that force-kills the marked minion (skips Reborn so the
  Deathrattle actually fires), then resummons an exact copy if `living(player) < 7`. The mark is a
  per-turn choice (cleared in `advanceAfterCombat`); the copy is combat-only (the recruit board is
  untouched, as always). Runs *before* the normal Start-of-Combat effects so the copy + any tokens
  take part.
- **The Spellbinder — "Attunement" (passive):** stat-granting spells give **+X/+X more**, X starting
  at 1 and rising every 3 turns (`spellAmplifyBonus`). First **passive** hero — new `HeroPower.passive`
  flag; the StatusBar shows it (with the live bonus) but never arms it, and the panel uses a neutral
  `passive` style instead of the greyed "spent" look. The effect hooks `spellBuffTarget` (so it covers
  both player- and minion-cast stat spells; non-stat spells like Mana Pouch are untouched).
- **Dusk — "Cadence" (once per turn):** proc a friendly minion's **End of Turn** effect now — a near-
  clone of Myra's Encore, applied to `endOfTurn` effects (`replayEndOfTurn`, honoring Chronos repeats).
- **Hero-select now shows a random 3 of 6** (the subset behavior that was waiting on >3 heroes).
- Judgement calls (flag if any should change): Reclaimer + Dusk are once-per-turn (re-choose each turn);
  Reclaim forces a true death past Reborn so the Deathrattle fires; "when you have space" = combat board
  < 7 after the Deathrattle resolves; the resummoned copy is ephemeral (no carry-back). Spellbinder's
  scaling (`1 + floor((wave-1)/3)`) is a starting dial.
- Verified: `typecheck` + `lint` clean, `test` **163** pass (+6: Dusk procs/locks, Spellbinder amplify
  + scaling + hero-gating, Reclaimer mark + carry-into-combat, and a core `simulate` test for the
  destroy→Deathrattle→exact-copy). Live: picker shows 3-of-6 (new heroes use the anvil fallback — **no
  portrait art yet**); HUD shows Reclaim/Cadence "once per turn", Spellbinder "Attunement · +1/+1
  spells" (passive, not armable).

### PvE win condition (survive wave 20 → Victory) + Start Over + clock waits for hero select
- **Win condition (bounded PvE).** `CONFIG.maxWave` (20). Surviving the final wave ends the run in a
  new **`victory`** phase (the run doesn't advance past it); losing — Resolve hitting 0 — is still
  `gameover`. A new **Victory screen** (celebratory gold "VICTORY", "Waves Survived", a **Play Again**
  button → the hero picker) layers on like the game-over screen. This bounds what CLAUDE.md framed as
  an "endless" climb for the current PvE iteration; `maxWave` is a dial that will likely move to a
  per-mode config once PvE/PvP modes land.
- **Start Over** in the Esc menu — a red-tinted action under a new "Run" section that abandons the
  current run and reopens the hero picker (`startHeroSelect`).
- **The round clock waits for hero select.** The timer no longer ticks behind the picker — it's
  frozen (and reset to full) while `heroChoices` is set, so wave 1 begins at full time the *moment*
  a hero is chosen (also fixes the edge where dying on wave 1 + re-picking could start the new run on
  a near-zero clock).
- Verified: `typecheck` + `lint` clean, `test` **157** pass (+3: victory at maxWave, no early victory
  at maxWave−1, a loss at the cap is still gameover). Live: the clock holds at 30 during the pick and
  ticks (30→28) after; the Victory screen shows at wave 20; Start Over reopens the picker.

### Hero HP on the picker + Myra's Encore unlocks on turn 3
- **Heroes have a Resolve (HP) stat.** `HeroDef.resolve` (all 30 today, will diverge per hero) now
  seeds the run's starting + max Resolve in `createRun` instead of the global `CONFIG.startResolve`.
  The hero picker shows it under each name as a red heart + number (matching the HUD's Resolve heart).
- **Per-power unlock turn.** `HeroPower.unlockWave` (default 1) gates when a power becomes usable.
  **Myra's Encore now unlocks on turn 3** — locked on turns 1 & 2 (the reducer rejects it; the HUD
  reads "Encore · unlocks turn 3" and greys the panel; the picker shows an "Unlocks turn 3" badge).
  From turn 3 it's the usual once-per-turn power.
- Verified: `typecheck` + `lint` clean, `test` **154** pass (+2: Encore rejected on turns 1–2 and fires
  on turn 3; `createRun` seeds each hero's Resolve). Live: picker shows ♥30 on all three + the badge on
  Myra; as Myra, the HUD shows "unlocks turn 3" (greyed) at wave 1 and "once per turn" (ready) at wave 3.

### New hero "Myra" (Encore — re-trigger a Battlecry) + Oner/Myra portrait art
- **Myra — power "Encore" (once per turn):** choose a friendly board minion and **trigger its
  Battlecry again**. New effect `kind: 'replayBattlecry'` + `replayBattlecry(state, card)` in
  `recruit.ts`, which re-fires the minion's `onPlay` effects right now — honoring Drakko repeats +
  Karwind, exactly as a fresh play would. It returns whether a Battlecry fired, so the hero charge is
  only spent when it did. Edge handling: a **targeted** Battlecry re-fires with no explicit target so
  its auto-pick fallback chooses (Toxin Tender → the highest-attack eligible friend); a strict-target
  Battlecry (Corrupted Lifebinder) no-ops; a **Choose One** minion has no `onPlay` effects so it isn't
  a valid target; a vanilla minion no-ops with the charge preserved. Once per *turn* (uses `heroReady`,
  recharges each wave — unlike Oner's once-per-game).
- **Hero targeting is now power-aware.** Fortify may still target a tavern offer, but **Gild and
  Encore are warband-only** (you can't gild or replay an unbought offer) — the aim selector and the
  shop-offer highlight now respect the power kind, so offers no longer glow for board-only powers.
- **Portrait art wired for Oner + Myra** (the picker + HUD showed an anvil-icon fallback before). The
  `downscale-art.ps1` script gained a `-Sub` param (defaults to `minions`) so it right-sizes any art
  subfolder; `oner.png`/`myra.png` were copied from the masters and downscaled to 640px (4.7 → 2.7 MB).
  The hero picker now shows all three with real portraits.
- Verified: `typecheck` + `lint` clean, `test` **152** pass (+3 Myra tests: Encore re-fires Hoard
  Cleric's +1/+1 once per turn, auto-targets Toxin Tender → a friend gets Venomous, no-ops on a vanilla
  minion). Live (fresh server so Vite re-globs the new art): picker shows Warden/Oner/Myra portraits;
  picking Myra + Encoring a Hoard Cleric took it 1/3 → 2/4 and set "Encore · used".

### Heroes as data + Warden scaling + new hero "Oner" + pre-run hero picker
First real **hero system** — heroes are now data (like cards), not a hardcoded single Warden.
- **New `@game/sim/heroes.ts`.** A `HeroDef { id, name, blurb, power }` registry (`HEROES`,
  `HERO_INDEX`, `getHero`, `DEFAULT_HERO_ID`). A power has a `kind` the reducer resolves; adding a
  hero is data-only unless it needs a brand-new `kind`. `RunState` gained `heroId` + `heroPowerSpent`
  (once-per-game lock); `createRun(seed, heroId?)` seeds the chosen hero (defaults to Warden).
- **Warden's Fortify now scales with Tavern Tier** — `+Tier/+Tier` instead of a flat `+1/+1` (so at
  Tier 3 it's +3/+3). Targets a warband minion (recorded as a `Fortify` buff) or a tavern offer (the
  buff carries on the offer and bakes in when bought). Still once per wave.
- **New hero `Oner` — power "Gild" (once per game):** make a friendly **board** minion Golden. It
  doubles the minion's stats (recorded as a `Gild` buff so the inspect breakdown still sums) *and*
  flips the golden flag — so its **effects** double too (Deathrattles fire twice, ×N multipliers, the
  Demon fodder bonus, etc.). No-op (no charge spent) on a missing target or an already-golden minion.
- **Pre-run hero picker** (`HeroSelect.tsx`) — the first slice of the eventual Title → Mode → Hero
  flow. Driven by a single store flag (`heroChoices`); no router. Shows up to 3 heroes (all of them
  while only 2 exist) on first load and after a game over ("Begin a New Ascent" now opens the picker).
  Picking one starts a fresh run as that hero. Hero *choice* uses `Math.random` (UI-level meta, not
  the seeded sim). The StatusBar hero panel now renders whatever hero the run is on (name, power line,
  ready/spent, art with an icon fallback for art-less heroes like Oner).
- Verified live (clean reload, `healthy`): picker renders both heroes; picking Oner flips the run +
  HUD to "Oner · Gild · once per game"; buying→playing→gilding a Sporeling turned it golden 2/4 with
  its Deathrattle doubled to **+2/+2** (vs the shop copy's +1/+1), HUD → "Gild · spent", a second use
  rejected. `typecheck` + `lint` clean; `test` **149** pass (+5 hero-power tests: Warden tier-scaling
  + offer carry, Oner double/golden/once-per-game + already-golden no-op, createRun hero defaults).
- Follow-ups: **Oner needs portrait art** (currently the anvil icon fallback). Seed the hero-choice
  roll for daily runs later. The picker is the seed for the full Title/Mode menu (see roadmap).

### Combat hand updates live when a card is granted mid-fight
- **Bug:** the hand shows in combat now, but a card *granted during* the fight (e.g. Arcane Weaver's
  Deathrattle → Spirit Fire) didn't appear there — `run.hand` is the pre-combat snapshot (grants only
  commit at `resolveCombat`), so the new card was invisible until after the fight.
- **Fix:** `useCombatReplay` exposes `handGrantsShown` — the cards from `toHand` events *before the
  current beat*; `Recruit` appends them to the combat hand (non-interactive, `suppressPop`), so the
  hand visibly grows as each grant lands (one beat after its fly-to-hand animation). `tokenRefView`
  now carries the `spell` flag, so a granted Spirit Fire renders as a spell card (and the Arcane
  Weaver ref-popup is more correct too).
- Verified live: a fragile Arcane Weaver, on death mid-combat, made **Spirit Fire** appear in the
  combat hand (as a spell card) alongside the "Spirit Fire is added to your hand" narration.

### Combat Log "Procs" tab, hand-in-combat, no-emoji text
- **Procs tab.** The Combat Log overlay is now tabbed **Procs / Log**. The Procs tab is a per-source
  report — who triggered what, how many times — e.g. "Deathsayer → Arcane Weaver's Deathrattle — 1×"
  and "Arcane Weaver → Spirit Fire — 2×" (plus Summoned/Buffs by source + totals). To attribute, the
  `toHand` and `summon` events now carry a `source` (the producing minion's uid); `rally` already had
  source→target. Confirmed headless on the example board (1 rally Deathsayer→Arcane Weaver, 2 Spirit
  Fires from Arcane Weaver). The Log tab keeps the blow-by-blow.
- **Hand stays visible in combat.** It no longer slides away — it shrinks to a compact, non-interactive
  peek pinned to the bottom (always see what you're holding), and the narration bar moves up to sit just
  above it (`bottom: --ch×0.66 + 16`). The fly-to-hand card now lands on a visible hand.
- **No emojis in combat text.** Removed the emoji prefixes from the rolling narration lines (poison,
  shield, reborn, rally) and the "to your hand" label / Spirit-Fire line. (The over-card float symbols
  — ☠ / ◇ / ♻ — are visual indicators, left as-is; flag if those should change too.)
- Verified: `typecheck` + `lint` clean, `test` **144** pass (toHand now also asserts its `source`);
  the `.alog` position, compact-hand transform, and Procs-tab CSS confirmed via live computed-style
  probes on a clean mount. The in-combat *look* (hand peek + bar placement, Procs tab in the overlay)
  is best confirmed in a live fight.

### Combat log readability + proc-count summary + cards-to-hand animation
Three combat-feedback improvements:
- **Combat narration bar is readable now.** `.alog` was getting light cream text (from a shared
  title-screen rule) on its own light translucent pill — light-on-light. Made it a solid **dark pill
  with cream text**, bigger + bolder. (Removed `.alog` from the `#f6efe2` rule.)
- **Combat Log now opens with a proc-count summary.** New `summarize()` tallies the fight —
  `N attacks · M damage · D deaths`, **Rally procs** (per source), **Summoned** (per token, e.g. "Pup
  ×9"), **Buffs** (per source with totals, e.g. "Flowing Monk ×9 (+54/+54)"), and shields/poison/reborn
  counts — rendered above the detailed line-by-line log. Great for seeing/​debugging how many times
  things procced.
- **Combat-generated cards now visibly fly to your hand.** `grantToHand` logs a new `toHand` combat
  event; the replay shows the granted card (e.g. Arcane Weaver → **Spirit Fire**) pop in centre-screen
  and fly down into the hand on its own beat, narrated in both logs. (It's still added to the real hand
  after combat as before.)
- Verified: `typecheck` + `lint` clean, `test` **144** pass (new test: a grant logs a `toHand` event);
  `.alog`/`.handgrant`/summary CSS confirmed via live computed-style probes; app mounts clean.

### Fix — no targeting prompt when there's no viable target
A targeted Battlecry no longer strands the player on an unfulfillable prompt. The `play` action now
sets `pendingTarget` **only if a viable target exists**; otherwise the minion just plays and its
Battlecry doesn't fire. Tribe-restricted picks (Corrupted Lifebinder → a friendly Demon, never self)
need a matching friend — with none, **no prompt, no link, played as-is**. Unrestricted picks (Toxin
Tender) always have a target (themselves included), so they're unaffected. Engine-level, so the UI
inherits it. Test added. `test` **143** pass.

### Golden Deathsayer — Rally proc is a ×2 multiplier
A **golden Deathsayer** now procs the leftmost Deathrattle **twice** — implemented as a multiplier on
the whole Rally proc count: `procs = (1 + Sylus extras) × (golden ? 2 : 1)`, so it stacks
*multiplicatively* on Sylus (golden Deathsayer + 2 Sylus = (1+2)×2 = 6 procs, not 5). Added `goldenText`
("…trigger your leftmost Deathrattle **twice**."). Tests lock it: golden alone → 2 procs, golden + 1
Sylus → 4 (multiplicative, not additive). `test` **142** pass.

### Art — downscale pass (build prep)
Added `scripts/downscale-art.ps1` (System.Drawing, no new deps) that caps in-repo minion illustrations
at **640px** (cards display ~290px, so 640 is retina-crisp + headroom). Ran it: the four 1254×1254
illustrations (Guel/Monk/Lifebinder/Deathsayer) → 640px, **minion art 31.5 → 26 MB**. The high-res
masters stay in `C:\Game Assets\Ascent Art\Minions`; re-run after dropping new art (idempotent). Modest
win because most existing art was already 512px and PNG stays heavy for detailed images — the real
reduction (~6 MB total) needs **WebP** (blocked on an encoder: add `sharp` as a dev dep + build step,
or `cwebp`). Deferred since a desktop-exe path would make download size a one-time install rather than a
per-play load. _(Detail in the size discussion this session.)_

### Deathsayer Rally respects Sylus + un-wire Pup placeholder art
- **Rally now procs the Deathrattle the full number of times a real death would** — including **Sylus
  the Reaper's** extra procs (+1 each, +2 golden). Earlier today Deathsayer fired the leftmost
  Deathrattle exactly once; that was wrong (the user's board: Pack Scrounger + Echo Warden + 2 Sylus,
  full board → only 3 Flowing Monk overflow procs instead of 9). `rallyProcDeathrattle` now loops
  `1 + reaperBonus` (Sylus count) like `killOrReborn` does. Echo Warden's extra tokens were already
  folded in via the summon factories. Confirmed headless on that exact board: **9 procs** (Pack
  Scrounger ×3 via Sylus × 3 Pups via Echo). New test asserts 2 Sylus → 3 Deathrattle procs.
- **Un-wired the Pup art** — `Sprite Pup.png` was a placeholder for a *new* (future) minion, not the
  existing Pup token, so `pup.png` was removed (the Pup goes back to its pixel sprite).

### Art — wire the Pup token *(superseded — reverted below same day)*
Wired `Sprite Pup.png` → the **Pup** token, then **reverted** (see above): that art is a placeholder
for a future minion, not the Pup. `DynamiteDuo.png` remains orphan art with no matching card.

### Deathsayer — Rally that procs the leftmost Deathrattle before its attack
New **Deathsayer** (T4 Undead 3/5, **Rally**): each time it attacks, it fires your **leftmost friendly
Deathrattle first**, then the hit lands. Art wired from the name-matched source.
- **Engine:** new combat factory `rallyProcDeathrattle` (subscribed to `onAttack`, which is emitted
  *before* `dealDamage`, so the proc + any buffs/summons it produces resolve before the attack's
  damage). It finds the leftmost living friend with a *true* Deathrattle (`onDeath` effect whose id
  starts with `deathrattle`, so friend-death watchers like Brood Matron don't count), logs a new
  `rally` combat event (source = Deathsayer, target = that minion), then runs that minion's onDeath
  effects (it stays alive). _(Same-day follow-up: the proc now also respects Sylus — see the later
  entry above.)_
- **UI:** the `rally` event is its own beat with a pause (`DELAY.rally` 720 ms) — Deathsayer pulses
  (`sccast`), the chosen minion flares + shows a violet **☠** bloom marking whose Deathrattle fires,
  then its buff/summon beats play, *then* the attack's damage. Narrated in both combat logs; the
  headless harness prints it too.
- Verified: `typecheck` + `lint` clean, `test` **140** pass (new test asserts the Rally + the
  Deathrattle's buff land in the log *before* that attack's damage); production build bundles the art;
  the app mounts clean with the `rally` float styled. Stats are starting dials.

### Content pass — 3 new minions, 6 removals, Maw/Toxin tweaks, per-proc EoT animation
A big content + mechanics batch from the user's spec.

**New minions (art wired from name-matched source files):**
- **Archmagus Guel** (T4 neutral 2/3) — *After you cast a tavern spell, give 2 other friendly minions
  +1/+1.* New `spellCast` factory `spellCastBuffOthers` (seeded-random targets, excludes self). The
  triple-reward Discover routes through `offerDiscover`, **not** `castSpell`, so it correctly doesn't
  proc Guel.
- **Flowing Monk** (T4 neutral 1/4) — *When you summon a minion that doesn't fit, give a random friendly
  minion +3/+3.* Fires on **summon overflow** in both phases: recruit (`makeContext.summon`) and
  **combat** (a new `summonOverflow` bus event from `simulate`'s `ctx.summon` + a combat
  `overflowBuffRandom` factory). New `summonOverflow` GameEvent.
- **Corrupted Lifebinder** (T6 Demon 1/1) — *Battlecry: bind to a friendly Demon; also gains the stats
  whenever that minion does.* Targeted Battlecry restricted to Demons (new `targetTribe` on `CardDef`
  + UI filter). The link mirrors gains **in recruit** (`syncLifebinders`, run after every reducer
  action) **and in combat** (the linked demon's `buff` events mirror onto the Lifebinder inside
  `simulate`; the board uid is remapped to the combat uid). If the demon leaves, the link just ends and
  the Lifebinder keeps what it has.

**Changes / removals:**
- **Maw of the Pit** → *On consume, gain a Divine Shield for the next combat* — a one-combat shield now
  (new `tempShield` flag + `onConsumeShieldNextCombat`; `resolveCombat` strips the DS after the fight).
- **Toxin Tender** → Tier 5 (was 2).
- Removed **Abyssal Sovereign, Pactstone Acolyte, Chromatic Caller, Nadir Hoardlord, Galewing Apex,
  Shield Capacitor** (tests using them were updated/retired; their now-unused combat factories are left
  inert).

**End-of-Turn animation — reworked to what was actually asked:** the previous pre-turn "pending buff
chip" preview is **removed**; instead the affected minions' **stats now visibly tick up one proc at a
time during the end-of-turn animation** (new `projectEndOfTurnSteps` gives per-proc cumulative stats
aligned to the UI's beat sequence; each beat sets the shown stats + flashes whoever just gained), then
`faceOmen` bakes the same totals in.

**Bug fix — Fodder ghost replaying every turn after a Soulfeeder:** the consume animation effect listed
`run.fodderEaten` in its deps, but that array gets a fresh reference every action, so any action within
the 2.3 s window re-ran the effect → its cleanup cancelled the clear-timeout → the ghost was stranded,
then **re-mounted and replayed every time you returned from combat** (the intermittency = whether you
acted in that window). Fixed by keying the effect on `fodderEatenSeq` alone + clearing the ghost on
combat start.

- Verified: `typecheck` + `lint` clean, `test` **139** pass (added coverage for Guel, Monk recruit +
  combat, Lifebinder link/recruit-mirror/combat-mirror/link-ends, Maw one-combat shield); production
  build bundles the 3 new art files; the live app mounts clean with the new content. The fodder repro
  was confirmed headless (seq bumps once, stays) — the replay was purely the UI dep leak.

## 2026-06-18

### Live End-of-Turn buff preview + triple-ready tavern highlight
Two recruit-screen quality-of-life features:
- **End-of-Turn stat buffs now show live, during the turn, instead of only at the end.** New pure
  helper `projectEndOfTurn(state)` (in `@game/sim`) runs the *real* `applyEndOfTurn` on a throwaway
  `structuredClone` and diffs the board + hand stats, returning per-uid deltas — exact by construction
  (same code path: self-buffs, Combinator's Mech welds, Ritualist's Fodder buff) and **zero side
  effects** on the real state. The recruit UI folds those deltas into the shown stats (so the board
  reads as it *will* when the turn ends), tags each affected minion with a small teal **"↑+x/+y"
  pending chip** (top-right) and an inspect-breakdown "End of Turn" entry, and recomputes live as the
  board changes. The real buffs still bake in once at end of turn (display-only preview, so combat /
  sell / the buff-flash all still use true stats until then). Verified headless: Ritualist + 2 Fred on
  board + 1 in hand → projection shows all three Fodder +1/+1, Ritualist none, and the source board is
  left unmutated. `recruit.ts` (`projectEndOfTurn`), `Recruit.tsx` (`eotProjection`, `instView`),
  `Card.tsx` (`eotBuff` chip), `styles.css`.
- **Triple-ready tavern highlight.** A tavern offer you'd **complete a triple** by buying (you already
  hold 2 non-golden copies across board + hand) now gets a **bright gold pulsing glow** (keeps the
  tribe ring) and **gold arrows floating up** around it. Detection mirrors `checkTriples`' counting.
  `Recruit.tsx` (`tripleReadyUids`), `Card.tsx` (`tripleReady` + arrows), `styles.css`.
- Verified: `typecheck` + `lint` clean, `test` **133** pass; projection logic confirmed headless (tsx);
  all new CSS (`tripglow`, `triparrow`, `eotchippulse`, tribe-ring preserved) confirmed via live
  computed-style probes on a clean mount. In-game appearance (chip on a real Fodder minion, glow on a
  real 3rd-copy offer) is for the user to confirm — a live board can't be built in the preview harness
  (synthetic drags don't land; screenshots / timeout-evals hang).

### Combat VFX round 3 — staggered keyword procs, bright-blue reborn, two-threshold stat colours
Follow-ups from playtesting the previous round:
- **Keyword procs no longer collide with the damage number.** Poison (☠), Divine Shield (◇ break/gain)
  and Reborn (♻) floats used to spawn on top of the `−N` at the same HP corner. They now **bloom big
  (64px) in the card centre, 0.26 s after** the damage number (a new `floatsym` animation + a `sym`
  class on those float kinds), so the hit reads first and the proc lands as its own beat — and each is
  much more apparent: poison glows green, shield gold, reborn electric blue. Damage/buff numbers still
  sit in the stat corner. `Unit.tsx` (`SYM_KINDS`), `styles.css`.
- **Reborn is now unmistakable.** Replaced the dim brightness `flare` with a **bright-blue resurrection
  flash** (`rebornburst`: the unit flares electric blue, brightness 2.5 + blue drop-shadow) plus an
  **expanding blue ring** (`rebornring` ::after). Bumped the reborn beat (`DELAY.reborn` 560→640 ms) so
  the 0.85 s flash plays out before the next beat clears the class. `styles.css`, `useCombatReplay.ts`.
- **Stronger poison proc** — vivid green flash (hue-rotate + saturate + green drop-shadow) and a denser
  rising mist, so a Venomous kill is obvious. `styles.css`.
- **Stat colours fixed: green stays green until actually reduced.** Last round set the combat baseline
  to the *combat-start* stats, which made a recruit-buffed 5/5 read **neutral** the instant combat began
  (cur == base). Now combat uses **two thresholds**: green above the **printed** base (it's buffed), red
  below the **floor** it entered the fight with (it's been damaged/debuffed). So a 5/5 reads **green**
  and only its HP flips **red** when chipped to 5/3 — exactly as asked. `statCls` gained a `floor` arg;
  `CardView` gained `floorAttack`/`floorHealth`; `Unit.tsx` passes printed base + combat-start floor.
  Shop/recruit is unchanged (no floor → printed-base compare).
- Verified: `typecheck` + `lint` clean, `test` **133** pass; all new CSS confirmed applied via live
  computed-style probes (`floatsym` delay 0.26 s/64px, reborn `rebornburst`+`rebornring`, sym colours)
  on a clean fresh mount. Runtime motion is for the user to confirm in-browser (the preview renderer
  still hangs on screenshots / `setTimeout` evals, and synthetic drags don't land, so a live fight
  can't be driven here).

### Combat readability round 2 — damage numbers, in-combat stat colours, return jiggle, hero-power flash
A grab-bag of combat/recruit polish from live playtesting:
- **Damage numbers, near the HP and readable.** The floating combat numbers (`−N`, poison, shields,
  buffs) were small, brief, and flew off the *top* of the card. They now pop over each card's own
  **stat corner (next to the HP)**, are **bigger** (dmg 30→42px), **linger longer** (1.0→1.4 s,
  `FLOAT_MS` 1250→1450), and **stay on the card** (pop-in → hold → gentle rise instead of flying away).
  Because the attacker's retaliation and the target's hit already resolve in the **same impact beat**,
  both numbers now spawn at the *same instant on their respective cards* — the exchange reads as
  simultaneous (it always was in the data; the old off-top position hid it). `styles.css` (`.float`
  + `floatup` keyframe), `useCombatReplay.ts` (`FLOAT_MS`).
- **In-combat stat colours now use the *combat-start* baseline.** Previously a combat unit coloured its
  stats against the *printed card base* (1/1), so a buffed 5/5 chipped down to 5/3 still showed green
  HP (3 > 1). Now each `UnitFrame` carries `baseAttack`/`baseHealth` = the stats it **entered the fight
  with** (for tokens, their summon stats; reset on Reborn). So **damaged HP and debuffed attack read
  red**, while a genuine *combat* buff above the entry value still reads green. The shop/recruit is
  unchanged (still compares to the printed base, so a recruit-buffed minion stays green there).
  `useCombatReplay.ts` (`UnitFrame` + `fromSnap` + reborn fold), `Unit.tsx`.
- **No more warband "jiggle" returning from combat.** The player board swaps `<Unit>`→`<Card>` on the
  way back to recruit, so every card **re-mounted** and re-fired the base `cardpop` animation (the
  random jiggle). The mount-pop is now opt-in via a `popin` class that's **frozen at mount** (a
  `useState` initializer in `Card`), and the warband passes `suppressPop` on exactly the combat→recruit
  render — so returning minions don't pop, while freshly bought/played cards still do. The hand never
  re-mounts (it's hidden, not swapped) so it was already fine; the new shop still pops (it *is* new).
  `styles.css`, `Card.tsx`, `Recruit.tsx` (`returningFromCombat`).
- **Hero Power (Warden / Fortify) always flashes its target.** Releasing the Fortify line now
  explicitly fires the green buff-burst on the chosen minion (`flashBuffed`), instead of relying solely
  on the passive stat-diff flash — so it can never silently land with no animation. `Recruit.tsx`.
- **Return "noise":** traced — *nothing* fires a sound on the combat→recruit return itself
  (`resolveCombat` has no sfx hook). The only sound near that moment is the **win/lose verdict chord**
  played when the replay finishes (just before "End Combat"). Removing the jiggle should make it read as
  intentional; flagged for the user to confirm.
- Verified: `typecheck` + `lint` clean, `test` **133** pass; new float/cardpop CSS confirmed via live
  computed-style probes; fresh page mount renders clean (the transient React hook-order warnings were
  HMR add-a-hook artifacts — a clean reload to WAVE 1 shows no error boundary). The *runtime* combat
  visuals (floats by the HP, red damaged HP, no jiggle, hero burst) couldn't be screenshotted —
  the preview renderer still hangs on screenshots and `setTimeout`-based evals — so the look is for the
  user to confirm in-browser.

### Combat clarity pass — readable attacks (Phase 1–3)
- Reworked the combat replay (`useCombatReplay` — animation-only, no logic changes) so exchanges read
  as a clear back-and-forth instead of a blur:
  - **Stop hiding the target:** the attacker leans in only **~40%** of the way (taps the defender's edge
    instead of sliding over its stat badges), then **recoils** on the impact beat; and the struck
    defender is **layered above** the attacker (z-index) so its dropping HP is never covered.
  - **Weight + breathing room:** the impact beat is longer, hits **flash red**, and there's a ~200 ms
    **settle** before the next swing so attacks don't run together.
  - **Telegraph:** the defender about to be hit gets a brief **danger glow** during the wind-up.
- All driven off the deterministic event log — zero risk to the sim. `test` (133) clean. (Live visuals
  unverified this session: the preview renderer was hung for screenshots/animation polling.)

### Fix: a Reborn attacker is next in line to attack again
- A minion that died to retaliation on its own attack and **Reborned** went to the *back* of its side's
  rotation (the `nextAttacker` pointer resumed after it). Now it keeps its place — it's the next attacker
  for its side. One-line pointer rewind in `simulate`'s attack loop; +1 sim test.

### Fix: dual-card hover no longer floods with colour
- Hovering a dual-type card (Heckbinder) made its split coloring "go wild": the hover-lift `transform`
  turns the card into a stacking context, which flips the `z-index:-1` split pseudo-element to the front
  so the *solid* gradient floods the interior. Rebuilt the split rim as a **masked gradient ring**
  (border-box minus content-box) that stays a clean rim regardless of stacking context, and gave dual
  cards the same boosted-glow hover as singles.

### Combat odds — win/draw/loss bar in the log
- After a fight, the **Combat Log** now shows the matchup's estimated **outcome odds** as a 3-segment
  win / draw / loss bar with percentages. `faceOmen` re-simulates the *same two boards* on **1000
  independent seeds** (margin of error ~±1.5%) and stores the distribution on `lastCombat.odds`. The
  seeds come from a dedicated `TAG.ODDS` stream derived from the run seed, so the odds are
  **reproducible** and don't disturb the real combat RNG. The actual fight is one roll of these odds
  (a tooltip says so).
- **Cheap:** measured ~1 ms warm per fight (a few ms for a long grindy fight); only the very first fight
  of a session pays a one-time cold-JIT cost (~tens of ms). Combat is a pure function on ~14 units — the
  balance runner already hammers it thousands of times. Win = accent, draw = grey, loss =
  threat-raspberry (matching the verdict pill).
- +1 sim test (odds sum to 1 + are deterministic per seed/wave). `typecheck` + `lint` + `test` (**132**)
  clean; the bar verified rendering live (segments 62/10/28 % with matching labels).

### Selection emphasises the tribe colour (no more orange selector)
- Hovering / targeting a card now **brightens + grows its own tribe-colour glow** instead of applying
  the accent (orange) selector line — so selection reads *with* the card's type rather than clashing
  with it. Changed `.card:hover` (dropped the accent border for a boosted tribe glow), `.card.armed`
  (targeting candidates) and `.card.targeted` (the current aim — a strong tribe glow + lift/scale). The
  orange aim-*line* (the hero-power / Toxin Tender beam) is left as-is for now.
- CSS-only; verified live — armed offers glow their own tribe (green / orange / slate / purple / teal),
  no accent ring; 0 console errors.

### Card body restyle — tribe colour fills the frame
- Per feedback, the tribe colour now **fills the card frame** instead of just outlining it: the card
  body is a tribe wash, the **art is inset + outlined** (a tribe border with the wash framing it), and
  **only the description sits in a white box** — matching the painted mockups. The footer carries the
  wash too, and dual-types split the frame + footer + rim half-and-half. Golden / spell / Triple Reward
  keep their own special frames.
- **Fix (affects most cards):** centring the description via `display:flex` had turned inline `<b>` runs
  into separate flex items, so bold words rendered cramped / out of flow. Wrapped the description HTML in
  a single span so it flows inline normally and still centres in the box.
- CSS + one JSX wrapper. `typecheck` + `lint` clean; verified live across all six tribes, a vanilla
  (no-text) card, and the dual (split frame + correctly-flowing bold text) — 0 console errors.

### Tribe-coloured card edges
- Every minion card now flags its **type by its outer edge**: a tribe-coloured ring (Beast green,
  Dragon orange, Mech teal, Undead slate, Demon purple, Neutral tan) plus a soft same-hue glow.
  **Dual-types split the rim half-and-half** (Heckbinder → Demon purple / Mech teal) via a
  pseudo-element gradient rim (a `box-shadow` can't be two colours). Driven by the existing `--c` /
  `--c2` card vars, so it's data-free.
- The edge previously did double duty for keyword cues; reconciled so **tribe owns the rim**: Divine
  Shield and Reborn keep their pulsing glow but as an **outer halo** layered around the tribe ring
  (DS = tribe ring + gold halo; Reborn = tribe ring + blue halo); Taunt now relies on its shield-ward
  badge and Stealth on its faded look (their edge rings dropped). Golden / spell / Triple Reward keep
  their special gold / purple frames (the tribe edge is suppressed there).
- CSS-only. `typecheck` + `lint` + `test` (**131**) clean; verified live across all six tribes, a dual
  (split rim), a Divine-Shield card (teal ring + gold halo), a Reborn card (slate ring + blue halo),
  and a golden (gold frame preserved) — 0 console errors.
- **Tuned per feedback:** thicker ring (3 → 4px) + a more saturated glow so the type colour reads at
  a glance (the DS / Reborn outer halos and the dual split rim were scaled to match).

### Toxin Tender — player-targeted Battlecry
- Toxin Tender's Battlecry is now **player-targeted** (like the Warden's Hero Power): play it to the
  board, then aim a glowing line at any friendly minion and click to grant **Venomous** to *that*
  minion. Built on the deferred-resolution pattern (mirrors Choose One): `CardDef.target: 'friendly'`
  makes `playCard` fire onSummon but **defer** the Battlecry; the reducer parks a `RunState.pendingTarget`;
  a new `battlecryTarget` action resolves the grant on the chosen minion. `battlecryGrantKeyword` is now
  target-aware — an explicit target wins, else it auto-picks the highest-attack friend lacking the
  keyword (so **Plaguebringer keeps its auto behaviour**). An unresolved target **auto-resolves on the
  carry** if the turn ends first, so the play is never stranded.
- UI: a `pendingTarget` aim-line effect (mirrors the Hero Power's) + an accent prompt — "Choose a minion
  for Toxin Tender's Battlecry"; the board minions arm and the played minion's drag is suppressed so a
  click targets rather than drags.
- +3 sim tests (defer-then-grant on the chosen minion — not the higher-attack carry; end-turn
  auto-resolve on the carry; Plaguebringer still auto-grants) + updated the old auto-grant test.
  `typecheck` + `lint` + `test` (**131**) clean; verified live (play → pendingTarget + prompt;
  `battlecryTarget` grants Venomous to the chosen minion, not the highest-attack one; 0 console errors).

### Finite minion pool (draw-from + return-on-sell)
- Wired the shared, finite minion pool the engine was scaffolded for. Each run stocks
  `POOL_QUANTITIES[tier]` copies of every buyable minion of its active tribes (+ neutral) into a new
  `RunState.pool`. The shop **draws from it** — `rollShop` / `topUpTavern` decrement on draw, a full
  reroll returns the discarded offers first, and a card at **0 copies stops being offered** (the shop
  just offers fewer cards). **Selling returns** copies (a golden returns 3, since it ate three), and
  **conjures** (Discover, Buddy Buddy) take a copy so selling them stays balanced. Tokens / Fodder /
  spells are never pooled. Old saves heal (re-stock) on `deserialize`.
- **Quantities** (per the user): T1 **10**, T2 **9**, T3 **8**, T4 **7**, T5 **6**, T6 **6**.
- **Draw weighting unchanged** — I gate by availability rather than weighting by remaining count, which
  keeps the exact draw sequence from a full pool (so every existing seeded test is undisturbed) while
  delivering depletion + return. Copy-count weighting (a drained card appearing less often, BG-style) is
  a noted refinement; a "copies left" UI cue is queued too (the pool is currently invisible).
- +5 sim tests (stocking, copy conservation across buy/reroll/sell, sell-returns incl. golden ×3, a
  depleted card never offered + an empty pool offering nothing). `typecheck` + `lint` + `test` (**129**)
  clean; verified live (pool stocks the Target Dummy at 10, rolls draw from it, no console errors).

### Buff-panel fit + Combinator welds random Mechs
- **Buff inspect panel fits any number of sources.** Widened the breakdown (max-width 150→252px) and
  added a `max-height` + vertical scroll, so a heavily-buffed minion (e.g. `Karwind ×128 +209/+418`
  alongside a dozen other sources) shows every row. The source name flexes/ellipsizes only if a name is
  unusually long, while the `+atk/+hp` amount is pinned always-visible (`flex: 0 0 auto`). Verified live
  with 12 sources incl. 200+ buffs — all fit, nothing clipped, scroll kicks in past the height cap.
- **Combinator welds onto RANDOM Mechs (per proc).** It used to pick the 2 *highest-Attack* friendly
  Mechs (deterministic). Now it picks 2 at **random**, fresh each proc — so Chronos repeats spread to
  different Mechs. The pick is seeded by (run seed, wave, the Combinator's board slot, proc) through a
  new shared `magnetizeTargets()` helper (exported from `@game/sim`), so it's reproducible **and** the
  recruit UI derives the exact same uids to electrify — the visual stays in sync with the actual welds
  without restructuring the recruit→combat flow. +1 sim test (over 24 seeds the welded pair shifts
  around, where the old highest-Attack logic always picked the same two).
- `typecheck` + `lint` + `test` (**125**) clean; buff panel verified live.
- *(Re: pool quantities — answered the user inline: the shop currently samples with replacement from
  the eligible pool with no finite per-tier counts; `POOL_QUANTITIES` remains an unwired placeholder.)*

### Tavern control bar restyle (toward the Pixel Arena mockup)
- Reworked the shop control bar to match the user's mockup. Cost/tier numbers are now **large, bold,
  colored inline** with **no pill** (the earlier teal-pill cost treatment is dropped). The **Refresh**
  cost is bold teal Mana; the **current-tier** indicator's number is bold tangerine.
- The current-tier indicator (`.tavernbox`) gained a **house icon**, the bigger orange tier number, and
  a solid border (was dashed). The **upgrade button** got the same house icon (new `house` glyph added
  to `Icon`) and keeps **"Tavern Up" + the teal Mana cost** (→ "Tavern MAX" at cap).
- **Design note:** the mockup's leftmost "Tavern · Tier 6" is the *current-tier indicator*, not the
  upgrade button — so the "Tavern · Tier N" wording lives there, and the upgrade button stays "Tavern
  Up" to avoid showing "Tavern · Tier" twice. (Together they satisfy "tier wording + cost": the tier on
  the indicator, the cost on the button.)
- `typecheck` + `lint` clean; verified live — bar reads "🏠 Tavern · Tier 1 · Refresh 1 · Freeze · 🏠
  Tavern Up 5 · End Turn" with bold colored numbers, and a forced re-render + real roll logged zero new
  console errors.

### Gnasher vs Reborn, golden Brood Matron, Imp rename, Spirit of the Pack cut
- **Gnasher re-attacks after killing a Reborn target.** Dropping a Reborn minion to 0 revives it
  (`killOrReborn` returns it at base stats and leaves `dead` false), so the on-kill check
  `target.dead || target.health <= 0` read false and Gnasher's re-attack never fired against a Reborn
  body. Now `performAttack` snapshots the target's Reborn availability before the swing and counts a
  *consumed* Reborn as a kill too — so Gnasher keeps swinging through it. +1 sim test (Gnasher clears a
  lone Reborn Grave Knit in exactly two swings, the enemy never getting to attack — which fails under
  the old check).
- **Golden Brood Matron breeds two Imps per death.** `onFriendDeathSummon` summoned `1 + echoBonus`
  regardless of golden; it now uses `mul(self) + echoBonus`, so a golden Brood Matron makes **2** Imps
  per friend death (Echo Wardens still stack on top). Added explicit `goldenText` + 1 sim test (golden
  → 2, plain → 1).
- **Imp Scrap → Imp.** The Brood Matron token is renamed to **Imp** (id stays `impscrap`, so Brood
  Matron's `tokenId` param and the existing tests are untouched) and now has illustrated art.
- **Art wired:** Brood Matron (`BroodMatron.png` → `brood.png`) and the Imp token (`Imp.png` →
  `impscrap.png`), both 512×512 — verified loading live. Wired-art count is now 32.
- **Spirit of the Pack (`pack6`) removed.** The tier-6 Beast (Deathrattle: all Beasts +4/+4) is cut
  from the set and its art file deleted. The one test that used it as a buff-Deathrattle vehicle now
  uses **Grim** (+6/+6), which remains the board-wide Beast buff; `useCombatReplay` comments updated to
  match.
- **Tavern Up cost emphasised.** The upgrade button's cost is now larger (22px, bold) inside a teal
  Mana pill, scoped to a new `.tavernup` class so the sibling **Refresh** cost keeps its baseline look.
- `typecheck` + `lint` + `test` (**124**) + `build:web` clean; art + button verified live (brood/Imp
  render at 512×512; Tavern Up cost 22px in a pill, Refresh cost unchanged at 17px). Repacked
  `ascent-itch.zip` (41 entries — brood + impscrap in, pack6 out; `index.html` at root, forward-slash
  paths).

### Venomous retaliation + "Tavern Up" button
- **Venomous now procs on the attacker too.** A unit that *attacks* a Venomous minion took the
  defender's retaliation damage, but the venom proc/drop-off was skipped whenever that raw retaliation
  was already lethal (the guard was `if (poison && target.health > 0)`). Now the proc fires whenever
  damage actually lands — i.e. past the Immune/Divine-Shield early-returns — so attacking a Venomous
  unit kills the attacker and consumes the defender's `V`, **unless the attacker is shielded** (a
  Divine-Shield/Immune attacker absorbs the hit and the venom never lands, exactly as before). One-line
  fix in `dealDamage` (`if (poison)`); `performAttack` already forwarded the defender's venom on
  retaliation. Added 2 sim tests — (a) attacking a Venomous target kills the attacker via retaliation
  venom, shielded variant survives; (b) the proc **and drop-off** fire even when the raw retaliation is
  lethal (would fail under the old `target.health > 0` guard). All **122** tests pass.
- **"Tier ^" → "Tavern Up" + mana cost.** The upgrade button now reads **Tavern Up** (and **Tavern
  MAX** at cap) with a teal **mana drop** rendered inline before the cost number. Sized 17px to match
  the cost text (`.btn.big .c` is now an `inline-flex` row with a small gap). Verified live: the button
  shows `Tavern Up 5`, two icons, the cost icon computed at 17px / mana-dk teal; Recruit re-renders and
  a real `roll` dispatch produced **zero** new console errors (the residual `<Recruit>` errors in the
  buffer are the documented stale artifact from forcing `newRun` mid-combat on the long-running server).
- Repacked `ascent-itch.zip` (40 entries, `index.html` at root, all forward-slash paths). `typecheck`
  + `lint` + `test` (122) + `build:web` clean.

### Fix: enemy minions now animate their attacks
- Enemy (tavern-side) attacks showed no lunge. Cause: the `enemyarrive` entrance animation used
  `both` fill, so it **held its final `transform`** on every enemy unit — and a filling CSS animation
  overrides the inline lunge transform (player units have no such animation, so they were fine).
  Dropped the fill (the keyframe ends at the identity transform, so the entrance is unchanged); enemy
  lunges now apply. Verified live — an attacking enemy now lunges (`translate(326px, 218px) scale(1.04)`),
  and a full combat replays with no console errors.

### Correct Echo Warden art + new Ember Whelp art
- Re-wired **Echo Warden** from the now-present `EchoWarden.png` (replacing the earlier wrong guess —
  a spectral figure surrounded by echoed summons, fitting the card), and swapped **Ember Whelp** to
  `EmberWhelp2.png` (a fierier flame-breathing whelp). Both verified loaded in-app.
- **Policy:** only wire card art when a source file's name matches the card — never guess from an
  un-attributed file (a wrong guess is worse than the pixel-sprite fallback).

### Shaper/Echo art, minimal Karwind burn, magnetize pass 2, golden buff breakdown
- **Wired Wildwood Shaper + Echo Warden art** (`shaper.png`, `echo.png`). *Note:* there was no
  `EchoWarden.png` in the source folder — used the only un-attributed export (a leafy winged creature)
  for `echo`; swap the file if that's the wrong asset.
- **Karwind flame, reworked.** The old effect filled the whole card (72%-tall tongues, 0.9s) and read
  inconsistently. Now it's a **quick, minimal burn along the bottom edge** (5 small uniform tongues
  ~17% tall + a bottom glow band, 0.5s) — just a "Karwind is working" indicator, consistent across
  every buffed Dragon. Verified live.
- **Magnetize pass 2.** The drone now fully **vanishes into the Mech** (scale → 0.06, opacity → 0,
  accelerating ease) in **0.28s** (was a lingering 0.16-scale/0.15-opacity remnant over 0.32s), with
  the target Mech's crackle settling faster onto the green buff flash. (Drag gestures can't be driven
  headless, so the feel is best confirmed in-game.)
- **Buffs now carry through triples → goldens itemize in inspect.** The triple now keeps the two best
  copies (by total stats), **sums their stats AND merges their per-source buff breakdowns** onto the
  golden. For uniform buffs / fresh triples this is identical to the old top-two-atk/top-two-hp result;
  it only differs for oddly asymmetric per-copy buffs (rare), and in exchange a golden's inspect panel
  now lists its buffs (e.g. `Spirit Fire ×2 +6/+6`, `Karwind ×2 +2/+4`) consistently with its stats.
  Verified live + unit-tested (golden carries `Spirit Fire ×2 +6/+6`).
- `typecheck` + `lint` + `test` (**120**) + `build:web` clean; art + Karwind + golden breakdown
  verified live, no console errors.

### Cleaner magnetize "absorb"
- The magnetize merge was janky: the dropped card crept to the target over **0.72 s**, shrank to 0.32
  with a box-shadow crackle *on the flying card*, then the stats jumped — slow, and the target Mech
  never reacted. Rebuilt it as a snappy **absorb**: the drone shrinks straight into the Mech in ~0.32 s
  (down to 0.16 scale + fading out), and the electric crackle now plays on the **target Mech** (it
  keeps crackling a beat past the merge), landing on the existing green buff flash. Faster + reads as
  the Mech eating the drone. (`typecheck`/`lint`/`build` clean; merge logic unit-tested already —
  drag gestures can't be driven in the headless preview, so the timing is best felt in-game.)

### Buff-source breakdown, Karwind flames, drag-popup + sell fixes
- **Per-source buff tracking + inspect breakdown.** `BoardCard` now carries a `buffs` list (source,
  ±atk/±hp, count), populated by a new `addBuff()` that every recruit buff routes through (battlecry
  tribe buffs, Karwind, Spirit Fire, Fortify, Broker, Kennelmaster, Combinator, Ritualist, consume,
  magnetize, deathrattles). Right-click → inspect now shows the breakdown to the **left** of the card,
  e.g. `Nadir ×1 +2/+2`, `Karwind ×1 +1/+2`, `Spirit Fire ×2 +6/+6`. (Goldens don't itemize — the
  triple sums stats ambiguously; known limitation.) Verified live + unit-tested.
- **Karwind flame highlight.** When a Battlecry triggers Karwind, the Dragons it buffs now flash with
  flames (a transient `karwindFlash` uid list + seq drives a flame overlay), on top of the normal green
  buff flash — so it's clear the extra buff came from Karwind. Verified live (playing Hoard Cleric
  flame-flagged all 3 dragons) + unit-tested.
- **No referenced-card popup while dragging.** Holding/dragging a card no longer counts as "hovering" a
  minion — a `dragging` prop suppresses the popup and drops any open one.
- **Minions must be on the board to sell.** A hand minion flung up to the tavern now snaps back to the
  hand instead of selling (only board minions sell; the sell-glow matches).
- `typecheck` + `lint` + `test` (**119**) + `build:web` clean.

### Drag insertion sweet spot + tooltip proximity
- **Drag drop now follows the card, not the cursor.** The warband/shop insertion index was computed
  from the raw pointer x — but the floating card is offset by wherever you grabbed it, so grabbing the
  right side dropped the card a slot too far right. It now uses the dragged card's **centre**
  (`pointer − grabOffset + width/2`) at every insertion site (live drop-slot preview, play, reposition,
  shop reorder, magnetize target), with `INSERT_FRAC` 0.35 → **0.5** so a card slots after another only
  once its centre passes that card's midpoint. (Verified by code: the harness can't drive React's
  pointer-capture drag synthetically.)
- **Referenced-card popup hugs the hovered card.** The 0.8 scale was anchored at centre, so the popup
  appeared to drift ~30px off the source. Now the scale is anchored to the source-facing edge
  (transform-origin left/right) and positioned so the *visible* edge sits ~8px from the hovered card
  (flips side near the screen edge). Verified live: popup's visible left edge ≈ the source card's right
  edge (~8px), origin left-center.
- `typecheck` + `lint` + `test` (**116**) + `build:web` + `package:itch` clean.

### Referenced-card popup polish — delay + float + haze
- The referenced-card popup now opens after a **~0.5s hover** (so it doesn't flash while skimming the
  board; position is measured when it opens, so it tracks a popped-up hand card). It **slides in**, then
  gently **bobs + wobbles in place** (a continuous float) so it reads clearly as an info card, not a real
  one, and it's wrapped in a **soft white haze** (layered white drop-shadows). Verified live: hidden at
  150 ms, shown by 650 ms; entrance + float animations active; haze present; no console errors.
- The popup minions also render at **80% size** (scale baked into the float keyframes so it composes with
  the wobble) — verified ~0.82× the source card on screen.

### Referenced-card hover popup
- Hovering a card that references another now shows the referenced card as a **popup to the right**,
  portalled to `<body>` at z-index 150 so it floats **above neighbouring cards / spells**. Covers every
  card that names/creates/affects another: **Alleycat / Wildwood Shaper → Stray**, **Pack Scrounger →
  Pup**, **Brood Matron → Imp Scrap**, **Combinator → Cling Drone**, and the Fodder cards **Soulfeeder /
  Voracious Imp / Ritualist / Pactstone Acolyte / Maw / Ravening Glutton → Fodder**. The Fodder popup
  reflects its **current buffed stats** (folds in Ritualist's persistent enchant), so the player can see
  what their Fodder is at right now. Positions to the right by default, flips to the left near the screen
  edge, and clamps on-screen. Wired via a memoized `refViewsByUid` map (stable across a drag, preserving
  the card memo). Verified live: Combinator→Cling Drone (2/2), Alleycat→Stray (1/1), Ritualist→Fodder
  shown at 4/4 (1/1 base + a 3/3 enchant), Soulfeeder→Fodder; popup on `<body>`, z-150, no errors.
- `typecheck` + `lint` + `test` (**116**) + `build:web` + `package:itch` clean.

### Ornate Discover frame, centered game-over button, sequenced End-of-Turn animations
- **Discover frame redesign.** The Discover overlay is now an ornate, gold-framed parchment panel —
  a layered gold border, a "Discover" banner plaque, blue gems above/below, a ✦-flourished subtitle,
  and each of the three cards in a **tier-coloured pulsing glow** (green/red/purple by tribe). New
  classes (`.disc-panel`/`.disc-banner`/`.disc-gem`/`.disc-sub`/`.disc-slot`) so the Choose-One overlay
  (which shared `.discover-box`) is untouched. Verified live: panel + banner + 2 gems + tribe-tinted
  glows render.
- **Game-over button centered.** `.btn` is `display:flex` (block-level), so the box's `text-align:center`
  never centered it — it sat full-width/left. Made `.over .box` a centered flex column; verified the
  box centers in the window and the button centers in the box (and the real "Begin a New Ascent" path
  resets cleanly, no crash).
- **End-of-Turn plays out one card at a time.** Reworked the End-Turn telegraph: instead of flashing
  all End-of-Turn minions at once, each fires **individually in sequence**, and **repeats
  `chronosRepeats` times** when a Chronos is in play (mirrors `applyEndOfTurn`'s per-card-then-repeat
  order; `chronosRepeats` is now exported from `@game/sim`). Each beat flashes the proc flourish under
  its card plus a tailored effect — **Ritualist** washes the whole shop purple (it buffs the Fodder
  there; new `.shopflash` over the tavern), **Combinator** crackles electricity over the two Mechs it
  magnetizes onto (new `electrify` prop reusing the `crackle` keyframe). Plus a short "proc" shimmer
  per beat. Then it faces the Omen. Verified live (Ritualist×2 + shop flash, then Combinator×2 +
  electrified Drone & Money Bot, → combat).
- Added a **DEV-only `window.useGame` handle** (stripped from production) to stage UI states from the
  console for verification.
- `typecheck` + `lint` + `test` (**116**) + `build:web` + `package:itch` clean.

### Triple Reward glow + itch.io packaging
- **Triple Reward card glow.** The Discover/triple-reward spell now wears the **golden frame + gold
  text box** (like a tripled minion — gold border, gold body tint, gold name pill + footer) and a
  **bright, vibrant orange glow that pulses** (`.card.triplecard`, keyed off the `discoverspell` id,
  overriding the generic purple spell look). Verified live: rules present + `tripleglow` animation active.
- **itch.io packaging.** The production build now uses a **relative base** (`base: './'` on `build` only;
  dev stays absolute) so every asset resolves from itch's CDN sub-path. Confirmed the output is fully
  relative — `index.html` → `./assets/…`, CSS → `../board.jpg` / `../cursors/…`, JS art via
  `import.meta.url`, no leading-slash refs. Added `npm run package:itch` (build + a small PowerShell
  zipper, `scripts/package-itch.ps1`) that emits **`ascent-itch.zip`** with `index.html` at the zip root
  and **forward-slash entries** (PowerShell's `Compress-Archive` writes backslashes, which break on
  itch's Linux unzip — the script writes the zip manually to avoid that). Upload that zip to itch.io as
  an HTML game with "play in browser". (Zip + dist are gitignored.)
- `typecheck` + `lint` + `test` (**116**) + `build:web` clean.

### Golden-magnetize Discover, beefier Reborn tears + Venomous drip, Triple Reward rename/art/dynamic text
- **Golden Magnetic now grants its Discover.** Welding a golden Magnetic minion (e.g. a tripled Cling
  Drone) onto a host returned early in the reducer, skipping the `grantGoldenDiscover` that a normal
  golden play runs — so you lost the triple reward. The magnetize merge path now grants it too. Tested.
- **Reborn tears are punchier** — bigger (11×15), brighter, faster cadence, and **6** particles (was 4)
  so several drift at once instead of one-at-a-time. (Per the user — they like the effect.)
- **New: Venomous drip.** Cards with Venomous now constantly drip green venom globs (form → swell →
  elongate → fall), keyed off the `V` keyword. No rim glow (per the user) — just the drips. Same overlay
  pattern as the Reborn tears; shows in the shop, on granted-Venomous minions, and on combat venom units.
- **Glimpse Beyond → Triple Reward.** Renamed the Discover spell, wired its art from the Spells source
  folder (`art/minions/discoverspell.png`), and made its text **name the exact tier** it Discovers from:
  `Discover a Tier {min(6, currentTier + 1)} minion` — recomputed from the live shop tier (so it reads
  "Tier 2" on tier 1, "Tier 6" on tier 6). Matches the actual `offerDiscover` formula.
- `typecheck` + `lint` + `test` (**116**) + `build:web` clean; rename + art + dynamic-text formula +
  CSS verified live, no console errors.

### Heckbinder dual-tribe fix, mana tooltip, golden-text correctness + full fill, Reborn FX, Esc resolution menu
- **Magnetize onto Heckbinder now works.** `magnetizesTo()` was checking only the *target's* primary
  tribe, so a Mech-magnetic card (Cling Drone) couldn't weld onto Heckbinder (primary tribe Demon).
  It now intersects BOTH cards' tribe sets — Heckbinder counts as a Mech, so anything Mech-magnetic
  attaches to it (and it still attaches to a Mech or Demon).
- **Dual-types count as both tribes for buffs**, not just magnetizing. Added a combat `Minion.tribe2`
  (from the def) and taught the tribe-buff sites (combat: buff-tribe, AoE-per-tribe, shield-tribe;
  recruit: battlecry/deathrattle buff-tribe, Combinator's auto-magnetize) to match either tribe.
  Regression-safe — single-tribe cards have `tribe2 === undefined`. Tested (Cling→Heckbinder merge;
  Heckbinder shielded by Omega Bulwark's Mech grant).
- **Mana projection tooltip** ("coming up") icon was tinted `--acc` (orange), reading as an ember —
  now `--mana` teal, matching the chip.
- **Golden text correctness.** The naive number-doubler mis-rendered cards whose golden form changes a
  *count* or needs plural grammar. Added an explicit `CardDef.goldenText` (+ zod, threaded through the
  card views) used verbatim when golden: **Buddy Buddy** (add *two* minions), **Soulfeeder** (add *2*
  Fodder), **Combinator** (*two* Drones), and grammar fixes for **Drakko/Sylus/Chronos/Echo** ("1 more
  time" → "2 more times"). Summon cards whose counts *don't* change when golden (Alleycat, Pack
  Scrounger, Brood Matron, Wildwood Shaper) are already correct under the doubler, so they're left.
- **Golden box fills the whole card.** Tinted the `.card.golden` background gold (the body shows it
  edge-to-edge) and dropped the inset description panel, so the entire text area reads gold (+ gold
  footer, on top of the existing gold name pill).
- **Reborn FX upgraded.** The blue aura now also washes OVER the art (screen-blend, like Divine Shield)
  and the whole card pulses; added drifting spectral "tear" particles (staggered, ~one at a time) for
  life. All keyed off the `R` keyword, so they vanish the instant a minion Reborns in combat.
- **Esc menu + resolution scaler.** New pause/settings overlay (Esc key or a bottom-right gear) with a
  display-resolution picker: **Fit to Window / 1920×1080 / 2560×1440 / 3440×1440**. The whole game now
  renders into a centred "stage" box driven by `--gw`/`--gh`; the card/chrome scaling keys off the box
  (not the raw viewport), so picking a fixed 16:9 / 21:9 size letterboxes the rest against a dark frame.
  No transform-scale, so drag + pointer math are untouched; window-edge HUD (status tray, hand, timer,
  combat log) is offset into the box by `--bar-x/--bar-y`. Choice persists (localStorage). Verified
  live: fit = full window; on 1080p, 16:9 fills + 21:9 letterboxes to aspect 2.333; menu applies +
  persists; no console errors.
- `typecheck` + `lint` + `test` (**115**) + `build:web` clean.

### Rope width cap, +30% proc flourish, golden/Reborn card cues, Reborn-at-base, dual-type Heckbinder
- **Rope no longer scales with the monitor.** It was `width: 86%` of the viewport, so it stretched
  edge-to-edge on wide screens. Capped to `min(1180px, 92vw)` (the board's content frame) — verified
  live: on a 1907px monitor it renders at exactly 1180px instead of ~1640px.
- **Proc flourish ~30% more noticeable.** The under-card Battlecry / End-of-Turn sigil (`.bcryfx`)
  got bigger + brighter: glow 46→60px (expand 1.55×→2×), motes 9→12px with a larger halo, travel
  40→52px, hotter core mix.
- **Golden (tripled) cards read at a glance:** the name pill is now a filled gold gradient (not just
  gold text) and the description sits in a soft gold panel, with a gold-tinted footer.
- **Reborn cards show a pulsing blue aura** (`.card.reborncard`, keyed off the `R` keyword) — recruit
  + combat. In combat it drops the instant the minion Reborns (it sheds `R`), so the glow marks "one
  revival left."
- **Reborn now returns at BASE stats.** A minion that died Reborn used to come back at its current
  (buffed) attack and 1 health, keeping granted keywords. Now it returns at its *printed* card stats
  and base keywords — shedding all combat buffs and granted effects (Divine Shield, etc.); golden
  returns at doubled base. So a 2/1 buffed to a 10/3 Divine-Shield body comes back a plain 2/1. The
  `reborn` event now carries `attack` + `keywords` so the combat replay applies the reset. (This is
  the "combat stats are temporary" rule; recruit-permanent stats live on the run board, untouched.)
  Tested (base reset, granted-DS shed, golden = 2× base).
- **New: Heckbinder** (T4 Demon/Mech, 3/3, Magnetic) — the first **dual-type** minion. Added
  `CardDef.tribe2` (+ zod schema); a Magnetic minion now welds onto any friendly minion sharing one
  of its tribes (new `magnetizesTo()`), so Heckbinder merges onto a **Mech or a Demon** (Cling Drone
  still Mech-only). Renders the split-hue card + a "Demon / Mech" footer. Art wired. Tested
  (magnetizes to demon + mech, not beast).
- **Mechanics checks (items 5 & 6):** there's currently **no way to destroy a board minion during
  the shop phase** (selling removes it without a Deathrattle; Consume eats tavern Fodder; triple /
  magnetize aren't destroys), so those rules have no trigger yet. The model they describe already
  holds: recruit-phase Deathrattle factories apply *permanent* stat changes, and combat buffs are
  combat-only (now reinforced by Reborn-at-base). The "Reborn lost permanently unless tripled" rule
  would need a per-card flag + restore-on-triple once a shop-destroy mechanic exists — flagged for
  the user.
- `typecheck` + `lint` + `test` (**113**) + `build:web` clean; rope cap + Heckbinder load verified
  live, no console errors.

### Better burning-rope timer — real flame + braided fuse, repositioned to clear the rows
The last-15s turn timer rope was a thin faint line with a small round glow dot crammed against the
tavern row. Rebuilt it:
- **Braided fuse** (rounded, diagonal-strand texture with top highlight) instead of a flat line, and
  a **charred trail** behind the flame (dark, with a glowing ember edge right at the burn point).
- **A real flame** at the burn point: a warm halo, a flame-shaped body, a hot inner core, and three
  rising **ember** sparks — all flickering. Replaces the single radial dot.
- **Repositioned**: more vertical margin so the fuse sits centred in the tavern↔warband gap (was
  cramped against the tavern). Tuned the flame height + margin so the flame licks up to exactly the
  tavern row's bottom with **0px overlap** (measured live: 22px below the tavern, 16px above the
  warband). All sizes scale with the `--u` chrome unit.
- `typecheck` + `lint` + `build:web` clean; verified live (rope + flame parts render, correct burn
  position, no console errors).

### Triage: Soulfeeder "procs every round" — engine is correct; fixed frozen-tavern Fodder stranding
Reported: Soulfeeder seems to proc every round after one play. Triaged with deterministic tests:
- **The engine procs Soulfeeder exactly once.** A multi-round test confirms its attack goes
  `2 → 3 → 3 → 3 → 3` (eats one queued Fred on the first refresh, never again) and `pendingTavern`
  is `['fred']` then `[]` forever. `refreshTavern` clears the queue after injecting, so there is no
  per-round re-proc in the simulation.
- **Real related bug found + fixed: a frozen tavern stranded the queued Fodder.** When you froze,
  `advanceAfterCombat` took the `topUpTavern` path, which never injected/consumed `pendingTavern` —
  so a Soulfeeder-queued Fred was stuck forever (the *opposite* of "every round," but a genuine bug).
  Extracted `injectPendingTavern()` and now run it on **both** the reroll and the frozen carry-over,
  so the promised Fred always arrives (and is eaten) exactly once. Tested (frozen delivery + the
  once-only multi-round case).
- **The "every round" visual could not be reproduced.** The two candidate animations both fire once
  by construction: the Fodder eat-swirl is gated by `fodderEatenSeq` (bumped only on a real consume,
  i.e. once), and the Battlecry flourish is gated by a played-uids set (`prevBoardUidsRef`, which
  retains the card across the combat→recruit round-trip). Instrumented both + attempted a live
  repro; no re-fire observed. Awaiting a repro clip / details from the user to pin any visual.
- `typecheck` + `lint` + `test` (**110**) clean.

### Chronos (End-of-Turn doubler) + a real fix for the return-to-shop minion flicker
- **Return-to-shop flicker — root cause found + fixed.** Frame-by-frame capture of the combat→recruit
  return showed the warband card playing `boardreset` cleanly (opacity 0.45→1)… and then, at ~650ms
  when the `resetting` class was *removed*, its `animation` reverted to the base `cardpop` and
  **re-fired from opacity 0** — a second flash. The toggle itself was the bug: changing a card's
  `animation` property (boardreset ↔ cardpop) restarts it. Fix: **drop the `resetting`/`boardreset`
  toggle entirely** — the warband re-mounts and re-enters via the base `cardpop` once (no class to
  toggle, so it can't re-fire), and the stat snapshot is re-synced on the transition so the green
  buff-flash doesn't spuriously fire on the cards coming back in. Verified by capture: a single
  `cardpop` 0→1 that settles at 1.0 with no second flash (previously opacity dropped back to 0 at
  650ms). No console errors.
- **New: Chronos** (T5 neutral 1/6) — *your End-of-Turn effects trigger 1 more time* (golden: 2 more;
  multiple Chronos do **not** stack — best one counts, mirroring Drakko). `applyEndOfTurn` now repeats
  each end-of-turn effect `chronosRepeats(state)` times, so e.g. Ritualist with a Chronos buffs Fodder
  +2/+2 per turn, Combinator welds two rounds of Cling Drones, etc. Art wired. Tested.
- `typecheck` + `lint` + `test` (**108**) + `build:web` clean.

### Fix: end-of-turn proc flourish now actually shows; smooth board return from combat
Two follow-up fixes to the previous batch.
- **End-of-turn flourish was invisible.** It was triggered on *combat entry*, but the warband flips
  from recruit `Card`s to combat `Unit`s the instant the phase changes — so the cards being flashed
  no longer existed. Now **End Turn** plays the flourish on the still-mounted recruit board first: if
  any minion has an End-of-Turn effect, those minions flash the Battlecry-style `.bcryfx` sigil for a
  ~620ms beat, *then* `faceOmen` fires (effects resolve + combat). Boards with no End-of-Turn card go
  straight to combat as before. (The effects themselves always resolved in `faceOmen` — this is the
  missing visual.)
- **Board "flash/jank/reset" returning from combat.** Every `.card` plays `cardpop` on mount, and the
  warband cards re-mount when returning from combat (they were `Unit`s). The `resetting` class (which
  overrides `cardpop` with `boardreset`) was set in a `useEffect` that runs *after* the cards already
  painted `cardpop`, so the two animations raced. Fixed by setting `resetting` in a **`useLayoutEffect`
  (before paint)** so the board paints `boardreset` directly, and softened `boardreset` to a calm
  rise-in (no scale-overshoot bounce). Verified live: the returning warband card's computed animation
  is `boardreset` (not `cardpop`), with no console errors.
- Confirmed for the user: the **minion caps are all enforced** — board 7 (play, recruit summon, and
  combat summon all gate on it), hand 10, mana/gold cap 10, tier 6.
- `typecheck` + `lint` + `build:web` clean; combat round-trip verified live.

### 5 new cards + Venomous (Poison rework) + end-of-turn proc anim + mid-combat buff display fix
A big content + mechanics batch.
- **Poison → Venomous.** The keyword is renamed everywhere (code `'P'` → `'V'`, schema, all card data,
  threat templates, UI labels/tooltips, CSV, tests) and its mechanic changed: **Venomous drops off
  after its first proc in combat.** When a unit's venom destroys a target (the poison event fires),
  that poisoner loses `V` and emits a new `venomLost` combat event; the UI removes the badge mid-fight.
  So a Venomous body is a one-shot per fight (unless re-granted). Tested (one-proc-then-survives).
- **Buddy Buddy** (T3 neutral 3/4) — Battlecry: add a random Tier 1 minion to your hand (golden: two).
  New recruit factory `battlecryGainRandomMinion` (draws from the run's buyable T1 pool, honors the
  hand cap, uses the shop RNG). Fires through Drakko like any Battlecry.
- **Combinator** (T5 Mech 6/7) — End of Turn: magnetize a Cling Drone (+2/+2) onto 2 *other* friendly
  Mechs (golden: 2 drones each → +4/+4). New `endOfTurnMagnetizeMechs`.
- **Grim** (T6 Beast 7/1) — Deathrattle: give your Beasts +6/+6 for the rest of combat (golden +12/+12).
  Reuses the existing `deathrattleBuffTribe` (data-only).
- **Karwind** (T6 Dragon 2/12) — whenever a Battlecry *triggers*, give your Dragons +1/+2 (golden +2/+4).
  New `battlecryTriggered` recruit event, fired once per Battlecry resolution — **including each Drakko
  repeat**, so a doubled Battlecry procs Karwind twice. New `onBattlecryBuffTribe`. Tested (incl. Drakko).
- **Money Bot** (T3 Mech 3/3, Magnetic) — while on your board, **+1 max mana per turn** (golden +2). A
  board-derived economy: the per-turn embers are recomputed each turn as `maxEmbers + boardManaBonus`
  (a new `CardDef.manaPerTurn` + a `BoardCard.manaBonus` for the absorbed amount). Magnetizing it into a
  Spare Part Drone transfers the income onto the host, which survives the host's triple; selling the host
  removes it. The mana projection tooltip folds it in. Tested (on-board, magnetize-transfer, sell-removal).
- **End-of-turn proc flourish.** Cards whose End-of-Turn effect resolves (Ritualist, Combinator…) now
  flash the same under-card sigil as a Battlecry, on the board through the shop-closing beat.
- **Mid-combat buff display fix.** A multi-proc deathrattle (e.g. Spirit of the Pack re-procced by Sylus
  for +12/+12) showed three separate "+4/+4" floats; the combat replay now **sums buff events per target
  within a beat** and shows one correct "+12/+12" per minion. (Stat badges were already correct.)
- All 5 sprites wired (BuddyBuddy / Combinator / Grim / Karwind / MoneyBot). `typecheck` + `lint` +
  `test` (**107**) + `build:web` clean; live: cards load with the right stats/art, combat replays with no
  console errors, the End-of-Turn banner + flourish fire.

## 2026-06-17

### Bug-fix + juice batch — freeze refill, end-of-turn feel, combat grants, end-game fix, sounds
An eight-item batch of fixes and feel polish.
- **Frozen taverns top up.** Freezing a partial shop (you'd bought some minions, or the spell)
  used to carry it over with the gaps; now after combat a frozen tavern fills its empty minion
  slots back up to the tier count and re-adds a spell if missing, keeping every frozen offer in
  place. New `topUpTavern()` shares the weighted-draw helper with `rollShop` (refactored out a
  `drawOfferId`). Tested.
- **A clear "End of Turn" beat.** Ending the turn already fired end-of-turn effects (`faceOmen` →
  `applyEndOfTurn`); now a brief centred **"End of Turn"** banner plays on the recruit→combat
  transition so it reads. (Verified live.)
- **Fodder eat animation shows what was eaten.** A Demon devouring tavern Fodder showed a 1/1 ghost
  even when Ritualist had buffed it. The consume record (`fodderEaten`) now carries the Fodder's
  *effective* stats, the ghost renders them (green vs. the 1/1 base), the swirl is **slower** (1.35s
  → 2.2s, holding full-size so the stats read), and it's wreathed in **orbiting purple orbs**.
- **Combat hand-grants pop in.** A card a combat Deathrattle adds to your hand (Arcane Weaver →
  Spirit Fire) now flashes an accent glow as it arrives — the hand is snapshotted on entering
  combat, and the new uids afterward are flagged as grants.
- **End-game state fixed.** The game-over overlay (`.over`) had no `z-index`, so the live board's
  positioned chrome (hand z-25, status z-40, timer z-80, …) painted *through* it — the "busted" end
  screen where the board showed on top. It's now `position: fixed; z-index: 300` (above all chrome)
  with a near-opaque scrim, so it cleanly covers + blocks the dead board. (Verified the rule live.)
- **Imp Scrap** is a plain 1/1 with no keyword/Fodder interaction — its misleading "…meant to be
  eaten" body text is now blank.
- **A "wrong" sound on rejected actions.** A buy/play/roll/upgrade you can't afford (or that's
  otherwise a no-op — the reducer returns the same reference) now plays a low descending **deny**
  buzz instead of the success blip.
- **Battlecry flourish.** Playing a minion whose Battlecry fires now swells a tribe-tinted sigil
  from *under* the card with sparks fanning out — detected by diffing the board for a new card whose
  def has an `onPlay` effect (or Choose One). (Verified live on Soulfeeder.)
- `typecheck` + `lint` + `test` (**100**) + `build:web` all clean; no runtime console errors.

### Buttery drag — memoize Card so the board doesn't re-render on every pointermove
Dragging a card fired `setDrag`/`setOverZone` on every pointermove, re-rendering the whole recruit
tree — including all 7–14 `Card`s (each an `<img>` + pills + `dangerouslySetInnerHTML` text). Now:
- **`Card` is wrapped in `React.memo`** and its props are stabilized so the memo actually fires:
  - The per-card **view objects** are hoisted into `useMemo` maps keyed by uid
    (`shopViews` / `boardViews` / `handViews` + a `spellView`), recomputed only when the underlying
    `run.*` slice changes. During a drag nothing dispatches, so those refs are stable → the maps
    return the *same* `CardView` object for each card across pointermove re-renders.
  - The per-card `beginDrag(uid, source, view)` factory (a fresh closure every render) is replaced by
    **one stable `onCardPointerDown`** shared by every card: it reads the grabbed card's uid + zone
    from the DOM and its view from a ref, so its identity never changes mid-drag. (Hand cards now also
    carry `data-uid` so the handler can resolve them.)
- **Result (measured live):** 10 pointermoves during a drag caused **2 total card re-renders** (the
  dragged card's dim-flip + the floating card mounting once) — ~0.2/move, vs. ~one-per-card-per-move
  before. The per-second turn-timer tick also no longer re-renders the cards.
- The drag *mechanics* (`onMove`/`onUp`/`applyDrop`) are untouched, so behavior is unchanged.
  **Verified** end-to-end with synthetic pointer drags: buy (tavern→hand, −3 mana), play
  (hand→warband), and sell (board→tavern, +1 mana) all still work; the floating card appears/clears
  correctly. `typecheck` + `lint` + `test` (99) + `build:web` all clean; no runtime console errors on
  a fresh load. (Note: editing `Card.tsx` now full-reloads in dev rather than hot-swapping — Fast
  Refresh bails on a memo-wrapped export in a file that also exports helpers; harmless, dev-only.)

### Proportional chrome — HUD / controls / status tray / overlays scale with the viewport
The cards already scale with viewport height (`--ch`), but the chrome was fixed-px, so on big
monitors the HUD/buttons/fonts looked comparatively tiny (a flagged backlog item).
- **New scaled unit `--u: clamp(1px, 0.107vh, 1.34px)`** — a "scaled pixel" with a **1px floor**
  (so laptops and short windows read *exactly* as before — zero regression at ≤~935px tall) that
  grows to **+34%** on tall monitors (1440px+). Chrome dimensions are expressed as `calc(N * var(--u))`
  so every piece scales by the same factor and stays proportional to the cards.
- **Converted:** the top HUD (wordmark, wave meter, tribes, mute), the round turn-timer, the bottom
  status tray (Resolve bar + value, the hero/power panel + portrait, the Ember/Mana chips — including
  the larger "hero-sized" overrides), zone headers, the tavern controls (Refresh/Freeze/Tier/End Turn
  + the Tavern-tier label), the result toast, and the two modal overlays (Combat Log + Discover /
  Choose One). The combat arena's intentionally-huge post-fight buttons (`.cbtns .btn.big`, 32px) keep
  their fixed size via the more-specific selector — they're sized for combat readability, not chrome.
- **Verified** objectively via the preview (resize + `getComputedStyle`, no screenshots needed):
  at 800px tall every value equals its original px (wordmark 19, big button 17, status-chip value 34,
  hero name 23, hero portrait 80×80, Resolve value 28); at 1440px tall all scale by ×1.34 in lockstep
  (25.46 / 22.78 / 45.56 / 30.82 / 107×107 / 37.52). Overlay rules parsed correctly; `build:web` +
  `lint` clean; no console errors.
- Also scouted the **minion-art backlog**: every source illustration that maps to an existing card id
  is now wired (21 cards); the leftover source art (`Combinator`, `Grim`, `Karwind`) has no matching
  card, so it needs a card decision, not just wiring. **Art→WebP compression** is blocked on tooling
  (no encoder installed) — noted in the roadmap.

### Arcane Weaver + Ritualist, board dust, drag float, simultaneous deathrattle buffs, 2 sprites
A seven-item content + polish batch.
- **New: Arcane Weaver** (Tier 4 Dragon, 3/4) — **Deathrattle: add a copy of Spirit Fire to your
  hand.** Combat can't touch the recruit hand, so this is a *carry-back*: a new combat factory
  `deathrattleGrantSpell` calls `ctx.grantToHand(cardId, side)`; `simulate()` accumulates player-side
  grants into `CombatResult.playerHandGrants`, and `advanceAfterCombat` pushes each into the hand
  after the replay (win or lose, capped by `handMax`). Golden Weaver grants two; an enemy Weaver
  grants the player none. Art wired.
- **New: Ritualist** (Tier 5 Demon, 2/5) — **End of Turn: all Fodder gets +1/+1, wherever it is.**
  This is a *persistent per-cardId run buff*: a new `RunState.cardBuffs` map (`cardId → {atk,hp}`)
  is folded into **every** instantiation of a card — bought (`buy`), summoned/conjured (recruit
  `summon`), discovered (`discover`), the demon-consume math (`consumeTavernFodder`), and the live
  tavern display (`shopView`) — so a Fodder from *any* source carries the accrued buff. The new
  recruit factory `buffFodderEverywhere` (fires on `endOfTurn`) bumps `cardBuffs` for every
  FD-keyworded card and immediately buffs the Fodder already on the board / in the hand. Golden
  doubles; multiple Ritualists stack. Art wired.
- **Board dust** — a soft, earthy puff of motes kicks up on a primary click of the *empty board*.
  A `puffBoard` handler on the `.app` root ignores any click whose target is a card or control
  (`.card, button, a, input, [role=dialog], .bar, .rtimer, .shopctl`) and is suppressed while
  aiming the Hero Power or dragging — so it reads as touching the table, never a card. Purely
  cosmetic (mirrors the spell-spark pattern; doesn't block other handlers).
- **Drag float** — the dragged card now follows the cursor on a whisper of lag (`.dragcard`
  `transition: transform 0.08s ease-out`) instead of being rigidly pinned; `.snap` / `.magslide`
  still override with their own transitions.
- **Simultaneous multi-target deathrattle buffs** — `buildBeats` now collapses a *run of
  consecutive `buff` events* into one beat, so an effect that buffs many minions at once (Spirit of
  the Pack giving every Beast +4/+4, a Rally aura) flashes them all together rather than one at a
  time. (Previously each buff was its own beat → sequential.)
- **Sprites wired:** Spirit of the Pack (`pack6`) and Cling Drone (`cling`) now have art.
- **Tests (+5, 99):** Arcane Weaver reports a Spirit Fire grant (golden → two; enemy-side → none);
  Ritualist's End of Turn buffs Fodder on board + in hand and sets the run buff; a Fodder bought or
  consumed after a proc carries it. `typecheck` + `test` (**99**) pass; live (fresh dev server):
  both card defs load with the right effects, all four sprites resolve via `artFor`, the drag
  transition + `.boarddust` rule are in the live stylesheet, a background click puffs (6 motes,
  auto-expires) while a card click does not, and a Spirit-of-the-Pack death emits the two
  consecutive `+4/+4` buff events the new beat-grouping collapses.

### Mana Pouch + Drakko + Sylus, spells play "upward", CSV by type with golden column
- **`docs/cards.csv` reorganised** into `# === TRIBE ===` sections, with new **`golden_text`** +
  **`golden_effect`** columns so the *tripled* version of every card is visible for triage (incl.
  the gotchas — e.g. word-count summons like "summon a Stray" don't auto-double their text, and 3
  summoned tokens trigger their own triple).
- **Spells play anywhere from the warband up.** Dragging a spell up to the tavern now casts it
  (you can't sell spells, so the old snap-back was just annoying). A targeted spell hits the minion
  under the cursor, or auto-targets your **carry** (highest-Attack) when flung up with no minion
  under it; untargeted spells just resolve. Spells no longer show the "Sell +1" glow over the tavern.
- **Ember Pouch → Mana Pouch** (id stable), art rewired. ✓ live (name + art).
- **Doublecast Drummer → Drakko the Drummer**, moved to **Tier 5**, art rewired. The golden version
  **triples** Battlecries (fires 3×), and **multiple Drakkos do NOT stack** (only the best one
  counts; golden = +2, else +1). New `drummerRepeats` helper used by both the play + Choose-One paths.
- **New: Sylus the Reaper** (Tier 5 neutral) — "In combat, your Deathrattles proc 1 more time."
  Golden procs **2 more**, and **multiple Sylus stack** (additive). Combat re-runs the dying minion's
  own onDeath effects `bonus` extra times. Art wired.
- **Tests (+4, 94):** golden Drakko triples / multiple Drakkos don't stack; Sylus re-procs a
  Deathrattle (golden +2, and stacks). `typecheck` (+web) + `lint` + `test` (**94**) + `build:web`
  pass; live: Mana Pouch shows its new name + art, no console errors.

### Choose One, bolder DS glow, slower Magnetic/Fodder, cards CSV
- **Choose One** wired. A card can carry `chooseOne: [{ text, effects }, …]`; playing it defers the
  Battlecry, opens a modal of the options, and the picked option's `effects` resolve as the Battlecry
  (honors Doublecast Drummer; a golden Choose-One still grants its Discover after the pick). New
  `CardDef.chooseOne` (+ zod), `RunState.chooseOne` + a `chooseOne` action, `applyChooseOne` in
  recruit, the reducer flow, and a Choose-One overlay (two big option buttons). Sample card added —
  **Wildwood Shaper** (T2 Beast: "give your Beasts +1/+1" or "summon two 1/1 Strays"). 2 tests.
- **Divine Shield — way more recognizable.** Dropped to a glow but made it bold: a bright soft-yellow
  **halo + ring around** the card *and* a glowing screen-blend **wash on top** (concentrated over the
  art so text stays legible), pulsing — reads at a glance across the board.
- **Slower Magnetic + Fodder animations.** The Magnetic slide is 0.36 s → **0.72 s** (and the merge
  fires at 720 ms), and the Fodder swirl 0.8 s → **1.35 s** (ghost held to 1.4 s) — clearer what's
  happening.
- **`docs/cards.csv`** — every card (minions, spells, tokens) as editable rows: id, name, kind,
  tribe, tier, atk/hp, cost, keywords, text, an effect note, and whether art is wired. Add rows at
  the bottom for new cards; I apply edits back into the content `.ts` files.
- **Verified:** `typecheck` (+web) + `lint` + `test` (**90**) + `build:web` pass; live: the DS card
  shows the strong yellow halo + on-top wash, no console errors. (Choose One is covered by unit tests
  — it needs a Tier-2 board to trigger in the live UI.)

### DS = golden glow only, Rally keyword, buff-replay fix, smoother Magnetic
- **Divine Shield** — dropped the overlay art entirely; a shielded card now just gets a **soft golden
  glow** (`.card.dscard`, an outer + inner glow with a gentle `dsglow` pulse, recruit + combat).
- **Rally keyword** wired (`RL`): combat now emits `onAttack` per swing, so an `{ on: 'onAttack' }`
  effect fires when a minion attacks. Added the keyword (core type + zod schema + pill/tooltip "Rally
  — Triggers each time this attacks") and a default `rallyBuff` combat factory (on attack, buff your
  other minions +atk/+hp; golden ×2). Ready for content — no card declares it yet.
- **Buff-replay fix** — grabbing a minion mid-buff-flash and moving it replayed the buff animation
  when the card re-mounted (lift-out → drop). `beginDrag` now clears the dragged uid from
  `buffedUids`, so it doesn't re-trigger.
- **Magnetic slide cleanup** — the merge animation was janky. Now when the slide starts the warband
  **settles** (the shove slot closes) and the held card **shrinks straight into the Mech** (scale →
  0.32, no tilt, 0.36 s) with the electric crackle, then merges. Tighter timing (360 ms).
- **Ember Pouch** text "Gain 1 Ember" → "Gain **1 Mana**" (Mana rename consistency).
- **Verified:** `typecheck` (+web) + `lint` + `test` (**88**) + `build:web` pass; live: a shielded
  card shows the golden `dsglow` (no overlay art), no console errors.

### New DS art + glow, live combat buffs (Kennelmaster), additive Echo Warden, Magnetic slide
- **Divine Shield** — re-wired the new (square 1024²) effect art at `scale(1.06)`, and added a **soft
  yellow glow fill** on any card with Divine Shield (`.card.dscard` — an outer glow + inner art-panel
  glow, shared by recruit + combat; dropped the old combat-only box-shadow).
- **Live combat card state (Kennelmaster).** Combat cards were static — a golden/avenged Kennelmaster
  showed "+1/+1" and no golden frame. Now `MinionSnapshot` carries `golden` + `summonBonus`, the
  replay folds `improve` events into a unit's live `summonBonus`, and `Unit` renders the golden
  treatment + the **current** buff magnitude (via a shared `summonBuffText` helper used by recruit and
  combat). So a Kennelmaster's text now climbs mid-fight as Avenge fires (+6/+6 → +7/+7 …) and reads
  golden. (General groundwork — other live-updating combat cards can reuse it.)
- **Echo Warden is additive, not multiplicative.** It now adds *extra* summoned tokens rather than
  re-running the summon: Pack Scrounger (2 Pups) + one Echo Warden → **3** Pups (not 4). A **golden**
  Echo Warden adds **2** ("1 more" → "2 more"). Replaced `echoReps` (×) with `echoBonus` (+).
- **Magnetic slide.** A Cling Drone dropped on a Mech now **shoves the warband aside** (a slot opens),
  then the held card **slides into the Mech** (left→right) with the electric crackle before the merge
  lands — instead of vanishing instantly. (`onUp` animates the floating card into the target Mech,
  then dispatches the merge.)
- **Tests (+1, 88):** golden Echo Warden adds 2 (the existing Echo test became the additive +1 case).
  `typecheck` (+web) + `lint` + `test` (**88**) + `build:web` pass; live: DS art loads (512²) with the
  yellow glow, combat renders cleanly via the new Unit code, no console errors.

### Tripling a summon-buff card combines its accrued buffs (Kennelmaster)
- **Bug:** tripling a buffed Kennelmaster dropped its Avenge buffs — the golden showed only +2/+2
  (golden ×2 of the base) instead of combining the copies. Two Kennelmasters at +6/+6 and +4/+4
  should triple to **+10/+10**.
- **Fix:** the summon-buff magnitude now **combines like a stat on triple**. `checkTriples` carries
  a new `summonBonus = base + (top-two combined bonuses)` onto the golden, and the separate golden
  ×2 was removed from `buffOnSummon` (both the combat and recruit factories) — the combine *is* the
  doubling. So a fresh triple still doubles the base (1+1 → +2/+2; Bristleback 2+2 → +4/+4), while
  two boosted copies sum (6+4 → +10/+10). `doubleNums` now skips `{{…}}` markers so a golden
  Kennelmaster's already-final magnitude isn't doubled again in the text.
- **Combat log already covers it.** Every combat event prints to the Combat Log (the verbose
  `narrateLog` handles attack/dmg/shield/poison/reborn/death/summon/**buff**/**improve**…), so a
  beast getting buffed and Kennelmaster's Avenge "aura strengthens" both show as lines — useful for
  triage, as requested. (The `improve` line was added in the prior commit.)
- **Tests (+2, 87 total):** tripling two boosted Kennelmasters yields a golden with `summonBonus` 9
  (→ +10/+10); a golden Kennelmaster grants its full +10/+10 (no double-counting). `typecheck`
  (+web) + `lint` + `test` (**87**) + `build:web` pass; the bot plays full runs deterministically;
  app loads clean.

### Kennelmaster Avenge text/anim, DS scale nudge
- **Kennelmaster reflects its Avenge boost.** Its board card now shows the *current* summon-buff
  magnitude (`+1/+1` → **`+2/+2`** at `summonBonus` 1, etc.), rendered **green** as a modified value
  (`instView` rebuilds the text with a `{{…}}` marker → `descUp()` in the Card → `.desc .descup`).
- **A combat pulse when Avenge triggers.** `avengeImproveSummon` now logs a new `improve` combat
  event; the replay pulses the Kennelmaster (✦ green float + a beat) and the log reads "…aura
  strengthens (+1/+1)." (New `CombatEvent` variant wired through the replay + harness narrators.)
- **In-combat escalation confirmed** — `buffOnSummon` reads the live `summonBonus`, which Avenge
  increments mid-fight, so a Beast summoned *after* the trigger gets the higher buff for the rest of
  that combat (and it persists onward).
- **Divine-Shield scale** nudged 1.32 → 1.18 (less overshoot). The real fix is matching-aspect art:
  the art panel is **5:4 (1.25:1)** but the source is 3:2, so `fill` distorts — a 5:4 frame
  (e.g. **1280×1024**, edge-to-edge, transparent centre) would fill it cleanly at scale 1.0.
- **Verified:** `typecheck` (+web) + `lint` + `test` (**85**) + `build:web` pass; app loads clean,
  DS art renders at scale 1.18, no console errors.

### Buff-jank fix (root cause), new DS art, Omen art, 2× combat buttons
- **Buff "reset" jank — actually fixed this time (found the root cause).** The card visibly
  disappeared/reappeared *after* the buff animation. Cause: `.card` always carries
  `animation: cardpop`, but `.card.cardbuff` *replaced* it; when the buff class cleared, the
  `animation` property reverted to `cardpop`, which the browser treats as a newly-added animation and
  **replays** (cardpop fades in from opacity 0). Fix: list `cardpop` first in the `.cardbuff` rule
  (`animation: cardpop 0.26s ease, cardbuff 0.62s both`) so cardpop stays in the list across the
  toggle and never restarts. Verified with `getAnimations()`: after the class clears there are no
  running animations and the card holds `opacity: 1` (no replay). Covers the Fodder-eat path too
  (same `.cardbuff`).
- **New Divine-Shield art** — re-converted the updated `Effects/DivineShield.png` (still stretched to
  fill + scaled 1.32× to wrap the art panel, fully opaque).
- **Omen Minion art** — wired `OmenMinion.png` → `art/minions/omen.png` (id `omen`); the enemy filler
  now renders its illustration instead of the pixel sprite.
- **Combat buttons** — "Climb On" → **"End Combat"** (always); both post-combat buttons (Combat Log +
  End Combat) are ~2× larger (32px, scoped to `.cbtns` so the tavern controls are unchanged) with a
  wider gap so they never overlap.
- **Verified live:** Omen enemy renders `omen.png`; DS art loads at scale 1.32 / opacity 1; the two
  combat buttons are 32px and non-overlapping; buff no longer replays cardpop. `typecheck` (+web) +
  `lint` + `build:web` pass; no console errors.

### Cleanup — removed the dead recruit-consume path + the old arena CSS
Housekeeping from the two preceding reworks (no behaviour change):
- **Dead recruit-consume code gone.** The Fodder rework left the old board-consume path unused —
  removed `RECRUIT_FACTORIES.battlecryConsume` + `consumeFodderOnSummon`, the `consume()` context
  method, `fireDeathrattle`, and the `battlecryConsume`/`consumeFodderOnSummon` `EffectFactoryId`s
  (core type + zod schema). The on-consume *effects* (Pactstone/Maw/Glutton) and the `onConsume`
  event stay — they're fired by `consumeTavernFodder`.
- **Dead arena CSS gone.** Combat renders in-place now, so the old full-screen-arena rules were
  unused — dropped `.arena/.atop/.ascene/.asub/.side/.line/.clash/.skip/.endcombat` (+ `endpop`),
  the `.result/.verdict/.rres/.rwhy/.climb` result panel, `.ares`, and the legacy unit badges
  `.unit .nm/.tok/.ua/.uh/.kb`. Kept everything still live (`.unit.*`, `.float`, `.proj`, `.alog`,
  `boardshake`/`resulttint` keyframes). CSS bundle 42 → 37 KB.
- **Verified:** `typecheck` (+web) + `lint` + `test` (**85**) + `build:web` pass; combat still renders
  (enemy units, banner, narration) with no console errors.

### Detailed combat log, Divine-Shield effect art, visible Fodder consume
- **Detailed combat log.** The post-combat log now spells out **every event with damage and the
  defender's remaining Health** — a new `narrateLog()` returns `{ text, kind }` per event (attacks
  with their swing, each hit "takes N (M HP left)", shields, poison, reborn, deaths, summons, buffs).
  Each line is colour-tagged by kind in the overlay (Start-of-Combat, attack, damage, death, shield,
  buff…). (The terse rolling in-combat line is unchanged.)
- **Divine-Shield effect art.** Wired the updated `art/effects/divineshield.png` as a `.dsfx` overlay
  that **wraps the square art panel** of any shielded card — shown everywhere a DS minion appears
  (shop, warband, combat), with a soft shimmer. Replaced the old combat-only golden box-shadow ring
  (now just a faint glow) since the art carries the read; the shatter-on-break stays.
- **Fodder consume is now visible.** It was resolving instantaneously (the player never saw it). Now
  `consumeTavernFodder` records each consume (`state.fodderEaten` + a `fodderEatenSeq` tick), and the
  UI replays it: a **ghost Fred pops into the tavern, then spins/shrinks/swirls into the Demon that
  ate it** (purple, ~0.8s), measured from the live DOM so it flies to the right minion. The Demon's
  buff proc still fires as it grows.
- **Verified live:** the DS art overlays the art panel exactly (155×124); the combat log shows e.g.
  "Omen Minion takes 1 damage (0 HP left)." / "Omen Minion is destroyed."; and a full
  buy-Soulfeeder → roll cycle shows the ghost **Fred** swirling into Soulfeeder (which grew 2/2 → 3/3),
  no Fred left as a static offer, ghost cleared after the swirl. `typecheck` (+web) + `lint` + `test`
  (**85**) + `build:web` pass; no console errors. (Screenshot tool was unresponsive this session, so
  checks were via the live DOM.)

### Kennelmaster — "Avenge (3): Improve this", permanent across the run
Reworked Kennelmaster to **"Each Beast you summon gains +1/+1. Avenge (3): Improve this."** The
Avenge boost is **permanent for the whole run** (the user's call), which meant threading per-instance
state through the pure combat boundary and carrying it back.
- **New per-instance `summonBonus`.** `BoardCard.summonBonus` (run) ↔ `BoardMinion.summonBonus` +
  `sourceUid` (combat input) ↔ `Minion.summonBonus` (combat-mutable) ↔ `CombatResult.playerSummonBonus`
  (carry-back). `buffOnSummon` (both the combat factory and the recruit one) now adds `summonBonus` to
  its per-stat magnitude, so the bonus raises every Beast the Kennelmaster summons.
- **New `avengeImproveSummon` factory** (combat): on every 3rd friendly death, while alive, it bumps
  its own `summonBonus` by 1 — improving every Beast it summons for the rest of the fight.
- **Carry-back + persistence.** `simulate()` reports each sourced minion's final `summonBonus` in
  `playerSummonBonus`; `advanceAfterCombat` writes it back onto the originating board card (matched by
  `sourceUid`), so the improved buff persists into future fights. `faceOmen` now also threads
  `golden` into combat (it wasn't before — a latent bug where golden minions didn't fire combat
  effects at 2×), so a golden Kennelmaster's summon buff doubles correctly.
- **Tests (85 total, +3):** a combat test (3 Taunt sandbags die first → Avenge fires once → `bonus: 1`
  in `playerSummonBonus`, deterministic because Taunts are targeted first), a run test that the
  recruit summon buff scales with the accrued bonus (Stray gets +3/+3 at `summonBonus: 2`), and a run
  test that `resolveCombat` persists the bonus onto the board card.
- **Verified:** `typecheck` (+web) + `lint` + `test` (**85**) + `build:web` pass; the headless bot
  plays full runs (waves 8–10) deterministically with no crashes; the live app loads clean. Soulfeeder
  + Kennelmaster art were wired in the earlier UI commit.

### Fodder reworked — Soulfeeder seeds the tavern, Demons devour it (+ a real tavern refresh)
Redesigned the Demon Fodder loop per the user's new spec. Fodder no longer sits in your hand to be
played beside a Demon; it **arrives in the tavern** and your Demons **eat it automatically**.
- **Fred is out of the shop pool** (`token: true`) — it can't be rolled. It now only enters play
  from other sources (Soulfeeder), and its text says so.
- **Soulfeeder → Tier 1**, "**Battlecry:** add Fodder to your next tavern" (new
  `battlecryAddTavernFodder` effect → pushes `fred` onto `state.pendingTavern`; golden adds 2). No
  longer consumes a friend.
- **Voracious Imp → Tier 2**, "Gains **2x** stats from Fodder" (golden "**3x**"). Implemented as a
  new `CardDef.fodderMult` (Imp = 2; golden = base+1 = 3). The golden card-text transform learns the
  "Nx → (N+1)x" rule so the doubled text reads "3x".
- **A real "tavern refresh".** New `refreshTavern(state)` is the single tavern-population point —
  both the manual **Refresh** and the **post-combat** refresh route through it. It rolls the shop,
  injects any `pendingTavern` Fodder, then runs the auto-consume. (This is the hook the user wanted
  so future effects can interact with refreshes.)
- **Auto-consume (`consumeTavernFodder`).** When Fodder *enters* the tavern and you have ≥1 Demon on
  board, each Fodder is eaten by **one random Demon** (2 Demons + 1 Fodder → a seeded coin-flip). The
  eater gains the Fodder's stats × its `fodderMult`, and the **normal on-consume pipeline fires**
  (Pactstone Acolyte +1/+1, Maw of the Pit Divine Shield, Ravening Glutton +2/+2). Eaten Fodder
  leaves the tavern; with no Demon present it just sits there, buyable. Per the user's call, only
  Fodder *entering* the tavern triggers this — placing a Demon next to existing Fodder does not.
- **Tests:** replaced the 6 old recruit-consume tests with 7 covering the new flow — Fred not in the
  pool, Soulfeeder queues Fodder, a Demon devours tavern Fodder (Imp 2×, golden 3×), on-consume
  Demons pay off (Pactstone, Maw), and Fodder with no Demon stays. **82 tests pass.**
- **Verified live:** Soulfeeder renders as Tier 1 with the new text; Fred never rolled across several
  refreshes; Voracious Imp is absent at a Tier-1 shop (it moved to T2). `typecheck` (+web) + `lint` +
  `build:web` pass; no console errors. (The synthetic-drag harness was too flaky to build a full
  board live for an end-to-end consume, so that path leans on the unit coverage + the shared
  `refreshTavern`/`consumeTavernFodder` code.)

### Mana economy, teal cost, combat-log + banner polish, buff-proc fixes, board 1
The UI half of a large batch (the Fodder/Demon and Kennelmaster reworks land in following
commits):
- **Board 1** — reverted the play-surface backdrop to `board1.png` (the user preferred its aesthetic).
- **Embers → Mana (display only).** Relabelled the resource to **Mana** and recoloured it **teal**
  (`--mana: #30d2ff`): a new droplet icon in the status chip, teal chip icon, teal button costs. The
  card **cost badge is back to a circle** (dropped the flame), teal. Internal identifiers stay
  `embers` (per the user's call — this is a cosmetic rename, the economy logic is unchanged).
- **Combat presentation.** Removed the `—VS—` divider; the top combat banner now shows just the
  **threat name** (the wave already lives in the HUD) as a raspberry pill pinned out-of-flow on the
  left, so the action buttons stay centred. Added a **Combat Log** button that appears beside **End
  Combat / Climb On** once the replay settles — it opens an overlay listing the whole fight narrated
  line by line (with the verdict). Both post-combat buttons are centred.
- **Buff-proc fixes.** The buff animation no longer "snaps back": the spring easing is now scoped to
  the *rise* only, and the settle eases out (`animation-fill-mode: both`), so the card returns
  smoothly. **Tavern offers buffed by the hero power now play the proc too** — the buff-detection
  effect tracks shop offers' effective stats (base + the stored offer buff), not just board/hand.
- **Card text bigger** — keyword pills 9.5→12px and the description 12→14px for readability.
- **Taunt ward −15%** (78→66px) and **Soulfeeder + Kennelmaster art** wired (`feed.png`, `kennel.png`).
- **Verified live:** board 1 + teal Mana circle + "Mana" label + teal button costs confirmed via
  screenshot; hero-powering a tavern offer now flashes it (`cardbuff` + burst); a full
  recruit→combat→recruit cycle shows the threat-name banner, no VS, the centred Combat Log + End
  Combat, and the log overlay opens with its verdict. Fresh-server console is clean (the hook-order
  warnings seen mid-edit were stale Fast-Refresh transition artifacts). `typecheck` (+web) + `lint` +
  `test` (**81**) + `build:web` all pass.

### In-place combat — the shop closes, the enemies arrive (no more separate arena screen)
Combat now plays out **on the recruit board itself** instead of cutting to a separate full-screen
arena. When you End Turn, the top half "closes up" (the tavern offers, the control bar, the timer,
the rope and the hand animate away) and the enemy team **arrives** where the tavern was — while the
**warband, the Warden hero frame, the HUD (ASCENT / wave / tribes / mute) and the Embers/Resolve
panel never move**. After the fight, your board plays a one-shot **reset** animation as the next
shop opens. (Item 11 of the batch.)
- **`Recruit` is the single, always-mounted board.** `Game.tsx` no longer swaps `Recruit` ↔ `Arena`;
  it renders `Recruit` for every phase, so the persistent chrome literally never unmounts (hence it
  can't move). `Arena.tsx` is **deleted**.
- **Replay engine extracted to a hook.** All of the old Arena's beat/lunge/projectile/float/SFX/
  verdict logic moved verbatim into `useCombatReplay(combat, { active, findEl })` (new
  `useCombatReplay.ts`); the combat `Unit` card moved to `Unit.tsx`. The hook is decoupled from
  layout: `active` gates the clock (so we can hold on the intro), and `findEl(uid)` resolves a unit's
  live DOM node for measuring lunges/bolts in *any* layout (it now looks inside the warband + tavern
  zones). The UI still only **replays** `simulate()` — it never computes combat.
- **Intro staging.** A local `combatStage` sequences `closing` → `fighting`: ~480 ms of "shop
  closing" (offers + control bar fold up and fade; the hand slides off the bottom), then the enemies
  arrive (slide-in) in the tavern's slot and the replay begins. The control bar's slot swaps to a
  compact combat bar (Wave · threat + **Skip**, then **Climb On**/End Combat when the replay settles)
  — same height, so the warband doesn't reflow. The VS divider is positioned out of flow so it can't
  shift the warband either.
- **Post-combat reset.** Returning to recruit tags the warband row `.resetting` for a 0.65 s settle
  animation; the shop reopens around it.
- **Timer-reset fix (caught live).** Because `Recruit` no longer remounts per wave, the round timer
  (which used to re-init on remount) stopped resetting — it carried 0s into the next wave. Added an
  effect keyed on `run.wave` that re-arms `seconds` to that wave's `turnSeconds` at the start of each
  recruit phase. Also gated drag-start and Hero-Power aiming on `!inCombat`.
- **Verified live (full loop):** drove a real run via synthetic pointer drags — bought + played a
  minion, hit End Turn, and confirmed through the DOM + screenshots that the shop closes (`app` →
  `app combat` → `app combat fighting`), the enemy unit arrives in the tavern zone, the warband units
  render in place, the HUD/hero/Embers stay put, the narration line shows, then End Combat returns to
  recruit (`row warband resetting` → settled), the shop reopens (4 offers), Resolve ticks 30→29, and
  the wave advances to 2 with the timer correctly re-armed (35 s). No console errors. `typecheck`
  (+web) + `lint` + `test` (**81**) + `build:web` all pass.

### Card/VFX/timer polish pass — spacing, spell sparks, buff procs, scaling timer
A grab-bag of feel + readability fixes (items 1–10 of an 11-item batch; the in-place combat
transition is the separate item below):
- **More space between cards** — the row `gap` 10→22px so the (2×) Attack/Health badges of
  adjacent cards no longer overlap.
- **Countdown ticks** — a short square-wave `tick` blip plays on each of the last five seconds of a
  turn (5·4·3·2·1), wired into the recruit timer (`sfx.tick()`), so you *hear* the clock running out.
- **Taunt ward 3×** — the Taunt corner emblem is 26→78px (icon 15→45px) so Taunt reads at a glance.
- **Divine-Shield glow +30%** — the combat DS aura's ring/blur/spread are ~30% thicker (`.unit.ds`).
- **Turn timer grows per wave** — base 30s + 5s each wave, capped at 70s (`turnSeconds`); the ring +
  rope fill scale to the new length. (Recruit remounts per wave, so it initialises fresh.)
- **Tier pills bigger + on spells** — the "Tier X" pill/text is +25%, and spells now carry a tier
  pill too (the tavern spell offer passes `tier` through `shopView`).
- **Cost ember outlined** — the flame cost badge gets a soft white outline (double `drop-shadow`) so
  it separates from the art behind it.
- **Spell spark** — casting a spell pops a one-shot accent-coloured burst (a flash + 8 radiating
  rays) at the point it resolved (`fireSpark` on the cast/play branches → `.spellspark`).
- **Buff proc** — when a recruit-phase buff lands (hero power, spell, summon buff) the card now plays
  a punchier green flash *plus* an expanding ring + spark shards (`.buffburst`), so e.g. Warden's
  Fortify reads as a clear proc rather than a faint tint.
- **Board art → board 2** — swapped the play-surface backdrop (`apps/web/public/board.jpg`) to the
  new warm crystal-arena render (1536×1024 → JPEG q82, 135 KB).
- **Verified:** `typecheck` (+web) + `lint` + `test` (**81**) + `build:web` all pass; live DOM +
  screenshot confirm row gap = 22px, the spell offer shows a "Tier 1" pill, the cost SVG carries the
  white `drop-shadow` outline, the Taunt ward = 78px (only on Taunt cards — confirmed it doesn't
  misfire on Divine-Shield/other cards), and board 2 is rendering. The tick/spark/buff-burst are
  transient VFX/audio verified via code + the green build.

### Bigger stat badges (2x, overhanging) + HUD scale-up
- **Attack / Health badges are 2× and overhang the card's bottom corners** (60px, was 30px), mirroring
  the cost ember at the top. They're absolutely positioned (out of the footer flow); the footer is
  padded so the (larger) tribe label centres cleanly between them and never slips under a badge. The
  horizontal overhang is a slight −8px (the bottom −12px does the "eclipse") so adjacent cards on a
  packed board don't clash much.
- **Cost ember pushed further up-left** (top/left −34/−32 → −44/−42) to eclipse the corner more.
- **Tribe text bigger** (11→14px, icon 14→17px).
- **Hero panel +15%** again (portrait 70→80px, name/power text scaled; panel ≈100px tall).
- **Embers chip is now as tall as the hero** — the top row stretches (`align-items: stretch`) so the
  Embers chip matches the hero's height (both ~100px), and its icon/value are scaled up to fill it.
- **HP bar scaled up** with the rest (bar 15→20px, heart 26→32px, value 22→28px).
- **Verified:** `typecheck` (+web) + `lint` + `test` (**81**) + `build:web` pass; atk/hp = 60×60,
  Embers chip = hero = 100px tall, HP bar 20px, and the tribe label fits (not clipped) — all confirmed
  via DOM + live screenshots.

### Resolve as an HP bar, hero panel +20%, cost-text nudge, re-wired Broker art
- **Resolve → an HP bar across the bottom of the status tray.** The chunky `[heart | 30 | "Resolve"]`
  chip is gone. The tray is now a column: **Embers + Hero on the top row**, and a full-width **HP bar
  across the bottom** — red heart on the left, the red fill in the middle (`resolve / maxResolve`), and
  the **current health on the right**. No "Resolve" label. Frees the tray's third slot so the hero can
  grow. (The resolve-loss shake + −X float moved onto the bar.)
- **Hero panel +20%** — the Warden portrait is 58→70px with the name/power text scaled to match, so it
  reads as the tray's centrepiece.
- **Cost text nudged up** — the number sits a little higher in the flame's body (`.costn` padding-top
  24→17px) so it reads as more centred.
- **Re-wired the new Brightwing Broker art** — re-exported the updated source to `broker.png` (512²);
  confirmed it re-bundled with a fresh hash.
- **Verified:** `typecheck` (+web) + `lint` + `test` (**81**) + `build:web` pass; HP bar (full at 30/30,
  value 30, no label), 70px hero portrait, and the cost padding all confirmed via DOM (the preview
  screenshot tool was unresponsive this session, so visual checks were done through the live DOM + the
  build output).

### Combat attack-order fix, Warden + Broker art, spell rules, drag sensitivity
- **Combat bug — attacker order after a death (fixed).** The attack loop picked the next attacker by
  indexing into the **living** list (`live[pointer % live.length]`). When a minion died it dropped out
  of `living()`, which **re-indexes**, so the pointer skipped the minion to the right of the one that
  died — e.g. with `[Sporeling 1/2, Stray, Taunt Sporeling]`, the front Sporeling traded in and died,
  then the **Taunt Sporeling attacked before the Stray**. Now the next attacker is tracked by
  **identity** (resume from the last attacker's position in the full board array), which is stable
  across deaths *and* mid-combat summons. Added a regression test (front 1/1 dies → the 2nd minion,
  not the 3rd, swings next). (Not a Taunt issue — Taunt only affects targeting, never attack order.)
- **Hero (Warden) + Brightwing Broker art wired.** Added an `art/heroes/*.png` glob + `heroArt()`; the
  hero panel now shows the **Warden** portrait (falls back to the anvil icon if absent). Brightwing
  Broker (`broker`, a Tier-2 neutral) gets its illustration via the normal minion glob. Both 512²,
  confirmed bundled.
- **Hero power usable without a friend on board.** `canHero` is now just `heroReady` (was gated on
  having a board/shop minion) — since Fortify can target a tavern offer, it's always usable when ready.
- **Spells: no triple, no sell.** `checkTriples` ignores spell cards (three copies stay separate), and
  the `sell` reducer refuses spells (they're only played for their effect). Drag-to-sell already
  excluded spells in the UI; this enforces it in the engine too. (+2 tests.)
- **Card insertion is more sensitive.** Dragging a card now moves the insertion point past another
  card when the cursor reaches **~35%** into it (was the 50% centre), so cards slide out of the way
  sooner — e.g. dropping next to a lone minion pushes it aside instead of landing on the far side.
  Tunable via `INSERT_FRAC` in Recruit.
- **Verified:** `typecheck` (+web) + `lint` + `test` (**81**, +3) + `build:web` pass; combat-order
  regression test green, Warden portrait rendering live, hero power armable on an empty board, Broker +
  Warden art bundled.

### Hero power can buff tavern minions, embers-projection popup, spell-sell fix + polish
- **Hero power targets the tavern now.** Fortify reads "give a minion +1/+1" (not "a *friendly*
  minion"), so it can target a **tavern offer**, not just the warband. `ShopCard` gained `atk`/`hp`/
  `keywords` buff fields; the hero-power reducer applies +1/+1 to a targeted offer, `shopView` shows the
  buffed stats (green), and **buy bakes the buff into the minion**. The aim (`minionAt`) now detects
  warband *or* tavern minion cards (never the spell), and `canHero` allows arming with an empty board
  as long as the shop has offers. Sets up the general "target a tavern minion" capability for future
  spells/cards. (Verified live: Fortify a shop Sporeling 1/2 → 2/3, bought as a 2/3; tests cover it.)
- **Spell "+1g" fix.** Dropping a *spell* on the tavern was hitting the minion-sell branch (`+1` Ember),
  so dragging a spell up toward the offers (now at the top) could silently sell it. Spells are now
  excluded from drag-to-sell — a spell dragged to the tavern just cancels (cast/play only). (Targeted
  spells already gave no embers when released without a target; the only intended +1 is Ember Pouch's
  net-neutral cast — buy −1, cast +1.)
- **Embers projection popup.** Hovering the Embers chip pops a small panel showing the **starting Embers
  for the next two waves** (cascading up, e.g. "Wave 2 → 4, Wave 3 → 5"), based on the maxEmbers curve.
  Made the Embers chip hoverable (it was `pointer-events: none` in the corner tray; still passes through
  mid-drag) and gave the chips the game's custom cursor instead of the OS `help` cursor.
- **Fodder tooltip** reworded — "A cheap minion your **Demon cards** can consume for its stats."
- **Cost badge** — the ember (flame) is ~10% larger and the cost number ~10% smaller, pushed further
  up-left to eclipse the corner more (number kept in the flame's body).
- **Hero panel ~15% larger** in the corner tray (portrait + text), so it reads as the tray's centrepiece.
- **Verified:** `typecheck` (+web) + `lint` + `test` (**78**, +1 tavern-targeting) + `build:web` pass;
  embers popup, cost badge, hero panel, Fodder text, spell-no-sell, and hero-power-on-tavern all
  confirmed live.

### Bigger cost badge, reorderable shop, + two new T1 spells (Ember Pouch, Bulwark)
- **Cost badge 2× larger** — the ember/flame cost badge doubled (47→94px, font 17→34px) and its corner
  overhang scaled with it, so the cost reads at a glance.
- **Shop offers are reorderable** (like the warband). Added a `reorderShop` action (mirrors
  `reposition`, purely cosmetic on `s.shop`) + an `overShop`/`shopGapIndex` drop-slot + a `shopIndexAt`
  helper; `applyDrop` now reorders an offer dropped back in the tavern instead of snapping it back to
  its slot (the spell stays pinned at the end). This removes the "teleport back to slot" jank — a
  dragged offer lands where you drop it. Verified live: dragging offer 1 to slot 3 reorders it, the
  drop-slot shows, and the spell stays last.
- **Two new Tier-1 spells** (art wired from the Spells folder → `art/minions/{emberpouch,bulwark}.png`,
  512²; the spell slot now rotates among all three):
  - **Ember Pouch** (1 cost, untargeted) — *Gain 1 Ember.* New untargeted cast path: `gainEmbers` is
    handled in `castSpell` against the run state (embers uncapped within a turn, like selling). **Note:
    net-neutral** as specced (pay 1 on buy, gain 1 on cast) — flagged in case more/over-time gain was
    intended.
  - **Bulwark** (1 cost, target a friend) — *+0/+1 and Taunt.* Extended `spellBuffTarget` to grant an
    optional `keyword` param (so it buffs **and** grants Taunt); reused for any future buff-a-keyword
    spell.
  - Added `gainEmbers` to the `EffectFactoryId` (core type + zod schema); `params` already allowed the
    `keyword`/`amount` keys.
- **Verified:** `typecheck` (+web) + `lint` + `test` (**77**, +2 for the new spells) + `build:web` pass;
  cost-badge size, shop reorder + drop-slot, and both spells (art + cost + text, Ember Pouch net-neutral,
  Bulwark +0/+1 + Taunt) confirmed live. `TURN_SECONDS` test bump reverted to 30.

### Cost-in-an-ember, styled hero tooltip + cursor fix, shop gets the warband lift-out drag
- **Cost sits inside an ember (flame).** The cost badge was a plain orange circle; it's now the ember
  flame `Icon` (orange) with the cost number (white) over its bulb, still overhanging the card's
  top-left corner — visually tying the cost to Embers (the currency).
- **Spent-hero cursor fixed.** `.hero.spent` used `cursor: default` (the OS arrow), so moving onto a
  used hero power visibly switched/flickered away from the game's custom SVG cursors. It now keeps the
  custom `gauntlet_default` cursor — no jarring switch. (The Embers/Resolve chips are `pointer-events:
  none`, so only the hero showed this.)
- **Hero-power tooltip now matches the aesthetic.** Replaced the native `title=""` (ugly OS tooltip)
  with a styled `.herotip` — the same dark rounded pill as the card keyword tooltips, "Fortify" in
  orange, popping above the corner tray on hover. Reads "Used this wave." when the power is spent.
- **Shop drag = warband drag (no more "shadow").** Buying used the dim-shadow (`.dragsrc` opacity) — the
  dragged offer stayed dimmed in place while a copy floated. Now the shop uses the warband's **lift-out
  + FLIP**: the dragged offer leaves the row entirely (the floating copy *is* the card) and the rest
  **slide to close the gap**; on drop it buys. Implemented by adding `displayShop` (filters the dragged
  offer, mirroring `displayBoard`), giving shop cards `data-uid`, folding the spell's shown/hidden state
  into `flipKey`, and extending the FLIP `useLayoutEffect` to track **both** the tavern and warband
  rows. Verified live: dragging an offer lifts it out (no `.dragsrc`), the others slide, release on the
  hand buys it, and the row closes up.
- **Verified:** `typecheck` (+web) + `lint` + `test` (**75**) + `build:web` pass; cost badge, spent-hero
  cursor (`gauntlet_default`), styled tooltip, and shop lift-out/slide/buy all confirmed live.
  `TURN_SECONDS` test bump reverted to 30.

### Scale the board to the viewport (16:9 → 21:9), overhang cost badge, Stray ≠ Fodder
- **Stray is no longer treated as Fodder.** `consumeFodderOnSummon` now matches **strictly the `FD`
  keyword** (dropped the "any token" fallback), so a Voracious Imp won't eat a summoned Beast Stray.
  (Stray never had the keyword — the fallback was making it behave like Fodder.) Test updated to assert
  the Stray *stays* and the Imp is unchanged.
- **Card sizing now scales with the viewport** so the board fills big screens (the game looked tiny on
  a 3440×1440 / 21:9 monitor): `--ch: clamp(220px, 27vh, 384px)`, `--cw = --ch × 0.752`, and the
  bottom padding + warband nudge are now `--ch`-relative. Verified across sizes — at **3440×1440** cards
  are **384px** tall (was a flat 278px) with **no overflow**; fits 16:9 down to ~768px tall too. The
  ultrawide play area stays centred (cards big, side margins are expected on 21:9). *Chrome (HUD/buttons)
  is still fixed-px — flagged for a follow-up if the user wants it scaled too.*
- **Hand hover is gentle now.** The hover-pop was `translateY(-150px)` — it flung the card ~184px up,
  out from under the cursor (causing a hover/un-hover bounce). Now `translateY(-5%)` (≈33px lift) +
  `z-index` — just enough to reveal the card and bring it to the front, staying under the pointer.
- **Cost badge overhangs the corner.** Moved the `.cost` badge out of the `overflow:hidden` `.art` to
  be a direct child of `.card`, then restyled it to hang over the **top-left corner** (eclipsing the
  edge), filled solid **orange** with **white** text, **~50% larger** (26→40px, 14→21px), with a cream
  ring + shadow so it reads as a sticker.
- **Removed the "Altitude" label** from the top wave readout (just the wave number + meter now).
- **Verified:** `typecheck` (+web) + `lint` + `test` (**75**) + `build:web` pass; scaling measured at
  3440×1440 (no overflow), cost badge / Stray / Altitude / hand-hover confirmed live. `TURN_SECONDS`
  test bump reverted to 30.

### Mirror layout: offers vs warband across the centre, HUD to the bottom-left corner
- **Tavern controls decoupled from the offers.** The Refresh/Freeze/Tier/End-Turn `shopctl` bar moved
  out of the tavern `[data-zone]` and now sits as its own control bar under the HUD; the tavern zone
  wraps only the offer cards. The **offers and warband are now flex-grow halves that mirror each other
  across the board's centre** (`flex: 1 1 0; justify-content: center` on each) — shop on top, your
  board below, like two facing lines.
- **Rope back on the centre line.** The burning-rope timer returned to the flow *between* the two
  zones (`position: relative; align-self: center`), so it lands exactly on the offers/warband split at
  any viewport (was a fixed `top: 50%`, which sat on the warband's edge).
- **Warband nudged up** (`padding-bottom: 48px`) to open a clearer gap above the hand (measured ~130px
  warband-bottom → hand-peek at 1300px tall).
- **HUD moved to the bottom-LEFT corner** and shrunk. The Embers · Hero · Resolve tray was the
  bottom-centre centrepiece (hero portrait 108px); it's now a **compact** tray pinned bottom-left
  (hero 50px, smaller chips), so the **hand owns the whole bottom-centre** with room to breathe. The
  compact tray (~440px wide) clears the centred hand — no overlap. (Kept `pointer-events: none` + the
  mid-drag hero pass-through in case a very wide hand fan reaches the corner.)
- **Hand hover snappier** stayed (0.08s); with the bar out of the centre the hand peeks/pops in the
  open instead of from behind the panels.
- **Divine Shield overlay removed** ("too much noise for now"): dropped the `.dsfx` image from `Card`
  + its CSS and the now-unused `effectArt` import. The `effectArt()` helper + `art/effects/divineshield.png`
  are **retained** (unused) so it's a one-line re-add later.
- **Minion-pool quantities — placeholder.** Added `POOL_QUANTITIES` to `@game/sim` config (Tier 1→16,
  2→15, 3→13, 4→11, 5→9, 6→7, **7→5 as a forward placeholder** — no tier-7 cards yet). **Not wired into
  shop rolls yet**; the finite-pool refactor is queued in the roadmap.
- **Verified:** `typecheck` (+web) + `lint` + `test` (**75**) + `build:web` pass; the mirrored layout,
  centred rope, bottom-left tray, removed DS, and Fred's Fodder pill all confirmed live (DOM probes +
  screenshots). `TURN_SECONDS`/`SPEED` test bumps reverted to 30/1.5.

### Fodder → a keyword (card becomes "Fred") + HUD tray, tavern raised, rope centred
- **Fodder is now a keyword (`FD`), not a one-off card.** Added `FD` to the `Keyword` union
  (`@game/core`) + the zod `KeywordSchema` (`@game/content`). The Tier-1 demon card is renamed
  **Fodder → Fred** (`id: 'fred'`, `keywords: ['FD']`, empty body text — the pill carries the meaning,
  so the old "Cheap fuel —" prose is gone). The consume trigger (`consumeFodderOnSummon`) now keys off
  the **keyword** (`minion.keywords.includes('FD')`) instead of the hard-coded `cardId === 'fodder'`,
  with the token fallback kept — so any future card can be marked Fodder and be eaten. Voracious Imp's
  text now reads "When you play a **Fodder** minion…". Card UI gained `FD → 'Fodder'` in the label +
  tooltip maps (label-only pill, like Consume). Art renamed `art/minions/fodder.png → fred.png` to
  track the new id. The `fred`/`FD` consume test was updated. (Verified live: Fred shows the "Fodder"
  pill + `fred.png` art + no description; the Imp eats a played Fred.)
- **Status-bar tray.** Embers · Hero · Resolve now sit in one connecting rounded frame (the
  `.statusbar` got a translucent card background, border, radius + tighter gap) so they read as a
  single unit instead of three floating panels.
- **Hero never fades.** Dropped the `opacity: 0.5` on the spent hero — the portrait/power stays full
  strength even when it can't be used this wave (the ready-pulse is the only "available" cue).
- **Tavern raised, warband lowered, rope centred.** With the freed room, the Tavern now rides high
  near the HUD (was vertically centred), the Warband floats down toward the hand (`margin-top: auto`),
  and the burning rope timer is pinned across the **centre of the board** (`position: fixed; top: 50%`)
  instead of tucked under the tavern.
- **Hand fans up from behind the tray, snappier.** The tucked hand now sits behind the status-bar
  tray (its bg cleanly hides the tucked portion; cards peek above), and the hover-pop transition was
  sped up (0.16s → 0.08s with a snappier curve). The status bar stays fully opaque (never faded).
- **Perf: dropped `background-attachment: fixed`** on the board image. The app never scrolls (100vh,
  overflow hidden), so `fixed` was pure cost — a full-viewport repaint on every paint — for zero
  visual difference. Removing it visibly smoothed repaints (preview screenshots that were *timing out*
  now return instantly). The remaining buy/drag micro-stutter is most likely the preview window's
  remote-control + screenshot overhead; a local `npm run dev` build should feel markedly smoother. A
  deeper pass (memoising cards / imperative drag-follow) is queued if it persists locally.
- **Verified:** `typecheck` (+web) + `lint` + `test` (**75**) + `build:web` pass; all of the above
  confirmed live (DOM probes + screenshots). `TURN_SECONDS`/`SPEED` test bumps reverted to 30/1.5.

### Tribe recolour + HUD/layout pass: hand tucked under the bar, omen + row labels gone
A UI/feel batch (all verified live in the running app):
- **Tribe hues recoloured** to the user's spec (each drives a card's `--c` accent → art panel
  tint, footer, keyword pills, and the HUD tribe dots): **Beast green** `#4ea83b`, **Dragon
  red/orange** `#ff6a3c`, **Mech blue** `#27a9dd`, **Undead dark slate-blue** `#5c6f8c`, **Demon
  purple** `#b15cf0`, **Neutral light greige** `#9a8d79`. Two colours were *overloaded* onto tribe
  hues and had to be decoupled first: the **Embers** chip icon (was `--t-beast`, now `--acc` so it
  stays warm) and the **combat poison** green (floats + omen badge — now a dedicated `--poison`
  `#22be86`, the old Undead hue, so poison reads green regardless of the Undead recolour).
- **Dual-type capability** (forward-looking — "dual-type minions will exist"): `CardView` gained an
  optional `tribe2`; a `.card.dual` splits the art panel + footer down the middle into both hues
  (`--c` / `--c2`). Dormant until the card data model carries a second tribe (see roadmap) — no card
  triggers it yet, so it's a ready visual, not active content.
- **Fodder's name now shows.** Root cause was a flex bug, not data: `.cbody` is a flex column and
  `.cn` (the name pill) had default `flex-shrink: 1`, so Fodder's longer description overflowed and
  squeezed the name to **5px** tall (invisible). Fixed with `.cn { flex: none }` — the name keeps its
  full height on every card; the description clips instead if it's ever too long. (Confirmed live:
  Fodder's `.cn` went 5px → 18px, text "Fodder" visible.)
- **Divine Shield overlay enlarged.** `.dsfx` now spills past the card edges (`112%`×`78%`, offset
  up/left) so the shield reads as an aura *around* the minion, not a contained icon — while the
  screen blend keeps the minion visible through it (confirmed on Spare Part Drone: bigger golden
  shield, drone still clearly readable underneath).
- **Removed the red omen bar.** Per the user, the pre-shop threat telegraph is gone for now — only
  the wave # (already in the top HUD) remains. `<Omen />` is no longer rendered (the component file
  is retained, unrendered, for easy restoration later).
- **Removed the left-row labels** ("The Tavern · Tier", "Your Warband · n/7", "Your Hand") — the
  per-zone `.zh` headers were dropped from all three rows for a cleaner board.
- **Hand reworked into a bottom fan tucked under the status bar.** The hand is now `position: fixed`
  at the bottom centre (`z-index: 25`, below the bar), its lower half behind the Embers/Hero/Resolve
  panels; a hovered card pops fully up (`translateY(-150px)`, `z-index: 45`) to read in full. The old
  dashed empty-hand box is gone (empty hand renders nothing). This frees the hand's old full-height
  row, so the **Tavern + Warband now centre lower** in the freed space (auto margins).
  - *Drop/interaction fixes this required:* the status bar is now `pointer-events: none` (only the
    hero captures, and even the hero goes click-through mid-drag via `body.dragging`) so a card can be
    **bought/played/grabbed** through the bar to the hand tucked behind it; and `onUp` now resolves
    the drop **zone before** clearing `body.dragging`, so the pass-through is still active at the
    moment the drop is read. Verified live: buying by dropping dead-centre (over the hero) lands in
    the hand, and playing a card from the tucked hand up to the warband works.
- **Verified:** `typecheck` (+web) + `lint` + `test` (**75**) + `build:web` all pass; every item
  above confirmed live via DOM probes + screenshots.

### Board art + Warden rename + aim-line spell casting + Divine Shield art + Fodder (demons fixed)
A six-part feel/content pass (all verified live in the running app):
- **Board background art.** The user's `board1` (a purple crystalline arena) is now the play surface:
  exported to `apps/web/public/board.jpg` (1536×1024, JPEG q82 → 201 kB) and painted on `body` under a
  dark scrim gradient (`linear-gradient(rgba(28,22,16,.34), …(.46))` over `url('/board.jpg') cover
  fixed`) so the cards/HUD stay legible. (Kept the taupe `--bg` as the fallback under the image.)
- **Spell casting reworked to match the hero power** (replacing last pass's drag-the-card-onto-a-friend
  gesture, per the user's spec):
  - **Non-targeted spells** ("buff your whole board", "gain Embers") — drag the card up and release
    anywhere in the warband space, like playing a minion; the effect fires. (`applyDrop` spell branch:
    no `target` → dropping on `zone==='warband'` dispatches the cast.)
  - **Targeted spells** (`target:'friendly'`, e.g. Spirit Fire) — the instant the card leaves the hand
    it **turns into the Forgewarden/Warden targeting line**: the floating card is hidden and an SVG
    aim-line (`svg.aimline`) is drawn from the hand to the cursor with a reticle that snaps **on** over
    a valid friendly minion (which gets the strong `targeted` highlight, same as the hero power).
    Release on a minion → spell goes off; **release off any minion → snaps back to hand**; **right-click
    → snaps back to hand** and the line ends. (`castingSpell`/`castTargetUid` derive from the live drag;
    `onUp` clears without dispatch when no target; a window `contextmenu` listener cancels held spells.)
  - Verified live: aim-line + reticle render on drag-out (`dragcard` hidden), release on the Imp cast
    Spirit Fire **+3/+3 (2/2 → 5/5)** and emptied the hand, and **both** cancel paths (empty-release,
    right-click) left the card in hand with the line gone.
- **Rename Forgewarden → Warden, hero power Temper → Fortify.** Pure UI/string change in `StatusBar`
  (title, hero name, "Fortify · +1/+1" subtitle) + the Recruit hint; the `+1/+1` effect is unchanged.
- **Spirit Fire art** wired (`art/minions/spiritfire.png`, 512²) — the spell card now shows its
  illustration via the existing `artFor` glob (card id = filename).
- **Divine Shield effect art.** Added an `art/effects/*.png` glob + `effectArt(name)` in `art.ts`;
  `Card` overlays `effectArt('divineshield')` on any minion with the `DS` keyword. The art is a golden
  shield-crest on transparent — rendered naïvely (`object-fit:cover`) it was opaque and hid the minion,
  so `.dsfx` uses **`mix-blend-mode:screen` + `object-fit:contain` + a slow opacity pulse**, making it a
  glowing aura the minion shows *through*. Verified live on **Spare Part Drone** (the drone reads clearly
  under the shield glow). *Follow-up for the user's call: it's a shield **crest** shape, not a bubble —
  swap art or move to a corner badge if a rounder "bubble" look is wanted.*
- **Fodder — the fix that makes Demons actually work.** The Consume engine (Voracious Imp et al.) had no
  cheap fuel to eat, so Demons were dead on arrival. Added **Fodder** (Tier 1 **1/1** Demon, art wired)
  as a buyable card, and taught the consume trigger to recognize it (`consumeFodderOnSummon` now fires
  for `cardId==='fodder'` as well as tokens). Verified live: bought + played Fodder beside a 5/5
  Voracious Imp → Imp **ate it → 6/6**, Fodder did not linger on the board. (Voracious Imp text updated:
  "When you play **Fodder**, this eats it and gains its stats.")
- **Verified:** `typecheck` (+web) + `lint` + `test` (**75**, +1 Fodder-consume test) + `build:web` all
  pass; the six features above confirmed live via DOM checks + screenshots. `TURN_SECONDS`/`SPEED` test
  bumps reverted to 30/1.5.

### Spell system + Spirit Fire + targeted casting
- **A new card kind: spells.** `CardDef` grew `spell` / `cost` / `target`; spells set their own cost
  (minions stay flat `CONFIG.minionCost`), are excluded from the minion pool, and never take a board
  slot. The shop now always offers exactly one spell on the **right** (`state.spell`, re-rolled each
  refresh from `SPELL_CARDS`). Zod schema kept in lockstep.
- **Spirit Fire** (the first spell): cost **2**, *target a friendly minion → +3/+3*. Bought into the
  hand, then **cast by dragging it onto a friend** (the target highlights; release off a minion snaps
  back). Verified live: 2/1 Drone → 5/4, spell consumed, slot re-offers on reroll.
- **Targeting mechanic** (the "target Battlecry" change): `target: 'friendly'` + a `targetUid` on the
  `play` action + `boardUidAt()` + the existing aim-highlight. Spirit Fire is its first user; targeted
  *minion* Battlecries reuse the same path (a small factory + place-then-target gesture away).
- **Plumbing set up now, ready for cards** (per the user — buffable spells, spell-casters,
  spell-trackers):
  - `spellCast` game event + `state.spellsCast` counter — minions that track spells cast.
  - `castSpell` recruit factory — a minion casts a named spell from an event (auto-targets the carry;
    counts the cast without re-firing `spellCast`, so no recursion).
  - `state.spellCostMod` — flat reduction subtracted from spell cost at buy ("your spells cost less").
- **Verified:** `typecheck` (+ web) + `lint` + `test` (**74**, +4 spell tests) + `build:web` pass;
  the shop slot, buy, drag-to-target cast (+3/+3), consume, and reroll re-offer all confirmed live.

### Fix: warband cards flew off-screen when wiggling a held minion
- Dragging a held minion back and forth over another a few times made the other cards "spazz out"
  and vanish. Cause: the FLIP slide measured each card's `getBoundingClientRect()` **including its
  in-flight transform**, then stored that interpolated value as the next "first" position — so rapid
  drags compounded the deltas until `translateX` flung cards far off-screen. Fixed by dropping any
  in-progress transform (`transition:none; transform:''`) on every tracked card *before* measuring,
  so each FLIP works from true layout positions; deltas stay bounded by the row width. Verified live:
  wiggling a held minion back and forth 8× over a 3-card board leaves every other card on-screen in
  place (was: flung away / gone).

### Warband drag — truly lift the held card out (drop-in-place, take 2)
- The previous pass only lifted the dragged board minion out *while the cursor was over the
  warband*; dragging it away (e.g. toward the hand) flipped it back to a solid card in the row, so
  you saw a duplicate — the copy you're holding *and* the original still sitting in the warband.
  Now the dragged minion is lifted out of the row for the **entire** drag (the floating copy is the
  card), the rest physically close up, and an empty drop-slot opens at the live insertion point only
  while hovering the warband — the held copy drops straight into it. Also made the drop-slot more
  visible. Verified live: dragging toward the hand leaves only the other minion in the warband (no
  duplicate); holding over the warband opens the slot with the dragged card lifted out.

### Keyword system (Immune/Stealth/Avenge/End-of-Turn + out-of-combat Deathrattle) + drop-in-place drag + lighter board
- **Lighter board** — the taupe backdrop was a touch dark; nudged `--bg` `#7d756b` → `#8c857a`.
- **Drop-in-place warband drag** — reordering a board minion no longer does a jarring post-drop
  "swap" animation. While you drag, the minion rides along as the held copy and its placeholder
  slides to the live insertion slot (the other cards open a gap via FLIP); on release the card lands
  exactly where it already shows, so there's no second shuffle. A played hand card opens the same
  slot. (Replaced the absolute drop-bar with a real `displayBoard` reorder + a `.dropslot` gap;
  `flipKey` drives the live FLIP. Verified live via a held drag — the order is already final before
  release.)
- **Keywords wired/fixed** across `@game/core` + `@game/sim` + UI, with the zod schema kept in
  lockstep:
  - **Immune (`IMM`)** — takes no damage at all (checked first in `dealDamage`, before Divine Shield;
    blocks Poison and destroy-by-damage too). Combat keyword, works on any card. Tested.
  - **Stealth (`ST`)** — can't be targeted by attacks (`chooseTarget` skips it; if every defender is
    Stealthed the swing is skipped) and is lost the moment it attacks (emits a new `reveal` event so
    the replay drops the keyword; the card wears a shadowy look until then). Tested.
  - **Avenge** — new `avenge` game event: `simulate` keeps a per-side death tally and emits it on
    each death; the `avengeBuff` factory fires every X friendly deaths. Trigger + pill wired (text
    prefix "Avenge (X):"); ready for any card that declares it.
  - **End of Turn** — new `endOfTurn` game event fired by `applyEndOfTurn` at the top of `faceOmen`
    (the turn ending / timer hitting 0), baking into the board before combat; `endOfTurnBuff` recruit
    factory + pill wired.
  - **Deathrattle now fires out of combat** — when a minion is Consumed (destroyed in the recruit
    phase) its Deathrattle resolves via recruit-side factories (summon / buff-tribe / buff-carry /
    grant-shield). Tested (Soulfeeder eating a Sporeling triggers its +1/+1).
  - Verified the rest already behave to spec: Battlecry (onPlay, +Drummer re-trigger), Divine Shield,
    Poison, Reborn, Start of Combat, Consume, Cleave, Windfury (existing tests cover them).
- **Verified:** `typecheck` (+ web) + `lint` + `test` (**70**, +3) + `build:web` all pass; lighter
  board + Target Dummy art + clean render confirmed live.

## 2026-06-16

### Combat out-of-order fix + darker board + tier-1 art + renames
- **Combat replaying out of order — fixed (the important one).** The simulator is deterministic and
  the beat advance is a monotonic `k => k+1`, so the *data* order was never wrong (confirmed by
  tracing). The bug was in the visual layer: the attacker→target **lunge** and the Start-of-Combat
  **projectiles** were measured by reading the DOM *during render* (`querySelector(...)
  .getBoundingClientRect()`), and the lunge was stored by **mutating a ref during render**. Render
  sees the *previously committed* frame, so when a death or summon shifted a minion between beats, an
  attacker lunged toward where its target *used to be* — and StrictMode's intentional double-render
  amplified the inconsistency. Moved both measurements into a `useLayoutEffect` (runs after the beat
  commits, when the DOM is current) and hold them in state, so render is pure and StrictMode-safe.
  Verified live (slow + normal speed): attackers lunge at the correct target, combat plays in order
  and completes, console clean.
- **Darker board.** The backdrop went from bright cream (`#f6f0e5`) to a warm taupe (`#7d756b`) so
  the cards and art pop; the text that sits directly on the board (zone titles, hints, combat log +
  side labels, the game-over wash) was lightened to stay legible.
- **Tier-1 art + renames.** Wired illustrations for **Alleycat, Sporeling, Stray, Target Dummy**
  (downsized to 512²). Renamed **Alleycur → Alleycat** and **Pocket Sandbag → Target Dummy** — display
  names only; the card ids (`alley`, `sandbag`) are unchanged, so art lookup + the run tests are
  unaffected (the sim references were comments).
- Verified: `typecheck` (+ web) + `lint` + `test` (67) + `build:web` (8 art PNGs bundle) all pass;
  dark board + Alleycat/Sporeling art + the rename confirmed live.

### Art fills the panel + standardized text line + Battlecry/Deathrattle pills + right-click inspect
- **Art zoomed to fill** — `object-fit` back to `cover` (from `contain`), so the illustration fills
  the 60 % art panel edge-to-edge (the user preferred full-bleed over the letterboxed full image).
- **Standardized text line** — the keyword-pill row (`.kws`) now always renders and reserves one
  pill-row of height, so a card's description starts on the same line whether or not it has pills.
  Verified Start (Ember Whelp), Battlecry (Alleycur), and Deathrattle (Sporeling) all land their
  description at the same Y (456 px).
- **Battlecry / Deathrattle pills** — these aren't keywords in the data model, so the Card derives
  them from the text prefix (tolerating the `**bold**` markdown — `/^\W*battlecry/i`) and shows a pill
  matching the existing Start / Consume style: Battlecry gets a new horn glyph, Deathrattle the skull.
- **Right-click inspect** — right-clicking any card (shop, hand, warband, or a combat unit) floats a
  centred, enlarged copy over a dimmed + blurred backdrop for a close look; click the backdrop or
  press Escape to dismiss. New `inspect` store state + `inspectCard`/`clearInspect` actions, an
  `<Inspect>` overlay at the Game root, and `onContextMenu` on the Card. Any dispatch also closes it.
- **Verified live**: art fills the panel; Start/Battlecry/Deathrattle descriptions all align at
  456 px; both new pills render with icons; inspect opens centred (centreX = viewport centre) and
  closes on backdrop-click and Escape. `typecheck` (+ web) + `lint` + `test` (67) + `build:web` pass.

### Bigger cards + 60% full-image art + compact Omen + sweet-spot targeting
- **Cards larger** — added `--cw` / `--ch` card-size variables (one standard size used in shop,
  warband, hand, and combat). Width +10 % (190→209 px) and height +14 px (264→278 px).
- **Art area 60 %, full image** — the art panel grew 50 %→60 % of the card and `object-fit` changed
  cover→**contain**, so the *whole* illustration is shown (no cropping); the tribe-tinted panel frames
  it. (The earlier "art too big" was a containment bug, already fixed; this is the size/fit the user
  asked for — 512² art is still the right source.)
- **Compact Omen** — the upcoming-threat banner was tightened (padding 11→7, name 24→19, description
  13→12, sigil 50→44, spacing) from ~123 px to ~100 px, funding the taller cards so the net vertical
  footprint barely changes. Verified live: recruit keeps ~31 px clearance above the StatusBar and the
  combat scene still fits.
- **Sweet-spot targeting** — the Hero-Power aim (and any future single-target ability) now follows the
  cursor exactly: you can aim **anywhere on a minion's card**, no snap to its centre. The minion under
  the cursor lights up with a strong accent ring (`.card.targeted`). Verified the aim circle lands at
  the cursor (901,631) rather than the card centre (954,720), and the hovered card highlights.
- **Verified live**: cards measure 209×278, art panel ~60 % showing the full image, Omen ~100 px,
  recruit clearance ~31 px, combat fits, tier colours intact, sweet-spot aim + highlight confirmed.
  `typecheck` (+ web) + `lint` + `test` (67) + `build:web` all pass.

### Drag precision pass + tier colours + art-covers-text fix
- **Drag precision** (the headline ask — make dragging exact, clean, satisfying). Six fixes to the
  pointer-drag in `Recruit.tsx`:
  1. **Zero-lag tracking** — the floating card had a 50 ms `transition: transform` so it always
     trailed the cursor; now it tracks instantly (the transition is kept only for the snap-back).
  2. **Grab-point lock** — `scale(1.04)`/`rotate` pivoted around the card's corner, sliding the
     grabbed point ~4 px off the cursor; `transform-origin` is now set to the exact grab point so the
     card stays pinned under the pointer (rotate softened to 1.5°).
  3. **Reorder off-by-one fix** — `warbandIndexAt` counted the dragged board card itself (it stays in
     the DOM, dimmed), so a rightward/inward reorder overshot by one ("doesn't go where you think").
     It now excludes the dragged card; verified live that dragging the left minion of three into the
     middle lands it at index 1, not dumped at the end.
  4. **Pointer capture** — `setPointerCapture` on press so move/up keep firing through fast flicks or
     when the pointer leaves the window.
  5. **Live insertion marker** — a glowing accent bar shows the exact slot a played / reordered minion
     will drop into, sliding between cards as you move.
  6. **Drop-zone glow** — the hand lights up when a shop card will buy, the warband when a card will
     play / reorder (the tavern already had its gold sell glow).
- **Tier colours** — the tier badge was dark on every card; tiers 1–6 now ramp cool→warm
  (slate · green · blue · violet · orange · raspberry) via a `data-tier` attribute, so tier reads at
  a glance. Applies in the shop, warband, and combat.
- **Art covers text — fixed.** The illustration was rendering 186 px tall inside a 130 px art panel
  (the grid auto-sized the square PNG to its *width*-driven height) and `​.art` had no `overflow:
  hidden`, so it spilled 56 px down over the keyword chips + description. The image is now
  absolutely positioned to fill its panel exactly and the panel clips — text sits cleanly below.
  This was a CSS bug, **not** the asset size (512² is fine). Card size was left as-is on purpose:
  growing height would break the three-rows-clear-the-StatusBar fit tuned last batch.
- **Verified live** (drove a real run via synthetic pointer-drags): the art now fills its panel
  exactly (measured), tier badges show distinct colours, the insertion marker renders at the correct
  slot, 2- and 3-card reorders land precisely where aimed, no console errors. `typecheck` (+ web) +
  `lint` + `test` (67) + `build:web` all pass.

### Illustrated art pipeline + more combat feel
- **Art pipeline** — a per-card image override. A new `packages/ui/src/art.ts` enumerates
  `art/minions/*.png` at build time via `import.meta.glob` (keyed by filename = card id), and the
  Card renders an `<img class="artimg">` (object-fit cover, top-anchored) when a matching file
  exists, falling back to the generated pixel `Sprite` otherwise — purely additive, a no-op until
  art is added. `cardId` is now threaded through every CardView (shop, warband/inst, Discover, and
  the combat Arena unit), so an illustration shows in all three rows + combat. The first four
  illustrations are wired — `whelp` (Ember Whelp), `imp` (Voracious Imp), `drone` (Spare Part
  Drone), `drummer` (Doublecast Drummer) — copied from `C:\Game Assets\Ascent Art\Minions` and
  downsized from the 1254² ~2.3 MB originals to 512×512 (~650 KB) for the bundle. A README in the
  art dir documents the card-id ↔ name table, the format/size spec, and the one Vite caveat (restart
  `npm run dev` once if you drop the *first* files into the previously-empty folder, since the glob
  compiles to an empty map at startup).
- **More combat feel** — four additions on top of the existing lunge/shatter/poison/SC/summon juice:
  (1) **death dissolve** — a dying minion now flashes, crumples with a slight tumble + desaturate,
  and fades to nothing, instead of shrinking to 0.7 and popping out; (2) a white-hot **impact spark**
  at each struck minion (a `::before` flash on the existing `struck` class); (3) a **win/lose scene
  tint** when the replay settles — a soft green vignette on a win, raspberry on a loss
  (`.arena.done.win|lose .ascene::after`); (4) **snappier lunge easing** (0.16 s with a slight
  overshoot) so a strike reads as a committed blow.
- **Verified live** (drove a real run via synthetic pointer-drags; combat slowed temporarily to film,
  then SPEED restored to 1.5): Ember Whelp / Voracious Imp / Spare Part Drone render their
  illustrations in shop, warband, *and* combat, while art-less cards keep their pixel sprite; combat
  lunges + SC scorch + deaths play; both result tints show (green win, raspberry loss). `npm run
  typecheck` + `typecheck:web` + `lint` + `test` (67) + `build:web` all pass; the four PNGs emit as
  hashed bundle assets.
- **Notes:** balance tuning stays deferred (feel + functionality first). As art scales past a handful
  of cards, the ~650 KB PNGs will want WebP/compression — flagged in the roadmap.

### Feel/functionality pass — hand box, combat juice, spell frame, golden text
- **Hand box** (`fdee24c`): the empty-hand box now spans the bottom frame's width (~760px, ≈ the
  Embers·Hero·Resolve StatusBar) and no longer clips under the hero — trimmed the card-row height to
  264 (= card height), the column gap, zone headers, and the control-bar margin so the three rows +
  chrome fit above the fixed StatusBar (~50px clearance).
- **Combat juice** (`c3f4d9a`): a breaking Divine Shield bursts a golden shard ring; in-combat
  summoned minions pop in; a kill shakes the board (hit-stop feel). Verified the shake live.
- **Spell frame + golden text** (`3462758`): the Discover spell now has a distinct demon-purple
  arcane frame; golden text-doubling broadened to bold "deal **3**" and SC-AoE phrasing ("3 to
  every", "3 more") so a tripled card's printed numbers match its doubled effect.
- Verified live this pass: taunt shield ward (steel emblem on the enemy), dead minions removed (not
  greyed), End-Combat top-centre, persistent StatusBar + hero-ready glow, board shake on a kill.
- **Note:** balance tuning (the counter matrix) is explicitly deferred — feel + functionality first.
  Minion art (the Ember Whelp dragon) is also deferred; art specs + a per-card image-override path
  are noted in the roadmap.


### Triple/Drummer/Echo fixes + combat & recruit polish + SFX
- **Engine fixes** (`7c6945a`): tripling now combines the three copies' *current* stats — the sum of
  the two highest attacks and two highest healths — and unions all their keywords (so a buffed /
  Poison / Divine-Shield copy keeps it), instead of resetting to 2× base. Doublecast Drummer now
  makes Battlecries fire one extra time per Drummer. Echo Warden now works in combat (friendly
  summons fire one extra time per Echo); its text reads "In combat, …".
- **Recruit layout** (`2f57101`): a shaded, non-clickable "Tavern · Tier N" box was added to the
  control row; the warband dropped its fixed "Empty" slots (renders just the played minions with a
  hint when empty); the keyword legend strip was removed.
- **Combat polish** (`5dac9c8`): Taunt minions wear a steel shield ward; damage/buff floats are much
  larger and the struck minion's HP badge flares; combat lines hold a static height; a burning rope
  appears in the last 15 s of a turn above the warband. Plus a Start-of-Combat **projectile** bolt
  (`6e8e285`) that flies from the caster to each target it hits.
- **Targeting** (`fe502a6`): the Hero Power is now drag-to-target — press the Forgewarden, drag the
  aim line onto a friendly minion, release to Temper it (the whole card is the target); release off
  to cancel. A plain click still arms. The same flow is ready for a single-target Battlecry.
- **Shuffle** (`4374ef7`): the warband FLIP-slides cards into place when it reorders (play / summon /
  sell / reposition); magnetic merges don't reorder so they don't shuffle.
- **SFX** (`1f1fe87`): a synthesized Web Audio sound bank (no asset files) for recruit actions,
  combat beats, triples, and win/lose, with a mute toggle (persisted) in the HUD.


### Combat overhaul + flair, stat colours, persistent HUD, even layout
- **Combat read cleanup** (`cacae5e`): attacks now play as a clear wind-up (the attacker lunges in,
  no damage) then an impact beat (it and its target take damage together, dead removed), instead of
  everything resolving at once. The lunge is cached so it stays planted through the impact then
  retracts. Combat is ~25% slower (SPEED 1.2→1.5) and floats linger longer.
- **Combat VFX + stat colours** (`e03c048`): Divine Shield is a pulsing golden aura (flashes on when
  granted, gone when broken); poison drops a green mist; Start of Combat fires a golden cast pulse;
  an in-combat buff gives a green pulse; a Cleave attacker shows a white slash. Stats above their
  base render green, below base render red, on cards everywhere.
- **Engine / balance** (`4c29eb4`): embers uncapped within a turn (sell always pays); keyword grants
  target a friend that *lacks* the keyword; early waves 1–4 softened (bot climbs to ~wave 8–10).
- **Persistent HUD + combat end** (`eb25733`): the StatusBar (Embers · Forgewarden · Resolve) is now
  rooted at the bottom across recruit and combat (moved to the Game root, fixed). Removed the bottom
  result bar; "Climb On" is now "End Combat" at the top-centre. A Resolve loss shakes/flashes the
  chip and floats the −X. The Hero Power pulses when it's available and unused.
- **Layout + flair** (`49f0ad3`): rows are fixed-height so spacing is equal (tavern↔warband ==
  warband↔hand, 54px); a hovered card's tooltip rises above the shop buttons; dragging a Magnetic
  minion over a friendly Mech crackles with electricity; a recruit-phase buff flashes the card green.

### Combat-feel beats, engine/balance fixes, card-UX pass, repo conventions
- **Combat replay → beats** (`195f2ca`): the replay advances in beats — a primary action (attack /
  Start-of-Combat / summon / buff / reborn) and all the result events it caused (both minions'
  damage, shields, poison, deaths) resolve together. So an attacker and its target take damage at
  the same instant and their floats land together. Dead minions are removed from the board (no grey
  fade): a death from a prior beat is filtered out; the minion dying in the current beat shows for
  one beat then is gone; the result screen shows survivors only.
- **Engine / balance** (`4c29eb4`): embers are uncapped within a turn — selling was clamped to
  `maxEmbers` (== current embers right after the per-turn refill) so it paid nothing at turn start;
  now sell just adds. Keyword grants (Toxin/Plaguebringer) target the highest-attack friend that
  *lacks* the keyword, never wasting the grant. Enemy strength softened for turns 1–4 (ramp 0.30→1.0
  over waves 1–7, width tracks the wave); greedy bot climbs to ~wave 8–10.
- **Card UX** (`dedf1b5` + styles in `195f2ca`): the name now sits as a pill on the bottom of the
  art with the keyword/text area below it (more room for legible text). Removed the result toast bar
  above the Omen. The drag-ghost positions via GPU transform (clean 150ms snap-back instead of a
  juddery left/top animation) with a small follow-lag + tilt for felt weight.
- **Repo conventions**: README carries a Recent-changes + Short-term-roadmap summary; CLAUDE.md gains
  a rule to keep README/devlog/roadmap current each commit, and a rule to ask clarifying questions on
  ambiguous asks. (The private GitHub repo `kcodea/ascent` was created earlier in the day.)

### UI fixes: button layering, no text-select/right-click, cursor + timer behavior (`a2c7b19`)
- **Shop controls layering** — the Refresh/Freeze/Tier/End Turn bar now sits above the tavern cards
  (`position:relative; z-index:6` + 16px clearance, tavern row aligned `flex-start`). The tall 264px
  minion cards had been eclipsing the buttons.
- **No text selection / no right-click** — `user-select:none` on `body`; `contextmenu` preventDefault
  registered in `apps/web/src/main.tsx`.
- **Drag cursor fix** — the closed-fist cursor was stranding "on" after the first drag. `body.dragging`
  is now removed on pointer release in `onUp` (immediate revert), with an effect tied to `drag.active`
  as a safety net. Also restored the gauntlet hover cursor over cards/buttons: a later `cursor:pointer`
  in the base `.card`/`.btn`/`.hero` rules had been overriding the custom-cursor rule once cards
  stopped being native-`draggable`.
- **Timer behavior** — the 30s round timer no longer auto-starts combat at 0; it now locks every
  action **except End Turn** (which pulses). `timeUp` gates `beginDrag`, Refresh/Freeze/Tier, and the
  Hero Power click.
- Verified via DOM: z-index + 9px button/card clearance, `user-select:none`, contextmenu prevented,
  `body.dragging` lifecycle (added during drag, cleared on release), gauntlet cursor resolves.

### Card sizing, tier badge, End Turn, round timer, triple rework, golden doubling, combat slide
- **Fixed 1:1 card size everywhere** (`069072b`) — cards are a constant **190×264** in tavern,
  warband, hand, combat, Discover and the drag-ghost. Recruit cards had been stretching to row height
  (so they shrank when the control bar + bigger panels tightened the layout) while combat cards were
  fixed; this unifies them and also resolves the art-at-50% flex-basis ambiguity.
- **Tier badge** on every card (top-centre, overlapping the top edge); **End Turn** (renamed from
  "Face the Omen") moved next to Tier in the tavern control bar at 2× size.
- **30s round timer** top-centre (`8bb900d`); ring depletes, turns red under 5s.
- **Two-step triple Discover + golden doubling** (`f6b8f8f`) — a triple drops a golden 2× minion into
  hand with *no* immediate Discover. Playing the golden grants a "Glimpse Beyond" Discover spell;
  playing that spell opens the Discover (3 minions from one tier up). Golden minions fire effects at
  doubled magnitude (combat + recruit factories ×2 when golden; card text doubles "+N/+N" and
  "deal N"). New `discoverspell` token; combat `Minion` gained a `golden` flag.
- **Combat slide-to-target** (`d56367b`) — the attacking card physically slides ~62% into its target
  (inline transform from the two units' live positions); damage floats at the clash.
- 62/62 tests; typecheck/lint/build clean throughout.

### Big UX pass (commit-per-feature)
- 1:1 combat cards using the real `Card` component (`dc86952`).
- Hero-Power **targeting line** with a snapping target orb (`b68a02b`).
- **Pointer-drag overhaul** — solid card follows the cursor, snap-back on invalid drop, gold "Sell +1"
  glow over the tavern (`abeb2eb`).
- Custom gauntlet/hand **cursors** (`29b23e0`).
- Hero-sized Ember/Resolve panels + a fanned, hover-pop **hand** (`6e82264`).
- 2× tavern controls above the shop + **center-anchored** warband (`1505981`).
- Terse mechanical card text + **keyword tooltips** + card width +15% (`71a31c5`).

### Content + balance
- **5 tribes per run** + active-tribe HUD (`667677b`).
- **Triples & Discover** v1 (`38bfdcd`) — later reworked to the two-step flow above.
- **Early-game balance on-ramp** (`d9fe8bb`) — enemy width capped near the wave number, stats ramp
  55%→100% over waves 1–5, and a gentler loss-damage formula, so waves 1–3 are winnable. Greedy bot
  now climbs to ~wave 7–9 (was 3–4).
- **Headless balance runner** (`216bc26`, `npm run balance`) — mono-tribe boards vs every threat,
  prints a tribe×threat win-rate matrix + counter-matrix adherence. Flags Mech dominant, Beast weak,
  Dragon/Undead flat, Demon holds.
- **Demon tribe** (`1f03feb`) — recruit-time Consume system (`onConsume` event + reactions).
- **Mech tribe** (`ba4e583`) — Divine-Shield walls + shield-break payoff chain + Magnetic merge.
- UI note batch (`cb1d95e`) — 50% card art, tribe-typed footer, big centred hero, buy/sell/summon FX.

## Earlier — M0 / M1
- **M0** — deterministic engine: seeded mulberry32 RNG, event bus, pure `simulate()` → event log;
  Beasts + neutral glue; headless determinism harness (`npm run harness`).
- **M1** — run-loop reducer + economy + 5 threats + deterministic wave/enemy generation + scoring +
  save/load; recruit-phase effect system (Battlecries / buff-on-buy / summon buffs); Dragons tribe;
  Battlegrounds hand (buy→hand→play→board); live recruit screen (`@game/ui` + `apps/web`); combat
  arena replaying the event log; full playable loop (recruit → combat → next wave / game over).
