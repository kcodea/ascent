# 2026-09-30 — Continue only resumes a started lobby game; the course format is gone from play

Owner bug report, with screenshots of the hero picker and then a "ROUND 1/17 · OATH 9" course run with a single
opponent panel:

> *"bug - if i quit from this menu, i have a continue option that put me in the old wave format. remove the wave
> format option entirely, and only create a continue option if the player selects a hero and starts a game."*

## Root cause

The store always holds a `run`. Behind the title it is a **dormant throwaway**: `createRun(randomSeed())`, which
has no lobby, so it is a legacy 17-round course run with the default hero and the default Line. It is never shown.

The hero picker's **Main Menu** button calls `openTitle`, and `openTitle` calls `flushSave` first (the mid-turn
Save & Quit path). `flushSave` refused only while `showTitle` was true. But every picker entry (`startLobby`,
`confirmPracticeSetup`) sets `showTitle: false` to open the picker, so at hero select the guard passed and
`flushSave` wrote the throwaway course run to `ascent.save` and set `savedRun`. The title then offered it as
Continue, and `continueRun` put the course run on screen. A tab-hide at hero select did the same.

## Fix (`packages/ui/src/store.ts`)

- `flushSave` now returns on `isPreRun(s)` (title, Practice setup, or hero picker), not just `showTitle`.
- New exported `isResumableRun(run)`: a run may be the save only if it has a `lobby`, is not a sandbox, and is not
  finished. `writeSave`, the phase-boundary autosave and `flushSave` all check it.
- `loadSave` discards a lobby-less save at boot (`console.warn`, `clearSave`), so a player who already has a
  phantom course save (the owner does) gets no Continue. It is a dropped save, not a quit: nothing settles
  (a course run never had a ranked `runId` anyway).
- `pickHero` always builds a lobby run (`createLobbyRun`, `practice` for Practice, `lobby` otherwise). The
  `createRun(..., pendingMode, line)` course branch is gone. `pendingMode` defaults to `lobby`.
- `newRun` (only tests call it) builds a lobby run too.
- Removed `startAscent` and `startRift` from the store, and the Rift card from the mode picker (`Title.tsx`).
  Every rift is disabled today, so the card was never mounted, but a rift run was a course run.

## Left alone, on purpose

- `createRun`, `RunMode`'s `'ascent'` / `'rift'`, `CONFIG.courseRounds` / `defaultLine`, the rifts registry, and the
  course branches in the sim. Tools, tests, old replays and the lobby itself (`createLobbyRun` wraps `createRun`)
  still read them.
- The dormant throwaway behind the title is still a `createRun`. It is never shown and now never saved; making it
  a lobby would build eight seats for nothing on every boot and every Clear.
- The tutorial was already a lobby (`createTutorialRun` attaches an authored lobby), so it saves and resumes as
  before. Practice and the Scene Builder were already lobbies.
- `HeroSelect`'s rift pill still keys off `pendingMode === 'rift'`, which nothing sets now. Harmless.

## Tests

`packages/ui/src/continueNoLegacyCourse.test.ts` boots a fresh store per case: quitting at hero select or the
Practice setup leaves no save and no Continue (5 of 7 cases fail on the old store); a started lobby run saves and
a reboot + Continue resumes the same lobby run; backing out of the picker over a real save leaves it byte-identical;
a planted legacy course save is discarded at boot; a stale `ascent`/`rift` `pendingMode` still yields a lobby.
Oracle rule: `R-PERSIST-01` in `packages/rules/src/registry/approved/persistence.ts`.
