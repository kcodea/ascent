/**
 * MY TEAMMATE'S RUN, RIGHT NOW (R-DUOS-FIGHTER-VIEW-01): what the HUD shows while THEIR board fights on my side (their
 * runes, their hand). A match reads it off the teammate's own spectate frames (they arrive whether or not I am
 * watching); the Scene Builder's placeholder teammate hands over the run it held as the fight began. Render-only:
 * nothing here is ever dispatched to. Null when there is no teammate or no frame has arrived yet.
 */
import { duosMateOf, type RunState } from '@game/sim';
import { localMate } from './localMate';
import { spectatorRunOf, teammateViewOf, useSpectate } from './spectate';
import { useVersus } from './versusStore';

export function duosMateRunNow(): RunState | null {
  const lm = localMate();
  if (lm) return lm.mateRun?.() ?? null;
  const m = useVersus.getState().match;
  const g = m?.group;
  if (!m || !g?.duos) return null;
  const sp = useSpectate.getState();
  const viewer = g.me ?? (sp.active ? sp.seat : null);
  if (!viewer) return null;
  const seat = g.duos.mate ?? duosMateOf(viewer);
  const view = teammateViewOf(seat);
  return view ? spectatorRunOf(view, seat, m.id, undefined) : null;
}
