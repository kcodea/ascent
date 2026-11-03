/**
 * VERSUS NAVIGATION under the party home's shell (DEV switch; not lazy, so the home can call it). Critic round 3 (owner
 * review 2026-11-02): "Browse rooms" must always show the room LIST, even while you still hold a room (the browser then
 * shows an "In a room: Return / Leave" plate), instead of dropping you back into the room. The store's `screen` is
 * presentation only, so the list can show while the room's session keeps running; Return puts the room back on screen.
 */
import type { VersusModifierId } from '@game/sim';
import { useGame } from '../../store';
import { openVersus, refreshRooms, useVersus } from '../../versus/versusStore';

/** What the home hands the browser's Create form (critic round 5: the modifier picked on the home is pre-filled). Read
 *  by the browser when it opens (kept until the next Browse rooms). */
let intent: { modifier: VersusModifierId | null } | null = null;
export function versusBrowserIntent(): { modifier: VersusModifierId | null } | null {
  return intent;
}

/** Show the Versus room list (the party home's "Browse rooms"), with the home's picked modifier for the Create form. */
export function openVersusBrowser(from?: { modifier: VersusModifierId | null }): void {
  intent = from ?? null;
  // The store's own entry first (it keeps the Ranked Duos split and puts a returning member back in their room)...
  openVersus('versus');
  // ...then the list, whatever the store chose to show.
  useVersus.setState({ screen: 'browser' });
  if (useVersus.getState().room) void refreshRooms();
}

/** Back to the room I hold (the browser's Return). */
export function returnToVersusRoom(): void {
  if (!useVersus.getState().room) return;
  useVersus.setState({ screen: 'room', error: null });
  useGame.getState().setTitleView('versus');
}
