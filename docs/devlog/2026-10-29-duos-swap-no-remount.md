# 2026-10-29 · Duos teammate swap: no more board remount (R-DUOS-VIEW-NOREMOUNT-01)

Owner approved "Option A" from the #2426 QA report: stop remounting the shop screen when a Duos player swaps between
their board and their teammate's.

## What changed

- **Game.tsx**: `Recruit` is keyed on `heldScreenKey(...)`, which holds my run's key while `useSpectate.teammate` is on.
  A new run or a replay seek still remounts. The StatusBar and the EmoteLayer stay on the live key (small, and the hero
  panel is a different hero anyway).
- **What the remount used to reset** (`packages/ui/src/screenSwap.ts`): `Recruit` computes `screenId` (seed, hero,
  runId of the run on screen) and `swapped` (true on renders where it changed, until the commit).
  - `useSwapRef(init, swapped)`: every FX sequence watcher (`prevXSeq = useRef(run.xSeq)`), diff snapshot (board / hand
    uid sets, stat snapshots, FLIP baselines), view cache and pending-drop ref re-initialises on the swap render, so no
    watcher fires for the jump between two runs.
  - `useSwapState(init, swapped)`: transient animation state goes back to rest during the swap render (React's adjust
    state on a prop change pattern; nothing commits in between). Render-time seq checks (`sotSeqSeen`,
    `gildTriplesSeen`, `heldConsumeSeq`) skip the swap render. States only an effect re-arms (`roundSettled`,
    `combatStage`) are deliberately NOT reset.
  - Mount-scoped cleanups now also key on `screenId`: the End of Turn cancel-and-commit, the live drag, the hero
    strike, the Shout chain / Start of Turn / Whisper timers, hand-summon FX. A new swap cleanup drops the bc /
    Karwind timers, settles a held watch-screen End of Turn, and clears global stat holds, hand-buff sparkles and Pixi
    particles.
  - The lasso cascade, the Equipment beam cascade and `useVersusRecruit` take the screen too.
  - Source pin in `screenSwap.test.tsx`: no `useRef(run.…)` / `useState(run.…)` in Recruit unless it is a live mirror.
- **Cards are reused, not re-keyed**: both runs mint uids from the same counter, so the same uid names two different
  cards. Keying the rows on the screen measured SLOWER than the old full remount, so instead `Card` reads
  `ScreenContext` and treats a change of screen like a change of uid (no stat roll, badge pop, step flourish, ward
  crack). The rail (`LobbyPanel`) and the End Turn gem reset their own diffs on the swap; the overlays and the foe
  pieces (cheap) are keyed.
- **The teammate portrait** (`DuosMateDock`) sat in two different JSX positions in `VersusHud`, so it remounted on
  every swap and its mount measure forced a layout. It now keeps one identity (`key="dock"`).
- **Fade**: re-measured. Desktop keeps the View Transition; phones keep the ghost (VT 0.8-1.3 s frames, no fade at all
  also worse on the throttled bench).

## Numbers (prod bench bundle, local Cloudflare stack, machine shared with other sessions)

In-page swap cost (store swap to forced style + layout, 16 swaps each way): base median 34 ms in / 32 ms out (min
24-30), now 25 / 23 ms (min 17-19). Desktop frames over 33 ms across 12 swaps: base 12-15, now 3-5 (not zero on the
loaded machine). Phone (4x CPU, ghost both): worst swap frame about 330 ms -> 180-240 ms.

## Follow-ups

- The remaining cost is the style + layout of the new cards (forced in `RowFlip`'s tavern sweep and the StatusBar's
  name fit). Zero frames over 33 ms on desktop needs a quiet machine to confirm.
- The milestone-badge latch (`fx/milestoneBadgeFx.ts`) is a global keyed by uid, so it can in principle light a
  teammate's card with the same uid. Pre-existing, rare (5000+ stats), not touched here.
