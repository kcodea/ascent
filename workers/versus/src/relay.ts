/**
 * VERSUS ON CLOUDFLARE — WHO HEARS A LIVE-SCREEN BROADCAST (R-VERSUS-CF-RELAY-SCOPE-01, netcode audit F6 / F17,
 * 2026-11-10). A player's live screen (their spectator frames, their Hero Select, their cursor) used to be relayed to
 * EVERY other member's socket, the opponents' included. The opponents' clients threw it away, so nothing showed, but
 * the other team's shop, hand, board and hero offers were readable in the socket, and in a four-player match two thirds
 * of every client's downstream frames were discarded on arrival. The room now routes these by audience, the way pings
 * and team chat already are:
 *
 *  - `spectate`, `spectate_cursor` (a seated player's screen): the STANDS and the sender's TEAMMATE. Never an opponent.
 *  - `spectate_key` (someone lost their place and asks for a keyframe): from the stands, every seated player (whoever
 *    they watch answers); from a seated player, their teammate only (the only screen a player may watch).
 *  - `spectate_watch` ("I am / am no longer viewing my teammate's screen"): the teammate only. It gates the teammate's
 *    cursor stream, which is otherwise 20 messages a second whether or not anyone is looking.
 *  - anything else (emotes, a spectator's own events): everyone, as before.
 *
 * A sender who is not a member of the room reaches nobody with these four. Pure; dependency-free apart from the seat
 * helpers in `pings.ts`.
 */
import { PING_SEATS, teammateOf, type PingMode, type PingSeat } from './pings';

/** The live-screen events (the UI's names: `spectate.ts`, `spectateTap.ts`, `versusStore.ts`). */
export const RELAY_SPECTATE = 'spectate';
export const RELAY_CURSOR = 'spectate_cursor';
export const RELAY_KEY = 'spectate_key';
export const RELAY_WATCH = 'spectate_watch';

export interface RelayMember { userId: string; role: string }

const isSeat = (role: string): role is PingSeat => (PING_SEATS as readonly string[]).includes(role);

/**
 * The user ids `event` from `sender` is relayed to, or `null` for "every other member" (an event this rule does not
 * scope). The sender is never in the answer.
 */
export function relayAudience(mode: PingMode, members: readonly RelayMember[], sender: string, event: string): Set<string> | null {
  if (event !== RELAY_SPECTATE && event !== RELAY_CURSOR && event !== RELAY_KEY && event !== RELAY_WATCH) return null;
  const to = new Set<string>();
  const me = members.find((m) => m.userId === sender);
  if (!me) return to;
  const mySeat = isSeat(me.role) ? me.role : null;
  const mateSeat = mySeat ? teammateOf(mode, mySeat) : null;
  const mate = mateSeat ? members.find((m) => m.role === mateSeat)?.userId ?? null : null;
  if (event === RELAY_WATCH) {
    if (mate) to.add(mate);
  } else if (event === RELAY_KEY) {
    if (mySeat) { if (mate) to.add(mate); }
    else for (const m of members) if (isSeat(m.role)) to.add(m.userId);
  } else if (mySeat) {
    // A seated player's screen: the stands and the teammate.
    if (mate) to.add(mate);
    for (const m of members) if (!isSeat(m.role)) to.add(m.userId);
  } else {
    // Not a seated player's screen (nothing sends this today): the stands only, never a seat.
    for (const m of members) if (!isSeat(m.role)) to.add(m.userId);
  }
  to.delete(sender);
  return to;
}
