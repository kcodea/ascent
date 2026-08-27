# Doc Bot 2.0 — Owner Review Pipeline (WP A deliverable 4)

> The hard bar, verbatim (owner): **"i dont want to be deciding answers for an hour, i want to be
> able to easily fly through logic questions with concrete examples, simple questioning and buttons
> to easily decide answers in 2-5s each."**
>
> Everything in this pipeline is designed to that bar: the owner sees only questions machines and
> conventions could not answer, each question is one screen with one concrete example, each answer
> is one keypress, and every answer is a durable git-tracked write. And critically: **owner review
> is never a pipeline blocker** — content that corroborates gets fully QA'd immediately.

## 1. What the owner never sees

The triangle (intent contract ↔ runtime trace ↔ displayed text) answers most questions by itself.
Before anything reaches the board:

1. **Auto-corroboration** removes the agreeing majority (§2).
2. **Convention clustering** collapses families into single questions (§3).
3. Only genuine disagreements, ambiguities, and convention forks survive to the questionnaire (§4).

## 2. Triangle auto-corroboration → `corroborated` (distinct from `approved`)

**Mechanism.** For each extracted ContentContract, Doc Bot checks all three triangle legs:
parsed displayed text ≡ extracted contract ≡ observed runtime trace (via the isolated-case suite).
When all three agree with no unresolved parse spans and no anomaly findings, the contract's
`reviewStatus` advances to **`corroborated`** — a new value between `extracted` and `approved`:

```
reviewStatus: 'extracted' → 'needs-review' → 'corroborated' → 'approved' | 'exception'
```

