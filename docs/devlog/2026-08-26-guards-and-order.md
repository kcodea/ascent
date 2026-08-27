# 2026-08-26 — Doc Bot: guard-reachability sweep + order goldens

Two new test-only instruments for Doc Bot blind-spot classes 7 (a refusal guard exists ≠ the guard is
correct) and 4 (determinism pins ONE order; nothing says it's the RULED order). No engine behaviour changed.

## Guard reachability (`packages/sim/src/docbot/guardReachability.test.ts`)

The #847 audit made unusable spells REFUSE (kept in hand, no Gold) instead of casting into nothing. This
sweep closes the automatable half of "is the guard correct": for **every** refusal guard, build a state where
the spell SHOULD cast, drive the real reducer `play` action, and assert it actually cast (refusal returns the
identical state object — the `spellFizzle` contract — so identity means refused). Over-eager guards now fail
mechanically; over-lenient ones stay on the owner's policy card (`q-policy-refused-spells`).

- The guarded-spell list is **derived from the guard code itself**: the `NO_OP` table keys are parsed out of
  `spellFizzle.ts`, the legacy inline guards out of `reducer.ts` (`spellReplayBattlecry`, `spellLayaway`,
  `spellAverageStats`, `spellDisplace`, plus the `targetTribe` / `targetNoGolden` predicates, each pinned by
  a source-text canary). A new guard auto-sweeps its spells in; a guarded spell with no arming fixture fails
  with "add an arming fixture" (the `factoryPhase.test.ts` excuse-and-ratchet discipline).
- Result: **21 guarded spells, all armed; 0 excused** (ratchet pinned at 0).
- Found in passing (over-LENIENT, not fixed here — policy card material): Undead Army's guard checks only
  the pinned POOL for Undead; the effect additionally requires `undead` among the run's five TRIBES, so an
  off-tribe run consumes the card for nothing. Noted in the fixture comment.

## Order goldens (`packages/sim/src/docbot/orderGoldens.test.ts`)

Six fixtures where a WRONG resolution order produces a DIFFERENT outcome, each pinning the rule it encodes:

1. SoC resolves left-to-right within a side (two Speed Demons — the right one grants off its already-buffed
   stats).
2. SoC resolves the whole player side before the enemy side, even when the enemy holds the first attack.
3. Mutual clash: the **defender's** Echo resolves before the attacker's (proved in both directions).
4. Trigger insertion is depth-first (a Cleave double-kill: each Pup's on-summon buff inserts right behind
   its own summon), and improving grants step **mid-wave** (Beardsley's 4th Pup gets +6/+6).
5. Simultaneous Avenge counters fire left-to-right.
6. Shop: on-summon auras land before the played minion's own Shout — so Den Mother's improved grant goes to
   the Battlecry-summoned token, not the played card.

Four of those pins looked genuinely ambiguous (defender-first Echo, player-side-first SoC, mid-wave improve
steps, aura-before-Shout). They are written up as **proposed** triage questions — owner card format, not
seeded — in `docs/rulebook/order-ambiguities.md`. The rules seeder was not touched.
