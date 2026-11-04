/**
 * THE WATCHED HAND, OVER EVERYTHING (owner report 2026-11-02: "bug with spectating - mouse goes under equipment it looks
 * like"; R-SPECTATE-CURSOR-LAYER-01). ONE mount of `SpectatorCursor` for every spectate path, at the app root beside the
 * replay viewer's layers (Game.tsx), never inside `.app`.
 *
 * Why: `.app` is a stacking context in the shop (`z-index: 1`), and the hero cluster (`.statusbar`: the portrait, the
 * hero power, the Equipment slot) is its SIBLING at z40 (z100 on some screens). A Versus spectator's cursor used to be
 * mounted by `SpectatorBar`, which lives inside Recruit's `.app`, so its own z540 only counted inside `.app` and the whole
 * layer painted under the Equipment slot and the hero power. At the root its z540 is measured against the HUD itself:
 * above the hero cluster, the rail, the hand and the teammate portrait, under the replay transport and the drag ghost
 * (DOM order there) and under the full-screen pages. Pointer events never land on it, so it never blocks a control.
 *
 * Who sees it (the same three paths as before, one place):
 *  - a Versus spectator on the watch screen (a member with no seat, not a Duos player viewing their teammate);
 *  - a Live Games watcher (`LiveWatchBar`'s screen);
 *  - a replay with a recorded spectator stream.
 */
import { SpectatorCursor } from './SpectatorCursor';
import { useSpectate } from './spectate';
import { mySeat, useVersus } from './versusStore';
import { useLiveWatch } from '../live/liveWatch';
import { isPreRun, useGame } from '../store';

/** Whether the watched hand is drawn (pure, tested). */
export function spectatorCursorOn(s: {
  replayStream: boolean; watching: boolean; teammate: boolean; versusScreen: boolean; versusSpectator: boolean; liveGame: boolean; preRun: boolean;
}): boolean {
  if (s.replayStream) return true;
  if (!s.watching || s.teammate) return false;
  // A Versus watch screen draws the hand while its shop / fight is up (where `SpectatorBar` used to mount it).
  if (s.versusScreen) return s.versusSpectator && !s.preRun;
  return s.liveGame;
}

export function SpectatorCursorLayer(): JSX.Element | null {
  const replayStream = useGame((s) => s.replaySession?.hasStream === true);
  const versusScreen = useGame((s) => s.run.mode === 'versus');
  const preRun = useGame(isPreRun);
  const watching = useSpectate((s) => s.active);
  const teammate = useSpectate((s) => s.teammate === true);
  const versusSpectator = useVersus((s) => !!s.match && !mySeat(s.match));
  const liveGame = useLiveWatch((s) => !!s.game);
  return spectatorCursorOn({ replayStream, watching, teammate, versusScreen, versusSpectator, liveGame, preRun }) ? <SpectatorCursor /> : null;
}
