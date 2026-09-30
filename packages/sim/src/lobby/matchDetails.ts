import type { BoardMinion, Keyword, Tribe } from '@game/core';
import { parseCosmeticSnapshot, type RunCosmeticSnapshot } from '@game/progression';
import type { BoardSnapshot } from '../snapshot';
import { driverFor, type LobbySeatState, type RunLobby } from './runLobby';
import type { PreparedBoard } from './types';

/**
 * MATCH DETAILS (owner ask 2026-09-28; a player's Discord request: "i placed 6th but wanted to see what everyone
 * else looked like at the time of my loss").
 *
 * A compact, serializable record of the WHOLE table at the moment YOUR game ended: every seat's name, hero,
 * placement (or that it was still standing), health, and the board it had then. The end screen shows it, and the
 * same object rides into the run's saved record (the ranked `run_history.entry.match`, the practice
 * `practice_games.replay.match`) so the Career's match history can show it again on any device.
 *
 * THE BOARDS ARE RECORDED, NEVER RECOMPUTED. Each board is exactly what the lobby itself fielded for that seat
 * (`driver.prepare(round) ?? driver.finalBoard()`, the same call `settleRunLobbyRound` and `ghostFor` make), and it
 * is captured ONCE at run end and then stored. Reading it back later never touches a driver, a pool or `simulate`.
 *
 * WHICH ROUND ("the moment your game ended"): your elimination round, or the last round played when you won (or
 * when Practice's curtain fell). A seat still standing then shows its board from that round; a seat knocked out
 * EARLIER shows the board it was knocked out with (the same board the lobby raises as its ghost).
 *
 * Additive and optional everywhere it is stored: an older record simply has no `match`, and the UI says so.
 */

/** Bump only on a BREAKING shape change; `parseMatchDetails` drops anything it cannot read. */
export const MATCH_DETAILS_VERSION = 1;

/** Hard cap on the serialized record (bytes of JSON). A full 8-seat table measures ~5-9 KB; past this the card
 *  text is dropped first (the card still renders its printed text), then boards are trimmed. */
export const MATCH_DETAILS_MAX_BYTES = 16_000;

/** Longest baked card text kept per minion. Live scaling text is short; anything longer is junk. */
const TEXT_CAP = 280;
const BOARD_CAP = 7;
const SEAT_CAP = 8;
const RUNE_CAP = 12;
const ID_RE = /^[A-Za-z0-9_.:-]{1,64}$/;

/** One seat's board at the recorded moment: the fields a card needs to render, nothing the engine needs. */
export interface MatchBoard {
  /** The lobby round this board is from. */
  round: number;
  tier: number;
  minions: BoardMinion[];
  /** The seat's OWNED rune ids at that moment, in acquisition order (a duplicate rune legitimately repeats). Read off
   *  the board snapshot (`BoardSnapshot.runes`), capped. Absent = none owned, or a record from before runes rode it
   *  (2026-09-28); authored practice bots own none. */
  runes?: string[];
}

export interface MatchSeat {
  /** Lobby seat id (`s0` is the player whose record this is). */
  id: string;
  /** Display name. For your own seat this is your handle at the time, not "You". */
  name: string;
  heroId: string;
  /** Present only on the record owner's own seat. */
  self?: true;
  /** The record owner's equipped title at the time (only known for your own seat). */
  titleId?: string;
  /** The seat's run key in the fight ledger (`author|heroId|seed`), for seats that ARE a real player's run: a
   *  recorded snapshot seat, and your own seat in a ranked game. What the Hall of Champions crown is looked up by.
   *  Absent for generated / bot seats and for your own practice seat (practice writes no ledger). */
  runKey?: string;
  /** A seat that presents as a bot (Practice's bot table). Generated `hybrid` seats are not tagged. */
  bot?: true;
  /** Final placement, when known at the recorded moment. Absent = still standing then. */
  placement?: number;
  eliminatedRound?: number;
  /** Resolve + Armor at the recorded moment (0 once knocked out). */
  health: number;
  armor: number;
  board: MatchBoard | null;
  /** The skins this seat's owner wore (display only; filtered through the opponent toggle by the UI). */
  cosmetics?: RunCosmeticSnapshot;
  /** BOARD STRENGTH (R-LOBBY-09, 2026-09-30): the run's strength percentile (1-100) as it stood when the game ended.
   *  An opponent seat carries its run's pool strength; your own seat the average of your rounds. Absent = not
   *  scored (generated seats, older records, a score that was not ready): the UI then shows nothing. */
  strength?: number;
  /** Your own seat only: the strength of each round's board, in round order. */
  roundStrength?: MatchRoundStrength[];
}

