# 2026-10-07: the Beast rune batch

Owner batch 2026-10-07: three new Beast runes, Set 2 only (the batch ruling), all `tribes: ['beast']`. Branch
`feat/beast-runes-1007`.

## What shipped

| Rune | Forge | Cost | Mechanism |
|---|---|---|---|
| Rune of Actioned Beasts | Basic | 3 | `runeThreshold`, NEW `playBeast` meter, `per: 5`, `grantRandomTribe: 'beast'` |
| Rune of the Gator's Bite | Epic | 3 | `runeThreshold`, `playBeast` meter, `per: 1`, NEW buff target `tribeBoard` (beast +6/+6) |
| Rune of the Sunpony | Basic | 3 | NEW `runeSunpony` combat flag, driving Sunmane Herald's own arena body |

Texts: "When you play **5 Beasts**, get a random **Beast**." / "When you play a **Beast**, give your **Beasts
+6/+6**." / "When a **Beast** attacks, give all of your **Beasts +1 Attack** and this Rune's effect." The
Sunpony cost (3) was confirmed by the owner mid-build.

## Mechanism

- **`playBeast` meter.** The Dragon's Pantry / Spirit shape: `playCard` (the one "played from hand" chokepoint)
  ticks it when the played body `isTribe(…, 'beast')`. The threshold engine owns banking, so progress carries
  across turns and the badge shows `x/5` through the generic `runeTally` threshold branch (the rune's live text;
  Gator's Bite reads `0/1` like Echoing Shouts). A Gilded Beast played is one tick. A Beast summoned by a Shout
  (Pennycat's Stray), a token, or a card reaching the hand is not a play. Play is a Shop action; there is no combat
  "play" path in Set 2 (the Set 3 hand-summon is out of this set), so no combat half was needed.
- **Actioned Beasts' grant** reuses `grantRandomTribe`: a buyable Beast from `poolOf(state)` at or below the shop
  tier (the Dragon's Pantry precedent). One payout per copy held (each copy is its own threshold entry).
- **`tribeBoard` buff target.** "Your Beasts" for Gator's Bite = the Beasts on the BOARD, permanent, Shop phase.
  It runs after the played body has landed, so the played Beast is included. Hand Beasts are not. Two copies pay
  twice.
- **Rune of the Sunpony.** The owner asked for Sunmane's effect with the rune as the source. `simulate()`'s
  `performAttack`, right after the attacker's own `onAttack` (its Rally), calls the Sunmane body
  `rallySpreadTribeBuff` with two new params: `fixed: true` (grant exactly the copy count; no Gilded doubling and
  no accrual read off the attacker, which is not the source) and `includeSelf: true` ("all of your Beasts": the
  rune has no body, so the attacker is one of them). Every Beast gains +1 Attack per copy for this fight, banks it
  as `rallySpreadAtk`, and gets the Sunmane spreading Rally graft if it lacks one. So a fed Beast passes on what
  it banked when it next attacks, exactly as a Sunmane-fed Beast does. The graft params are now written
  `{ tribe, attack: 0 }`, identical to what Sunmane always grafted, so the rune's flags never leak into a carrier.
  Beside a real Sunmane both fire (Sunmane's Rally to the OTHER Beasts, then the rune to every Beast); a body
  holds one graft whichever source landed it. Combat-only like Sunmane: nothing carries out of the fight.

## Judgement calls (all five CONFIRMED by the owner on #1974, 2026-10-07)

1. Gilded Beast played = one play; Shout-summoned Beasts are not plays (the "play a X" meter precedent).
2. Gator's Bite: board Beasts only, the played Beast included. Owner: Gator's Bite should NOT reach hand. Note this differs from Rune of the
   Echoing Shouts, whose "your Dragons" reaches the hand too (`tribe` target).
3. Sunpony: the attacker is included ("all of your Beasts"), unlike Sunmane, which never buffs itself. "This
   Rune's effect" is implemented as Sunmane's spreading Rally (what Sunmane grants), not as a copy of the rune's
   any-Beast-attacks trigger on every body, which would fire N times per attack and explode.
   With a real Sunmane on board, both fire (confirmed).
4. Actioned Beasts' random Beast uses the Pantry filter (`tribe`/`tribe2`/run-tribe), so All-types neutrals are
   not in its pool, same as the Pantry.

## Sunpony + Sunmane stacking (owner question: "it stacks appropriately still?")

Sunmane Herald (5 Attack) + two 1-Attack Beasts `a`, `b`, against an inert wall, left-to-right swings. Attack
s/a/b after each swing, with each Beast's banked spread value in brackets:

| Swing | Rune alone | Sunmane alone | Both |
|---|---|---|---|
| 1 (s attacks) | 2/2/2 [1/1/1] | 5/4/4 [0/3/3] | 6/5/5 [1/4/4] |
| 2 (a attacks) | 4/3/4 [3/2/3] | 8/4/7 [3/3/6] | 11/6/10 [6/5/9] |
| 3 (b attacks) | 8/7/5 [7/6/4] | 14/10/7 [9/9/6] | 21/16/11 [16/15/10] |

"Rune alone" uses a plain 1-Attack Beast in Sunmane's slot. Both = rune + Sunmane EXACTLY, every Beast, every
swing: a spread grant is linear in the carrier's bank. The one-graft dedupe only skips a second copy of the
Rally; the bank (`rallySpreadAtk`) always adds, and Sunmane's printed Rally reads it too, so nothing is dropped
and no fix was needed. Pinned in `sunponyRune.test.ts` against an independent reference model of the two
printed rules; a sabotage that skips the bank when the graft already exists fails it.

## Re-pins (after merging #1973, the same day's balance batch)

- `runes.test.ts` RUNES.length 181 (main) → 183 (Actioned Beasts, Sunpony).
- `set3RuneRoster.test.ts` Set 2 pool [124, 114] (main) → [126, 115].
- `balance/strategy/packages.test.ts` beastSummon `28/9/3/10` → `28/9/3/12` (the two Basic Beast runes; the census
  counts Basic runes only, so Gator's Bite is not in it).
- `docbot/textParse/textParse.test.ts` UNRESOLVED_CAP stays 119: the Sunpony's "this Rune's effect" does not parse
  (live count 115 → 116), but #1973's archives had already brought the count under the cap.
- `docs/docbot2/final-report.md` contracts 1072 → 1075; generated registries regenerated by `docbot:sync`.

## Oracle

Two approved rules in `registry/approved/runes.ts`: R-BEAST-PLAY-METER-01 (the meter, Actioned Beasts, Gator's
Bite board-only) and R-SUNPONY-SPREAD-01 (the Sunmane body with the rune as source). Tests:
`packages/sim/src/beastRunes1007.test.ts` (reducer: buy, meter, countdown, targets, tier, determinism) and
`packages/core/src/combat/sunponyRune.test.ts` (real `simulate()`: attacker included, carrier pass-on, one graft,
Gilded, two copies, beside Sunmane, determinism).
