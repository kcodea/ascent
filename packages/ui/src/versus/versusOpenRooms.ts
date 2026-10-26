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
      // One call answers both play areas: the Versus rooms and the Ranked Duos parties with a free seat (`duosOpen`,
      // 2026-11-01-ranked-duos-party.sql). Packed into one number (duos x 1000 + versus) so the one menu poll keeps one
      // value; each hook unpacks its half.
      const r = await versusRemote.openRooms(contentRevision());
      return Math.min(999, r.open) + 1000 * Math.min(999, r.duosOpen ?? 0);
    } catch (e) {
      if ((e as VersusError).code === 'not_deployed') deployed = false;
      throw e;
    }
  },
  () => deployed && versusEnabled() && !versusMatchLive(),
);

/** Open Versus rooms I could join right now (0 when unknown). */
export function useVersusOpenRooms(): number {
  return rooms.use() % 1000;
}

/** RANKED DUOS: open parties with a free seat I could join right now (0 when unknown). */
export function useDuosOpenParties(): number {
  return Math.floor(rooms.use() / 1000);
}

/** The Duos tile's hover line: "1 Ranked Duos party open". */
export function duosPartiesTip(n: number): string {
  return `${n} Ranked Duos ${n === 1 ? 'party' : 'parties'} open`;
}

/** The hover bubble's line: "2 Versus rooms open" / "1 Versus room open". */
export function versusRoomsTip(n: number): string {
  return `${n} Versus ${n === 1 ? 'room' : 'rooms'} open`;
}

/** Tests only. */
export const __versusOpenRooms = { poll: () => rooms.poll(), get: () => rooms.get(), resetDeployed: () => { deployed = true; } };
