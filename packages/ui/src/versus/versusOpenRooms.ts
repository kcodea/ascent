/**
 * HOW MANY VERSUS ROOMS ARE OPEN (owner 2026-10-17: "can we add a way to show if a lobby is up in versus mode so
 * players know to look"; R-VERSUS-OPEN-ROOMS-01). The Mode screen's Versus tile glows with "2 open", and the title's
 * Play and the side menu's Play carry a small badge, while this is above 0.
 *
 * The count is `versus_open_rooms` (2026-10-17-versus-open-rooms.sql): open rooms with a member seen in the last 2
 * minutes (the browser's own freshness rule), on my protocol and content revision, that I am not in. Two integers
 * cross the wire, never rows (R-NET-01). It rides the shared menu poller (`menuPoll.ts`: 45 s, menus only, visible tab
 * only, one timer with the Live Games count).
 *
 * 0 (no indicator) when: Versus is not public on this build, a Versus match of mine is being played, there is no
 * backend, the player is offline, the call fails, or the migration has not run (then it stops asking this session).
 */
import { contentRevision } from '@game/content';
import { menuCount } from '../menuPoll';
import { versusEnabled } from './versusFlag';
import { versusRemote, VersusError } from './versusRemote';
import { useVersus } from './versusStore';

let deployed = true;

/** A Versus match of mine is being played (its screens hide the title anyway; this is the belt to that brace). */
export function versusMatchLive(): boolean {
  const m = useVersus.getState().match;
  return !!m && m.phase !== 'complete';
}

const rooms = menuCount(
  async () => {
    try {
      return (await versusRemote.openRooms(contentRevision())).open;
    } catch (e) {
      if ((e as VersusError).code === 'not_deployed') deployed = false;
      throw e;
    }
  },
  () => deployed && versusEnabled() && !versusMatchLive(),
);

/** Open Versus rooms I could join right now (0 when unknown). */
export function useVersusOpenRooms(): number {
  return rooms.use();
}

/** The hover bubble's line: "2 Versus rooms open" / "1 Versus room open". */
export function versusRoomsTip(n: number): string {
  return `${n} Versus ${n === 1 ? 'room' : 'rooms'} open`;
}

/** Tests only. */
export const __versusOpenRooms = { poll: () => rooms.poll(), get: () => rooms.get(), resetDeployed: () => { deployed = true; } };
