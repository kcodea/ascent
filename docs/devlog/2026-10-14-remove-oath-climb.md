# 2026-10-14 · "Oath" and "climb" retired from player-facing text

Owner: "remove oath everywhere, and any mention of climb. this is not the terminology or story we are using"

**"Oath" is retired as a term.** The vocabulary pass of 2026-07-16 (PR #505) displayed the Line as "Oath"
(Line→Oath, Covered→Fulfilled, Exceeded→Surpassed, Missed→Fell Short). That mapping is dead: the Line is never
displayed under any name. "Climb" as the story of a run ("the climb", "climber") is retired too. Describe the game
in its own terms: an eight-seat elimination lobby, placement, Rating, Resolve. Oracle: `R-TERM-01` in
`packages/rules/src/registry/approved/foundation.ts`.

## Display only

No mechanics changed. `metLine`, `lineResult`, `defaultLine`, `profile.currentLine`, `run.line`, save fields, ids
and DB columns are untouched, so old saves and replays load as before. The legacy end screen still decides its
win/loss headline with `metLine`; it just never names the target.

## What changed

- **Removed UI that only showed the Oath:** the "Oath N" pill on the round plaque (`HudBar.tsx`, the owner's
  "0-6 / OATH 9"), the "Oath N" pill on the hero picker's Rating line (`HeroSelect.tsx`), and the end screen's
  "Oath N · verdict" row (`EndScreen.tsx`). The dead CSS went with them (`.alt .lbl.line`, `.hsline-line`,
  `.endline*`).
- **Reworded:** end screen headline (OATH FULFILLED → VICTORY; "You fulfilled your Oath" → "You won the run"; "The
  climb is complete" → "You reached the final round"; "Promoted → Oath N" → "Promoted"); five hero bios (Brackus,
  Tradesman, Runesmith, Jensen, Aster); Gorun's hero tip; Recent Games ("latest climbs" → "latest games",
  "Unnamed climber" → "Unnamed player"); the Rules Wiki rank answer; the web manifest description.
- **Renamed (display strings, ids unchanged):** achievement `ranked.promotions_10` Climber → Rising Star (the Deno
  copy in `supabase/functions/_shared/` was regenerated with `npm run progression:shared`; the deployed
  `submit-progression` function picks the new name up on its next deploy, and evaluates by id either way); build tag
  Tempo Climber → Fast Starter (only shown on the legacy end screen; older run-history rows keep the old string).

## Guard

`packages/ui/src/retiredTerms.test.ts` fails on `/\boath|\bclimb/i` in: every string literal, template and JSX
text in `packages/ui/src` (parsed with the TypeScript compiler, so comments never count; tests, tuners,
`*Config.ts`, `fx/`, perf tools and the patch-note history are skipped); patch notes dated 2026-10-14 on; card,
quest and rune names/text; hero names, bios, powers and tips; build tags; achievements; the Learn Ascent course.

## Left for the owner

Content names allow-listed in the guard until the owner rules (a rename re-keys art and the oracle refs):
**Oathshield Orin**, **Twin Sun Oath** (Dragon capstone quest), **Crest of the Climb** (spell). Recorded VO lines in
`packages/tools/vo-lines.json` (Brackus "Now climb.", Tradesman "Dear to climb.", Orin "Oath sworn.") need a
re-record to change. The tutorial's first step keeps the internal id `climb`.
