# 2026-10-29 — Audio memory: the announcer's line cache, paced phone decodes

Part of the late-game slowdown hunt (owner: "smooth early, hitchy late, worse on phones"). The headless passes ran
without real audio, so they could not see audio caches grow. Rule: R-AUDIO-MEMORY-01.

## How it was measured

- `perf:gauntlet --audio` (new, with `--round-probe`): Chrome with autoplay allowed (output muted). Every AudioBuffer
  the page decodes or creates is held by a WeakRef and tagged by what fetched its bytes. Each probe runs after a full
  GC, so it reads the decoded bytes still alive.
- The phone walk (`perf:phone-run`, the CI `phone-budgets` check), also run locally with a 44.1 kHz context and 4x CPU
  throttle to match CI. A local 96 kHz device takes a different decode path and hid the problem.

## 1. The announcer kept every line forever

`announcer.ts` cached every decoded line in a Map for the page's life. The no-repeat bag makes almost every line a
new file, so the cache only grew, and it carried into the next game.

Desktop Practice game, Ale engine, rounds 1 to 14 (live decoded announcer audio after GC):

| round | 1 | 4 | 8 | 11 | 14 |
|---|---|---|---|---|---|
| before | 0.9 MB (1 line) | 2.5 (4) | 5.4 (10) | 7.3 (14) | 8.8 (17), still climbing |
| after | 1.1 (1) | 3.0 (4) | 4.2 (6) | 3.3 (6) | 3.4 (6), flat |

A bot game speaks few lines. A chatty lobby speaks far more, and the growth scales with it.

Fix: `audio/lineCache.ts`. A line is held while it loads or plays. After it ends, at most 6 lines and 6 MB stay as a
recent set. A playing line is never dropped. A failed file is remembered by URL only, so a pack that lacks a clip is
not fetched again. The announcer never preloaded the next line (it loads a line when it speaks), so nothing changed
there.

## 2. phone-budgets: "audio 90 MB > 80" was garbage, not held clips

The phone walk's audio column counts every buffer decoded until the collector frees it. A phone folds each stereo
clip to mono, so every decode leaves a stereo buffer behind as garbage, twice the clip's kept size. The ~130-clip
resident bank decoded back to back, and that garbage piled up faster than the collector took it. The clips the game
actually held never went past about 50 MB. CI's 2-core runner peaked at 90 MB on the mode home, so the check went red
on about half the runs.

Fix: the phone's decode queue (`pacedQueue`) waits 50 ms after each decode, so the collector gets idle time between
them. A clip a play is waiting on (`lane: 'now'`) goes ahead of the waiting bank and skips the pause, so no sound
the player triggers waits longer. The bank finishes about 6 s later than before. It starts 2.5 s after Play and the
mode home and hero select cover that time.

Phone walk, 44.1 kHz, 4x CPU throttle, peak decoded audio: before 75 and 85 MB; after 52 and 57 MB. At the mode
home: before 75 to 85 MB, after 35 to 49 MB. From hero select on, both hold the same ~50 MB.

Also: a phone dropping an on-demand clip from its cache now drops that clip's reversed copy too.

## Not changed (findings for later)

- **Desktop decodes and keeps the whole SFX bank:** 519 clips, about 488 MB at a 96 kHz stereo context (about half
  that at 48 kHz). It is held from the first click and it is flat all game, so it is not the late-game growth. It is
  still a large fixed cost. A desktop LRU plus prewarm, like the phone's, would cut it.
- **Music** streams through two `<audio>` elements and is never decoded into buffers. Nothing to fix.
- The convolver impulse cache (`fx/audioFilters.ts`) is keyed by reverb settings, so it is bounded by the FX defs.
