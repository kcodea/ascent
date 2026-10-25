/**
 * VERSUS GROUP — the display lobby a 3-4 player match is shown through (owner 2026-10-24: "we'd replace the 'enemy hero'
 * ui element we made with versus, with the lobby rail we have in the normal ranked mode, but it'd just have the 4
 * players on the rail instead of 8, and show a 'Copy' in the 4th slot if only 3 players are playing, and that would
 * change based on who is copied that round"; R-VERSUS-GROUP-03).
 *
 * The 1v1 twin is `versusLobby` (lobbyView.ts); this is the same idea for N seats, so the ordinary ranked rail, the
 * combat scene (portrait, name, skin, board), the scout cards and the FightRecap all read it unchanged:
 *  - `s0` is the player, `s1..` every other seat in seat order, each an `authored` seat whose per-round board is the
 *    board that seat actually fielded in its fight that round (public fight rows), its tier from that round's scout.
 *  - HEARTS ride `resolve` (7, no Armor), with the 1v1 timing: YOUR hearts drop when your fight settles, everyone
 *    else's when you leave the fight. A seat out of the match is `alive: false` with its server placement, shown from
 *    the round after it went out.
 *  - THE COPY (`sc`): while the current round has a copy fight, one more row, "Copy of <name>", carrying that round's
 *    copied board (and the copied player's hearts); it is the player's opponent when they are the one facing it.
 *  - `forcedOpponent` pins the player's opponent to the server's round-robin pairing, so nothing here pairs the table.
 * Display state only: the reducer never settles it, and no persistence path takes it (the UI gates key on the mode).
 */
import type { CombatResult, Keyword } from '@game/core';
import type { RunCosmeticSnapshot } from '@game/progression';
import type { SetId } from '@game/content';
import type { RunLobby, LobbySeatState, VersusSeatScout } from '../lobby/runLobby';
import type { LobbyEncounter } from '../lobby/types';
import type { AuthoredOmen } from '../lobby/tutorialSeats';
import { VERSUS_HEARTS } from './constants';
import type { VersusGroupPairing, VersusGroupSeat } from './group';

/** The Copy row's seat id. */
export const VERSUS_COPY_SEAT_ID = 'sc';

export interface VersusGroupLobbySeat {
  seat: VersusGroupSeat;
  label: string;
  heroId: string;
  cosmetics?: RunCosmeticSnapshot;
  /** The round the seat went out in (null = still in). */
  eliminatedRound: number | null;
  placement: number | null;
}

export interface VersusGroupLobbyFight {
  a: VersusGroupSeat;
  b: VersusGroupSeat;
  copy: boolean;
  heartLostBy: VersusGroupSeat | null;
  /** Side a's own perspective (initial.player = a's board, initial.enemy = b's or the copy's). */
  aResult: Pick<CombatResult, 'initial' | 'result'> & Partial<Pick<CombatResult, 'damageBreakdown' | 'duosBoards'>>;
  aScout?: VersusSeatScout | null;
  bScout?: VersusSeatScout | null;
}

export interface VersusGroupLobbyRound {
  round: number;
  /** Every seat's hearts after the round. */
  hearts: Partial<Record<VersusGroupSeat, number>>;
  fights: VersusGroupLobbyFight[];
}

export interface VersusGroupLobbyInput {
  matchSeed: number;
  setId?: SetId;
  /** The player's seat. */
  me: VersusGroupSeat;
  wave: number;
  inCombat: boolean;
  combatSettled: boolean;
  /** Every seat of the match, the player's included (their hero is the run's). */
  seats: readonly VersusGroupLobbySeat[];
  rounds: readonly VersusGroupLobbyRound[];
  /** The fights of the round being played (`versusGroupPairings` for `wave`). */
  pairing: readonly VersusGroupPairing[];
  /** VERSUS DUOS (R-DUOS-01): the round's fight order. Present = a Duos match: the teammate's row comes first after
   *  yours, every seat's board is the one it LOCKED for the round (its teammate's included, even when it never stepped
   *  in), and your opponent is the other team's first board. */
  duos?: { first: { a: VersusGroupSeat; b: VersusGroupSeat } };
}

/** The Copy row's name: who is copied this round. */
export const versusCopyLabel = (name: string): string => `Copy of ${name}`;

function omenOf(m: Pick<CombatResult['initial']['enemy'][number], 'cardId' | 'attack' | 'health'> & { golden?: boolean; keywords?: readonly Keyword[] }): AuthoredOmen {
  return {
    cardId: m.cardId,
    attack: m.attack,
    health: m.health,
    ...(m.golden ? { golden: true } : {}),
    ...(m.keywords?.length ? { addedKeywords: [...m.keywords] } : {}),
  };
}

