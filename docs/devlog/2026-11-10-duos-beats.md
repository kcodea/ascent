# 2026-11-10 — Duos beats: the hand-off, the countdown, the pass, the announcer, the team moments

Owner, after the Duos presentation audit (`.versus-qa/FX-AUDIO-AUDIT.md`): *"make the beats much stronger for duos"*.
The audit's verdict was that Duos had two authored moments (the pass stream, the teammate-ready slam) and everything
else was silent or a 0.2 s fade. This PR is the presentation pass. UI only: no engine, sim, content or Worker change.

**Nobody has heard any of this yet.** Every cue is built from clips the bank already had plus the game's own synth, and
was verified by asserting that the calls fire (unit tests, and a wrapped `sfx` in real headless games). The levels are
starting points for the desk (four new faders: `duostag`, `duosfall`, `duospass`, `duoscue`).

## What changed

### 1. The tag-in is a beat (`choreo/channels/duosHandoff.ts`, `duosHandoffTiming.ts`, `channels/sfx.ts`, `score.ts`)

`boardFallen`, `tagIn` and `flyIn` had `[...BASE]` cue lists and no `sfx` case: nothing played. Now:

- **Sound** (`audio/duosCues.ts`, data; played by `sfx.duosTagIn / duosBoardFallen / duosFlyIn`): a small team motif
  (G, D, G rising for my team; D, B flat, G falling for the other), the heavy whoosh-into-hit clip timed so its hit
  lands as the LAST body lands (`stingerLanding`: delayed when there is room, sped up when the fight is fast), and a
  low thud under it. A fallen board is a low ground hit and a sinking note (lower and longer for mine).
- **Accent** (the new `duosHandoffFx` cue): a soft shadow over the fallen row; `landing-dust` under each body as it
  lands; the Versus room's `ground-slam` in the team colour (teal / ember), scaled to the board, with the board shake,
  under the last body. A fly-in after a won fight gets the dust only. Reduced motion: no accents, a plain fade-in.
- Not added, on purpose: ownership markers, a "steps in" plate, a name on the portrait (owner removed those).

### 2. The tag-in is speed-true, and three things were wrong, not one

The audit said the CSS entrance ignored `--combat-speed`. True, and fixed (`styles.css`: the 0.52 s flight and the
60 ms stagger divide by the speed; the stagger is now each body's TURN, `tagi-N`, mirrored for the foe, instead of
`nth-child` by slot). Measuring it live showed two more defects underneath:

