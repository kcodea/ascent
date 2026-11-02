/**
 * VERSUS under the party home's app shell (DEV switch "Party home (prototype)", owner 2026-11-02): the pure half of the
 * room browser (`VersusBrowserPh.tsx`) and the room (`VersusRoomPh.tsx`). No DOM, no React: what a room row says, how the
 * browser filters, which seats a mode lays out and in what teams, and what the room's START area says. Presentation
 * only: every call these pages make is the store's existing one (createRoom, joinRoom, takeSeat, setRoomOptions, ...).
 */
import { normalizeVersusOptions, VERSUS_MODE_SEATS, type VersusGroupSeat, type VersusMode, type VersusRoomOptions } from '@game/sim';
import type { VersusMember, VersusRoom, VersusRoomSummary } from '../../versus/versusRemote';

/** The three Versus room modes, named as the party home's mode tabs name them. */
export type VersusRoomMode = Exclude<VersusMode, 'ranked_duos'>;
export const VERSUS_ROOM_MODES: readonly { id: VersusRoomMode; label: string; short: string; desc: string }[] = [
  { id: 'duel', label: 'Versus 1v1', short: '1v1', desc: 'Two players. Health and Armor, like a normal game.' },
  { id: 'group', label: 'Versus Group', short: 'Group', desc: 'Three or four players. Last one standing wins.' },
  { id: 'duos', label: 'Versus Duos', short: 'Duos', desc: 'Two teams of two. Each team shares its Health.' },
];
const MODE_OF = new Map(VERSUS_ROOM_MODES.map((m) => [m.id, m] as const));

/** A room's mode (a Ranked Duos party never reaches these pages; it reads as 1v1 if one ever did). */
export function roomModeOf(options: VersusRoomOptions | null | undefined): VersusRoomMode {
  const m = normalizeVersusOptions(options).mode;
  return m === 'ranked_duos' ? 'duel' : m;
}
export const roomModeLabel = (mode: VersusRoomMode): string => MODE_OF.get(mode)?.label ?? 'Versus';
export const roomModeShort = (mode: VersusRoomMode): string => MODE_OF.get(mode)?.short ?? '1v1';

// ── THE BROWSER ───────────────────────────────────────────────────────────────────────────────────────────────────────

export type RoomFilter = 'all' | VersusRoomMode;

/** How many rooms each filter tab holds. */
export function roomCounts(rooms: readonly VersusRoomSummary[]): Record<RoomFilter, number> {
  const c: Record<RoomFilter, number> = { all: rooms.length, duel: 0, group: 0, duos: 0 };
  for (const r of rooms) c[roomModeOf(r.options)]++;
  return c;
}

/**
 * The rooms a filter shows: open rooms (ones you can still sit in) first, then the rest, each group in the server's order
 * (newest first). A full or running room stays listed so its stands can still be joined.
 */
export function visibleRooms(rooms: readonly VersusRoomSummary[], filter: RoomFilter): VersusRoomSummary[] {
  const shown = filter === 'all' ? [...rooms] : rooms.filter((r) => roomModeOf(r.options) === filter);
  const rank = (r: VersusRoomSummary): number => (r.status === 'open' && r.players < seatCap(r) ? 0 : r.status === 'open' ? 1 : 2);
  return shown.map((r, i) => ({ r, i })).sort((a, b) => rank(a.r) - rank(b.r) || a.i - b.i).map((x) => x.r);
}

/** A room's player seats (2, or 4 for a group or Duos room). */
export const seatCap = (r: Pick<VersusRoomSummary, 'maxPlayers'>): number => r.maxPlayers ?? 2;

/**
 * What the row's button does. The store's join: everyone arrives in the stands (R-VERSUS-ROOM-HAND-01) and asks for a
 * seat only when the stands are full; an open room with a free seat reads Join, a full one or a running one Watch.
 */
export function roomJoin(r: Pick<VersusRoomSummary, 'status' | 'players' | 'maxPlayers'>): { label: 'Join' | 'Watch'; as: 'player' | 'spectator'; primary: boolean } {
  const free = r.status === 'open' && r.players < seatCap(r);
  return { label: r.status === 'open' ? 'Join' : 'Watch', as: free ? 'player' : 'spectator', primary: free };
}

export const ROOM_STATUS: Record<string, string> = { open: 'Open', sealed: 'Starting', in_game: 'In game' };

/** "2 of 4 seats" style count for a row (seat words for a screen reader too). */
export const seatText = (r: Pick<VersusRoomSummary, 'players' | 'maxPlayers'>): string => `${r.players} of ${seatCap(r)} seats taken`;

