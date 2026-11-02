/**
 * VERSUS NAVIGATION under the party home's shell (DEV switch; not lazy, so the home can call it). Critic round 3 (owner
 * review 2026-11-02): "Browse rooms" must always show the room LIST, even while you still hold a room (the browser then
 * shows an "In a room: Return / Leave" plate), instead of dropping you back into the room. The store's `screen` is
 * presentation only, so the list can show while the room's session keeps running; Return puts the room back on screen.
 */
import { useGame } from '../../store';
import { openVersus, refreshRooms, useVersus } from '../../versus/versusStore';

/** Show the Versus room list (the party home's "Browse rooms"). */
export function openVersusBrowser(): void {
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
