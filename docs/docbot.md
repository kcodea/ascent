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

The eight tripwires gate in `npm test`; the report narrates what they enforce plus the backlogs they
tolerate-but-track. **Every number in the report is derived live from content and source — nothing here or
there is hand-maintained** (the CONTENT.md lesson).

## The first four tripwires — from one day's reports

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

## Tripwires 5–8 — mined from the fix history

A sweep of the repo's ~480 `fix` commits found four more recurring, machine-checkable classes. Same doctrine;
each cites its incidents in the test header. Registries: `packages/sim/src/docbot/historyRegistry.ts`.

| # | Test | Bug class it kills | Historical incidents |
|---|---|---|---|
| 5 | `docbot/refIntegrity.test.ts` | An id-suffixed param that doesn't resolve — a crash or silent no-op at runtime | #719, #853, #848 |
| 6 | `docbot/turnScopedReset.test.ts` | A `*ThisTurn` field never reset — "this turn" quietly means "forever" | #670, #517, #891 |
| 7 | `docbot/runeRewardDifferential.test.ts` | A rune reward that changes nothing, or swallows a second copy | **#900** (41 of 72 Epics), the `combatFlag` 23-rune incident |
| 8 | `docbot/spellPowerFolding.test.ts` | A stat-spell factory that skips the spell-power fold | #817, #731 |

