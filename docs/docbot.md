# Doc Bot — the standing correctness auditor

Doc Bot is not a play bot. It never decides what is *good*; it decides what is *wired*. It exists because a
day of owner reports (2026-08-26) showed that our bug classes repeat: the same five shapes keep shipping, and
each was **predictable from structure** — no gameplay judgment required. Doc Bot is the on-ramp to the full
Interaction Verification Lab blueprint (owner's Codex doc, 2026-06-29): registry tripwires first, exhaustive
scenario synthesis later if the tripwires prove insufficient.

Run the report:

```bash
npm run docbot
```

The four tripwires gate in `npm test`; the report narrates what they enforce plus the backlogs they
tolerate-but-track. **Every number in the report is derived live from content and source — nothing here or
there is hand-maintained** (the CONTENT.md lesson).

## The four tripwires

| # | Test | Bug class it kills | Shipped examples |
|---|---|---|---|
| 1 | `packages/sim/src/docbot/factoryPhase.test.ts` | A factory missing from a phase map where its trigger dispatches — `MAP[do]?.()` makes that a **silent no-op** | Conductor in combat; Funeral on Loan; Beefy/Lantern Light fizzles |
| 2 | `packages/ui/src/docbotLiveText.test.ts` | A live-text helper that renders only **half** a dual-stat grant | Kringle's vanished Health |
| 3 | `packages/sim/src/docbot/tribePredicates.test.ts` | Raw `.tribe ===` comparisons that miss all-types | Voicekeeper, Trade-In, Pack Leader, snapshot drift |
| 4 | `packages/sim/src/docbot/derivations.test.ts` | Two code paths documented as "mirrors X" that silently diverge | Merchant's Chorus buy path; snapshot `beastsPlayed` |

### 1. Factory × phase (`phaseRegistry.ts`)

`TRIGGER_PHASES` declares where each trigger dispatches (recruit / combat / both) — derived by reading the
dispatchers, never from card text. Every (trigger, factory) pair in content must be implemented in every
phase its trigger dispatches, or carry a `PHASE_EXCUSED` entry with a **verifiable** reason
(`no-surface` / `outside-map` / `other-channel` / `state-missing`) — or `needs-triage`, the tolerated-but-
counted backlog awaiting an owner ruling. The triage count is ratcheted: it may only shrink.

This registry is the machine-checked replacement for the hand audit that used to live in
`replayCombatBattlecry`'s docblock — which was complete on 2026-08-04 and stale by the time Conductor
shipped. Comments audit the world once; registries audit it every CI run.

The **cast lane** rider: factories that route through `arena.castNamedSpell` → `combatCastable` must name
spells that pass the gate, or the cast *fizzles without counting* (the Beefy class). Factories that inline
their spell's body via `castRepeat` are exempt — an inlined cast works even when the spell's own factory
would not (Watcher/Lantern of Souls; a recorded false positive from this test's first run).

### 2. Dual-stat live text

Re-derives its worklist per run: every factory the `cardText.ts` chain keys on whose content params grant
both Attack and Health, driven through the real `liveCardText` under an all-scalers-hot bag. Two demands:
every such helper **engages** (coverage must be real — a helper the bag can't reach fails the test, it does
not silently pass), and every replacement text keeps **both halves**. Kringle's own unit test had asserted
the buggy string for two rebalances; this test cannot pin strings, so it cannot preserve a bug that way.

### 3. Tribe-predicate ratchet (`tribeRatchet.ts`)

The owner's ruling: *all types trigger all types of interactions*. The shared predicates (`isTribe` /
`defIsTribe` in sim, `isTribeOf` in simulate, `arena.isTribe` in the arena) know that; raw comparisons don't.
145 raw comparisons predate the ruling — frozen behind per-file pins that may only go **down**. New code goes
through the predicates or CI fails.

Burn-down priority: **`packages/core/src/effects/arena.ts`** — 13 raw sites, zero all-types guards, and the
arena serves *both* phases, so each is potentially two bugs. `arena.isTribe` already exists in the same file;
the fix is one call away per site.

Deliberately out of scope: `bots/`, `productionBots/`, analytics (heuristics, not rules), and the question of
whether all-types cards join every tribe's **pool draws** (open balance question, owner-deferred in #1216).

### 4. Derivation pairs

Declared "these two code paths must compute the same thing" pairs, held equal by seeded fuzz instead of by
docblock. Current pairs: `offerBuyStats` ↔ the reducer's buy path (100 fuzzed states); `snapshotBoard`'s
`beastsPlayed` ↔ the shared Beast predicate. **When you write "mirrors X" in a comment, add the pair here
instead** — a comment claiming two functions agree is a testable assertion nobody tests.

## What landing Doc Bot found (2026-08-26)

- **16 needs-triage phase gaps** — see `npm run docbot` for the live list. Standouts: `deathrattleBuffShopPermanent`
  (a *shop* buff whose Echo can't fire in the shop), `deathrattleTriggerAdjacentRally` (the shop has a Rally
  dispatcher; Echo replays don't reach it), `onRubyPlayedSpreadRandom` (combat-played Rubies don't spread).
- **A live gameplay divergence, fixed in the landing PR**: `snapshotBoard` still counted `beastsPlayed` with a
  raw compare after #1216 fixed the reducer — a served board's Pack Leader fought weaker than its owner's.
- **The arena burn-down target** above.

## Extending Doc Bot

New trigger → classify it in `TRIGGER_PHASES` (read the dispatchers first). New dual-phase factory → implement
both sides or excuse it. New "mirrors X" comment → derivation pair. New scaling card → nothing to do; tripwires
1 and 2 derive their worklists from content. When a tripwire fires and you believe the code is right, the
answer is a *registry entry with a reason*, never a loosened assertion.
