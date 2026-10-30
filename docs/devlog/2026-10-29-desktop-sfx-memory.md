# 2026-10-29 — Desktop SFX memory: a resident bank plus a capped, prewarmed LRU

Follows the audio memory pass (#2450, R-AUDIO-MEMORY-01). Its finding: desktop decoded the whole SFX bank (519
clips) at the first click and kept it for the page's life. That was 488 MB of PCM at a 96 kHz context. Rule:
R-AUDIO-MEMORY-02.

## What changed

- Desktop now uses the phone's split. The **resident** bank is the top-level clips, the ceremony and the 11 FX clips
  every game plays (`clipIndex.common`). It decodes at the first click and is never dropped. **Everything else** is
  prewarmed for the scene (`phonePrewarm.ts`, now subscribed on desktop too) and held in a least-recently-played
  cache (`audio/clipLru.ts`).
- Desktop cap: **64 MB at 48 kHz, scaled with the context rate** (128 MB at 96 kHz), so it always holds the same
  seconds of sound. A clip still sounding is never dropped: every play holds its clip until the source's `ended`. The
  clip just decoded is never dropped either, because a play is waiting on it. The phone's 40 MB cap is unchanged; it
  now shares the same cache code.
- The prewarm scene now also covers an **open Discover's offer**, because a pick can be played as it lands. On desktop
  the prewarm settles in 150 ms, not 400, and rides the `chrome` lane like the phone's. The resident bank stays on the
  `audio` lane.
- `__ascentSfx` (play stats, decoded MB, LRU MB, evictions, bank ready time) is now exposed on desktop too.
- `perf:gauntlet --audio` gains MEM rows at boot, the mode home (a real PLAY click, plus how long the bank took to land)
  and every round. Each row has sfx counters, JS heap after GC, `measureUserAgentSpecificMemory` (the page is served
  COOP/COEP credentialless) and the renderer process's private MB (Windows, via CIM).

## Not done, on purpose

- **No mono fold on desktop.** A census of the bank: 0 of 363 stereo clips are dual mono. 301 of them differ between
  channels by more than -20 dB of peak. They are genuinely stereo, so folding them would be audible on headphones.
- **No resample to 48 kHz on a 96 kHz device.** It would halve the bytes again. But a 48 kHz buffer on a 96 kHz
  context plays through the source node's linear interpolation, about -3 dB at 15 kHz. That is the dull top end
  R-TOUCH-AUDIO-QUALITY-01 fixed on phones.
- The core bank stays resident whole (about 70 MB at 48 kHz). Its biggest clips (turncharge, the gate and wipe set,
  combatStart) play in every game.

## Numbers

`perf:gauntlet --only <dist> --round-probe --audio --from 11 --to 10 --headless`: the Practice game, Dwarf Ale
board, one run per build, same seed. The context ran at **96 kHz**; at 48 kHz every audio number halves.

| probe | decoded audio before | after | LRU after | renderer private before | after |
|---|---|---|---|---|---|
| boot (title, no input) | 0 MB | 0 | 0 | 175 MB | 175 |
| mode home (15 s after PLAY) | 493.5 | 207.5 | 34 | 1198 | 890 |
| round 1 | 494.9 | 256.4 | 82 | 1266 | 1011 |
| round 5 | 498.2 | 302.0 | 124 | 1731 | 1523 |
| round 10 | 498.7 | 305.8 | 128 (cap; 36 evictions) | 2225 | 2015 |

- JS heap after GC and `measureUserAgentSpecificMemory` were identical between builds (heap 28 / 40 / 62 / 90 MB;
  UA 482 to 550 MB). Neither counts AudioBuffer PCM, so the renderer's private bytes are where the saving shows.
- **First play.** Both builds missed exactly 3 plays, all on the first click (`uihover`, `clickthock`, `pulse`: the
  context did not exist yet). Their decode lag was p50 58 / max 62 ms before and 46 / 61 ms after. There were zero
  on-demand misses in about 3,000 plays through round 10. The bank landed 1114 ms after the click before (521 clips)
  and 553 ms after (133 clips).
- A first pass with a 400 ms settle on the `audio` lane, and no Discover in the scene, had 2 on-demand misses at
  round 1 (`fx/vo-dw-mountainbond`, `fx/vo-dw-chef`). The bench buys and plays a god-printed card within 250 ms. Both
  were FX `sound` layers, which retry for 4 s, so they played late (under 100 ms), not silent. The 150 ms settle, the
  `chrome` lane and the Discover offer removed them.

## Findings for later (not this PR)

- The renderer's private memory climbs about 1 GB from round 1 to round 10 in **both** builds. The GPU process
  climbs to about 3 GB. Over the same span the JS heap grows only about 50 MB. That points at decoded images and
  textures, not audio. It is the next lead for the "janky late game" hunt.
