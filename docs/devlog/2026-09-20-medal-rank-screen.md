# 2026-09-20 — Medal rank presentation: the post-game rank screen, the shared RankBar, crests + cues

The **presentation half** of the medal ranking feature (owner blueprint 2026-09-20, §7 + the presentation
rows of §5/§8; owner decisions: six medals Bronze → Ascendant, divisions III → II → I, 100 points per
division, division promotion on a top-4, medal promotion on 1st, a won promotion lands at **0/100**,
Ascendant I uncapped). The rules resolver + store slice + server settlement are a separate branch
(`feat/rank-rules-server`, `packages/sim/src/rank.ts`); this branch was built **against local mirror types**
because that branch had not been pushed when this one was cut.

## What shipped (`packages/ui/src/rank/`)

- **`types.ts`** — an IDENTICAL local mirror of the rules contract (`RankPosition`, `RankedProfile`,
  `RankResult`, `RankSubmission`) plus the one index → label mapping (`medalOf`, `divisionNumeralOf`,
  `rankLabel`, `rankScalar`, `compareRank`, `isMedalGate`, `isPromotionReady`, `rankPositionOf`). Marked
  **"replace with `@game/sim` rank.ts at merge"** — it should shrink to re-exports when the rules branch lands;
  every consumer imports through it, so nothing else changes.
- **`rankFormat.ts`** — the ONE formatting helper every surface prints from: `pointsText` ("76 / 100" or
  the uncapped "130 RP"), `placementText` ("VICTORY" / "2ND"), `deltaText` (the ACTUAL movement; "0 RP ·
  Bronze floor"; a won promotion prints the base award because the owner's 0/100 reset makes the scalar
  movement 0), `cappedDetail` ("base +40 RP · capped at the gate", "promotion — Gold I starts at 0 / 100"),
  `outcomeText`, `gateText` (top 4 vs 1st), `announcement` (the live region).
