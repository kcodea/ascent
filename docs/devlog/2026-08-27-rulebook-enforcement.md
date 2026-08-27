# Rulebook enforcement loop — every ruling carries its probe (PR 7)

The Rulebook registry recorded approved rules and owner decisions, but a decision was not guaranteed to
become an executable contract: a ruling could stay prose, an excuse could outlive the behaviour it
explained, and a rejected question sat on the pending board forever. This closes the §10 Workstream G loop
(Docbot next-iteration handoff): **every decision becomes an executable contract or an explicit
classification.**

## What shipped

- **Enforcement metadata** (`packages/rules/src/schema.ts`): rules can declare
  `enforcement: { kind: 'scenario'|'oracle'|'property'|'manual', refs, reason?, lastVerifiedAt? }`.
  `manual` is valid only for genuinely visual/design rulings and requires a `reason`.
- **Anti-rot validation** (`enforcement.ts` + `enforcement.test.ts`): scenario/property refs are
  fs-checked at test time (a deleted pinning test fails loudly); oracle refs must name a lane in the new
  `ENFORCEMENT_LANES` registry, whose backing files are fs-checked too.
- **Corpus populated honestly**: R-CEL-01 → `celestial.test.ts`; R-COPY-01 → the Bellringer plain-copy
  pin in `set2Neutral.test.ts`; R-COPY-02 → `copycat.test.ts`; the three revised policy/watch cards →
  their Doc Bot lanes (`heroPowerLane`, `playDifferential.refused`, `playDifferential.watchers`). All 19
  hand-retired 2026-08-26 rulings now carry machine-checkable enforcement: the nine implemented ones ref
  `ownerRulings20260826.test.ts`, the confirmed-behaviour ones ref `phaseRegistry`/`historyRegistry`,
  Echohorn refs `combatDifferential`.
- **Approved-but-unenforced queue**, two-sided ratchet: exactly `R-PLAY-01` (no probe pins the
  played-card definition's negative half) and `R-AURA-01` (no probe pins the behavioral aura contract).
  Moving the pin requires adding a probe or an honest classification.
- **Seed hygiene** (`seedSupport.ts`, pure + unit-tested; wired into `rules-seed.ts`): rejected questions
  leave the active pending set on reseed with an audit tombstone in the new generated
  `registry/retired.generated.ts` (append-only); a previously-pending question whose content ids vanished
  auto-retires with an audit record instead of silently disappearing; tombstoned/approved ids are never
  recycled as new pending ids (tested). First real effect: `q-policy-rune-duplicates` (owner REJECT
  2026-08-26) is now tombstoned, board down to 3 standing cards. Reseeding is idempotent.
- **PR review signal** (`ruleImpact.ts` + `npm run rules:impact -- <paths...>`): given changed paths +
  content ids, prints approved rules touched, enforcement probes to run, and the standing unenforced
  debt. Pure module, unit-tested; Doc Bot aggregate wiring is a later integration pass.
- **Sabotage tests** (§3.5): a fabricated rule with a nonexistent ref / unknown lane / reason-less
  `manual` fails the validator for the intended reason; a vanished-content question provably tombstones.

## Judgement calls

- Enforcement for generated (pending) rules lives in the hand-authored `RULE_ENFORCEMENT` map keyed by
  rule id — inline metadata in `pending.generated.ts` would be lost on reseed.
- Auto-retirement is deliberately narrow: only REJECTED questions and vanished-content questions. A
  question that drains from a scan for any other reason while carrying a decision still demands an
  explicit hand tombstone (the existing integrity test enforces that path).
- `q-watch-gravebody`'s revise ("rework later; not currently active") is classified `oracle` on the
  watcher lane — the WATCHER_EXCUSED reading is the standing pin — not `manual`.
