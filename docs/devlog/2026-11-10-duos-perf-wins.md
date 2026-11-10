# 2026-11-10 — Duos perf wins: the first click, the hero pick, the next-foe ring, and what the audit got wrong

Follow-up to the Duos runtime audit of 2026-11-09 (`.versus-qa/RUNTIME-AUDIT.md` in the `duos-audit` worktree, defects
D1, D3, D6, D7). Branch `fix/duos-perf-wins`. Bar: no frame over 6.25 ms. This entry says what moved, what did not, and
which of the audit's causes turned out to be wrong.

## How it was measured

Prod bench bundles (`VITE_PERF_BENCH=1`, Supabase blank) of `origin/main` (base) and the branch (new), a local Versus
Worker, headless Chrome with a real GPU and every non-local host unresolvable. The audit's own drivers
(`scripts/versus-qa/audit-*.mjs`, untracked) plus a one-browser probe for the idle shop (a Practice game with the clock
off, so the turn fuse never runs; 1 s DevTools traces summed by event).

**The machine was shared with three other building sessions for most of the "after" runs (60% CPU with nothing of mine
running).** Frame times from those runs are inflated and noisy. Base and new were therefore run back to back in pairs,
and the numbers that carry a claim below are the ones that do not depend on a quiet machine: handler times, long-task
presence, per-second trace sums in A/B on the same page.

## What changed

1. **The first click of a session no longer builds the audio graph** (`sfx.ts` `warmAudioGraph`, `fx/audioFilters.ts`
   `reverbImpulseSteps`). The AudioContext, limiter, buses and meters are built on idle time during the boot (desktop
   only; a phone keeps its first-touch build, R-TOUCH-AUDIO-01). Built before a gesture the context starts suspended;
   the first gesture resumes it, as `audioUnlock.ts` always did. The SFX bank still decodes from the first gesture. The
   reverb pre-warm now fills each impulse a few ms per idle callback instead of a whole tail in one.
2. **The hero pick no longer creates a WebGL context** (`HeroCeremonyPixi.ts` `prewarmHeroCeremonyFx`, called by
   `HeroSelect` while an offer is up). Context, textures and shader link are built on idle time once Hero Select's own
   entrance is over (1.5 s in: asked for during the entrance, the context waited 439 ms on a busy GPU process). Desktop
   only. A pick before the warm build is done finishes it at once (the old cost, never a missing effect).
3. **The next-foe ring** (`lobbyRailDocked.css`, `LobbyPanel.tsx` `SliceEdge`): the breath runs on a plain wrapper and
   the two drop-shadows moved from the svg root to its polygon. See "the ring" below.
4. **The teammate swap**: `ClampedName` never measures inside a commit (it writes its last fit, and fits in the
   ResizeObserver callback); `useBottomLeftAnchor` no longer re-measures on a run swap; the `duos-viewing` class left
   `<body>` (`duosViewing.ts`: the three dimmed controls carry it themselves).
5. **Tab** (R-DUOS-TAB-PEEK-01): for a seated Duos player Tab is the peek only. It used to peek AND open the
   Compendium, and a held Tab's repeats toggled the book.
6. **"You" on the rail** (R-DUOS-VIEW-YOU-01): stays on my plate while I watch my teammate.

## Numbers

| | base | new | how |
|---|---|---|---|
| START click, handler time | 41 to 67 ms (5 games) | 5.1 to 6.2 ms (5 games) | Event Timing |
| START click, worst frame | 54 to 75 ms | 67 to 71 ms | **not improved**: with the handler gone the frame is still late, no script in it |
| Hero pick, long task | 65 to 90 ms (5 of 5 games) | none (5 of 5) | Long Tasks API |
| Hero pick, worst frame | 63 to 88 ms | 46 to 54 ms | 5 games each, loaded machine |
| The warm build itself | n/a | one 50 to 54 ms task about 1.5 s after Hero Select shows | 3 games with the final timing |
| Idle shop, ring breathing: main thread per second | 293 to 345 ms | 202 to 234 ms | 1 s traces, 2 runs each, same session |
| of which `Layerize` | 102 to 115 ms | 1 to 33 ms | same |
| Idle shop, ring still (control) | 104 to 111 ms | 99 to 119 ms | same |
| Class change cost: `duos-viewing` on body | 0.24 ms a change | 0 (no rule left) | 40 forced changes on a round-3 shop |
| Class change cost: `duos-vt` on html | 0.45 ms | 0.46 ms (kept, see below) | same |