/** A seat's hearts after the last round shown (`through`), from the rounds' snapshots. */
function heartsThrough(seat: VersusGroupSeat, rounds: readonly VersusGroupLobbyRound[], through: number): number {
  let h = VERSUS_HEARTS;
  for (const r of rounds) if (r.round <= through && r.hearts[seat] != null) h = r.hearts[seat]!;
  return Math.max(0, h);
}

/** Per-round boards / tiers / scouts for one board source (a seat, or the Copy), index = round - 1. */
function track(rounds: readonly VersusGroupLobbyRound[], pick: (r: VersusGroupLobbyRound) => { board: AuthoredOmen[]; scout: VersusSeatScout | null; tier?: number } | null) {
  const boards: AuthoredOmen[][] = [];
  const tiers: number[] = [];
  const scouts: (VersusSeatScout | null)[] = [];
  let lastTier = 1;
  for (const r of rounds) {
    const got = pick(r);
    if (!got) continue;
    while (boards.length < r.round - 1) boards.push(boards[boards.length - 1] ?? []);
    while (tiers.length < r.round - 1) tiers.push(lastTier);
    while (scouts.length < r.round - 1) scouts.push(scouts[scouts.length - 1] ?? null);
    boards[r.round - 1] = got.board;
    lastTier = got.scout?.tier ?? got.tier ?? lastTier;
    tiers[r.round - 1] = lastTier;
    scouts[r.round - 1] = got.scout;
  }
  return { boards, tiers, scouts };
}

