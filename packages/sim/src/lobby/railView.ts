import { roundLossCap } from '../reducer';
import { boardIntel, driverFor, playerOpponent, seatScoutIntel, type LobbySeatState, type RunLobby, type SeatIntel } from './runLobby';

/**
 * THE LOBBY RAIL'S NUMBERS, as one pure read (owner 2026-10-16: "make sure that it is accurate", R-LOBBY-RAIL-01).
 *
 * Everything the rail prints about the table that is not art or animation comes from here: the round, the round's
 * max damage, how many seats are left, the row ORDER, each row's health, Armor and placement, and which row is your
 * next opponent (and whether that opponent is a ghost). `LobbyPanel` renders exactly this, and
 * `railAccuracy.test.ts` plays real lobbies and checks every field of it against what the round actually did, so
 * the panel cannot drift from the table without a test failing.
 *
 * `self`: YOUR row's live health. The run takes your hit the moment the fight settles, while the seat is only
 * re-synced when the table settles (`resolveCombat`), so your row reads the run (owner report 2026-08-25). Absent =
 * the seat (Versus, whose seats carry the hearts).
 */
export interface LobbyRailRow {
  id: string;
  label: string;
  heroId: string;
  alive: boolean;
  resolve: number;
  armor: number;
  /** `#N` on a fallen row. Absent = still standing. */
  placement?: number;
  you: boolean;
  /** Your opponent this round (the seat `playerOpponent` serves). */
  next: boolean;
  /** That opponent is a fallen seat's GHOST board (a bye, or a paired seat that fields nothing). */
  ghost: boolean;
}

export interface LobbyRailView {
  round: number;
  /** The round's loss cap (`roundLossCap`): Infinity = "No cap". */
  lossCap: number;
  /** "N left". */
  left: number;
  rows: LobbyRailRow[];
  /** `playerOpponent(lobby)`, read once (its board feeds the foe's scout card). */
  opponent: ReturnType<typeof playerOpponent>;
}

export function lobbyRailView(
  lobby: RunLobby,
  opts: { self?: { resolve: number; armor: number }; hideSelf?: boolean; opponent?: ReturnType<typeof playerOpponent> } = {},
): LobbyRailView {
  const opponent = opts.opponent !== undefined ? opts.opponent : playerOpponent(lobby);
  const hp = (s: LobbySeatState): { resolve: number; armor: number } =>
    s.id === 's0' && opts.self ? opts.self : { resolve: s.resolve, armor: s.armor };
  const shown = opts.hideSelf ? lobby.seats.filter((s) => s.id !== 's0') : lobby.seats;
  const rows: LobbyRailRow[] = shown.map((s) => {
    const h = hp(s);
    const next = opponent?.seat.id === s.id;
    return {
      id: s.id, label: s.label, heroId: s.heroId, alive: s.alive,
      // A fallen seat's pools can sit below zero (an overkill hit); it shows its placement, never a negative number.
      resolve: Math.max(0, h.resolve), armor: Math.max(0, h.armor),
      ...(s.alive || s.placement === undefined ? {} : { placement: s.placement }),
      you: s.id === 's0', next, ghost: next && !!opponent?.ghost,
    };
  });
  // Living seats first, strongest (Resolve + Armor) to weakest; the fallen beneath, best placement first. Ties keep
  // seat order, the same tiebreak the bye rule's standing uses (`pairRunLobby`), so "bottom three" means on screen
  // what it means there.
  const order = new Map(lobby.seats.map((s, i) => [s.id, i]));
  rows.sort((a, b) => {
    if (a.alive !== b.alive) return a.alive ? -1 : 1;
    const byHp = a.alive ? (b.resolve + b.armor) - (a.resolve + a.armor) : (a.placement ?? 99) - (b.placement ?? 99);
    return byHp || order.get(a.id)! - order.get(b.id)!;
  });
  return {
    round: lobby.round,
    lossCap: roundLossCap(lobby.rules, lobby.round),
    left: lobby.seats.filter((s) => s.alive).length,
    rows,
    opponent,
  };
}

/**
 * The intel a seat's scout card shows: the imminent opponent's comes off the board it is bringing (`opponent`, read
 * once by the rail), every other seat's off `seatScoutIntel`. Both are the board for the round the viewer is IN.
 *
 * ONE RULE FOR EVERY ROW (R-LOBBY-RAIL-01): a recorded seat this client cannot resolve to its real run is driven here
 * by a generated stand-in (`driverFor`). That happens to a LIVE-GAME WATCHER whose own pool does not hold the
 * watched game's recordings. Every other row already shows the seat's recorded read then (`seatScoutIntel`), never the
 * stand-in's invented board; the next opponent's row used to show the stand-in's board, so a watcher saw a Shop Tier,
 * build and runes that player never had. It now follows the same rule.
 */
export function railSeatIntel(lobby: RunLobby, seat: LobbySeatState, opponent: ReturnType<typeof playerOpponent>): SeatIntel | undefined {
  const standIn = seat.kind === 'snapshot' && !driverFor(seat, lobby.setId)?.realPlayer;
  // A ghost's board is the one it fell with, so its read is dated to that round, exactly as `seatScoutIntel` dates it.
  if (opponent && opponent.seat.id === seat.id && !standIn) {
    return boardIntel(opponent.board, opponent.ghost ? (seat.eliminatedRound ?? lobby.round) : lobby.round);
  }
  return seatScoutIntel(lobby, seat);
}
