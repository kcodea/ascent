# 2026-09-20 — Medal rank presentation: the post-game rank screen, the shared RankBar, crests + cues

The **presentation half** of the medal ranking feature (owner blueprint 2026-09-20, §7 + the presentation
rows of §5/§8; owner decisions: six medals Bronze → Ascendant, divisions III → II → I, 100 points per
division, division promotion on a top-4, medal promotion on 1st, a won promotion lands at **0/100**,
Ascendant I uncapped). The rules resolver + store slice + server settlement are a separate branch
(`feat/rank-rules-server`, `packages/sim/src/rank.ts`); this branch was first built against local mirror types
and then MERGED that branch the same day (see "Owner review rounds" below) — `rank/types.ts` now re-exports `@game/sim`.

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

## Owner review rounds (same day, same branch)

- **Layout + backdrop**: one centred column at every viewport (`.heroselect.rankend` collapses the picker's
  two-row grid to a single centred cell); the board dims into the LOADING SPLASH's deep-navy radial
  (`apps/web/index.html`'s boot backdrop — this replaced a first "blue wipe + slight dim" direction). No "of 8"
  under the placement; no Rewatch / Final warband on this screen (Rewatch lives in Recent Games).
- **Crest in the portrait ring**: the medal disc now sits in the game's gold hero-portrait PNG
  (`hero-select/heroportrait.png`, the ring the ceremony snaps the champion into), painted by CSS as the
  `.portring::after`; the hole was measured off the alpha (centre 49.6 % / 48.9 %, inner diameter 86 %, the
  PNG is 1524×1572 because of its drop shadow). The division numeral is a gold-coin plate on the ring's
  bottom edge. Crest ≈ 200–260 px on desktop (`clamp(200px, 26vh, 260px)` inside the zoomed `.hsbox`). The
  Career page's hero portrait (left column) wears the same ring through CSS only — its markup is untouched.
- **Text trimmed to what the visuals don't say**: a promotion / demotion prints NO detail or outcome line
  (the crest transition + new label + 0/100 say it); the gate lines stay ("Promotion game ready — …",
  "Demotion game — …"), as do "Promotion unsuccessful" and the floor / cap details. The live region still
  SAYS "Promoted to …" / "Demoted to …" because a screen reader cannot see the crest change.
- **Continue cross-fades into the menu** (`rank/exitFade.ts`): `openTitle` unmounts the end screen in the
  same commit the title mounts, so the settled overlay is CLONED onto `<body>` above the title (`.rankend-exit`,
  z480, aria-hidden, buttons disabled), the real one is released, and the clone tweens to opacity 0 over
  400 ms (150 ms reduced motion) and removes itself. The clone is taken in an effect keyed on `leaving` so it
  captures the settled DOM. Continue is single-fire (disabled after the first press, Enter included).
- **Rules branch merged** (`feat/rank-rules-server`): `rank/types.ts` now re-exports `@game/sim`'s contract
  (its `compareRank` is ascending — the surfaces use `compareRankDesc`), keeps the presentation helpers, and
  carries the MEDAL-DEMOTION GATE fields as optionals (`wasDemotionGame`, `demotionUnlocked`) until the
  resolver lands them; `rankSource.ts` reads the real slice (`rankSubmissionError` is a short CODE →
  `rankErrorText` prints the truthful sentence; `rankRunId` keys the consumed marker). `PlayerRow.rank` is
  typed now. Career's Seasonal Ranked card always shows the medal (every profile carries a rank since the
  merge); a viewed player without one keeps the bare number.
- **Medal-demotion gate (owner rule)**: a loss clamped at 0 on a medal floor prints "Demotion game — finish
  top 4 to stay in Gold" (`demotionGateText`; derived from the result shape when the rules don't carry the
  flag); a LOST demotion game holds the bar at 0 → crest transitions down a medal → the landing division's bar
  fills to the landing points (the rules agent owns the number; the fixture uses 60); an ESCAPE is a plain
  fill. The Title plate / Career bar print the demotion line from the profile's `demotionReady` flag
  (`useDemotionReady`) — a 0 at a medal floor alone is ambiguous, since a won promotion lands there too.
  Fixtures `demo-gate` / `demo-lost` / `demo-escape` in the DEV panel + tests.
- **Career card re-stacked** (`RankBar layout="stack"`): the crest large in its ring (150 px) and centred, the
  bar the full card width beneath it, the rank NAME under the bar, the scalar caption small under the name.
- **Rank-up is an authored FX** (`fx/defs/rank-up.json`, owner-authored in the workbench; params verbatim): a
  reversed shockwave ring collapsing onto the crest (0 → 280 ms) then a 329-shard additive gold burst at
  280 ms. Fired from `rank/rankTimeline.ts` at the promotion beat — division AND medal — with
  `playDef('rank-up', { source: <crest centre> })` behind `canPlayDefs()`. Sequence: the OLD crest holds while
  the ring collapses → at the hit (`RANK_UP_HIT_MS` = 280) the burst fires, the crest / plate / label / bar
  swap to the new division and the Runeforge lock-in clang plays (`sfx.runeSelect()` — `runeselect.mp3`
  already shipped, so it is reused rather than re-imported) → the new bar fills from 0. The up-transition beat
  is the def's full 900 ms so the shards are not cut off. Registered in `fx/directCalls.ts` +
  `directCalls.test.ts`, allow-listed in `playDefUids.test.ts` (crest-anchored, no unit) and in
  `defs.test.ts`'s above-modal inventory: the def draws on the ABOVE canvas (z200), which the rank overlay
  (z400) would cover, so `body:has(.heroselect.rankend) .pixifx-above { z-index: 470 }` lifts it over the
  screen while it is up (under the dev panels at 600+, under the exit clone at 480). Demotions keep the drain
  + crest change; reduced motion never builds the timeline, so the def is skipped and the crest just swaps.
  The DEV preview mounts `PixiFxLayer` itself while a fixture is open from the title (Game only mounts it with
  the board), so the owner can watch the hit without playing a game.
- **Rules branch re-merged (its rebased push with the medal-boundary gate)**: `RankResult` now carries
  `wasDemotionGame` / `demotionUnlocked` for real, so the presentation's optionals and its local
  `isDemotionUnlocked` derivation are GONE — the screen prints the demotion-gate line from `r.demotionUnlocked`
  and nothing else. The standing (Title plate, Career bar) reads `standingDemotionReady(profile.rank)`: the
  rules' STORED `demotionReady` flag on the profile / position (armed only by a loss that clamps at 0 on a
  medal floor, cleared by any non-negative result, never set by a promotion landing) — and NOTHING else: no
  fallback to a derived predicate, no local shape check, since a won medal promotion lands on the same 0 as a
  clamped loss. Without the flag the standing is simply not on a gate. The lost-demotion fixture is an 8th (−40 → Silver I
  60), matching the confirmed `100 + award` landing. Conflicting rules-owned files (rank.ts, schema, edge
  function, GAME-RULES, their devlog, parity test, README) were taken from the rules branch wholesale; the
  patch note keeps their two rule bullets and this branch's three screen bullets in one entry.