**Why not just approve it?** §23 is explicit: *generated contracts must never become approved
automatically.* `corroborated` honors that to the letter — it is a machine verdict ("the three
independent descriptions of this card agree"), not an owner ruling. The distinction is visible in
every report: corroborated counts and approved counts are never merged.

**What corroborated buys — immediately, blocking on nothing:**
- The full QA machine runs against corroborated contracts exactly as against approved ones:
  isolated suites, differential variants, interaction pairs, text fidelity, regression pinning.
  **Nothing waits for the owner.** A corroborated contract that later breaks emits a finding just
  the same; the only difference is classification ceiling — a violation of a merely-corroborated
  contract caps at `questionable-interaction` + high confidence rather than
  `verified-mechanical-bug` (§12.1 requires an *approved* rule/contract for "verified").
- Owner promotion `corroborated → approved` is then a bulk act, not per-card triage: the
  questionnaire offers whole corroborated batches ("These 214 Beast minions: text, contract, and
  behavior all agree — approve the batch?") with per-item drill-down only on demand. One click can
  approve hundreds, because the machine already did the per-item work and shows its evidence.

**Disagreement routing.** Any leg mismatch demotes to `needs-review` with the mismatch attached —
and *that* is what becomes a questionnaire card: not "describe what this card should do" (an
hour-long question) but "text says X, code does Y — which is right?" (a 2-second question).

## 3. Convention clustering — one click rules a family

**The precedent (proven on main).** The rune-duplicate program: one 80-rune policy question was
REJECTED by the owner as asked; Claude answered with an 8-family proposal
(`docs/rulebook/rune-duplicate-stacking-proposal.md`); the board then carried **8 family cards
instead of 80 rune cards**; 8 clicks became standing rules R-RUNEDUP-01…08, each with the owner's
verbatim quote as evidence, all sharing one enforcement pin (`runeSwallowScan`) whose 80-item
queue shrank to zero as #1264 implemented the rulings. Same shape: R-AVWIN-01…11 (one owner doc →
11 rules → one shared lane), R-TURN-01 (one card decision → a standing language rule → a derived
28-subject sweep).

**Generalization.** Every extraction sweep clusters before it asks:
- Cluster keys come from the structure that already exists: the 28 presentation timing families,
  the 8 rune reward shapes, keyword identity (16), hero-power families
  (`heroPowerFamilies.ts`), copy modes, persistence classes, multiplier interactions.
- Each cluster produces ONE question card whose statement is the proposed family convention and
  whose example is one concrete member ("Threshold-shaped runes (23): the second copy lowers the
  threshold. Example: Rune X — 6 spells → 4. OK?").
- An approve writes one `R-<FAM>-NN` rule; every member contract records `relatedRuleIds` and is
  ruled by inheritance. A member that *deviates* from its family convention is exactly what the
  contract oracle then flags — deviation becomes a finding, not a question.
- A REJECT auto-tombstones the cluster question (the seeder's §10.4 rejection rule, already
  built) and the family re-clusters under a counter-proposal — rejection is cheap and safe.

## 4. Rapid-fire questionnaire mode for RulebookTriage

**Today** (`packages/ui/src/RulebookTriage.tsx`, 160 lines): a scrolling card list with mouse-only
buttons. **Keyboard support is ZERO** — no onKeyDown, no Escape, no j/k; the only keyboard
affordance is autoFocus on the revise input. Closing is the ✕. That is the gap between the current
board and the 2–5s bar.

**Spec — a new "fly-through" mode on the same board (same data, same writes):**

- **One question per screen.** Statement (≤ 2 lines) + **ONE concrete example** (board/hand setup →
  outcome, rendered from the rule's structured `examples[0]`; verbatim `cardText` in the existing
  gold block when the question is about a card). currentBehaviour/recommendation collapse behind a
  "more" toggle — the default screen is answerable without scrolling.
- **Keys + big buttons, both:** `Y`/`Enter` = approve · `N` = reject · `S`/`→` = skip (requeues to
  the sitting's tail) · `R` = revise (opens the existing autofocused input; `Esc` cancels back) ·
  `U`/`Backspace` = undo last (the existing `{clear}` POST) · `Esc` = leave fly-through.
  Buttons are thumb-sized for the same actions; every key has a visible button twin.
- **Domain-batched sittings of 5–10 minutes.** A sitting = one queue filter (the existing
  sourceQueue chips become sitting definitions) capped at ~70 cards; the board proposes the next
  sitting and shows its estimated time up front ("Copy semantics — 14 questions, ~2 min").
- **Progress bar:** `n of N · streak · est. remaining`, updating per keypress. Skips shown
  separately so a sitting can end honestly at "answered 61, skipped 3".
- **Every click is a durable write, immediately.** Each answer POSTs through the EXISTING
  `apps/web/rulebookPlugin.ts` middleware to `decisions.json` — one keypress = one validated,
  git-tracked file edit, exactly today's write path (fixed path, id regex, proto-pollution
  rejected, revise-requires-note). No batch-commit step that could lose a sitting; optimistic UI
  with the existing dev-server-unreachable fallback.
- **No new write surface, no second board.** Fly-through is a view over the same worklist
  (`effective === 'needs-ruling'`, hand-approved excluded); the list view stays for browsing.
  Contract promotions (§2) and wording accept/dismiss (WP E) are additional sitting types on the
  same board, all writing rule decisions / registry files through the same plugin pattern.

**Build note.** The mode is ~1 focused PR on `RulebookTriage.tsx` + a keyboard handler; the plugin
needs nothing new. Custom-cursor rule applies to the new buttons (CLAUDE.md UI conventions).
Ships early in WP B so every subsequent sweep drains through it (the VS slice prototypes it).

## 5. Projected click budget (from the real counts)

Inventory (generated 2026-08-27, events map): **483 cards · 281 runes · 117 quests · 59 heroes
= 940 active objects**; 856 presentation policies across **28 timing families**; 469 factory ids;
16 keywords.

| Bucket | Estimate | Basis |
|---|---|---|
| Convention/family questions | **~70** | 28 timing-family conventions + 16 keyword contracts + ~8 hero-power families (heroPowerFamilies.ts) + ~10 global conventions (copy modes, persistence, multipliers, targeting) + ~8 residual reward/effect shapes. The 8 rune-shape questions are already ruled (R-RUNEDUP) — the precedent, not new work. |
| Per-item escalations (triangle disagreements + ambiguities) | **~70** | 5–8% of 940 objects. Calibration: the historical peak was 274 machine-seeded questions across the whole system, and clustering + fixes drained it with **47 total owner decisions** — the observed escalation-after-clustering rate is ~5%. |
| Corroborated-batch promotions | **~10** | One batch click per domain/tribe grouping over the corroborating majority (~800+ objects). |
| Wording recommendations (WP E) | **~50** | One-click accept/edit/dismiss, own sitting; capped by the advisor's confidence floor. |
| **Total** | **~200 clicks** | at 2–5 s each ≈ **10–17 minutes of pure deciding**, spread across sittings. |

**Three-sitting core schedule** (wording rides later as WP E emits):

| Sitting | Content | Cards | Time |
|---|---|---|---|
| 1 — Conventions | timing families, keywords, hero-power families, global conventions | ~70 | 5–8 min |
| 2 — Escalations | triangle disagreements, batched by domain (copying · persistence · combat · economy) | ~70 | 6–10 min |
| 3 — Promotions + stragglers | corroborated batch approvals, skipped/revised follow-ups | ~60 | 5–8 min |

Worst honest case (~200 clicks × 5 s + reading) is ~25–30 minutes **total across the program** —
against 940 objects and ~2,000 machine-verified checks. Every sitting is optional-when-convenient
because nothing downstream blocks on it (§2); the pipeline's only owner-critical path is the
convention sitting, and even that only gates *verified* classification, never QA execution.