export function versusGroupLobby(input: VersusGroupLobbyInput): RunLobby {
  const rounds = [...input.rounds].sort((a, b) => a.round - b.round);
  const mineThrough = input.inCombat && input.combatSettled ? input.wave : input.wave - 1;
  const othersThrough = input.wave - 1;
  const ordered = [...input.seats].sort((x, y) => x.seat.localeCompare(y.seat));
  const me = ordered.find((s) => s.seat === input.me);
  const mate = input.duos ? ({ p1: 'p2', p2: 'p1', p3: 'p4', p4: 'p3' } as const)[input.me] : null;
  // Duos: the teammate's row sits right under yours, then the other team in seat order.
  const others = ordered.filter((s) => s.seat !== input.me).sort((x, y) => (x.seat === mate ? -1 : y.seat === mate ? 1 : 0));
  const idOf = new Map<VersusGroupSeat, string>([[input.me, 's0'], ...others.map((s, i) => [s.seat, `s${i + 1}`] as const)]);
  const seed = (n: number): number => (input.matchSeed ^ (0x7e55a11d + n * 0x9e37)) | 0;

  // The board a seat fielded in its own fight each round.
  const seatTrack = (seat: VersusGroupSeat) => track(rounds, (r) => {
    if (input.duos) {
      // Duos: one fight a round; every seat's locked board rides the result by real seat.
      const f = r.fights[0];
      const board = f?.aResult.duosBoards?.[seat];
      if (!f || !board) return null;
      const teamA = seat === 'p1' || seat === 'p2';
      return { board: board.map(omenOf), scout: (teamA ? f.aScout : f.bScout) ?? null, ...(teamA ? {} : { tier: f.aResult.damageBreakdown?.oppTier }) };
    }
    for (const f of r.fights) {
      if (f.a === seat) return { board: f.aResult.initial.player.map(omenOf), scout: f.aScout ?? null };
      if (f.b === seat && !f.copy) return { board: f.aResult.initial.enemy.map(omenOf), scout: f.bScout ?? null, tier: f.aResult.damageBreakdown?.oppTier };
    }
    return null;
  });

  const seats: LobbySeatState[] = [{
    id: 's0', label: me?.label ?? '', heroId: me?.heroId ?? '', kind: 'player', seed: 0,
    resolve: heartsThrough(input.me, rounds, mineThrough), armor: 0, alive: true,
    ...(me?.cosmetics ? { cosmetics: me.cosmetics } : {}),
  }];
  others.forEach((s, i) => {
    const t = seatTrack(s.seat);
    const out = s.eliminatedRound != null && s.eliminatedRound <= othersThrough;
    seats.push({
      id: idOf.get(s.seat)!, label: s.label, heroId: s.heroId, kind: 'authored', seed: seed(i + 1),
      authoredBoards: t.boards, authoredTiers: t.tiers, invulnerable: true,
      ...(t.scouts.some((x) => x) ? { authoredScouts: t.scouts } : {}),
      resolve: heartsThrough(s.seat, rounds, othersThrough), armor: 0, alive: !out,
      ...(out ? { eliminatedRound: s.eliminatedRound!, ...(s.placement != null ? { placement: s.placement } : {}) } : {}),
      ...(s.cosmetics ? { cosmetics: s.cosmetics } : {}),
    });
  });

  // THE COPY: present while this round has a copy fight; it fields the copied seat's latest board, and the boards of
  // every past copy fight for its history.
  const copyNow = input.pairing.find((p) => p.copy) ?? null;
  if (copyNow) {
    const copied = ordered.find((s) => s.seat === copyNow.b);
    const past = track(rounds, (r) => {
      const f = r.fights.find((x) => x.copy);
      return f ? { board: f.aResult.initial.enemy.map(omenOf), scout: f.bScout ?? null, tier: f.aResult.damageBreakdown?.oppTier } : null;
    });
    // The copied seat's own latest board stands in for this round until the fight shows the real one.
    const theirs = seatTrack(copyNow.b);
    const last = theirs.boards[theirs.boards.length - 1];
    const boards = past.boards.slice();
    const tiers = past.tiers.slice();
    if (last && boards.length < input.wave) {
      while (boards.length < input.wave - 1) boards.push(boards[boards.length - 1] ?? []);
      while (tiers.length < input.wave - 1) tiers.push(tiers[tiers.length - 1] ?? 1);
      boards.push(last);
      tiers.push(theirs.tiers[theirs.tiers.length - 1] ?? 1);
    }
    seats.push({
      id: VERSUS_COPY_SEAT_ID, label: versusCopyLabel(copied?.label ?? ''), heroId: copied?.heroId ?? me?.heroId ?? '',
      kind: 'authored', seed: seed(9), authoredBoards: boards, authoredTiers: tiers, invulnerable: true,
      resolve: heartsThrough(copyNow.b, rounds, othersThrough), armor: 0, alive: true,
      ...(copied?.cosmetics ? { cosmetics: copied.cosmetics } : {}),
    });
  }

  // My opponent this round, by the server's schedule.
  const mine = input.pairing.find((p) => p.a === input.me || (p.b === input.me && !p.copy));
  const foeId = input.duos
    ? idOf.get(input.me === 'p1' || input.me === 'p2' ? input.duos.first.b : input.duos.first.a) ?? null
    : !mine ? null : mine.copy ? VERSUS_COPY_SEAT_ID : idOf.get(mine.a === input.me ? mine.b : mine.a) ?? null;

  const encounters: LobbyEncounter[] = [];
  for (const r of rounds) {
    if (r.round > othersThrough) continue;
    for (const f of r.fights) {
      const a = idOf.get(f.a)!;
      const b = f.copy ? VERSUS_COPY_SEAT_ID : idOf.get(f.b)!;
      encounters.push({
        round: r.round, a, b, outcome: f.aResult.result, fought: true,
        damageToA: f.heartLostBy === f.a ? 1 : 0, damageToB: !f.copy && f.heartLostBy === f.b ? 1 : 0,
      });
    }
  }
  return {
    version: 1,
    seed: input.matchSeed,
    ...(input.setId ? { setId: input.setId } : {}),
    round: Math.max(1, input.wave),
    seats,
    encounters,
    finished: false,
    rules: { seatCount: seats.length, startingResolve: VERSUS_HEARTS, startingArmor: 0, exhaustion: 'repeatFinal', maxRounds: 1000, lossCaps: [] },
    unrated: 'all-generated',
    ...(foeId ? { forcedOpponent: { round: Math.max(1, input.wave), seatId: foeId } } : {}),
  };
}

/** A cheap identity for the inputs that change the view, so the client rebuilds only when something moved. */
export function versusGroupLobbyKey(input: VersusGroupLobbyInput): string {
  const last = input.rounds.reduce((n, r) => Math.max(n, r.round), 0);
  const seats = input.seats.map((s) => `${s.seat}:${s.heroId}:${s.label}:${s.eliminatedRound ?? ''}:${s.placement ?? ''}:${s.cosmetics ? 1 : 0}`).join(',');
  const pairing = input.pairing.map((p) => `${p.a}${p.copy ? '~' : '-'}${p.b}`).join(',') + (input.duos ? `|d${input.duos.first.a}${input.duos.first.b}` : '');
  return `g|${input.me}|${input.wave}|${input.inCombat ? 1 : 0}${input.combatSettled ? 1 : 0}|${last}|${input.rounds.length}|${seats}|${pairing}`;
}
