# Doc Bot 2.0 — the vertical slice: the triangle proven on an interaction-heavy set

The §19 stage between WP A and WP B: intent contract ↔ runtime trace ↔ displayed text, compared end to
end on real content through the real engine, with all four §1 output classes emitted from actual
observations. Prototypes are quarantined in `packages/sim/src/docbot/slice/` (the WP B/D registries
supersede them); the canonical-schema extensions (findings V2 fields, QaScenarioV1 optional fields,
semanticRevision) are permanent. Full narrative: `docs/docbot2/vertical-slice-report.md`.

## What landed

- **ContentContract v0 + 13 hand-authored contracts** for the §19 roster (wolvesden, sylus, zyff,
  deathsayer, stuntdrake, kennel, anubis, n2_bellringer, hero:xerox, dm_butcher, dm_agent, d2_recaller,
  rune_fury). Amounts read from printed text + owner rulings, never from the factory params under test
  (§4.2). `reviewStatus` carries the owner-review pipeline's `corroborated` state.
- **Contract oracle v0** (`slice/contractOracle.ts` + `verticalSlice.test.ts`, in `npm test`, <2s):
  probes execute through `simulate()` / `createRun`+`reduce` / `runQaScenario` and record path-addressed
  observations; a generic comparator owns expected-vs-observed, so sabotage (doctored threshold, copy
  policy, gilded delta) fails without re-running the engine — §4.5 evidence in-file. Unprobed contract
  fields are emitted as a first-class list with reasons (§4.3).
- **The four findings** (see the report): R-AVWIN-10 verified mechanical bug (double repro, first
  divergence, minimized, graduated); hero:xerox verified text defect ("a copy" vs the ruled exact copy);
  zyff wording recommendation (owner's "Twice"-for-non-stackers flag, cited verbatim); anubis
  questionable interaction (a Rise minion's own Echo fires on both its deaths — unruled, two competing
  interpretations).
- **Graduation in miniature (§14)**: `docbot/scenarios/avenge-dying-source-batch-pin.json` — the
  R-AVWIN-10 repro minimized (1-minimal board, stats reduced) and pinned with a concrete event-count
  assertion + `provenance.findingFingerprint` back-link. It pins the *violating* behaviour (the
  KNOWN_VIOLATIONS doctrine): asserting the ruled behaviour would be red until the engine fix; the pin
  fails loudly the day the fix lands, and the notes say what to flip. `seedMinimize` was NOT reused —
  it minimizes recruit `TrajectorySpec` action sequences and this is a combat board fixture; the §13
  ladder was run by hand (drop-one over entities, then stat reduction) and recorded in
  `provenance.minimizedFrom`.
- **semanticRevision v0 (§16)**: `packages/sim/src/semanticRevision.ts` composes
  `buildSha.contentRev.rulesRev.schemaRev` from the previously-unused `contentRevision()`
  (first QA consumer of revisions.ts) + a new `rulesRevision()` (`packages/rules/src/registryHash.ts`,
  hashing the *resolved* rulebook so an owner click moves it and a comment edit does not). Stamped on
  every slice finding and on `QaScenarioResult` via an **injected** `runQaScenario` opts parameter —
  deliberately not imported inside qaScenario.ts, which would ride the rules registry into the web
  bundle (the D-2 trap). For the same reason `semanticRevision` is not exported from `@game/sim`'s
  public entrypoint; `@game/sim` now depends on `@game/rules` (canonical-schemas §5).
- **Findings V2 fields** on `DocbotFinding` (class, firstDivergence, competingInterpretations,
  minimizationStatus, provenance, semanticRevision, contractIds, suggestedText) and **QaScenarioV1
  optional `semanticRevision` + `provenance`** — all optional, fingerprint and validator literal-1 gate
  untouched, zero fixture migration.

## Owner decisions consumed (none made)

No engine change (§23): R-AVWIN-10 stays violated and pinned. The anubis Echo×Rise question and the
xerox text fix are queued as findings, not acted on.

## Schema friction — every place §6.3 fought the real content (WP B reads this before freezing)

1. **Hero-power identity.** `contentType: 'hero-power'` exists but there is no id namespace or resolver:
   `hero:xerox` was invented, and `QaScenarioV1.contentIds` validation (CARD/RUNE/QUEST indexes) would
   reject it — the exact-copy fixture attributes to `kennel` instead. WP B needs an id scheme +
   resolution for hero powers (and probably quests-as-content parity).
2. **Amounts want formulas, not numbers.** "Give this minion's **Attack**" (stuntdrake) and "gains the
   eaten offer's **bought stats**" (dm_agent) have no numeric plain/gilded pair; the slice proxied them
   through counts. §6.3's "amounts and formulas" needs a reference vocabulary
   (`stat-of-source`, `offer-buy-stats`, `per-N-counter`) before extraction can be honest.
3. **Threshold triggers had no home.** Avenge (N) is neither a plain trigger nor a §6.3
   `TriggerLimitContract`; a `threshold` field was added to the trigger. Decide where threshold /
   progress / reset live (trigger vs counters) once, before 483 cards are extracted.
4. **Multipliers are not trigger+effect.** Sylus/Zyff/rune_fury needed a first-class `multiplier`
   field ({families, extra, stacks, resolutionOnly}) mirroring CardDef.triggerMultiplier; §6.3 lists
   "multiplication behavior" as a bullet but its interface has no slot.
5. **Copy policy belongs on both ends.** The schema puts `copyPolicy` on the copier (bellringer, xerox),
   but the R-AVWIN-03/04 rulings are about the copied SUBJECT's counters (kennel). A subject-side
   "what of mine rides a copy" claim is needed, or the oracle cannot attribute copy findings to the
   card whose state is at stake.
6. **Cardinality vocabulary.** `targets.count: -1` is the slice's sentinel for "all" — replace with a
   real vocabulary ('all', 'up-to-N', 'exactly-N') before the §10.1 case generator keys on it.
7. **Reachable phases are already computed.** The slice hand-stamped `phase: 'combat'` on Echo triggers
   and noted forced-Echo shop reachability in prose; WP B should derive per-trigger phases from
   phaseRegistry (the factory×phase substrate) instead of hand-stamps that will drift.
8. **Shape-changing gilded deltas.** Most slice gilds are a clean ×2 factor; Bellringer's gild changes
   the SHAPE (left neighbour → both adjacent). `gildedDelta.kind: 'other'` + prose was the escape
   hatch; the real schema needs a delta that can reference a different effect body.
9. **Verbatim textContract duplicates CardDef text.** The displayed-text leg was copied by hand and
   will drift silently. The extractor must source it from CARD_INDEX at check time and reserve
   hand-authoring for *claims about* the text, not the text itself.
10. **`corroborated` must be derived, not stored.** A stored review status cannot hold a machine verdict
    that changes with every engine commit; the slice stores 'extracted' and computes corroboration per
    run (`slice/corroboration.ts`). Recommend WP B keeps reviewStatus ∈ {extracted, approved, exception}
    on disk and derives needs-review/corroborated exactly like `effectiveStatus` derives rule status.

## Verification

`npm run typecheck` · `npm run lint` (0 errors) · `npm test` (504 files, 7339 passed — includes the new
16-test slice lane) · `npm run build:web` — all green.