The swap, pass and return-from-fight frame times are in the PR body with their pairs; under the shared-machine load no
change in them can be claimed either way.

## The ring: what the audit said, what it was

The audit named the ring's svg (filter + `will-change` + animation on one element) as the cause of 62% of the idle
shop's main-thread work and proposed the kwglow split. The split alone changed nothing (measured: 278 to 317 ms a second
after, same as before). Switching one thing at a time on the live page found:

- **`Layerize` every frame comes from the SCALE over a filter on the svg root.** Opacity-only: 0. Transform-only: 76 to
  107 ms a second. Filter on the polygon instead of the root: 0 to 18. Frozen at four points of the breath, root filter
  against polygon filter differ by at most 2/255 on any pixel.
- **About 45 to 60 ms a second of style remains**, and it is not the ring's doing: ANY element animated inside the
  next-foe slice costs that (a plain 40 px box included), 6 to 9 in another slice, 3 in `<body>`. Taking the `foe` class
  off the slice removes it; putting it on another slice brings it. Ruled out: the slice's z-index, filter, transitions,
  the ring and the swords being there. **Open.**
- **Why any of it reaches the main thread at all:** two rAF loops run on every frame of an idle shop (the always-on
  `perfMonitor` sampler and a Pixi ticker). With every page rAF parked, the same shop with the ring breathing did 13 to
  38 ms of main-thread work a second and 15 to 24 style passes instead of 240. That is an owner call (the sampler is
  the telemetry), so nothing was changed there.

Target was under 80 ms a second. **Not met**: 202 to 234 with the ring breathing, and the control (ring still) is
itself 99 to 119 on this page.

## What did not improve, and why

- **The pass (D7).** The audit read "`drawImage` 30.6 ms" in the profile as one call on the release frame. Bucketed by
  time it is 0.5 ms on each frame of the dissolve (a micro-bench of the same draw: 0.5 ms median, 0.9 ms worst, first
  frame included; an ImageBitmap sprite saves 0.1 ms). The dissolve is already started a frame after the release
  (`passLob.ts:181`). Preparing its canvas at pickup has nothing to move, so `plateDissolve.ts` is untouched. What the
  pass's slow frames actually are: the pickup's compositor commit (13 to 16 ms, the shared shop drag) and the release
  task (handler 8 ms with two forced layouts, React 7 to 10 ms, style 7 to 9 ms).
- **The swap's worst frame.** The swap's task is 26 to 39 ms: style 12 to 22, React 9 to 13. The style is the new
  screen's own restyle, which has to happen once; the forced reads were where it was charged, not what caused it.
  Removing them removes the extra passes only.
- **`duos-vt` stays on `<html>`.** The View Transition's pseudo-elements and the cursor shown while it runs belong to
  the document element; nothing narrower can carry it. 0.45 ms a change.
- **The return from a fight (D2).** One React commit of 36 to 43 ms. `measureDockAnchors` (`useDockedRail.ts:17`) is
  where its forced layout lands, not an extra one. Not changed.

## Follow-ups worth a session

- The `.foe` slice restyle cost (above).
- `useCiaEnchantedFx.ts:40` reads `getBoundingClientRect` on every frame while its effect follows an element (96 ms of
  self time across one return from a fight).
- The owner call on the always-on rAF sampler: parked, an idle shop is 5 to 10 times cheaper.
