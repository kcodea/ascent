# 2026-09-25: The announcer, third batch (Entering Combat takes + TimeRunningOut)

Builds on [2026-09-24-announcer-lines-2.md](2026-09-24-announcer-lines-2.md) (whose event map now carries the new
row). The queue, the gate and the channel are unchanged.

## Owner ask (verbatim)

*"wire new announcer sfx C:\Game Assets\Ascent Art\SFX\Announcer"*. The owner reorganised the folder into subfolders
(Buying Cards, Entering Combat, Equipment, Fight outcomes, Knockouts, Low on time, Players left or Top x, StartGame,
Triple reward, Win or Loss, Win streak).

## The audit (every file, by audio)

Every file in every subfolder was compared to the repo's clips by the MPEG stream with the ID3v2 header and the
ID3v1 `TAG` trailer stripped (the method from #1716). Result:

- Every same-named clip already wired matches its repo copy exactly. **No re-exports**: nothing to swap.
- The two StartGame `(1)` files are audio copies of `14_21_12` / `14_21_29` (already dropped in #1716).
- `GameWon.mp3` matches `game-won.mp3`; the old `TopTwo2.mp3` is gone from the folder.
- New: 5 ElevenLabs takes in `Entering Combat/` and 21 in `Low on time/`, all distinct from each other and from
  every wired clip.

## What changed

- **Clips**: `entering-combat-3..7.mp3` (the five `Entering Combat` takes, folder timestamp order 17_03_16 ->
  17_04_52) and `time-running-out-1..21.mp3` (the `Low on time` takes, 16_08_41 -> 17_02_05).
  `EnteringCombatAfterLoss.mp3` stays with its own event. 103 clips in `apps/web/public/announcer/`.
- **`announcer.ts`**: `enteringCombat` lists 7 takes; the new `timeRunningOut` event is appended at the END of
  `ANNOUNCER_LINES` (the table is append-only, see `announcerVariant`), priority 5 (the lowest).
  `observeTurnClock(seconds, wave)` is the trigger; `ANNOUNCER_TIME_WARNING_SECONDS = 10`.
- **`Recruit.tsx`**: the shop countdown's tick calls `observeTurnClock(next, run.wave)` after it moves the clock,
  skipped under the effectively infinite clock (tutorial, God-rules sandbox). Presentation only: the engine is untimed.
- **`announcerSlice.ts`**: the event union. **`announcerConfig.ts`**: the Announcer tuner rows (volume + offset).
- **Oracle**: `R-PRESENT-07` amended (priority list, the bypass list, the new trigger, the owner quote).
- **Patch note**: Systems, "Announcer: Low on Time".

## TimeRunningOut, exactly

- Fires when the Shop clock ticks down to 10 s, in a lobby or Practice Shop turn (the announcer gate: never the
  title, a tutorial, a sandbox rig or a replay; the Recruit guard adds the infinite-clock case). A Continue that
  resumes the clock below 10 s never crosses the mark, so that turn stays quiet.
- **Tried once per game**: the first time the clock reaches 10 s, whether it then speaks or is dropped. The "tried"
  flag is in memory (like TribeFour's count), so a Save & Continue after a drop may try again on a later turn; once
  it has spoken it is in the persisted `announced` slice like every other line.
- **Bypasses the 12 s cooldown** (it is a warning) but never talks over a playing line: it waits for that line to end
  (the same `bypassCooldown` path as the forge lines). If the clock reaches 0 first, it is dropped (`why: 'time up'`).
- **Shop shelf**: End Turn (combat starting) expires it.
- Priority 5: if another line is ready at the same instant, the other speaks and this is dropped as outranked.

## Tests (`announcer.test.ts`, new describe "the third batch")

Every clip of every event exists and no two share audio; the table is append-only with TimeRunningOut last at priority
5; it fires at 10 s and only once per game; it bypasses the cooldown; it waits out a playing line; it is dropped when
the clock hits 0 and not tried again; combat starting expires it; it never fires in the tutorial, a sandbox rig, on
the title or during a fight.
