# 2026-09-23 — Lobby background music

Owner ask (verbatim): *"can you wire the bg music here: C:\Game Assets\Ascent Art\SFX\Music — this should start
3 seconds into turn 1 and play in the background, uninterrupted, on repeat/looping with 3s in between plays. add
a button in the settings the mute music, and have a separate mixer for the sound, so that the player can adjust
the sound of the game sounds, and music. it should chain through bg-bg2 and repeat, again, with a short delay and
small fade in/out. remove the round won and round lost chimes that play currently. this music should ONLY play
when a player is in a lobby, and stop immediately if they leave a lobby run or practice etc."*

## What shipped

- **`packages/ui/src/music.ts`** — one module, one small state machine (`idle → armed → playing ⇄ gap`, plus
  `silent` when both tracks fail), driven from the store and React-free. `isMusicWanted(state)` is the pure
  gate: a run is on screen (`!isPreRun`), no replay, `run.mode` is `lobby` or `practice`, and the run is not a
  sandbox rig (Scene Builder / bug scenarios set `sandbox: true`). `syncMusic(state)` is the transition;
  `Game.tsx` subscribes it to `useGame` beside the perf warm-up wiring.
- **Timing:** starts 3 s after the run is on screen (fresh run AND Continue), fades in over 600 ms, fades out
  over its last 600 ms (found by the element's `timeupdate`, never a timer for the track length), then 3 s of
  silence measured from `ended`, then the other track: `bg → bg2 → bg …` forever. Leaving the run stops it with a
  150 ms click-guard fade, then `pause()` + rewind.
- **Playback:** the two mp3s are PUBLIC files (`apps/web/public/music/bg.mp3`, `bg2.mp3`), streamed by two
  `HTMLAudioElement`s created once (`preload: 'none'` until the first play), never decoded into WebAudio buffers.
  They are NOT under `packages/ui/src/audio`, whose eager `import.meta.glob` would have bundled and decoded 5.5 MB
  into memory. URLs are `BASE_URL`-relative so the itch / desktop builds (base `./`) resolve them.
- **Routing:** when the SFX AudioContext exists (`sfx.ts` warms it on the first gesture; the new
  `audioContext()` export hands it over) each element goes `MediaElementAudioSourceNode → fade gain → level
  gain → destination`. Deliberately NOT through the SFX master / mute bus, so the Game-sounds slider, the sound
  mute and a Skip's `stopAllAudio` never duck the music. Fades are one scheduled `linearRampToValueAtTime` each
  (no per-frame work). Without a context the element's own `volume` carries fade × level via a single 50 ms
  interval that exists only during a fade.
- **Settings (EscMenu):** the Audio section now has two mixes. "Game sounds" (the existing SFX master slider +
  mute, relabelled) and "Music" (its own slider + mute, persisted in `ascent.musicvol` / `ascent.musicmuted`,
  applied live). Same `escvol` / `escbtn` styling; the global gauntlet cursor rule paints every control.
- **Chimes removed:** the verdict effect in `useCombatReplay.ts` that fired `sfx.win()` / `sfx.lose()` is gone,
  and so are the two synth cues on the sound bank (nothing else called them). `docs/sfx-events.md` updated.
- **Autoplay guard:** a `play()` rejected with `NotAllowedError` retries once on the next pointerdown / keydown.
  Any other failure marks the track failed and skips to the other; both failed → silent for the run.

## Judgement calls

- The post-game screen KEEPS the music (the ask lists it under "uninterrupted"); it stops on Play Again / Save &
  Quit / Main menu because those go through `openTitle`.
- A new lobby run replacing a lobby run without the title in between (rare; the entry paths all pass the title)
  restarts the chain for the new run (`run.seed` is part of the sync key).
- Default music volume 0.7; the "Game sounds muted" copy now says "Sound effects are off" since the mute no
  longer covers everything.

## Verification

- `packages/ui/src/music.test.ts` (18 tests, jsdom + fake timers + a stub element through the module's injected
  seams): the gate, the 3 s start + 600 ms fade-in, Continue, tutorial / title never start it, elements created
  once, the chain order + 3 s gap + tail fade-out, uninterrupted under store churn, stop (150 ms fade → pause +
  rewind, cancels a pending start / gap, a non-lobby run replacing the lobby run), failure skip + both-fail
  silence, autoplay retry, mute / volume persistence + live apply + clamping.
- `packages/ui/src/verdictChimesRemoved.test.ts`: the replay never calls `sfx.win` / `sfx.lose`; the bank has no
  such keys.
- Oracle: `R-PRESENT-06` (domain foundation) in `packages/rules/src/registry/approved.ts`, enforcement refs the two
  tests; `docs/docbot2/final-report.md` counts bumped (186 rules / 100 approved).
- Browser: see the PR's Verification section (Practice run on a worktree vite, `window.__music()` readouts).
