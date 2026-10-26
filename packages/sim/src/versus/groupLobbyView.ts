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
 *  - HEALTH AND ARMOR (owner 2026-10-26, R-VERSUS-HEALTH-01; hearts until then) ride `resolve` / `armor`, read off the
 *    server's per-round record (before round 1: each hero's start), with the 1v1 timing: YOUR pools drop when your
 *    fight settles, everyone else's when you leave the fight. The rules are the lobby's (the normal round cap). A seat
 *    out of the match is `alive: false` with its server placement, shown from the round after it went out.
 *  - DUOS: both teammates' rows carry the TEAM's shared pool (R-DUOS-HEALTH-01).
 *  - THE COPY (`sc`): while the current round has a copy fight, one more row, "Copy of <name>", carrying that round's
 *    copied board (and the copied player's pools); it is the player's opponent when they are the one facing it.
 *  - `forcedOpponent` pins the player's opponent to the server's round-robin pairing, so nothing here pairs the table.
 * Display state only: the reducer never settles it, and no persistence path takes it (the UI gates key on the mode).
 */
import type { BoardMinion, CombatResult, Keyword } from '@game/core';
import type { RunCosmeticSnapshot } from '@game/progression';
import type { SetId } from '@game/content';
import type { RunLobby, LobbySeatState, VersusSeatScout } from '../lobby/runLobby';
import type { LobbyEncounter } from '../lobby/types';
import type { AuthoredOmen } from '../lobby/tutorialSeats';
import type { VersusGroupPairing, VersusGroupSeat } from './group';
import { versusDuosStartingVitals, versusStartingVitals, type VersusVitals } from './vitals';
import { duosMateOf } from './duos';

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
  /** The seat that took the fight's damage (null: a draw, or a copy / ghost lost). */
  loser: VersusGroupSeat | null;
  /** The damage `loser` took (capped). */
  damage?: number;
  /** Side a's own perspective (initial.player = a's board, initial.enemy = b's or the copy's). */
  aResult: Pick<CombatResult, 'initial' | 'result'> & Partial<Pick<CombatResult, 'damageBreakdown' | 'duosBoards' | 'playerDamage' | 'enemyDamage'>>;
  aScout?: VersusSeatScout | null;
  bScout?: VersusSeatScout | null;
}

