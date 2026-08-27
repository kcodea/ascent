# Rendered-text reconciliation — the DOM shows what the sim computed (blind-spot class 8)

The live-text rule had helper-level enforcement (`liveTextAudit`, `docbotLiveText`) but nothing asserted the
RENDERED output equals the helper output. The sim could compute the right number and the UI could still show a
stale one — through either of the two chains (`liveCardText` via `instView` for shop/board/hand/Discover/end
screen; `Unit.tsx`'s param mapping for combat), which can drift independently.

## What shipped (test-only — no component behaviour changed)

- **`packages/ui/src/renderedText.test.tsx`** — the reconciliation harness, mounting the REAL `Card` and
  `Unit` under jsdom:
  - **Subjects derived from `cardText.ts`'s own dispatch** (factory-id regex + explicit card-id gates +
    structural gates mirrored with cites), so a new scaling card is auto-swept. 73 subjects as of today.
  - **Shop chain**: all 70 armable subjects render through `Card` and the `.desc` textContent must EQUAL the
    helper string (modulo the sanctioned marker→style transforms), plain and golden; every `{{…}}` payload
    must render inside a green `.descup` span.
  - **Combat chain + cross-chain**: 8 exemplars (per-instance and run-scoped scalers) mounted through `Unit`
    against a store run must render the SAME string the shop chain (`liveBoardView`) computes for the same
    state.
  - **Badges**: rendered attack/health digits equal state; buffed reads `.up`, below-combat-floor reads
    `.down`.
  - **Sabotage proof**: a deliberately stale base string trips the reconciler.
- **`packages/ui/src/renderedText.mount.tsx`** — minimal mount util (createRoot + act, no testing-library)
  plus `plainOf` (the sanctioned render transforms reduced to plain text).
- **`packages/ui/src/renderedText.registry.ts`** — the phaseRegistry-style excuse table: 3 subjects the bags
  legitimately can't arm (`b2_oona`, `bloodbinder`, `d2_grimoire` — each with a verifiable
  accurate-at-any-value reason), needs-triage ratcheted at **0**.
- **jsdom scoping**: `vitest.config.ts` now includes `packages/ui/src/**/*.test.tsx`; the jsdom environment is
  a per-file docblock in the harness only — the sim/core suites stay in the node environment untouched.
  `jsdom` added as a root devDependency.

## Real drift found (NOT fixed here — test-only PR)

**Vaultkeeper (`d2_herzog`) under-reads in combat and on the end screen.** The effect scales on the spell
UMBRELLA (Shop Spells + Rubies), and the Recruit chain passes `rubyCasts` — but `Unit.tsx` and
`liveBoardView` both omit it. With 4 spells + 4 Rubies cast the shop card reads `{{+6/+6}}` while the combat
card reads `{{+4/+4}}`. Same omission class in `Unit.tsx`: `improveReps` (Rune of Mastery ×2 for Spirit
Worgen / Conductor) is never passed, and `liveBoardView` also omits `alesThisTurn`. The cross-chain test
compares `liveBoardView` ↔ `Unit` (which agree with each other today), so fixing these means threading the
fields and the harness then holds the line.

## Deliberately not folded

- `beats:audit` is a top-level CLI script (`packages/tools/src/beat-audit.ts` — argv + print side effects at
  module scope), not an importable function; its CI-enforcing half already lives in
  `packages/content/src/presentationPolicies.test.ts`. Folding the CLI is deferred to the integration pass.
- Crypt Drake's "N to go" countdown is combat-only BY DESIGN (`cryptDrakeText`'s shop fallback) — the
  exemplar deliberately doesn't set `attackSeen`, with the cite inline.
- Spell / Ruby text goes through `spellDisplayText` / the Ruby branch — a different chain, out of scope here.
