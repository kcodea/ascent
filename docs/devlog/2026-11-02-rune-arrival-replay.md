# 2026-11-02 · A bought rune's arrival no longer replays on every Duos view swap

Owner report 2026-11-02 (live, Versus Duos): "going back and forth sometimes causes runes to "trigger" as if they were
just equipped. like ninefold broker's keeps triggering". Branch `fix/rune-arrival-replay`. Rule R-RUNE-ARRIVAL-ONCE-01
(approved/runes.ts).

## Root cause

- The Runeforge ceremony hands its rune over with an ARRIVAL beat on the rack badge: the `rune-select-implosion` def,
  its sound, and the `rune-arrived` art pop (CSS, one-shot). The cue for it (`useGame.runeArrival`) is never cleared, so
  after it plays it sits in the store as `phase: 'arrived'` for the rest of the session.
- The "already played" memory was a `useRef` inside `useRuneArrivalFx`, so it lived and died with the `QuestBadges`
  mount.
- `QuestBadges` lives in the StatusBar, which is keyed on the LIVE run identity (`sb:${seed}:${heroId}:${seekEpoch}`,
  Game.tsx). The Duos teammate view puts the teammate's run in the store, so the StatusBar remounts on the way in AND on
  the way back. Each fresh mount saw the stale `arrived` cue with an empty ref and replayed the arrival of the last
  rune you bought (Ninefold Commerce, in the report). A replay seek did the same. If the teammate owned the same rune at
  the same slot, it popped on their badge too.
- PRESENTATION ONLY. The view swap writes the store (`useGame.setState`), it dispatches no reducer action, and the rune
  reward (Ninefold Commerce granting the Ninefold Broker) is granted once by `buyRune`. Nothing double-fires in the run.

## Fix

- `useRuneArrivalFx` keeps the played arrivals in MODULE state, keyed by the cue's run and `seq` (seqs only grow within
  a session), so the memory outlives any mount. A beat cancelled by an unmount before it landed is forgotten again, so a
  remount mid-delay still plays it once.
- The hook now RETURNS the cue this mount should present, and `QuestBadges` builds the badge classes from that: an
  arrival an earlier mount already played reads as none (no art pop on a remount), while the mount that played it keeps
  the class for its own pop.
- The cue carries the run it was bought in (`runKey`, set by `cueRuneArrival` in Recruit), and a cue never lights a
  badge on another run's screen (the teammate view, or a new run).

## Verification

- `packages/ui/src/runeArrivalReplay.test.tsx` (jsdom): remount, replay seek key, four teammate swap round trips with
  the teammate owning the same rune, a foreign-run cue, and a new arrival after a suppressed one. Four of five failed on
  the old code.
- Headless Playwright (bundled headless shell, throwaway profile, own dev server on 5391), the real Game tree with the
  same store writes the teammate swap makes: before the fix the badge started its art pop 9 times over 4 round trips;
  after, once. (The Pixi implosion does not fire in the headless shell, which has no WebGL for the FX layer, so the
  art pop is the observable; both sit behind the same gate.)
