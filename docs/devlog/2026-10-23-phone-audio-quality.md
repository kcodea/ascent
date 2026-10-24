# 2026-10-23: Phone sounds load ahead of time and play at full quality

Owner, 2026-10-23, on a real iPhone with the #2242 build (the crashes are gone): "the sound effects were all
terrible/not loaded". Rule: R-TOUCH-AUDIO-QUALITY-01 (next to R-TOUCH-PLAY-MEMORY-01). Desktop is unchanged.

## What was wrong (measured, not assumed)

`npm run perf:phone-run -- --interact --net 9000,60 --combat-ms 15000` (prod build, iPhone landscape, iOS UA, touch,
a 9 Mbps / 60 ms network, title to the first fight with a buy and a play). The phone build now exposes its SFX play
stats (`window.__ascentSfx`: plays that found their clip decoded, plays that missed it, miss-to-decoded time), and the
script prints them per step.

1. **The core bank arrived after the first Shop.** It rode the asset queue's `audio` lane, which drains after
   `early` and `set`: on a phone that is the whole background art stream (~1,300 images, #2151). At the first Shop
   only 23 of the ~96 core clips were decoded; the rest landed ~25 s into the Shop. So buy, card touch, the hero
   select ceremony stingers, the turn charge and the gate cues played as synth blips or not at all.
2. **Card, hero and FX clips loaded on their first play** (#2163), so that play was silent: the hero's pick line,
   every card's bound FX voice (`fx/vo-*`), the Discover sparkle.
3. **32 kHz decode.** The context runs at 44.1 or 48 kHz, so every 32 kHz buffer was resampled again at play time by
   the buffer source, which interpolates linearly: a 16 kHz top end, a soft treble roll-off below it and images above
   it. That is the "terrible" part of the report on top of the missing clips.
4. Smaller: the 32 MB cache was first-in-first-out (a play never refreshed a clip), and the phone's serial decode ran
   inside the asset queue's slots, so queued decodes held slots the art needed.

Not causes: reverb is not cut on a phone (it builds each convolver on first use, at most one pooled per impulse); the
iOS unlock (#2149) works (the context exists from the first touch). Not checked on a device: the iPhone's ring/silent
switch mutes Web Audio unless `navigator.audioSession.type = 'playback'`; that is a product call, left alone.

## Fix (phone path only, `LITE_ART`)

- `audio/phoneAudio.ts`: `phoneDecodeRate` = the context's own rate, capped at 48 kHz (so no second resample);
  `phoneMono` averages the channels but keeps the louder one when they cancel; `PHONE_AUDIO_LRU_BYTES` = 40 MB.
- `audio/clipIndex.ts`: which clips a game needs, from shipped data. COMMON = the clips of the defs bound to generic
  moment kinds (`choreo/bindings.json` `kinds`) and fired from code (`fx/directCalls.ts`): 10 clips, ~7 MB. PER CARD =
  its voice clips plus its bound defs' clips. PER HERO = its lines. CODE = the `fx/` clips named in code (hero attacks,
  entrances), a snapshot in `audio/codeClips.ts` pinned by a scan test.
- `sfx.ts`: the phone's resident bank is the core bank plus COMMON, fetched in the `chrome` lane (after the title art,
  ahead of the art stream, still behind anything on screen). `prewarmSfx(scene)` queues the scene's clips the same
  way. The queue slot covers only the fetch; decoding stays one at a time outside the queue. The cache is now least
  recently PLAYED (a play moves the clip to the young end).
- `audio/phonePrewarm.ts` + one subscription in `Game.tsx` (phone only): after a 400 ms quiet spell, each change of
  hero choices / hero / board / hand / Shop / `lastCombat` prewarms the heroes on offer, the hero, the cards in play
  (both fight boards and every `cardId` the fight's events name), then the code clips.

## Measured, same script, same network

| step | before: decoded audio / clips | after |
|---|---|---|
| Play pressed (+3 s) | 0.1 MB (1) | 4.9 MB (18) |
| tutorial skipped | 4.3 MB (11) | 40.3 MB (112) |
| hero select | 4.3 MB (11) | 52.6 MB (135) |
| first Shop | 11.2 MB (23) | 53.4 MB (139) |
| first fight | 26.5 MB (104) | 54.0 MB (141) |

(The probe's own "audio" column also counts the stereo buffer a decode returns until GC; peak 29 vs 57 MB. The final
build, which loads the clip index lazily, read the same to the first Shop: 52.0 MB at the ranked gate, 52.7 MB in the
Shop. Two of the after runs stalled at the title: the touch made the audio context but the Play button never ran, with
no page exception; four short reruns of both builds did not reproduce it, so it reads as a tap race in the script.
The numbers are from clean runs.)

Clip plays in the scripted game: **before 13 of 46 missed** (synth or silence; mean 1.6 s from the miss until the clip
was decoded), **after 1 of 42**: the very first touch's `pulse`, which plays before the context exists, as on desktop.
(The raw "before" count was 16; three were a card asking for voice files it does not have, which the stats no longer
count as misses.) Peak iOS estimate 239 MB before, 267 MB after: the extra ~28 MB is the decoded working set at
48 kHz, well under the 442 / 651 MB levels in 2026-10-22-phone-play-crash.md.

Bank sizes at 48 kHz mono, for scale: core + ceremony ~35 MB, COMMON ~7 MB, a card's clips ~0.43 MB on average, all
hero lines ~28 MB, the whole on-demand bank ~120 MB. A busy game's on-demand working set (the 31 heaviest cards, four
heroes, the code clips) is pinned under 90% of the 40 MB cap by `phoneAudioQuality.test.ts`.

## Not confirmed / follow-ups

- Chrome stands in for WebKit. The owner should hear it on the iPhone; the crash log's audio MB per step will show the
  larger resident bank (~42 MB) if anything goes wrong.
- The decode runs from Play + 2.5 s, one clip at a time; by the end of the tutorial skip (a few seconds later) 40 MB
  is decoded. #2163 measured the Play crash at a 60 MB burst all at once; this is serial, but it is more than 20 MB.
- `audio/clipIndex.ts` is loaded with a dynamic import when a phone's bank starts, so desktop never loads it.
- `playTailedSample` (the wipe crank, Discover and Good Luck tails) still builds a fresh ConvolverNode per reverb'd
  play on every device (follow-up from 2026-10-18-ios-play-crash.md).
