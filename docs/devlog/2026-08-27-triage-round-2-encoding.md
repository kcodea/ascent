# 2026-08-27 — Triage round 2 encoded: 24 owner decisions into the durable registries

The owner's second full triage session (24 clicks on the round-2 board seeded by #1258, recorded in
`decisions.json`) is now encoded end to end, the same job the 2026-08-26 owner-rulings PR did for round 1.
This PR is the *registry* half only — four sibling implementation PRs carry the behaviour changes (rune
duplicate stacking, snapshot carries, the this-turn rule, combat multiplier/order fixes) and are referenced
by branch name in the tombstones.

## What was encoded

- **`decisions.json` committed** — it lived uncommitted in the primary checkout (round-1 precedent); all 24
  round-2 decisions plus the earlier round-1 clicks are now durable.
- **24 hand tombstones in `registry/retired.ts`** — every decided manual card left `pendingManual.ts` (the
  manual board is now EMPTY; the seeder never touches it, so removal + tombstone are by hand per
  `rules.test.ts`). Implemented-by-sibling rulings say `IMPLEMENTED in <branch>`; confirmed-current-behaviour
  rulings are OWNER RULED. All carry lane-level enforcement (the siblings' dedicated suites are in flight).
- **12 standing rules appended to `registry/approved.ts`**:
  - `R-RUNEDUP-01..08` — the per-family rune-duplicate rules, owner's verbatim wording as evidence
    (recurring stack; thresholds double the OUTPUT, not parallel meters; +1 repetition per copy; one-shots
    re-grant with next-turn banking, Ornate Clock unique, Held Strength becomes a Start-of-Combat rune;
    repeatable boolean flags fire once per copy; the universal sweetener floor — half cost rounded up +
    a free refresh; the forge filter; unique engines double where possible).
  - `R-ORD-01` (live improve steps mid-wave, golden G4) and `R-ORD-02` (shop aura-before-Shout, golden G6)
    — current behaviour confirmed.
  - `R-MULT-01` — non-stacking multipliers collapse to best-of across different cards; the "Twice"
    terminology pass is the owner's future work.
  - `R-SHOUT-01` — "first Shout each turn" charges are PER-PHASE (shop and combat each carry their own) —
    the Warm Embers ruling; the this-turn sibling PR had not yet added it, so it lands here.
- **Six new enforcement lanes** in `ENFORCEMENT_LANES` (`runeSwallowScan`, `snapshotFidelity`, `carryOver`,
  `interactionFamilyMatrix`, `orderGoldens`, `textOracleSummons`) — all backed by files already on disk, so
  the integrity test validates every ref today.
- **Grave Body parked** — `WATCHER_EXCUSED.gravebody` upgraded to an OWNER RULED parked-for-rework entry
  ("not currently active … we'll revisit when we need to"), and the `RULE_ENFORCEMENT` comment updated.
  The other two round-1 leftovers (`q-policy-passive-hero-powers`, `q-policy-refused-spells`, both REVISE =
  all-fine) already carried their round-1 enforcement entries — nothing further needed.

## Notable owner rulings (the ones that change future authoring)

- **"This turn" spans shop → that turn's combat**, ending at the next shop turn — standing language rule,
  to be applied retroactively (q-carry-demand-encore).
- **Initiative-side-first Start of Combat** (q-order-soc REVISE): the side that attacks first resolves SoC
  first — a replay-affecting change riding the combat-fixes sibling.
- **Rebirth keyword incoming** (owner's own follow-up): the copy-without-echo shape gets a real keyword;
  gilded sources produce gilded exact copies (q-copy-gilded-badge, q-snap-echostripped).

## Board state

Reseed verified: decisions survive, 3 generated cards remain in `pending.generated.ts` (all decided/revised —
the undecided board is **0**), manual board **0**. Gate: typecheck + lint + test (7263 passed) + build:web
all green.
