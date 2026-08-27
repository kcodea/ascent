# Hero-power activation stagers — the passive queue drained (Docbot PR 4)

**Date:** 2026-08-27
**Scope:** `packages/sim/src/docbot/` only (heroPowerFamilies.ts NEW, heroPowerStagers.test.ts NEW, heroPowerLane.test.ts note/cross-check)

The heroScan lane proved ACTIVE powers act through the real `heroPower` action; the 24 powers it read silent
sat in a queue pinned at 24 with a generic passive/scheduled excuse (owner-approved as working-as-designed on
the triage board). This PR verifies each of them individually, per handoff §6 (Workstream C):

- **`heroPowerFamilies.ts`** — every `HeroPowerKind` classified into ONE activation family
  (`Record<HeroPowerKind, ActivationFamily>`, so an unclassified new kind is a compile error; a runtime sweep
  over the live HEROES registry re-checks with a "classify me" failure naming the hero). Retired kinds are
  typed `'retired'` and a live hero wielding one fails the lane.
- **`heroPowerStagers.test.ts`** — a stager per family drives the REAL engine (createRun, real
  buys/sells/rolls/upgrades/plays, real wave advances via `resolveCombat`, the real `faceOmen` fight) to each
  silent power's activation point and asserts the payoff. All 24 formerly-silent powers are staged; the
  **needs-stager queue is pinned two-sided at 0**. Depth per §6.3 where applicable: exact thresholds (Drakko
  5th-not-4th, Chronos 4th, Ayse 3rd Enchanted, Pete 3rd refresh), fire-once semantics, cost-paid-exactly-once,
  refusal when unaffordable/ineligible (Soulkeeper, Gildcrafter, Membrance, Commission's offer validation),
  progress carry across turns (Pete) and across `serialize`/`deserialize` (Drakko mid-quest), and
  adopted-power routing (a Mimic disguise firing Nadja's active and inheriting Midas' Gild-at-2 rule sites).
- **Sabotage (§3.5):** Drakko's counter is neutered in-memory just before the threshold buy and the stager's
  oracle is shown to fail for the intended reason, with the undoctored run still paying.
- **`heroPowerLane.test.ts`** — the 24-pin stays (it describes what the FIXTURE can see), but the note now
  points at the stager lane, and a new exact-match test locks the silent set to `SILENT_QUEUE_VERDICTS`
  key-for-key, so a hero joining or leaving the silent set without a verdict fails.

## Fixture traps worth remembering

- **Crafted shop uids can collide with the rolled spell slot.** `createRun` numbers everything from one
  `s${n}` sequence; a fixture shop of `s0…s4` made `buy s3` silently buy the SPELL SLOT (a Gold Pouch) instead
  of the crafted offer. The stagers use a `q` prefix and clear `spell`.
- **Identical-card buy chains complete triples** and the Gild's Triple Reward interferes with the count under
  test — quest-buy stagers use DISTINCT Shout/EoT card ids derived from content.
- **Disco Dan's turn 1 refuses every shop action including `play`** (the pure-Setlist rule at the top of
  `reduce`), so lock-guard checks must run at wave ≥ 2.
- **An arbitrary Discover pick may be a targeted Shout that fizzles an empty board** and masks a lock verdict
  — the lock guard is checked on a fizzle-proof body carrying the real stamp.

## Documented smell (NOT fixed — engine is Kevin's seam, this PR is docbot-only)

The `heroPower` case's else-if chain ends in a **Fortify fall-through**, and these passive kinds are missing
from its explicit passive no-op list: `secondHand`, `fourPeat`, `greatPresence`, `crownTally`, `baldgecoin`,
`midasTouch`, `tempest`, `bladeMastery`, `hoard`, `empoweringVines`, `voidTwin`. A `heroPower` action for one
of those heroes with a valid target applies a free +Tier/+Tier Fortify buff and spends the once-per-turn
charge — which is also why heroScan reads them "active" (so the lane's floor-30 ACTIVE count is partly the
fall-through, not real verification). The UI never arms a passive power's button, but any headless driver
(bots, scene bridge, doctored replay) can reach it. Recorded in `FALL_THROUGH_PASSIVE_COVERAGE`
(heroPowerFamilies.ts) together with the dedicated suites that DO cover those powers' real behaviour; the lane
asserts those files exist.
