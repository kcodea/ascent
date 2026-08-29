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

---

## Follow-up the same day: the HUD reads like a HUD, and the report names content

### It is black now, and bigger

Owner: *"make the perf-hud black with white/colored text so it's easier to read … make the text larger."*

It wore the game's parchment card, which is right for a player-facing panel and wrong for this one: the HUD
sits **on top of** a bright busy board, at small sizes, and is read at a glance while something is going
wrong. Dark ground with high-contrast type wins that fight. Type went up across the board (fps 17→24px, rows
11→13px) for the same reason — it is a readout, and it was sized like chrome.

### Why the ✕ did nothing

*"make it so the X actually closes the window."* It was wired correctly the whole time. The buttons sit inside
the header, which is the **drag handle** — so `pointerdown` on the ✕ started a drag, the header captured the
pointer, and a captured pointer never delivers the click that follows. The button highlighted on hover and did
nothing, which is exactly what a dead control looks like.

Each control stops propagation now. Moving them out of the header would have cost the whole top edge as a drag
target; this keeps both. **Minimize** is a separate control from collapse: minimize folds to the title bar
(and drops the persisted inline height, which no stylesheet rule could outrank), collapse hides the detail rows
and keeps the sparkline.

Closing stops recording but **keeps the log** — the tooltip says so, because losing a session to a misread
button would be the worst possible outcome for this particular tool.

### The report points at cards, effects and mechanics

*"i want the perf hud to be so good that it points at cards or mechanics or effects that are causing
slowdowns."*

Three chokepoints already existed; they just were not carrying their subject.

- **`playDef`** is the one path every authored effect takes, so timing it there attributes the SPAWN cost to
  the def by name — `fx:titan-hammer`, not a generic tally. That spawn is precisely where §3b's 160 ms
  collision freeze lived.
- **The store's dispatch** already timed `reduce:<action>` — mechanic-level cost. It now folds in the card id
  when the action names one, so a timing reads `reduce:play:dw_foreman` and the finding can point at the card.
- **`subjectOf()`** decodes those labels into something a person can act on, and each KIND gets its own
  suggested fix: shader pooling for an effect, "read its effects, compare against a vanilla minion" for a
  card, "what runs on every dispatch" for a mechanic. Advice about pooling a shader wastes an afternoon when
  the cost is a reducer pass.

An unrecognised label degrades to generic phrasing rather than breaking, so instrumenting something new never
requires editing the decoder to stay correct — a test pins that.

All of it is free when the monitor is off: `measure()` is a bare passthrough with no clock reads.

### The "empty" cue

The owner's `equipment-used-up` effect fires when the Equipment allowance reaches zero — on the **transition**,
not the state. Spending the first of two uses is silent; spending the second fires. A bonus use takes it off
zero and spending that one fires again, which falls out of watching the edge rather than the value with no
special case for how it got back above zero. A fresh mount already at zero is silent, because StatusBar
remounts on every return from combat.

Verified by sabotage: swapping the edge test for a value test fails the suite.

### The two ✕s, and why the wrong one was the one you could see

Owner: *"fix the ui bar too it has 2 x's"* — and, from the pass before, *"make it so the X actually closes
the window."* Both were the same root cause, and the earlier fix addressed the wrong button.

`useDraggablePanel` **injects** a `.devpanel-close` ✕ into every panel it manages, pinned to the panel's
top-right, and wires it to `DevPanelContext`'s `close`. The perf HUD was mounted in `Game.tsx` **outside any
provider**, so that button called the context's default no-op — while the header carried a second ✕ of my own
that did work but was the less prominent of the two. Clicking the obvious one did nothing.

The panel is wrapped in its own provider now, the way `SceneBuilder` already does it, so the injected button
closes it for real — and the header's duplicate is gone. One ✕, and it is the one that looks like the close
button.

The earlier "the drag handle swallowed the click" fix was still real and still needed for the remaining
header controls; it just was not the whole story.

### Minimizing did not dock it

*"minimizing it doesnt actually dock it."*

The fold set `height: auto` from React. But `useDraggablePanel` owns size **imperatively** — it restores a
saved height by writing `el.style.height` so the native resize grip has nothing fighting it, and a
`ResizeObserver` persists whatever height it observes. So folding wrote 44px into storage as the panel's
size, and expanding restored a 44px panel. The next open got the same sliver.

The fold is imperative now, at the level the hook works at: stash the pre-fold height, write `auto`, put it
back on expand — and on unmount too, since closing while minimized would otherwise save the folded height.

**Plus a heal**, because the broken build already persisted bad values: a stored height too short to be a real
panel is dropped on mount and the CSS size takes over. Without it the fix would read as "still broken" on any
machine that had minimized once — which is every machine that tried the feature.

