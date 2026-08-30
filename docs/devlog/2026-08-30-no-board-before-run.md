# No board before a run

**Owner report (2026-08-30):** *"pressing 'practice' flashes the real board screen before going to the
practice menu"* — with the general ruling that follows from it: *"no active game should be displayed or
happening until the player actually enters a lobby."*

## Cause

`showTitle: false` was carrying two meanings that are not the same state: **"the title screen is closed"**
and **"a run is on screen."**

`<Recruit key={runKey} />` rendered unconditionally, with the title overlaying it — the architecture keeps a
*"dormant throwaway run behind the title"* (the store's own words in `continueRun`). Every entry path drops
`showTitle` merely to open the NEXT menu:

```ts
startPractice: () => set({ showTitle: false, practiceSetupOpen: true, ... }),
startAscent:   () => set({ showTitle: false, pendingMode: 'ascent', heroChoices: rollHeroChoices(), ... }),
```

So between the title going down and the Practice options painting, the dormant run's board was the topmost
thing on screen. Same gap exists for Ascent, Rift and Lobby, which all open the hero picker the same way.

## Fix

One predicate, `isPreRun`, covering every way to be pre-run — the title, the Practice options screen, and the
hero picker. Anything that opens *over* the title (leaderboard, career, patch notes, account) leaves
`showTitle` true and is caught by the first term.

The board — `Recruit`, `PixiFxLayer`, `StatusBar` and the end screens — renders only when it is false.

**Unmounting rather than hiding is the point.** A hidden board still *runs*: Recruit owns the shop clock and
the FX canvas keeps its ticker. The ruling says "displayed **or happening**", and only unmounting delivers
the second half.

**It costs no extra mount.** `Recruit` is keyed on run identity, so entering a run already remounted it; this
only stops the *previous* run's board painting in the gap between two menus.

## Verified in the browser, per frame

A one-frame flash cannot be caught by polling, so the check ran on `requestAnimationFrame` and counted every
frame in which the board was in the DOM:

| moment | frames watched | frames with the board |
|---|---|---|
| clicking **Practice** | 289 | **0** |
| the Practice options screen → Start | 217 | **0** |
| the hero picker (54 cards up) | 361 | **0** |
| **after `pickHero`** | — | **419** |

That last row is the one that makes the other three mean something: the same detector that reports zero
through the whole pre-run flow reports 419 the moment a run is actually entered, so the zeros are the gate
working rather than a probe that never fires.

`isPreRun` is unit-tested directly for all four states.