/** A room's generic name for its mode (critic round 3: the title must match the mode). */
export const MODE_ROOM_NAME: Record<VersusRoomMode, string> = { duel: 'Versus room', group: 'Group room', duos: 'Duos room' };

/** The Create field's starting name: "<name>'s room" (or the mode's generic name without a player name). */
export function defaultRoomName(playerName: string, mode: VersusRoomMode = 'duel'): string {
  const n = playerName.trim();
  return n ? `${n}'s room`.slice(0, 40) : MODE_ROOM_NAME[mode];
}

/**
 * The room's title as shown: its own name, unless that is one of the generic mode names (or a party name) that no longer
 * matches the mode (a room hosted as one mode and switched to another, or named by a hand-off default), in which case the
 * mode's own generic name.
 */
export function roomTitleOf(name: string | null | undefined, mode: VersusRoomMode): string {
  const n = (name ?? '').trim();
  if (!n || /^(versus|group|duos) (room|party)$/i.test(n)) return MODE_ROOM_NAME[mode];
  return n;
}

// ── THE ROOM ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The seats a mode lays out, in teams: 1v1 = two sides of one, Group = four free seats, Duos = two teams of two. */
export function seatTeams(mode: VersusRoomMode): VersusGroupSeat[][] {
  if (mode === 'duos') return [['p1', 'p2'], ['p3', 'p4']];
  if (mode === 'group') return [['p1', 'p2', 'p3', 'p4']];
  return [['p1'], ['p2']];
}

/** Who sits where (null = open). */
export function seatedOf(room: Pick<VersusRoom, 'members'>, mode: VersusRoomMode): Map<VersusGroupSeat, VersusMember | null> {
  return new Map(seatTeams(mode).flat().map((s) => [s, room.members.find((m) => m.role === s) ?? null] as const));
}

/** The START area for this viewer: the host's START once enough players sit; everyone else, what they wait for. */
export interface RoomStart {
  /** START shows, enabled (the host, an open room, enough players). */
  canStart: boolean;
  /** The plaque's word. */
  label: string;
  /** One line beside it (null = none). */
  note: string | null;
}
export function roomStartOf(args: {
  mode: VersusRoomMode; status: VersusRoom['status']; seated: number; host: boolean; isPlayer: boolean;
  running: boolean; phase: string | null; round: number | null; gateLeft: number | null;
}): RoomStart {
  const { mode, status, seated, host, isPlayer, running, phase, round, gateLeft } = args;
  const need = VERSUS_MODE_SEATS[mode].min;
  if (status === 'sealed') {
    return { canStart: false, label: 'Starting', note: isPlayer ? null : `The players are getting ready.${gateLeft != null ? ` ${gateLeft}s left.` : ''}` };
  }
  if (running) {
    if (isPlayer) return { canStart: false, label: 'In game', note: null };
    if (phase === 'hero_select') return { canStart: false, label: 'In game', note: 'The players are choosing heroes.' };
    return { canStart: false, label: 'Watch', note: round ? `Round ${round} is live.` : null };
  }
  if (status !== 'open') return { canStart: false, label: 'In game', note: null };
  if (seated < need) {
    const missing = need - seated;
    const who = mode === 'duel' ? 'an opponent' : missing === 1 ? 'one more player' : `${missing} more players`;
    return { canStart: false, label: 'Start', note: mode === 'group' ? `Needs three or four players. Waiting for ${who}.` : `Waiting for ${who}.` };
  }
  if (!host) return { canStart: false, label: 'Ready', note: 'The host starts the match.' };
  return { canStart: true, label: 'Start', note: mode === 'group' && seated < 4 ? 'A fourth player can still sit.' : null };
}

/** THE HOST SITS BY DEFAULT (critic round 3): a room I host, still open, with me alone in its stands. */
export function hostSitsFirst(room: Pick<VersusRoom, 'host_user_id' | 'status' | 'members'>, me: string | null): boolean {
  if (!me || room.host_user_id !== me || room.status !== 'open' || room.members.length !== 1) return false;
  return room.members[0]!.userId === me && room.members[0]!.role === 'spectator';
}

/** An open seat's line for this viewer. */
export function openSeatText(args: { open: boolean; mine: VersusMember | null }): { label: string; sub: string | null; take: boolean } {
  const { open, mine } = args;
  if (!open) return { label: 'Open seat', sub: null, take: false };
  if (!mine) return { label: 'Open seat', sub: 'Waiting for a player', take: false };
  if (mine.role === 'spectator') return { label: 'Open seat', sub: 'Drag your card here, or', take: true };
  return { label: 'Open seat', sub: 'Drag your card here, or', take: true };
}