Tripwire 7 runs every one of the 281 runes through the **real `buyRune` action** twice and diffs
bookkeeping-stripped state (`runeSwallowScan.ts`, shared with the CLI so gate and report can't disagree).
First-copy no-op is a hard gate — zero today. Second-copy swallowing is a **ratcheted backlog of 80**: the
forge never excludes owned runes and Duplication doubles any Epic, so each is a reachable purchase that pays
nothing — but stack-vs-idempotent is a per-rune owner ruling (the blueprint's `duplicatePolicy`), so the list
is a designer queue, not a failure. Two instrument bugs were caught by this test's own sabotage checks and are
recorded in its header: plain `JSON.stringify` made the diff vacuously green (key reordering), and
`flagCopies` ticking masked the exact pre-#900 overwrite for amount-carrying flags.

## Tripwires 9–12 — the behavioural layer (the "wide" improvement scope)

Tripwires 1–8 mostly check WIRING. These check BEHAVIOUR — the real reducer and the real `simulate()`, run
differentially, so a factory that exists but does nothing is caught without any registry entry.

| # | Test | What it proves | Instrument lessons it carries |
|---|---|---|---|
| 9 | `docbot/playDifferential.test.ts` (+`playScan.ts`) | every `onPlay` minion, spell cast, and `onSummon` watcher ACTS through the real reducer, vs a validated vanilla control; golden play ≠ plain play | the control-body saga: `effects: []` ≠ inert (Drakko's `triggerMultiplier`, then Sylus, then zero clean non-token minions existed at all); event bookkeeping + fixture watchers masking a neutered Shout |
| 10 | `docbot/combatDifferential.test.ts` (+`combatScan.ts`) | every combat-effect card, present vs a stat-clone control in a staged fight, CHANGES the fight; golden combat ≠ plain | this is the generic Conductor catcher — zero registry entries needed |
| 11 | `docbot/textNumbers.test.ts` | every effect magnitude >1 is printed on the card (word numerals parsed; named-spell casts exempt per the 2026-07-15 ruling); golden text prints the doubled halves | 292 params, 0 misses; the 8 initial misses each taught a sanctioned escape |
| 12 | `docbot/invariantFuzz.test.ts` | random legal action sequences: Gold ≥ 0, board ≤ cap, unique uids, finite stats, no modal deadlock, trajectory determinism, identity-independence | the only unknown-unknown hunter; its first cut wrongly asserted input purity — the perf doctrine sanctions shallow-clone writes |

Every lane was sabotage-proofed by reintroducing a real bug shape (a neutered Shout factory surfaced
`n2_conductor`; a neutered `deathrattleSummon` surfaced 12 named echo-summoners; a Kringle-style param bump
surfaced `dw_foreman` with both numbers in the message).

New owner queues from the behavioural layer (all printed by `npm run docbot`):
- **54 scenario-conditional combat effects** — cards whose combat effect did not influence the staged fight.
  Most are condition-gated by reading (Ryme, Dawnclaw, Moe…); each deserves a per-card verification, and a
  NEW card landing here trips the pin at authoring time.
- **27 golden-flat combat cards** — the effect acts, but gilding changes nothing about it in combat.
- **14 refused spells** + **5 excused-conditional plays** + **1 explained silent watcher** (gravebody).

## What landing Doc Bot found (2026-08-26)

- **16 needs-triage phase gaps** — see `npm run docbot` for the live list. Standouts: `deathrattleBuffShopPermanent`
  (a *shop* buff whose Echo can't fire in the shop), `deathrattleTriggerAdjacentRally` (the shop has a Rally
  dispatcher; Echo replays don't reach it), `onRubyPlayedSpreadRandom` (combat-played Rubies don't spread).
- **A live gameplay divergence, fixed in the landing PR**: `snapshotBoard` still counted `beastsPlayed` with a
  raw compare after #1216 fixed the reducer — a served board's Pack Leader fought weaker than its owner's.
- **The arena burn-down target** above.
- **An 80-rune duplicate-policy queue** (tripwire 7): every rune whose second copy currently does nothing,
  each a purchasable situation. `npm run docbot` prints it.
- **Two spell-power rulings wanted** (tripwire 8): `rubyStatGain` and `spellBuffShopByRuby` don't fold spell
  power — plausibly correct (the Ruby-strength channel), unruled.

## The rulebook layer (tripwires cite rules from here on)

`@game/rules` is the registry that breaks Doc Bot's last circularity — implementation-as-its-own-oracle.
Approved rules enter only on explicit owner rulings (five seeded from the Complete Rulebook handoff;
eleven more — `R-AVWIN-01…11`, the per-instance temporal-window rulings of 2026-08-26 — enforced by
`packages/sim/src/docbot/temporalWindow.test.ts`, which also pins the two found violations);
`npm run rules:seed` regenerates the pending backlog from Doc Bot's live queues (274 verified-reachable
questions at first seed); and the owner decides them in **DEV MENU → Rulebook Triage** — each click writes a
git-tracked ruling to `packages/rules/src/registry/decisions.json` through the dev server. `docs/rulebook/`
carries the human-readable snapshot.

## From tripwire layer to QA machine

The explicit limitation list, each blind spot's circumvention, and the phased build order live in
[docs/docbot-roadmap.md](docbot-roadmap.md) — the execution plan for the blueprint's remaining components.

## The coverage corpus + nightly lane (PR 8)

Three commands sit above the tripwires (`packages/sim/src/docbot/{coverageKeys,corpusBuilder,trajectory,seedMinimize,findings,nightlyLane}.ts`):

- `npm run docbot:corpus` — regenerates the coverage-guided scenario corpus (`docbot/corpus/`): a
  deterministic fuzz sweep retains the smallest one-action `QaScenarioV1` that first reaches each SEMANTIC
  coverage key (factory executed, trigger emitted, combat-mod consumed, hero-power family, rune reward
  kind, guard branch, snapshot boundary, target arity, chain depth). Keys are derived purely from the
  event stamps the engine already emits (`factory:<do>:<on>` on combat events, `policyKey` on recruit
  beats) — zero engine change. The corpus is generated output: never hand-edit; regenerate in the PR that
  invalidates a fixture (the test names it).
- `npm run docbot:nightly` — the full-lifecycle lane (NOT in the PR gate; `.github/workflows/nightly.yml`
  runs it on a schedule): complete runs to elimination with serialize/restore checkpoints, replay
  reconstruction, invariant + explosion + combat-event budgets, plus an 8-seat bot-lobby law sweep. A
  failure minimizes (greedy drop-one to a proven 1-minimal trace), folds into a `QaScenarioV1` with its
  `npm run docbot:scenario --` repro line, and ships as a fingerprinted `DocbotFinding` (structural
  fingerprints — message prose never changes identity) with the original seed/trace preserved.
- `npm run docbot:scenario -- <id>` — replays any emitted scenario (corpus fixture or minimized failure).

## Extending Doc Bot

New trigger → classify it in `TRIGGER_PHASES` (read the dispatchers first). New dual-phase factory → implement
both sides or excuse it. New "mirrors X" comment → derivation pair. New scaling card → nothing to do; tripwires
1 and 2 derive their worklists from content. When a tripwire fires and you believe the code is right, the
answer is a *registry entry with a reason*, never a loosened assertion.