- **The hold was in the wrong place.** `holdMs(next, shown)` is the wait BEFORE `next` shows. So `tagIn: 640` (960 ms)
  was dead air after the fallen board, and the fly-in itself got only the following beat's hold: 360 ms for a swing,
  240 ms for a summon. Measured at 1x to 2x: the entrance class stayed 117 to 567 ms against an entrance of up to
  880 ms, so the new board swung while still flying in at EVERY speed, not only at 2x. Fix (`clock.ts`): nothing
  follows a tag-in or a fly-in until its last body has landed (the entrance's own length for the bodies that arrive
  is the floor), and the lead-in before the tag-in gives the same time back (`tagIn: 640 -> 290`, now "how long the
  fallen board is read"). A full board of seven into a swing is exactly as long as before; everything else is shorter.
- **The live-speed stamp had been dead since 2026-10-11.** `Unit.tsx` stamps `--combat-speed` on a unit whose
  animation is speed-timed. Its regex's two `\b` word boundaries had been written into the file as literal BACKSPACE
  characters (0x08), so it never matched: no death, Rise or Rebirth ever got the live speed (they ran at the base
  slider speed while the auto-ramp and the Skip raced ahead). Now `floatConfig.isSpeedTimedAnim`, a word set with no
  escape to lose, pinned by `combatSpeedRestyle.test.ts` (which also fails on any control character in those files).
  **This changes every fight, not only Duos:** in a ramped or skipped fight deaths now shorten with the speed, which
  is what #2032 intended and its comments describe. Worth a look by Mike.
  (How it happens: this shell halves backslashes in heredocs, so `\\b` reaches the file as `\b`, which JS reads as a
  backspace. It bit this session three times. Write escapes with the Edit / Write tools, never through a heredoc.)

### 3. The countdown (`versus/countdownBeat.tsx`)

The 5 s End Combat window was a number re-read every 200 ms by `useSecondsUntil` inside `useVersusRecruit`, a hook the
whole Shop screen calls. Now a tiny external store driven by a timeout chain at whole-second edges; only
`CountdownTail`, a leaf inside the gem's pill, subscribes. FIVE..ONE play the shop clock's own recorded ticks
(`sfx.turnTick`), and the number re-keys each second (one transform / opacity pop; the last five gold).

**Ranked Duos overtime, a judgement call for the owner:** R-RANKED-DUOS-GATE-02 says the 5 s window is gone and the
clock face stays at 0:00. Both still hold. What is new is that the 30 s idle safeguard, which was invisible, now counts
down on the gem's pill ("Waiting for Ann · 23s", or "Time is up. Ready up · 23s" when nobody is ready), ticking aloud
for its last five. If the owner would rather the safeguard stay invisible, delete the `overtime` branch in
`VersusHud.tsx` (`countTo`); the End Combat countdown is independent.

### 4. The pass (`versus/passLob.ts`)

Send and receive were `sfx.sell` plus the Gild trail's two clips (the pass defs began as a copy of `gild-trail`).
`playDrop` and `playEmerge` now play `sfx.duosPassSend` (a pluck up and a quick whoosh away) and
`sfx.duosPassReceive` (a lower whoosh in and a chime down into the hand, landing as the card forms), each through one
voice (a board of gift effects on one beat rings once). The defs are played with `muteSound`; their files are
untouched. The pass's LOOK was left alone (allowed, not needed).

### 5. The announcer in Ranked Duos (`announcer.ts`, `versus/duosSignals.tsx`)

Ranked Duos runs as `mode === 'versus'`, so every table line was muted. With no new recordings:
`firstOut`, `knockout`, `topTwo` and `finalShowdown` speak again, but only when raised by TEAM detectors (a Duos table
loses its seats two at a time; the solo detectors count seats). `gameWon` / `secondPlace` / `gameLoss` and `rankUp`
speak through `announceTeamResult`, outside the queue, because a Ranked Duos run has already left the screen when its
result opens. Still silent there: `topFour`, `playersRemain`, `lobbyLast`, `leaderboardTop`, `comebackWin`. Versus 1v1,
Group and Versus Duos are unchanged.

### 6. Team moments (`versus/TeamFaces.tsx`, `SpectatorBar.tsx`, `DuosParty.tsx`)

One shared row presents the pair (each hero in its owner's frame and skins, me first): the two come in from either
side and meet. The knockout notice shows it greyed, with the place landing under it ("3RD of 4 teams") and the end
screen's low tone plus the motif falling; it stays 9 s instead of 6. The Ranked Duos result shows it above the
unchanged `RankScreen`, lit gold on a win, with the end screen's tone for that half of the table and the motif.

### 7. Small signals (`versus/duosSignals.tsx`)

Two store subscriptions, mounted once (`<DuosSignals />` in `Game.tsx`): a two-note cue up / down for the teammate
view (its six call sites ring `sfx.tick`, which the owner silenced for menus), the motif when my teammate sits down in
the party, and one low note when the round closes on us (sound only: the held board stays untouched, as designed).

## Verification

Unit: `duosHandoff.test.ts`, `duosCues.test.ts`, `countdownBeat.test.tsx`, `duosSignals.test.ts`,
`announcerRankedDuos.test.ts`, `duosTeamMoment.test.tsx`, `duosPassSound.test.ts`, `combatSpeedRestyle.test.ts`.

Live (headless Chrome, every non-local host blocked; bench bundle; `wrangler dev` on 8804): real four-browser Versus
Duos games at 1x, 2x and with Skip, before (`f5ec35d20`'s bundle) and after; a Ranked Duos pair for the rest. The
drivers are local (`scripts/versus-qa/beats-*.mjs`, not committed: they need the audit's untracked library).

**Is the board down before it fights?** How long the entrance class stays on the bodies (until the next beat) against
the entrance's own length, per hand-off. The fights auto-ramp, so "1x" covers 1.0x to 3.0x and Skip 4x to 17x.

| run | hand-offs | cut short | examples (on screen / entrance, ms) |
|---|---|---|---|
| before, 1x | 10 | 9 of 9 | 363 / 520, 222 / 580, 140 / 880 (seven bodies), 119 / 820 |
| after, 1x | 10 | 0 of 10 | 520 / 519, 358 / 357, 315 / 313 (seven bodies), 273 / 273 |
| before, 2x | 8 | 7 of 7 | 182 / 520, 176 / 640, 145 / 820 |
| after, 2x | 8 | 0 of 8 | 283 / 260, 290 / 290, 311 / 311, 399 / 303 |
| before, Skip | 6 | 5 of 5 | 94 / 520, 36 / 580, 38 / 640 |
| after, Skip | 8 | 0 of 8 | 88 / 82, 39 / 39, 74 / 47, 74 / 73 |

**Frame cost.** Worst frame in the audit's window (250 ms before a tag-in to 1500 ms after), one number per hand-off:

| run | worst frame, each hand-off (ms) | median | max | p95 (median) |
|---|---|---|---|---|
| before, 1x | 12.6, 12.6, 16.7, 16.7, 16.8, 20.8, 20.9, 20.9, 25, 58.4 | 20.8 | 58.4 | 8.2 |
| after, 1x | 16.6, 16.7, 25, 25, 29.1, 33.4, 41.7, 45.8, 54.2, 62.5 | 33.4 | 62.5 | 8.4 |
| before, 2x | 16.7, 16.7, 20.8, 29.1, 45.8, 45.8, 58.3, 125 | 45.8 | 125 | 8.4 |
| after, 2x | 20.8, 25, 25.1, 29.2, 33.2, 45.8, 45.8, 125.1 | 33.2 | 125.1 | 8.4 |
| before, Skip | 8.4, 16.7, 20.9, 25.1, 25.1, 154.2 | 25.1 | 154.2 | 8.3 |
| after, Skip | 16.7, 20.8, 20.8, 20.9, 25, 25, 25, 41.6 | 25 | 41.6 | 8.4 |

Read honestly: this harness (four headless browsers on one machine) does not hold the 6.25 ms bar at a hand-off before
OR after, and the spread between two runs of the same build is as large as the spread between builds. The long frames
carry no script time in the long-animation-frame records (raster / compositor, the cards being promoted as they
start to fly), which is the entrance that already existed. The 1x "after" sample is the worst of the six and the 2x and
Skip "after" samples are the best, so there is no clean signal that the new accents cost a frame, and none that they do
not. In isolation on one page the accents measured: `ground-slam` spawn 0.7 to 2.0 ms, worst frame 4.3 to 8.3 ms (at
most one dropped frame at 240 Hz); four `landing-dust` 1.2 to 2.1 ms, worst frame 4.3 ms. **This wants a look on a real
machine with the perf HUD** before anyone calls the hand-off clean.

**Sound calls** (wrapped `sfx` in the real games, since nobody hears a headless run): every hand-off fired
`duosBoardFallen(side)` then `duosTagIn(side, landMs)` with `landMs` following the live speed (371 at 1.0x, 187 at
2x, 29 to 59 under Skip). Ranked pair: `duosMateJoined` as the teammate sat down; `duosViewSwap(true)` /
`duosViewSwap(false)`; `duosPassReceive(307)` and `duosPassSend` with no `sell`; `duosLockedIn` as the round closed;
`turnTick(5..1)` exactly once each in the End Combat window (pill "Bob is ready · 5s" down to "1s") and in overtime
(pill "Time is up. Ready up · 30s" down to "1s", the clock face at 0:00); a real double concede showed the result with
`duosTeamResult(4)`, `placementTone(8)` and the announcer's `gameLoss`; a forced first / second place showed
`duosTeamResult(1 / 2)`, `placementTone(1)` and `gameWon` / `secondPlace`.

Not reached live: the Duos knockout notice (a local Ranked Duos table has no recorded teams, so our team never takes
damage; Versus Duos has two teams, so the first team out ends the match). It is covered by `duosTeamMoment.test.tsx`
only. The win result was shown by calling the store's own `loadDuosResult` (a forced state), for the same reason.

## Assets I would want

- A recorded tag-in stinger (one for my team, one for theirs) and a "board down" hit.
- Pass send and pass receive clips.
- A teammate-joined chime, and a view-swap blip.
- Voiced lines: a tag-in call, "their first board is down", a team knockout, a Duos win.
- An authored Pixi def for the hand-off sweep (the slam is the Versus room's, recoloured).

## Follow-ups

- The cue levels need a pass by ear on the SFX desk.
- Mike should look at ramped / skipped fights now that deaths follow the live speed again.
- `teamSend: 0`, the reserve board's invisibility, per-unit ownership and the round-close hang (audit items 3, 4, 8)
  are untouched: owner calls.
