/**
 * VERSUS ROOM: DRAG A CARD TO A SEAT (owner 2026-10-17, R-VERSUS-DRAG-SEAT-01: "the player should drag their card to
 * a slot to take it, and drag their card from a slot up to 'sell it' to go to the spectate").
 *
 * The pure half: who may drag what, which zone a point is over, and what a drop there does. No DOM, no React: the
 * room's drag hook (`useSeatDrag.tsx`) measures the zones ONCE per drag and asks these. The room rules are the
 * existing ones (the `versus_take_seat` RPC): a seat change only while the room is open, a player seat only when
 * it is empty, and nothing new about the host (moving to the stands keeps the host, exactly like the button).
 */
import type { VersusMember, VersusRole, VersusRoom } from './versusRemote';
import type { VersusSeat } from '@game/sim';

export interface Box { left: number; top: number; right: number; bottom: number }

/** Where a dragged card is: over a player seat, over the stands (the sell band above the seats, or the hand of
 *  spectator cards), or nowhere that does anything. */
export type SeatZone = VersusSeat | 'stands' | null;

/** The drag's cached geometry (screen px, measured once at pick-up). */
export interface SeatDragGeo {
  seats: readonly { role: VersusSeat; box: Box }[];
  /** The sell line: above it a SEATED card goes back to the stands (null for a spectator's card). */
  sellTop: number | null;
  /** The spectator hand's box: dropping a seated card on it also goes back to the stands. */
  bench: Box | null;
}

/** What a drop does. `take` = call take-seat with this role; `reject` = the existing invalid-drop feedback (deny +
 *  snap back); `cancel` = a plain snap back (released over nothing). */
export type SeatDrop = { kind: 'take'; role: VersusRole } | { kind: 'reject' } | { kind: 'cancel' };

const inside = (b: Box, x: number, y: number): boolean => x >= b.left && x <= b.right && y >= b.top && y <= b.bottom;

export const memberOf = (room: VersusRoom | null, userId: string | null | undefined): VersusMember | null =>
  (room && userId ? room.members.find((m) => m.userId === userId) : null) ?? null;

/** Only MY card, only while the room is open (never mid-match: a sealed or in-game room is not a room you can
 *  change seats in). Another spectator's card, or the other player's, just hovers. */
export function canDragSeatCard(room: VersusRoom | null, me: string | null | undefined, cardUserId: string): boolean {
  if (!room || !me || cardUserId !== me || room.status !== 'open') return false;
  return memberOf(room, me) !== null;
}

/** The zone under a point, for a card dragged FROM `from`. A seat wins over the sell band (the seats sit inside it);
 *  your own seat is not a target (dropping it back is a cancel). The stands are only a target for a seated card. */
export function seatZoneAt(from: VersusRole, x: number, y: number, geo: SeatDragGeo): SeatZone {
  for (const s of geo.seats) if (s.role !== from && inside(s.box, x, y)) return s.role;
  if (from === 'spectator') return null;
  if (geo.sellTop !== null && y < geo.sellTop) return 'stands';
  if (geo.bench && inside(geo.bench, x, y)) return 'stands';
  return null;
}

/** Is this zone a legal drop for me right now? A player seat must be empty (or already mine); the stands are always
 *  open to a seated player (the server's 20-seat cap still answers, and the optimistic move rolls back if it says
 *  no). Everything needs an open room. */
export function seatZoneValid(zone: SeatZone, room: VersusRoom | null, me: string | null | undefined): boolean {
  if (!zone || !room || !me || room.status !== 'open') return false;
  const mine = memberOf(room, me);
  if (!mine || mine.role === zone) return false;
  if (zone === 'stands') return mine.role !== 'spectator';
  return !room.members.some((m) => m.role === zone && m.userId !== me);
}

/** The drop's outcome. An occupied seat is a REJECT (the deny buzz + snap back), empty air a plain cancel. */
export function seatDropOf(zone: SeatZone, room: VersusRoom | null, me: string | null | undefined): SeatDrop {
  if (!zone) return { kind: 'cancel' };
  if (!seatZoneValid(zone, room, me)) return { kind: 'reject' };
  return { kind: 'take', role: zone === 'stands' ? 'spectator' : zone };
}

/**
 * THE SELL LINE for a seated card: the shop sells a minion dragged above the warband's top; a seat card fills the
 * top of the arena, so the line sits two fifths of the way down the card, and always a clear pull above where you
 * grabbed it (a grab near the card's top never starts in the zone).
 */
export function sellLineOf(seat: Box, grabY: number): number {
  const h = seat.bottom - seat.top;
  return Math.min(seat.top + h * 0.4, grabY - h * 0.22);
}

/** The OPTIMISTIC room (R-VERSUS-DRAG-SEAT-01): the room as the server last said, with my pending seat move applied,
 *  so my card is in its new place the moment I drop it. A pending move into a seat someone else now holds is not
 *  applied (the server is about to refuse it, so the card starts back at once). */
export function roomWithSeatMove(room: VersusRoom | null, move: { role: VersusRole } | null, me: string | null | undefined): VersusRoom | null {
  if (!room || !move || !me) return room;
  const mine = memberOf(room, me);
  if (!mine || mine.role === move.role) return room;
  if (move.role !== 'spectator' && room.members.some((m) => m.role === move.role && m.userId !== me)) return room;
  return { ...room, members: room.members.map((m) => (m.userId === me ? { ...m, role: move.role } : m)) };
}
