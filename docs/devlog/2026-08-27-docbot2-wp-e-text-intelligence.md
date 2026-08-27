# Doc Bot 2.0 — WP E: text intelligence (parser, language guide, rewrite advisor; Sitting 3 prepared)

**Scope (blueprint §11 / §18-E; work-package-plan.md WP E).** The displayed-text leg of the triangle
becomes a first-class oracle surface: a conservative partial parser over every active object's printed
text, semantic comparison against the WP B/D contract registry, the §11.3 language guide grown from 2 to
26 rules, a rewrite advisor, gilded-text verification, and the Sitting-3 wording question deck —
generated, dormant, decisions-preserving.

## What shipped

- **`packages/sim/src/docbot/textParse/`** — the WP E module:
  - `types.ts` — `ParsedTextContract` (§11.1 shape verbatim: triggers/targets/effects/amounts/limits/
    persistence/randomness/phaseRestrictions + **unresolvedPhrases** spans) and the full §11.2 mismatch
    taxonomy, with `IMPLEMENTED_TAXONOMY` naming the 10 detectors that actually ship — the rest stay
    typed so later tranches slot in and the report can say which detectors exist (§4.3).
  - `lexicon.ts` — the keyword lexicon as `Record<Keyword, …>` (a new union member is a COMPILE error
    until named), the trigger lexicon (printed prefixes → the contract trigger vocabulary), and
    `TERM_VARIANTS` — the measured wording-inconsistency table that feeds both the guide's evidence and
    the Sitting-3 generator.
  - `parser.ts` — sentence-by-sentence prefix parsing: one leading trigger (or conditional clause), then
    anchored effect recognizers consume from the left; the first unrecognized position ends the sentence
    parse and the whole remainder lands in `unresolvedPhrases` verbatim. A recognizer never guesses.
  - `classify.ts` — `runTextSweep`: every active object (enumerated BY the contract registry, so the
    surface is definitionally WP B's inventory) classified into the four §18-E buckets; mismatch
    detectors guarded exactly like the corroboration lane (single-effect exact-pair attribution, named
    tokens only, spells excluded from trigger comparison, sell-event aliases); findings classed per §6.1
    authority (approved contract ⇒ `verified-text-defect`; draft ⇒ questionable, never a conviction).
    `KNOWN_TEXT_MISMATCH` pins every investigated mismatch (verify-before-alarm); `TEXT_EXCEPTIONS` is
    the owner-ruling-only exception registry (empty — nothing is auto-approved).
  - `rewriteAdvisor.ts` — guide entries carry optional machine predicates; the advisor flags violating
    text and proposes mechanics-preserving replacements as `wording-recommendation` findings. It stays
    silent on `contested` rules (the deck asks first) and `reserved` ones (the owner's in-flight
    Rebirth rename), plus a measured frame-length readability bound.
  - `wordingQuestions.ts` — the Sitting-3 deck, derived live from the corpus: one card per guide rule
    where BOTH spellings still occur (self-retiring), verbatim exemplars from each side, the ✓/✕/✎
    micro-tail, ≤ 30 words (the rules.test.ts ratchet now covers this deck too).
  - `textParse.test.ts` — the PR-gate lane (~30 ms): bucket exhaustiveness, the no-unresolved-as-clean
    invariant, the grow-loudly unresolved cap (540) + collapse floor (340), pin/stale symmetry, three
    sabotages (doctored amount / doctored guide rule / doctored gilded factor — each detected), §6.1
    class honesty, advisor mechanics preservation, deck determinism + format bar.
- **`packages/rules/src/languageGuide.ts`** — v1: 26 rules across every §11.3 topic, each seeded from
  the 2026-08-27 corpus survey (1059 printed texts) with counts quoted in evidence, or from standing
  owner rulings. `contested` marks the Sitting-3 pairs; `reserved` marks the Rise/Reborn split (the
  owner's own Rebirth rename — recorded, never advised or asked about).
- **`packages/rules/src/registry/pendingWording.generated.ts`** — the 11-card Sitting-3 deck (DORMANT;
  `npm run docbot:text` regenerates it through the same seed hygiene as `contracts:extract` — decisions
  survive, rejects tombstone). Folded into `allRules()`/`undecided()` like every pending source; the
  `textParse` enforcement lane added so an approval never lands unenforced.
- **`npm run docbot:text`** — the full classification report + deck regeneration CLI.

## First-run results (the §18-E buckets, 901 active objects)

| bucket | count |
|---|---|
| parsed-equivalent | 358 (123 textless — quests + vanilla bodies, counted separately) |
| verified-mismatch | 9 |
| approved-exception | 0 (registry exists, owner-only) |
| unresolved-parse | 534 (the visible queue, capped grow-loudly) |

**Real text defect (1):** `hero:xerox` — the slice's verified-text-defect **rediscovered mechanically**:
the approved contract rules the copy EXACT while the printed "Summon a copy" reads plain under
R-COPY-01. Pinned `confirmed-defect-pending-fix`; the wording fix is a content edit for its own PR.

**Extractor honesty gap caught (7):** every Choose One card (shaper, godfodder, contractimp, crestclimb,
k_veinbreaker, n2_spellsword) plus betterbot (Magnetic-weld Rally) parses to ZERO contract effects while
the WP B extractor stamps `confidence: 'high'` — the drafts are incomplete, not the texts. Pinned
`draft-contract-gap`; the extractor should learn choose-one payloads (WP B/H follow-up).

**Advisor recommendations (4):** zyff + uron ("an additional time" on non-stackers → "twice",
LG-TWICE-01) and selfless ×2 ("Divine Shield" → "Ward", LG-KEYWORD-01). Suggestions only — §23.

**Sitting-3 deck (11 questions, ≈ 2 min):** Shout/Battlecry (112 v 44), Echo/Deathrattle (94 v 55),
Ward/Divine Shield, Gilded/Golden (8 v 7), Shop/tavern (204 v 9), run/game, wherever-they-are/everywhere,
trigger/fire/proc, N Gold/Ng, left-most/leftmost, Consume/devour.

## Judgement calls

- Quests print no free text (name/objective/reward render from data) — classified textless, vacuously
  parsed-equivalent, counted separately in every report.
- The first run's "goldenText ⇒ reshape" structural alarm was investigated and found WRONG (curated
  contracts legitimately declare ×2 beside written-out gilded text — wolvesden). Replaced with the
  honest amount/count ×factor comparison; where the parses can't compare, no claim is made.
- "Dormant" for the deck mirrors Sitting-1 exactly: cards live as needs-ruling on the standard board;
  nothing schedules the sitting.
