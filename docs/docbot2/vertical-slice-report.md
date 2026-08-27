# Doc Bot 2.0 — Vertical Slice Report (§19)

> Stage VS of the work-package plan: the intent-contract ↔ runtime-trace ↔ displayed-text triangle,
> proven end to end on a deliberately interaction-heavy content set. **Architecture proof only — not
> project completion.** Prototypes live quarantined in `packages/sim/src/docbot/slice/`; the lane is
> `verticalSlice.test.ts` (gated in `npm test`, sub-2s).

## What shipped

| Piece | Where | Blueprint |
|---|---|---|
| ContentContract v0 (optional-everything beyond identity; `reviewStatus` incl. `corroborated`) | `slice/contentContract.ts` | §6.3 |
| 13 hand-authored contracts for the §19 roster | `slice/contracts.ts` | §19 |
| Contract oracle v0 — real-engine probes + generic path-addressed comparator | `slice/contractOracle.ts` | §9.1 |
| The four §1 output classes, one real finding each | `slice/sliceFindings.ts` | §12 |
| Triangle auto-corroboration (machine verdict, never auto-approve) | `slice/corroboration.ts` | owner-review-pipeline §2 |
| DocbotFinding V2 optional fields (class, firstDivergence, competingInterpretations, minimizationStatus, provenance, semanticRevision, contractIds, suggestedText) — fingerprint untouched | `docbot/findings.ts` | §12.2, canonical-schemas §3 |
| QaScenarioV1 optional `semanticRevision` + `provenance`; result stamping via injected opts | `qaScenario.ts` | §8.1/§16, canonical-schemas §1 |
| semanticRevision v0 (`buildSha.contentRev.rulesRev.schemaRev`) — first consumer of `contentRevision()` | `packages/sim/src/semanticRevision.ts` + `packages/rules/src/registryHash.ts` | §16, canonical-schemas §5 |
| Minimized + graduated regression fixture | `docbot/scenarios/avenge-dying-source-batch-pin.json` | §13/§14 |
| Sabotage evidence for the contract-oracle family (doctored amount, copy policy, gilded delta) | `verticalSlice.test.ts` | §4.5 |

## The content set (all live on main)

Echo source **wolvesden** · Echo multipliers **sylus** (stacking) / **zyff** (non-stacking) · forced Echo
**deathsayer** · Avenge under simultaneous deaths **stuntdrake** · Avenge counter + copy subject
**kennel** · Rise **anubis** · plain-copy summoner **n2_bellringer** · exact-copy active hero power
**hero:xerox** (Copy Machine) · Shout with gilded delta **dm_butcher** · Shop Consume Demon **dm_agent**
· Shop spell copier **d2_recaller** · behavior-altering rune **rune_fury**.

## The four findings (each from a real observation, this run)

1. **Verified mechanical bug** — `slice-contract-oracle-f62a69df` (stuntdrake, **R-AVWIN-10**). A source
   dying in a simultaneous cleave batch observes its batch-mates and fires one avenge grant while dying;
   ruled behaviour is zero. Deterministically reproduced twice from the same capsule (§4.4), first
   divergence identified as a combat-log index, minimized (stats reduced; the 5-minion board is 1-minimal
   — dropping any member loses the repro), and graduated into
   `scenarios/avenge-dying-source-batch-pin.json` with a concrete event-count assertion pinning the
   violation until the engine fix (KNOWN_VIOLATIONS doctrine: the pin fails loudly the day it is fixed).
   Status `known` — the same violation is pinned in `temporalWindow.test.ts`.
2. **Verified text defect** — hero:xerox (**R-COPY-01/02**). The approved contract (owner rulings
   2026-08-14/15) makes Copy Machine an **exact** copy, and the runtime proves it (a gilded Kennelmaster
   with `summonBonus 2` copies with gilding + counter intact). The printed text — "Summon a copy of a
   friendly minion." — omits the plain/exact discriminator the copy vocabulary makes load-bearing
   (Bellringer prints "plain copy"; the Dwarf echo-twin prints "exact copy"); an unmarked copy reads as
   R-COPY-01's fresh base copy. `suggestedText` proposes "an exact copy" — never auto-applied (§23).
3. **Wording recommendation** — zyff (**R-MULT-01**). Mechanically correct (the oracle measured exactly
   one extra Echo resolution) but non-stacking while phrased "trigger an additional time". Cites the
   owner's verbatim flag (decisions.json `q-interact-nonstack-best-of`, 2026-08-27): use "Twice" for
   non-stackers. Suggested text supplied; emitted as advice for the owner's terminology pass.
4. **Questionable interaction** — anubis (no ruleIds, deliberately). A Rise minion's own Echo fires on
   **both** its deaths: one Anubis cast Lantern of Souls twice in one fight (rise-death + final death).
   R-AVWIN-09/11 govern the window and return stats across a Rise; no rule governs Echo-fire count.
   Two competing interpretations presented with evidence; capped at questionable per §9.7 until ruled.

## Corroboration outcome (machine verdict, this run)

10 of 13 contracts corroborated (all three legs agree); `stuntdrake` and `anubis` demoted to
`needs-review` by their findings; `hero:xerox` stays `approved` (owner-ruled input status — the machine
never moves it, and never promotes anything to approved, §23). A wording recommendation does **not**
block corroboration: §11.4 is clarity, not fidelity.

Honest coverage gaps are first-class data: the oracle emits an `unprobed` list (sylus/rune_fury
`stacks`, bellringer cadence, gilded Deathsayer, Lantern magnitude), each with the reason — no silent
uncertainty (§4.3).

## Schema friction (feeds WP B before the freeze)

The authoritative list lives in the devlog entry
(`docs/devlog/2026-08-27-docbot2-vertical-slice.md`, "Schema friction"); headline items:
hero-power identity has no id namespace or resolver (`hero:xerox` invented; `contentIds` validation
rejects it); amounts need a formula/reference vocabulary, not numbers ("its Attack", "the eaten offer's
bought stats"); threshold triggers (Avenge N) had no home; multipliers needed a first-class field;
copy policy is needed on the copied subject as well as the copier; `targets.count` needs a real
cardinality vocabulary (−1 sentinel used for "all"); per-trigger reachable phases should come from
phaseRegistry, not hand-stamps; a shape-changing gilded delta (Bellringer) is inexpressible as a factor;
verbatim `textContract` duplicates CardDef text and will drift; and `corroborated` must be a derived
view, not a stored status.
