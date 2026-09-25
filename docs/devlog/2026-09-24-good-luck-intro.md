# 2026-09-24: the "Good Luck" game-start intro

Owner ask (verbatim): *"i want to add a short "Good Luck" text with fantasy style text and arrows or flair to it
with some glow and the screen dimmed after the player hits start game in the hero ceremony. it should go from the
ceremony to a dimmed board and text should fade in with some sparks and a shine from left to right, then fade to
the game screen and the clock begins."*

## What plays

Start Game → the launch curtain covers → `pickHero` builds the run → **the intro begins under the still-opaque
curtain** → the curtain lifts onto an already-dimmed first shop → "Good Luck" (the title font, Cinzel Decorative, a
static gold gradient + drop-shadow glow) fades and grows in while two filigree arrow arms draw outward and a gold
spark burst fires off the words → one shine sweeps left to right → hold → words and dim fade to the live board →
the shop clock starts, at full time.

Defaults: dim 0.72, start delay 250, fade-in 500, shine 650, hold 900, fade-out 500, 70 sparks, text 112. That is
2150 ms from the run being built, ~2.4 s from the Start Game press (the 280 ms cover comes first).

Esc (capture phase, so the Esc menu underneath does not also open) or a click anywhere skips straight to the game
and starts the clock. `prefers-reduced-motion`: opacity fades only, no scale, no flourish draw, no shine, no sparks,
hold capped at 600 ms.

## Where it lives

- `packages/ui/src/goodLuck/goodLuckIntroStore.ts`: a tiny external store (like `turnClock`), `begin` / `end` /
  `useGoodLuckIntroActive`, plus `shouldPlayGoodLuckIntro(run)`. Presentation state only; the sim never knows.
- `packages/ui/src/goodLuck/GoodLuckIntro.tsx` + `goodLuckIntro.css`: the overlay, mounted in `Game.tsx` just
  before the curtain. z190: above the board, HUD and `.pixifx` (z110), below `.pixifx-above` (z200) so the sparks
  land over the words, below the curtain (z480).
- `packages/ui/src/goodLuck/goodLuckIntroConfig.ts` + `GoodLuckIntroTuner.tsx`: the 🍀 "Good Luck intro" dev tuner
  (localStorage in DEV, `GLI_DEFAULTS` in prod) with a ▶ replay action that replays over the current board.
- `packages/ui/src/fx/defs/good-luck-intro.json`: the spark burst (one `burst` layer, box emitter stretched along the
  words, gold palette, `slot: above`). The tuner's spark count is passed as `intensity` = count / 70.
- `HeroLaunchCurtain.tsx`: calls `goodLuckIntro.begin()` right after `pickHero` when `shouldPlayGoodLuckIntro`.
- `Recruit.tsx`: the countdown's pause gate moved into `turnClockMayTick` (`turnClock.ts`) and gained
  `introPlaying`. The clock is not reset by the hold, so the turn is never shortened; it simply does not tick.

## Which starts get it

Lobby and Practice, opening turn (wave 1), not sandbox, not during a replay session. The tutorial never goes through
the ceremony or the curtain (it builds its run directly), Save & Continue does not either, and the Scene Builder is
a sandbox run. Legacy `ascent` / `rift` are excluded: the ask was the lobby game start. **Judgement call:** Practice
is included (the task said include it if unsure); flip the mode check in `shouldPlayGoodLuckIntro` to drop it.

## Perf

Every motion is a WAAPI transform/opacity animation scheduled once, up front; no per-frame JS. The glow is a static
filter and the shine's soft edge a static mask: the shine is two counter-moving transforms (a masked window sliding
right over a bright copy of the words sliding left by the same distance), so no paint property animates. One layout
read per play (`offsetWidth` of the words) plus one rect read for the spark anchor.

Measured in the dev build (240 Hz display, Chrome): an isolated ▶ replay pass over a live shop, 599 frames, worst
frame 8.3 ms (one vsync), median 4.2 ms, no long animation frames. On a real Start Game the only long frame is the
existing ~66 ms `pickHero` + first Recruit mount under the opaque curtain, which happens with or without the intro.

## Tests

`goodLuck/goodLuckIntro.test.ts` (mode matrix, clock gate holds while playing and releases on end, timeline order
and the 2.2 to 3 s window) and `goodLuck/GoodLuckIntro.test.tsx` (ends on its timer and only then, Esc skip without
reaching the Esc menu, click skip, leaving to the title releases the clock, the curtain begins it for lobby and
Practice but not the tutorial or a sandbox).

## Sound (follow-up, same day)

Owner: *"the effect you had built is nice. it needs a sound effect tho"*. Two clips, both already in the repo, no new
audio files:

- **Shine**: `audio/equipmentsheen.mp3` (the Equipment slot's art-sheen sweep, source
  `C:/Game Assets/Ascent Art/SFX/Equipment/equipmentsheen.mp3`). It is already the game's "light sweeping over gold
  art" sound, so the intro's sweep reads as the same family. `sfx.goodLuckShine(vol, delayMs)`, category
  `goodLuckShine` (ui bus, 0.6).
- **Spark burst**: `audio/fx/djartmusic-christmas-sparkle-whoosh-1-275404.mp3`, cut to the same 1.1 s to 2.0 s window
  the Stellar Lens FX plays (the glitter tail, not the whoosh). `sfx.goodLuckSpark(vol, delayMs)`, category
  `goodLuckSpark` (ui bus, 0.45). `playSample` gained an optional `slice` for this.

Both are queued up front on the audio clock at the intro's start, with the same delays the WAAPI sweep and the spark
timer use (`goodLuckTimeline` now returns `shineSoundAt` and `sparkAt`), so they cannot drift from the visuals. Each
returns an `SfxHandle`; a skip (Esc, click, a tuner replay over a playing intro, leaving to the title) stops both,
while the natural end leaves the shine's tail ringing over the live board. Reduced motion: no codebase-wide gate on
sounds exists, so the shine sound still plays (at the moment the words finish fading in); the spark sound follows the
sparks and is skipped with them.

Tuner "Good Luck intro" gains a **Sound** group: Shine sound (gain, default 1), Shine sound offset (ms, default 0,
-400 to 400), Spark sound (gain, default 0.8). Tests in both goodLuck test files pin the shine at the sweep start,
the offset, stop on Esc and click, no stop on the natural end, and a replay playing them again.
