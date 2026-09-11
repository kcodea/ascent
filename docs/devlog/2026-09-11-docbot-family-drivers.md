# 2026-09-11 — Doc Bot: contract-oracle FAMILY drivers (no-driver-for-shape 471 → 149)

**What.** The contract oracle (`packages/sim/src/docbot/contractOracle.ts`) had 972 contracts but only
five drivers, each written for one OBJECT SHAPE (death summon, avenge threshold, battlecry summon, copy
policy, gilded token). Result: 36 contracts with a case a driver actually executed and **471 applicable cases
skipped `no-driver-for-shape`** — the largest verification hole in the platform (`final-report.md` §2.2).

This PR adds drivers keyed by CLAIM FAMILY, in `packages/sim/src/docbot/drivers/`:

| driver | claim shape it reads | what it compares |
|---|---|---|
| `stat-grant` | a const amount with only `attack` / `health` (/ `count`) keys | the (A, H) delta on some unit — board, hand, tavern rider, run-wide aura; combat `buff` / `handBuff` events — per effect, or the SUM of a branch's effects ("+3/+4 twice"); only stated keys are observed |
| `card-grant` | `refs` on a grant-shaped kind, or `count` on a grant/summon kind, or a Discover | the named card arrives; the count of arrivals (sum rule for several unnamed counts); combat summons attributed by `source` |
| `economy` | one `amount` / `gold` / `count` on a gold / max-Gold / armor / refresh kind | the delta of the economy field that moved, the staging's real Gold cost (`goldSpentThisTurn`) added back |
| `keyword-grant` | a keyword-named kind (Taunt, Ward, Reborn, Magnetic, Gild …) | activation only — a keyword (or `golden`) arrived; the contract states no value |
| `equipment` | `grantEquipment` on `equip` | the granted Equipment id equals the card's own param (a limit-style verdict) |
| `vanilla-body` | no triggers, no effects, no def-level behaviour field | playing it equals playing the vanilla control (`omen`) with the same body; a hidden effect is `<unstated behaviour>` |
| `activation` | everything else stageable (copies, transforms, refreshes, scalers) | a control-body differential (playScan / combatScan's rule, generalized over every stager) — activation only; the magnitude template stays a typed skip |

`drivers/shared.ts` is the staging + observation kit: `stageShop` fires 18 shop triggers through the real
reducer (`reduce`, `applyEndOfTurn`, `applyStartOfTurn`) under the playDifferential fixture AND a tribe-rich
variant, with a **control-body baseline** (the same staging with `omen` in the source's place) subtracted so
a subject spell's own buff, an offer's price or a sale's base value never reads as the source's grant;
`stageCombat` fires 9 combat triggers through the real `simulate()` with one-activation fixtures (a 0/1
sandbag dies to the first swing, so "get 3 Rubies" reads 3, not 9). `drivers/families.ts` is the pure
classifier both the planner (`isolatedCases.ts`) and the drivers read.

**Numbers (full sweep, `npm run docbot:contracts`).** Contracts with a driver-executed case 36 → 470 (381
with at least one case actually OBSERVED); `minimum-activation` executed 36 → 346; `plain` 17 → 186;
`gilded` 7 → 92; `no-driver-for-shape` 471 → 149, and each remaining skip now names why: a scaler amount key
(`every` / `step` / `improve` / `per` …) the first activation does not print (110), a def-level behaviour field
the extractor never states (`discoverOnPlay`, `manaPerTurn`, `ruby` … — 29), or a trigger no stager fires
(10). New typed skip: `contract-states-no-magnitude` (86 — activation proven, nothing numeric to compare).

**Accounting change.** A driver record with `unobserved` set is now counted as a `runtime-unobserved` SKIP,
not an execution (it was counted executed before), and a template is counted once per contract even when
several families plan it. Both make the ledger stricter.

**Disagreements.** Every disagreement the drivers raised during the build was an INSTRUMENT bug and was fixed
in the driver (Choose One branches staged separately; stacked "twice" effects; keys the contract does not
state; spell cost from the spend ledger; source-attributed combat summons; same-id triples out of the vanilla
fixture; Set/Swap/Double/Per-* kinds excluded from the stat family). The full sweep prints exactly one
standing draft disagreement, `shaper` (`effects.1.summons.count.plain` expected 1, observed 0), which
predates this PR (the death-summon driver) and is queued as a `questionable-interaction`.

**Sabotage.** `familyDrivers.test.ts` doctors a contract amount, a gilded factor, a named ref, a count, a
hidden Shout on a vanilla claim, and swaps a vanilla body under keyword / equipment / activation claims — each
must be caught as a mismatch, a broken law, a failed limit check, or an unobserved record that refuses to
count as an execution.

**Gate cost.** The full sweep is ~0.5 s; the docbot vitest directory runs in ~8 s wall.

**Follow-ups.** A scaler-aware driver (stage N activations for `every` / `step` / `improve` shapes) and an
extractor pass that lists def-level behaviour fields under `extraction.unparsed` would take most of the 149
that remain. `runtime-unobserved` (163) is the next honest queue: fixtures for Imps / Fodder / Attachments /
Ales and "if you lost your last combat"-style conditions.
