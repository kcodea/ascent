# The perf HUD grew a brain: findings, phases, a timeline, and a report

*2026-08-29*

Owner ask: *"improve our perf hud … be better at diagnosing slow downs and pinpoint potential problems and
solutions … send the perf log to a new perf-screen that shows analytics of games? then we can send reports to
claude from there to further diagnose and confirm/deny issues."*

## What was already there, and what was actually missing

`perfMonitor` was in better shape than the ask implied: 1-second buckets, jank thresholds **derived** from the
measured refresh, measured timings (real attribution) alongside marks (correlation), FX counters, longtask,
heap and DOM-node tracking, and a JSON export. It ships in production, dormant.

So the gap was never *data*. It was that reading the data required knowing things that live in
`docs/performance.md` and in people's heads: that a low measured-time share means the cost is in paint rather
than in any timed block; that DOM nodes climbing across a run is a leak that will surface as slow style
recalc; that `worst` is the metric and the mean is context. **The knowledge existed and the tool did not have
it.** Now it does, in `perfDiagnose.ts`.

## The engine is where the value is, so it is pure and tested

The sampler is rAF- and DOM-bound and cannot run headlessly. That is exactly why the *analysis* was split out
of it: `perfDiagnose.ts` takes buckets and returns findings, with no DOM anywhere, so the claims the screen
prints are unit-tested rather than eyeballed through a panel. Ten rules, 23 tests.

Three properties the tests exist to protect:

1. **Thresholds are derived, never assumed.** A 10 ms frame is fine at 60 Hz and 3.6× over budget at 360, so
   there is a test that the same timeline produces opposite verdicts at the two refresh rates. §4's rule —
   *"never write a fixed millisecond threshold for a slow frame"* — applies to the thing that reads the
   numbers as much as to the thing that records them. The run's refresh is the **median** across buckets, so
   one stray reading from a resize cannot move the budget every verdict is judged against.
2. **A correlation is never dressed as an attribution.** Findings carry `confidence`, the report labels them
   `MEASURED` / `possible lead`, and the screen gives them different chips. A test asserts a mark can never
   come back as `measured` — and another asserts the suspect list goes *quiet* once something is directly
   attributable, so the reader follows the real culprit instead of a list.
3. **Absence is reported.** "Every frame fit the budget" and "only 4% of the time is attributable" are both
   findings. A tool that prints nothing when a run is clean reads as broken.

## The screen

Dev menu → 📈. Four sections, matching the four questions you actually have: **Findings** (worst first, each
with a next step), **By phase**, **Timeline** (click any second for what fired in it), and **vs an earlier
run**. Then one button puts the whole thing on the clipboard as markdown.

Recordings persist in **IndexedDB**, not localStorage — a full run is ~½ MB and localStorage's ~5 MB budget is
shared with `ascent.save`. A dev tool has no business sitting between a player and their save file. Every
store call resolves rather than throws: private windows, blocked site data and quota exhaustion are ordinary,
and none of them should take the game down.

Phases are compared by dropped frames **per second**, not by total, so a long shop phase does not out-rank a
short combat one purely on volume.

## It stays opt-in, and that was the owner's call

The original plan was to record automatically. The owner's ruling: *"lets not have it run automatically, it
still must be enabled in the dev tuner, but let's still make the improvements to the UI and the
diagnose-ability."* Which is the right call — recording is cheap but not free, and a diagnostic that runs
unasked is a cost every player pays for a tool only we use. The zero-cost-when-disabled guarantee in
`perfMonitor`'s header survives intact.

The live diagnosis on the HUD is throttled for the same reason: `diagnose` walks every bucket, and a
40-minute session is 2400 of them. It runs **only while the panel is expanded**, and at most every 5 seconds.
A perf tool that shows up in its own measurements is worthless.

## Two bugs caught by looking at the real output

Both were in the *wording*, which in a tool whose entire value is precision is not cosmetic:

- **"particles runs 260× higher in the seconds that drop frames."** 260 was the average live count, not a
  multiple. A number that means something other than what it says is the worst kind of bug in a diagnostic;
  it now prints the actual ratio (22.5×) with the raw averages in the evidence line, and a test pins that the
  `×` is a ratio.
- **"171 frames blew past 12.5 ms and 0 past 8.3 ms."** The two counts *nest* — jank is a subset of long — and
  listing them side by side invites the reader to add them. Phrased as a subset now.

Neither would have been found from the unit tests, which is worth remembering: the tests check the reasoning,
and reading the rendered output checks whether the reasoning is *communicated*.

## One thing to know

The screen sits at `z-index: 600` — above the title screen's 450. It shipped at 220 first, which meant opening
it from the title (where the dev menu also lives) mounted it perfectly and rendered it entirely behind the
title art. Worth remembering for any future dev overlay: the dev menu is reachable from the title, so anything
it opens has to outrank the title.
