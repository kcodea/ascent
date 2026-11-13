# 2026-11-13: Warhost, Top Rope and Stars brought back under the phone audio budget

`phoneAudioQuality.test.ts` failed on `feat/hero-attacks-16`: the busiest two attacks (Warhost, then Top Rope) put the
phone's decoded-audio working set at 42.98 MB against its 41.52 MB ceiling (90% of the 40 MiB LRU). Fixed by making
the attacks need less decoded audio. The test and the ceiling are unchanged; no attack lost a sound, a spoken line, or
any timing.

## What changed

- **Own cuts of shared clips.** Warhost and Top Rope each played a short window of a long shared clip, and the budget
  counts the whole clip. Each now has its own cut of exactly the window it plays (mono 44.1 kHz 128 kb/s, loudness
  matched to the stereo original's window as heard, so nothing got quieter):
  - `warhost-cheer`: `cheering` 0.50 to 1.90 s (both cheer cues; their `startMs` moved down by 500 ms to match).
  - `warhost-zap`: `blue-impact-hit` first 2.1 s, faded over its tail (below -40 dB).
  - `wrestle-cheer`: `cheering` 0.42 to 3.04 s (every crowd window; the `startMs: 420` went away).
  - `wrestle-boom`: `heavy-rock-impact` first 1.02 s (every boom is cued for 1000 ms or less).
  The shared originals are untouched (other attacks and FX defs still use them).
- **Tails trimmed** (sample values kept, only the inaudible tail cut and a short fade added; checked against every
  cue's `startMs` + `lenMs`): Warhost's bicker (to 1.0 s: its cue plays about 0.86 s at the defaults), boulder, charge,
  drum, gallop, horn, volley; Top Rope's roar, bell, woo, slam, big slam, chair, thud, rope; Stars' boom, sky, beam,
  howl, hiss, grind, rumble, release, loose, fall. Risers (`stars-rise`, `stars-implode`) and the spoken lines were not
  touched.

## Numbers (the test's own clip lengths, each attack's clips not in the shared code set)

| attack | before | after |
| --- | --- | --- |
| warhost | 24.84 s | 19.62 s |
| wrestle | 23.49 s | 17.89 s |
| stars | 18.23 s | 16.40 s |

Working set 40.90 MB against the 41.52 MB ceiling (0.62 MB headroom). Stars paired with Warhost would be 1.5 s less
than the current worst pair.

Caveat: a tuner that stretches Warhost's `bickerMs` past about 800 ms now runs out of bicker clip early. Nobody has
listened to the cuts; they were placed from measured envelopes.
