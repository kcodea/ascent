# Beat System — Status & Definition of Done

**The finish line for the beat-system migration is [Codex's 12-item Definition of Done](../../Documents/Codex/2026-06-29/files-mentioned-by-the-user-codex/beat-system-remaining-work-handoff.md)** (owner ruling 2026-08-13). This file tracks each item's real state so classification-vs-live-presentation gaps can't hide behind a green audit.

> The trap this project exists to close (Codex): *a new automatic effect can be **correct in gameplay**, **green in the policy audit**, and still have **no readable moment on screen**.* Done means the live game plays one authoritative, source-attributed, tunable batch — without changing gameplay order or Mike's FX.

## Legend
- ✅ **DONE (merged to `main`)**
- 🟡 **BUILT (on an unmerged PR)** — code exists, awaiting merge
- 🔴 **TODO** — not built

## Definition of Done (Codex's 12) — status

| # | Item | Status | Where / gap |
|---|------|--------|-------------|
| 1a | Minion/spell/rune/quest automatic effects classified | ✅ | 654 keys, `#988`/`#998` |
| 1b | **Hero** automatic effects classified | 🟡 | `#1007` — 27 heroes classified (sim-side `heroSurface` + tripwire + Beat Lab Heroes filter), flagged for owner review; **emission is per-power follow-up** |
| 2 | Every reachable `ownBeat` effect **emits** a source event | 🟡/🔴 | recruit `onPlay` + End-of-Turn emit (✅ merged); **combat / start-of-turn / hero do not** |
| 3 | Every emitted own beat is **consumed by live presentation** | 🔴 | **the cutover** — live EoT still animates via the legacy path |
| 4 | End of Turn resolves **exactly once** | 🔴 | cutover (today: reducer resolves, then `projectEndOfTurnSteps` re-projects) |
| 5 | Live EoT no longer reconstructs via `projectEndOfTurnSteps` | 🔴 | cutover |
| 6 | Live playback no longer uses fixed `BEAT`/`GAP` constants | 🔴 | cutover — but the **timing resolver is built** (`#1000`, precedence source→family→policy→global); needs wiring to live |
| 7 | Fleeting Vigor & delayed next-combat effects claim their payout moment | 🔴 | surfaced as EMPTY + Twilight-doubling fixed (`#1003`/`#1004`); **emission not wired** |
| 8 | Folded combat reactions visibly identify their source | 🟡/🔴 | King Oona effectively fixed; **Beardsley / Hatchery / Undertow / Ruby-multiplier attribution TODO** |
| 9 | Beat Lab timings affect **live** gameplay presentation | 🔴 | cutover + wire the shared resolver into live playback |
| 10 | Beat edits cannot mutate Mike's FX | 🟡 | separation holds (beats live in `beat-defaults.json`, never touch FX); **byte-identical FX-isolation tests + read-only FX lane TODO** |
| 11 | New content with an unclassified **or un-emitted** effect fails CI | 🟡 | classify-tripwire ✅ (`presentationPolicies.test.ts`); **emission-coverage CI TODO** (every reachable ownBeat emits in a fixture) |
| 12 | Browser verification: visible timing matches event order | 🔴 | manual, after the cutover |

## Already built but UNMERGED (Codex audited the old `#996` head and under-credited these)
- `#1000` — timing resolver (`beatTiming.ts`, exact Codex precedence) + numeric editor + provenance + synthetic preview.
- `#1001` — drag-timeline editing.
- `#1002` — commit-to-`beat-defaults.json` dev endpoint (Codex's "export/commit to source-controlled defaults").
- `#1003` — source-grouped library (browse by card/rune/quest name) + EMPTY-trigger surfacing (Fleeting Vigor's SC).
- `#1004` — Rune of Twilight doubles pending SoC effects; Beat Lab preview gates consequences by timing.

**Merge order:** `#1000 → #1001 → #1002 → #1003 → #1004`. Merging these closes/advances items 6 (resolver), 10 (commit separation), and most Beat-Lab requirements — and lets a fresh `beats:audit` reflect reality.

## The remaining TODO work (what my earlier roadmap missed)
1. **The live cutover** — replace `projectEndOfTurnSteps` + `BEAT`/`GAP` with an authoritative batch player wired to the shared resolver. *Highest value (Codex + owner agree).* Closes 3,4,5,6,9,12. Needs a playtest.
2. **Heroes** — registry + `presentationSurface` + `sourceLibrary` + emission (Re-Pete, Goldcrafter, Chaos attachments, hero-power payouts…). Closes 1b.
3. **Comprehensive emission** — every reachable combat / start-of-turn ownBeat emits a `sourceTrigger`; plus Fleeting Vigor's SC payout and the other pending next-combat fields. Closes 2, 7.
4. **Folded-cue source attribution** in combat — Beardsley, Hatchery, Undertow, Ruby multipliers. Closes 8.
5. **Multi-phase sources** in the library — a rune/quest can have acquisition + EoT + combat moments; today the library shows only its first registry phase.
6. **Emission-coverage CI** — a fixture-driven tripwire stronger than the classify check. Closes 11.
7. **FX isolation** — read-only nested FX lane + tests proving beat-only edits leave FX files byte-identical. Closes 10.
8. **Legal-sibling reorder** — drag beats vertically within dependency constraints (last authoring feature; most useful after the cutover).

## Recommended work order (Codex)
1. Reconcile the branch / recover the unmerged Beat-Lab work → **merge `#1000–#1004`.**
2. Add the live authoritative End-of-Turn batch player (the cutover).
3. Verify Coffers, Shopkeep, Lapidary, repeats in-browser.
4. Connect live playback to the shared timing resolver.
5. Add Fleeting Vigor's Start-of-Combat payout event (+ audit other pending next-combat fields).
6. Add hero + start-of-turn coverage.
7. Expand the source-grouped library to multi-phase sources.
8. Add emission-fixture CI + FX-isolation tests.
9. Full browser acceptance scenarios (the EoT + Start-of-Combat acceptance fixtures) and tune timings.

## Deferred watch-items (revisit at the end)
- **Spurious minion trigger-pulses when a spell "beats"** (owner report 2026-08-13). In the LIVE game, when a
  spell like Fleeting Vigor plays its beat, board minions show their trigger medallions pulsing as if THEY
  triggered — a mis-attribution in the current End-of-Turn playback. May self-resolve once the cutover's
  event-driven player only pulses the actual source; if not, fix it after the cutover lands.
- **Roll the End-of-Turn shop buff instead of jumping** (owner, 2026-08-12) — see roadmap "Now".