- **`RankBar.tsx`** — `RankCrest` (the medal crest composited inside the game's circular hero-portrait
  frame: the same `.lb-heroframe > .hero > .f > img.heroimg` markup `LbHeroFrame` re-seats from the StatusBar,
  with the division numeral as a **plate** on the frame's bottom edge) and `RankBar` (crest + label + a
  `scaleX` fill + points + the promotion-ready line), in four sizes: `mini` (Title's Play card), `row`
  (Rankings), `big` (Career), `xl` (end screen).
- **`rankSequence.ts` + `rankTimeline.ts`** — the beats as DATA (`planRankSequence(result)` → Reveal /
  Establish / Bar / Gate / Transition / Outcome steps) and their GSAP execution (`buildRankTimeline`), split so
  the plan is node-testable. Compositor-only: `scaleX` on the fill, scale+opacity for the crest swap, opacity
  for every text beat; the counter writes `textContent` from a tweened proxy (no React re-render per frame,
  no layout reads). Cues fire from `.call()`s so a skip stays silent.
- **`RankScreen.tsx`** — the screen: placement headline (VICTORY in green for 1st) → crest + bar → delta →
  outcome → CONTINUE (always usable → `openTitle`), Rewatch / Final warband as secondary links (the warband is
  expandable). Click the rank display or "Skip animation" to settle instantly; neither touches the submission.
  Submission states: pending ("Updating rank…", current crest), confirmed (animates), retryable ("Rank update
  pending" + Retry), unrated (placement + "Unrated · Practice"), rejected (the truthful error, `role=alert`).
  Reduced motion: no timeline, everything present, the overlay's short CSS fade only. Focus lands on Continue;
  one `aria-live` announcement on settle. Timelines are killed on unmount. When the sequence settles the bar
  **remounts on the after-state** (`key`), so React's view and GSAP's inline styles can never disagree.
- **`presented.ts`** — the presentation-consumed marker (localStorage, last 24 run ids + in-memory mirror),
  kept SEPARATE from rank state: a remount after Rewatch, a reload, or a duplicate confirmation settles silently.
  Marked on finish/skip, on the reduced-motion path, and in the effect cleanup when a timeline had ticked
  (`tl.time() > 0` — so StrictMode's synchronous re-run in dev does not consume it).
- **`rankSource.ts`** — the seam to the store slice. Duck-typed reads of `rankSubmission` / `rankResult` /
  `rankError` / `retryRankSubmission` / `profile.rank` via `useShallow`, so the presentation compiles and runs
  before the slice exists and lights up the moment it does. **No slice → `null` → the lobby end screen keeps
  its legacy rating block**; practice is always unrated regardless.
- **`fixtures.ts` + `RankScreenPreview.tsx`** — 15 fixture states (gain, loss, gate unlocked, gate unlocked
  at a medal step, promotion won, medal promotion won, promotion failed, demotion, Bronze floor, floor at 0,
  Ascendant uncapped, pending, retryable, rejected, unrated) and a DEV menu panel ("Rank Screen", 🎖️, under
  Stage & Layout) that plays each one over the live app in `preview` mode (never writes the marker), plus a
  "Pending → confirmed" arrival flow, a reduced-motion toggle, and the four cue test buttons.

### Surfaces

- `EndScreen.tsx` — the lobby end screen mounts `RankScreen` when the store carries a rank slice (or the run
  is practice), inside the same `.heroselect.endscreen.lobbyend` chrome (`+ .rankend`, fade-in stretched to
  the 450 ms Reveal beat). Legacy block otherwise.
- `Title.tsx` — the Play card wears a frosted `.mcrank` plate (mini RankBar with the gate line) once the
  profile has a rank; the hover caption reads "Gold II · 60 / 100". "Rating N" until then.
- `Career.tsx` — ONLY the Seasonal Ranked card: `RankBar size="big"` with the scalar as a caption
  ("800 MMR") when a rank exists; the bare number otherwise (the existing tests still pin that).
- `Rankings.tsx` — rank-aware rows (row RankBar in the rating cell, header "Rank") and `sortRankAware`:
  division desc, then points, ranked rows ahead of legacy rows in their server order.

### Art, sound, CSS

- Six crests → `packages/ui/src/art/ranks/{bronze…ascendant}.webp` through `npm run optimize-art` (which
  now walks `ranks/`); no PNG masters committed; ratchet 1256 → 1262 (+6, dated line). `art.ts` gains
  `rankArt(medal)` and preloads the crests with the rest.
- Four modest cues on a new `rank` mixer category (ui bus): `sfx.rankProgress / rankGate / rankPromote /
  rankMedal` — each tries an authored clip (`rankprogress` / `rankgate` / `rankpromote` / `rankmedal`,
  routed in `clipFamily.ts`, none committed) and falls back to a short synth. A demotion plays only the
  progress cue.
- `styles.css` — one appended block (`MEDAL RANK`). No bare `cursor` keywords: the skip target is a
  `role=button` (global gauntlet rule), the links are `<button>`s; the settled rank display gets the gauntlet
  default URL form. Nothing loops.

## Verification

- `npm run typecheck && npm run lint && npm test && npm run build:web` green.
- New tests: `rank/rankFormat.test.ts` (labels, gates, ordering, delta/detail/outcome per fixture, the planned
  sequence per fixture, 2.2–3.3 s budget), `rank/RankScreen.test.tsx` (jsdom: every fixture's labels + delta
  text at caps/floors/promotion/uncapped, Continue present + focused + fires once, Retry fires once and never
  Continue, rejected is an alert, unrated has no bar, live region, warband/Rewatch secondary, animated path:
  before-state + staged next crest + skip settles, keyboard skip, presented marker stops a replay, preview
  never marks, reduced motion marks, pending → confirmed arms then settles), `rank/rankSurfaces.test.tsx`
  (crest = hero frame + plate, RankBar text/gate/caption/uncapped, `sortRankAware`).
- Visual QA on port 5199 through the DEV panel: gain, promotion won (Gold II full → transition → Gold I
  0/100 + "Promoted to Gold I"), demotion (drain → transition → Gold III retreating 100 → 70), gate unlocked
  (VICTORY green, +12 RP, "base +40 RP · capped at the gate", tip lit), pending, retryable, rejected, unrated,
  Ascendant (130 RP), Bronze floor at 0 ("0 RP · Bronze floor"); Title plate + Career card with a faked
  `profile.rank`. NB the embedded Browser pane only ticks rAF while capturing, so the motion was verified by
  scrubbing the live timeline (`tl.time(t)`) at each beat rather than by wall-clock waits.

## Follow-ups / at the merge

- When `feat/rank-rules-server` lands: collapse `rank/types.ts` to re-exports from `@game/sim`; confirm the
  slice field names (`rankResult`, `rankSubmission`, `rankError`, `retryRankSubmission`, `profile.rank`) match
  `rankSource.ts` (any mismatch reads as "no slice" — the legacy block — not as a crash); add `rank` to
  `PlayerRow` so Rankings stops duck-typing it.
- Authored cue clips (`rankprogress` / `rankgate` / `rankpromote` / `rankmedal`) when the owner has them —
  they slot in with no code change.
- `docs/GAME-RULES.md` rank wording belongs to the rules PR (it owns the rules).