/** One round's board strength (a percentile, 1-100). */
export interface MatchRoundStrength { round: number; value: number }

export interface MatchDetails {
  v: 1;
  /** The round your game ended on. */
  endRound: number;
  /** Your finish (1 = won). */
  placement: number;
  /** Did your seat get knocked out (false = you won, or Practice ended the game)? */
  eliminated: boolean;
  /** Who you fought in `endRound`, when that fight knocked you out. */
  knockedOutBy?: string;
  /** Every seat, already in scoreboard order. */
  seats: MatchSeat[];
}

export interface MatchDetailsInput {
  /** Your display name (the seat's own label is "You"). */
  name: string;
  /** Your placement as the end screen shows it. */
  placement: number;
  /** Your board at the end (the end-state board the Career and the leaderboard show). */
  selfBoard: Pick<BoardSnapshot, 'minions' | 'tier' | 'runes'> | null;
  selfCosmetics?: RunCosmeticSnapshot | null;
  titleId?: string | null;
  /** Your own run's ledger key (ranked only; see `MatchSeat.runKey`). */
  selfRunKey?: string | null;
  /** Your board strength, when it was scored by the time the record is built (see `MatchSeat.strength`). */
  selfStrength?: { value: number | null; rounds: readonly MatchRoundStrength[] } | null;
}

const pctOf = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) && v >= 1 && v <= 100 ? Math.round(v) : undefined;
const roundsOf = (v: unknown): MatchRoundStrength[] =>
  Array.isArray(v)
    ? v.map((r) => (r && typeof r === 'object' ? { round: (r as MatchRoundStrength).round, value: pctOf((r as MatchRoundStrength).value) } : null))
      .filter((r): r is MatchRoundStrength => !!r && typeof r.round === 'number' && Number.isFinite(r.round) && r.value !== undefined)
      .slice(0, 80)
    : [];

/** The round your game ended on: your knockout round, else the last settled round. */
export function matchEndRound(lobby: Pick<RunLobby, 'seats' | 'round'>): number {
  const me = lobby.seats[0];
  return me?.eliminatedRound ?? Math.max(1, lobby.round - 1);
}

/** Which round's board a seat shows: its knockout round if that came first, else your end round. */
export function seatBoardRound(seat: Pick<LobbySeatState, 'alive' | 'eliminatedRound'>, endRound: number): number {
  return seat.eliminatedRound !== undefined && seat.eliminatedRound < endRound ? seat.eliminatedRound : endRound;
}

/** Keep only what a card renders (`storedCardView`), capping text. The inspect breakdown (`buffs`) is dropped. */
function compactMinion(m: BoardMinion, keepText: boolean): BoardMinion {
  const out: BoardMinion = { cardId: m.cardId, attack: m.attack, health: m.health };
  if (m.golden) out.golden = true;
  if (m.keywords && m.keywords.length) out.keywords = [...m.keywords] as Keyword[];
  if (m.name) out.name = m.name;
  if (m.tribe) out.tribe = m.tribe;
  if (m.addedTribes && m.addedTribes.length) out.addedTribes = [...m.addedTribes] as Tribe[];
  if (keepText) {
    if (typeof m.text === 'string' && m.text) out.text = m.text.slice(0, TEXT_CAP);
    if (typeof m.goldenText === 'string' && m.goldenText) out.goldenText = m.goldenText.slice(0, TEXT_CAP);
  }
  return out;
}

function runesOf(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((id): id is string => typeof id === 'string' && ID_RE.test(id)).slice(0, RUNE_CAP) : [];
}

function boardOf(minions: readonly BoardMinion[], tier: number, round: number, keepText: boolean, runes?: readonly string[]): MatchBoard {
  const out: MatchBoard = { round, tier, minions: minions.slice(0, BOARD_CAP).map((m) => compactMinion(m, keepText)) };
  const r = runesOf(runes);
  if (r.length) out.runes = r;
  return out;
}

/** The board the lobby fielded for `seat` in `round` (the lobby's own call; recorded seats are pure lookups). */
function fieldedBoard(lobby: RunLobby, seat: LobbySeatState, round: number): PreparedBoard | null {
  const d = driverFor(seat, lobby.setId);
  try {
    return d?.prepare(round) ?? d?.finalBoard?.() ?? null;
  } catch {
    return null; // a seat that cannot be read back degrades to "no board", never breaks the end screen
  }
}

