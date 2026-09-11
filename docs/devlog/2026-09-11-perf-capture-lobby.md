# 2026-09-11 — Perf auto-capture records Play (lobby) games

## Root cause

`isRealPlayRun` (`packages/ui/src/perfCaptureScope.ts`) admitted only `mode === 'ascent'` (or an absent mode).
The Play button (`Title.tsx`) starts a LOBBY run (`startLobby` → `pendingMode: 'lobby'`), and no entry path has
started an `ascent` run since the eight-seat lobby became the game. So every real game was sampled for its
whole length and then dropped at the end by the one gate in `Game.tsx`'s publish. The `perf_runs` table
confirmed it: nothing had landed since 2026-08-30, and those rows were `ascent` / "abandoned" (from the
tab-hide fallback that was removed the same week).

## Change

- `isRealPlayRun` captures `lobby` and `ascent` (an explicit set). `ascent` stays eligible: it is still the
  `RunState.mode` default (an older save with no mode resolves to it on Continue), the store still carries
  `startAscent`, and it is a full scored game with the same phase mix. Practice, tutorial, rift and the Scene
  Builder sandbox stay out; no run stays out; "finished only" stays at the call site (terminal-phase
  transition, no tab-hide / unmount fallback).
- The row's outcome note: a lobby run ends in `gameover` whether the seat won or was eliminated, so the note
  is now "game finished — placed N" from the seat's placement (a phase-name label would call every lobby win
  "lost").
- `perfCaptureScope.test.ts` pins lobby, legacy ascent, absent mode, every exclusion, the sandbox on top of
  any mode, and the whole `RunMode` union so a new mode fails loudly. `perfAutoShare.test.ts` pins the
  placement label.
- `docs/performance.md`: the "records itself in dev / production ships it dormant" section was stale (the
  sampler is unconditional in every build since 2026-08-31 and only the HUD overlay is toggled); "a dev client
  uploads" → any signed-in client; the tab-hide fallback sentence was removed; a capture-rules table added.

## Smoke test (dev server, Browser pane)

Started a throwaway lobby run through the store (`startLobby` → `pickHero`), let the sampler run, forced the
terminal transition with a seat placement, and read the table back through the app's own Supabase client:
exactly one new row — `mode: lobby`, `hero_id: devourer`, `patch: 0.1.0+<sha>`, `note: "game finished —
placed 3"`, 47 buckets each carrying phase / wave / fps / marks / timings. Deleted afterwards (synthetic).
Caveat: the embedded pane reports `document.hidden`, which marks every bucket hidden and would trip the
45-live-seconds gate, so the buckets were un-hidden in-page for the test; that gate is untouched.