export interface VersusGroupLobbyRound {
  round: number;
  /** Every seat's Health and Armor after the round (Duos: each seat carries its team's pool). */
  vitals: Partial<Record<VersusGroupSeat, VersusVitals>>;
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
  /** The match's pinned room options (a modifier's Armor in each seat's start). */
  options?: unknown;
  /** VERSUS DUOS (R-DUOS-01): the round's fight order. Present = a Duos match: the teammate's row comes first after
   *  yours, every seat's board is the one it LOCKED for the round (its teammate's included, even when it never stepped
   *  in), and your opponent is the other team's first board. */
  duos?: { first: { a: VersusGroupSeat; b: VersusGroupSeat } };
  /** RANKED DUOS: a recorded member's board for THIS round (`versus_ranked_duos_table`), shown on its row and scout card
   *  exactly as a solo lobby shows a seat's current board (R-LOBBY-SCOUT-01). Keyed by its (virtual) seat. */
  current?: Partial<Record<string, { minions: BoardMinion[]; tier: number | null }>>;
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

/** A seat's pools after the last round shown (`through`), from the rounds' snapshots; before any, its `start`. */
function vitalsThrough(seat: VersusGroupSeat, rounds: readonly VersusGroupLobbyRound[], through: number, start: VersusVitals): VersusVitals {
  let v = start;
  for (const r of rounds) if (r.round <= through && r.vitals?.[seat]) v = r.vitals[seat]!;
  return { health: Math.max(0, v.health), armor: Math.max(0, v.armor) };
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
  const mate = input.duos ? duosMateOf(input.me) : null;
  // Duos: the teammate's row sits right under yours, then the other team in seat order.
  const others = ordered.filter((s) => s.seat !== input.me).sort((x, y) => (x.seat === mate ? -1 : y.seat === mate ? 1 : 0));
  const idOf = new Map<VersusGroupSeat, string>([[input.me, 's0'], ...others.map((s, i) => [s.seat, `s${i + 1}`] as const)]);
  const seed = (n: number): number => (input.matchSeed ^ (0x7e55a11d + n * 0x9e37)) | 0;
  // Each seat's start: its hero's Health and Armor (+ the modifier's Armor); Duos: the team's shared pool.
  const heroOf = (seat: VersusGroupSeat): string | undefined => ordered.find((s) => s.seat === seat)?.heroId;
  const startOf = (seat: VersusGroupSeat): VersusVitals => (input.duos
    ? versusDuosStartingVitals(heroOf(seat), heroOf(duosMateOf(seat)), input.options)
    : versusStartingVitals(heroOf(seat), input.options));
  const poolOf = (seat: VersusGroupSeat, through: number): { resolve: number; armor: number; startArmor: number } => {
    const start = startOf(seat);
    const v = vitalsThrough(seat, rounds, through, start);
    return { resolve: v.health, armor: v.armor, startArmor: start.armor };
  };

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
    ...poolOf(input.me, mineThrough), alive: true,
    ...(me?.cosmetics ? { cosmetics: me.cosmetics } : {}),
  }];
  others.forEach((s, i) => {
    const t = seatTrack(s.seat);
    // RANKED DUOS: this round's board of a recorded member stands in for the round being played.
    const now = input.current?.[s.seat];
    if (now && t.boards.length < input.wave) {
      while (t.boards.length < input.wave - 1) t.boards.push(t.boards[t.boards.length - 1] ?? []);
      while (t.tiers.length < input.wave - 1) t.tiers.push(t.tiers[t.tiers.length - 1] ?? 1);
      t.boards.push(now.minions.map(omenOf));
      t.tiers.push(now.tier ?? t.tiers[t.tiers.length - 1] ?? 1);
    }
    const out = s.eliminatedRound != null && s.eliminatedRound <= othersThrough;
    seats.push({
      id: idOf.get(s.seat)!, label: s.label, heroId: s.heroId, kind: 'authored', seed: seed(i + 1),
      authoredBoards: t.boards, authoredTiers: t.tiers, invulnerable: true,
      ...(t.scouts.some((x) => x) ? { authoredScouts: t.scouts } : {}),
      ...poolOf(s.seat, othersThrough), alive: !out,
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
      ...poolOf(copyNow.b, othersThrough), alive: true,
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
      // The capped blow each way (a copy or a ghost is never charged).
      encounters.push({
        round: r.round, a, b, outcome: f.aResult.result, fought: true,
        damageToA: f.loser === f.a ? f.damage ?? f.aResult.playerDamage ?? 0 : 0,
        damageToB: !f.copy && f.loser === f.b ? f.damage ?? f.aResult.enemyDamage ?? 0 : 0,
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
    // The lobby's rules: Health from the hero (Duos: the team's 30), each seat's own start Armor, the normal round cap
    // (no `lossCaps`: the rail's MAX DMG reads `lossDamageCap`).
    rules: { seatCount: seats.length, startingResolve: startOf(input.me).health, startingArmor: 0, exhaustion: 'repeatFinal', maxRounds: 1000 },
    unrated: 'all-generated',
    ...(foeId ? { forcedOpponent: { round: Math.max(1, input.wave), seatId: foeId } } : {}),
  };
}

/** A cheap identity for the inputs that change the view, so the client rebuilds only when something moved. */
export function versusGroupLobbyKey(input: VersusGroupLobbyInput): string {
  const last = input.rounds.reduce((n, r) => Math.max(n, r.round), 0);
  const seats = input.seats.map((s) => `${s.seat}:${s.heroId}:${s.label}:${s.eliminatedRound ?? ''}:${s.placement ?? ''}:${s.cosmetics ? 1 : 0}`).join(',');
  const pairing = input.pairing.map((p) => `${p.a}${p.copy ? '~' : '-'}${p.b}`).join(',') + (input.duos ? `|d${input.duos.first.a}${input.duos.first.b}` : '');
  const vit = input.rounds.filter((r) => Object.keys(r.vitals ?? {}).length).length;
  const cur = Object.entries(input.current ?? {}).map(([k, v]) => `${k}:${v?.minions.length ?? 0}:${v?.tier ?? ''}`).join(',');
  return `g|${input.me}|${input.wave}|${input.inCombat ? 1 : 0}${input.combatSettled ? 1 : 0}|${last}|${input.rounds.length}|${vit}|${seats}|${pairing}|${cur}`;
}