/**
 * Scoreboard order: placed seats by placement; seats still standing at the recorded moment by health. When YOU
 * were knocked out, everyone still standing finished above you, so they come first. When you won (or Practice
 * ended the game with you standing) you come first, then anyone else still standing, then the placed seats.
 */
export function orderMatchSeats<T extends Pick<MatchSeat, 'id' | 'placement' | 'health' | 'armor'>>(seats: readonly T[], selfId = 's0', eliminated = true): T[] {
  const standing = (s: T): boolean => s.placement === undefined;
  const hp = (s: T): number => s.health + s.armor;
  const byHealth = (a: T, b: T): number => hp(b) - hp(a) || a.id.localeCompare(b.id);
  const self = seats.find((s) => s.id === selfId);
  const others = seats.filter((s) => s !== self);
  const up = others.filter(standing).sort(byHealth);
  const placed = others.filter((s) => !standing(s)).sort((a, b) => a.placement! - b.placement! || byHealth(a, b));
  if (!self) return [...up, ...placed];
  if (eliminated) {
    // Everyone still standing, then every placed seat, with you slotted in by placement.
    const all = [...placed, self].sort((a, b) => (a.placement ?? 0) - (b.placement ?? 0) || (a === self ? -1 : b === self ? 1 : byHealth(a, b)));
    return [...up, ...all];
  }
  const ahead = placed.filter((s) => s.placement! < (self.placement ?? 1));
  const behind = placed.filter((s) => s.placement! >= (self.placement ?? 1));
  return [...ahead, self, ...up, ...behind];
}

/**
 * Build the match record from a finished lobby. Call ONCE at run end (off the interaction path): recorded seats are
 * cheap lookups, but a driver the session has not built yet costs a rebuild.
 */
export function buildMatchDetails(lobby: RunLobby, input: MatchDetailsInput): MatchDetails {
  const endRound = matchEndRound(lobby);
  const me = lobby.seats[0]!;
  const eliminated = !me.alive;
  const encounter = lobby.encounters.find((e) => e.round === endRound && e.fought && (e.a === me.id || e.b === me.id));
  const knockedOutBy = eliminated && encounter ? (encounter.a === me.id ? encounter.b : encounter.a) : undefined;

  const build = (keepText: boolean): MatchDetails => {
    const seats: MatchSeat[] = lobby.seats.slice(0, SEAT_CAP).map((seat) => {
      const isSelf = seat.id === me.id;
      const placement = isSelf ? input.placement : seat.placement;
      const out: MatchSeat = {
        id: seat.id,
        name: isSelf ? input.name : seat.label,
        heroId: seat.heroId,
        health: Math.max(0, seat.resolve),
        armor: Math.max(0, seat.armor),
        board: null,
      };
      if (isSelf) out.self = true;
      if (isSelf && input.titleId) out.titleId = input.titleId;
      const runKey = isSelf ? input.selfRunKey : seat.kind === 'snapshot' ? seat.runKey : undefined;
      if (runKey && runKey.length <= 160) out.runKey = runKey;
      // Only a seat that PRESENTS as a bot (Practice's bot table, a balance bot) is tagged. A generated `hybrid` seat
      // sits at the table under a player-style handle, like a recorded run, and stays untagged here too.
      if (seat.kind === 'bot' || seat.kind === 'authored') out.bot = true;
      if (typeof placement === 'number' && placement > 0) out.placement = placement;
      if (seat.eliminatedRound !== undefined) out.eliminatedRound = seat.eliminatedRound;
      if (!seat.alive) { out.health = 0; out.armor = 0; }
      if (isSelf) {
        if (input.selfBoard) out.board = boardOf(input.selfBoard.minions, input.selfBoard.tier, endRound, keepText, input.selfBoard.runes);
        const c = parseCosmeticSnapshot(input.selfCosmetics);
        if (c) out.cosmetics = c;
        const st = pctOf(input.selfStrength?.value);
        if (st !== undefined) out.strength = st;
        const rs = roundsOf(input.selfStrength?.rounds);
        if (rs.length) out.roundStrength = rs;
      } else {
        const round = seatBoardRound(seat, endRound);
        const b = fieldedBoard(lobby, seat, round);
        if (b) out.board = boardOf(b.minions, b.tier, round, keepText, b.snapshot?.runes);
        const c = parseCosmeticSnapshot(seat.cosmetics ?? b?.snapshot?.cosmetics);
        if (c) out.cosmetics = c;
        // The run's pool strength, frozen here (a recorded seat's boards all carry it, stamped at pool load).
        const st = seat.kind === 'snapshot' ? pctOf(b?.snapshot?.runStrength) : undefined;
        if (st !== undefined) out.strength = st;
      }
      return out;
    });
    return {
      v: 1, endRound, placement: input.placement, eliminated,
      ...(knockedOutBy ? { knockedOutBy } : {}),
      seats: orderMatchSeats(seats, me.id, eliminated),
    };
  };

  let details = build(true);
  if (matchDetailsBytes(details) > MATCH_DETAILS_MAX_BYTES) details = build(false);
  // Last resort (never measured in practice): trim boards from the back of the table until it fits.
  for (let i = details.seats.length - 1; i >= 0 && matchDetailsBytes(details) > MATCH_DETAILS_MAX_BYTES; i--) {
    const s = details.seats[i]!;
    if (!s.self && s.board) s.board = { ...s.board, minions: [] };
  }
  return details;
}

/** The serialized size, in bytes (UTF-8 is close enough to the string length for this ASCII-heavy payload). */
export function matchDetailsBytes(d: MatchDetails): number {
  return JSON.stringify(d).length;
}

// ── Reading a stored record back ─────────────────────────────────────────────────────────────────────────────
// Tolerant by design: a stored record may come from an older or newer build, or be absent. Anything unreadable is
// dropped; a record with no readable seats is `null` (the UI then says the details were not recorded).

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);

function parseMinion(v: unknown): BoardMinion | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const cardId = str(o.cardId);
  const attack = num(o.attack);
  const health = num(o.health);
  if (!cardId || attack === undefined || health === undefined) return null;
  const m: BoardMinion = { cardId, attack, health };
  if (o.golden === true) m.golden = true;
  if (Array.isArray(o.keywords)) m.keywords = o.keywords.filter((k): k is Keyword => typeof k === 'string');
  if (str(o.name)) m.name = str(o.name);
  if (str(o.tribe)) m.tribe = str(o.tribe) as Tribe;
  if (Array.isArray(o.addedTribes)) m.addedTribes = o.addedTribes.filter((t): t is Tribe => typeof t === 'string');
  if (str(o.text)) m.text = str(o.text)!.slice(0, TEXT_CAP);
  if (str(o.goldenText)) m.goldenText = str(o.goldenText)!.slice(0, TEXT_CAP);
  return m;
}

function parseBoard(v: unknown): MatchBoard | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (!Array.isArray(o.minions)) return null;
  const minions = o.minions.slice(0, BOARD_CAP).map(parseMinion).filter((m): m is BoardMinion => m !== null);
  const out: MatchBoard = { round: num(o.round) ?? 0, tier: num(o.tier) ?? 1, minions };
  const runes = runesOf(o.runes);
  if (runes.length) out.runes = runes;
  return out;
}

function parseSeat(v: unknown): MatchSeat | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const id = str(o.id);
  const heroId = typeof o.heroId === 'string' ? o.heroId : undefined;
  if (!id || heroId === undefined) return null;
  const s: MatchSeat = {
    id, name: str(o.name) ?? 'Player', heroId,
    health: Math.max(0, num(o.health) ?? 0), armor: Math.max(0, num(o.armor) ?? 0),
    board: parseBoard(o.board),
  };
  if (o.self === true) s.self = true;
  if (str(o.titleId)) s.titleId = str(o.titleId);
  if (o.bot === true) s.bot = true;
  const rk = str(o.runKey);
  if (rk && rk.length <= 160) s.runKey = rk;
  const placement = num(o.placement);
  if (placement !== undefined && placement > 0) s.placement = placement;
  const er = num(o.eliminatedRound);
  if (er !== undefined) s.eliminatedRound = er;
  const c = parseCosmeticSnapshot(o.cosmetics);
  if (c) s.cosmetics = c;
  const st = pctOf(o.strength);
  if (st !== undefined) s.strength = st;
  const rs = roundsOf(o.roundStrength);
  if (rs.length) s.roundStrength = rs;
  return s;
}

/** Read a stored match record; `null` when absent or unreadable (older matches). Keeps the stored order. */
export function parseMatchDetails(v: unknown): MatchDetails | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (o.v !== MATCH_DETAILS_VERSION || !Array.isArray(o.seats)) return null;
  const seats = o.seats.slice(0, SEAT_CAP).map(parseSeat).filter((s): s is MatchSeat => s !== null);
  if (seats.length === 0) return null;
  const endRound = num(o.endRound) ?? 1;
  const placement = num(o.placement) ?? seats.find((s) => s.self)?.placement ?? 0;
  const out: MatchDetails = { v: 1, endRound, placement, eliminated: o.eliminated === true, seats };
  const k = str(o.knockedOutBy);
  if (k) out.knockedOutBy = k;
  return out;
}
