import { combatSide, makeRng, simulate, type Rng } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { lossDamageCap } from '../reducer';
import type { LobbyRules, LobbySeat, LobbyState, SeatDriver } from './types';

export const DEFAULT_LOBBY_RULES: LobbyRules = {
  seatCount: 8,
  startingResolve: 30,
  startingArmor: 15,
  // `repeatFinal` by default: a recorded run is finite and the lobby is not, and eliminating a seat the moment
  // its recording ends would make lobby length depend on how long its owner survived rather than on play.
  exhaustion: 'repeatFinal',
  maxRounds: 60,
  // No snapshotSeats cap (owner call 2026-07-31): player runs fill EVERY non-player seat the pool can cover,
  // bots only take what's left. The old "minority on purpose" cap of 3 predates the pure-snapshot direction --
  // the table is now MEANT to be other players' runs, and it still degrades on its own: an empty pool seats
  // zero snapshots and every seat is generated, exactly as before.
};

export function createLobby(seed: number, drivers: readonly SeatDriver[], rules: Partial<LobbyRules> = {}): LobbyState {
  const r: LobbyRules = { ...DEFAULT_LOBBY_RULES, ...rules };
  return {
    version: 1,
    seed,
    rules: r,
    round: 1,
    seats: drivers.map((driver, i) => ({
      id: `s${i}`,
      driver,
      resolve: r.startingResolve,
      armor: r.startingArmor,
      alive: true,
    })),
    encounters: [],
    finished: false,
  };
}

/**
 * Deterministic pairing for one round.
 *
 * Greedy over a seeded shuffle, preferring an opponent this seat has met least often and least recently. Greedy
 * rather than a true maximum-weight matching because the prototype is testing whether the loop and the damage
 * feel right, not the matching quality — and a greedy pass over 8 seats is trivially inspectable. With an odd
 * number of survivors the last seat takes a bye. Swapping in proper matching later changes only this function.
 */
export function pairSeats(state: LobbyState, rng: Rng): { pairs: [LobbySeat, LobbySeat][]; bye: LobbySeat | null } {
  const living = state.seats.filter((s) => s.alive);
  // Seeded shuffle so ties don't always resolve in seat order (which would make seat 0 face seat 1 forever).
  const pool = [...living];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  const met = new Map<string, number>();
  const lastMet = new Map<string, number>();
  for (const e of state.encounters) {
    for (const key of [`${e.a}|${e.b}`, `${e.b}|${e.a}`]) {
      met.set(key, (met.get(key) ?? 0) + 1);
      lastMet.set(key, e.round);
    }
  }

  const pairs: [LobbySeat, LobbySeat][] = [];
  const taken = new Set<string>();
  for (const a of pool) {
    if (taken.has(a.id)) continue;
    let best: LobbySeat | null = null;
    let bestScore = Infinity;
    for (const b of pool) {
      if (b.id === a.id || taken.has(b.id)) continue;
      const key = `${a.id}|${b.id}`;
      // Fewest previous meetings wins; the longest-ago meeting breaks the tie.
      const score = (met.get(key) ?? 0) * 1000 - (state.round - (lastMet.get(key) ?? -999));
      if (score < bestScore) { bestScore = score; best = b; }
    }
    if (!best) continue;
    taken.add(a.id); taken.add(best.id);
    pairs.push([a, best]);
  }
  const bye = pool.find((s) => !taken.has(s.id)) ?? null;
  return { pairs, bye };
}

/** Apply damage through Armor first, then Resolve. Returns the seat's remaining effective HP. */
function applyDamage(seat: LobbySeat, amount: number): number {
  let left = Math.max(0, amount);
  const fromArmor = Math.min(seat.armor, left);
  seat.armor -= fromArmor;
  left -= fromArmor;
  seat.resolve -= left;
  return seat.armor + seat.resolve;
}

/**
 * Resolve one round: pair the survivors, fight each pair ONCE, apply both sides' damage, eliminate anyone who
 * hit zero.
 *
 * Fighting once and reading both sides' damage out of that single result is the load-bearing detail. Resolving
 * the same fight twice with the sides swapped can disagree — attack order alone can flip a close board — which
 * would let a lobby produce two contradictory truths about the same encounter.
 */
export function resolveRound(state: LobbyState): LobbyState {
  if (state.finished) return state;
  const rng = makeRng(state.seed ^ (state.round * 0x9e3779b9));
  const { pairs, bye } = pairSeats(state, rng);
  const eliminatedThisRound: LobbySeat[] = [];
  // Effective HP entering the round — the tiebreak for the wipeout guard below.
  const hpBefore = new Map(state.seats.map((s) => [s.id, s.armor + s.resolve]));

  for (const [a, b] of pairs) {
    // `repeatFinal` lives HERE, not in the driver: a driver reports what it has, the lobby decides what
    // running dry means. Without this the default policy silently behaved like `eliminate`.
    const keepLast = state.rules.exhaustion === 'repeatFinal';
    const boardA = a.driver.prepare(state.round) ?? (keepLast ? a.driver.finalBoard?.() ?? null : null);
    const boardB = b.driver.prepare(state.round) ?? (keepLast ? b.driver.finalBoard?.() ?? null : null);

    // A seat with no board this round can't fight. Under `eliminate` that's fatal; under `repeatFinal` the
    // driver already handed back its last board, so a null here means it genuinely never had one.
    if (!boardA || !boardB) {
      for (const [seat, board] of [[a, boardA], [b, boardB]] as const) {
        if (!board && state.rules.exhaustion === 'eliminate' && seat.alive) {
          seat.alive = false;
          seat.eliminatedRound = state.round;
          eliminatedThisRound.push(seat);
        }
      }
      state.encounters.push({ round: state.round, a: a.id, b: b.id, outcome: 'draw', damageToA: 0, damageToB: 0, fought: false });
      continue;
    }

    const r = simulate(
      boardA.minions, boardB.minions, rng, CARD_INDEX,
      combatSide({ tier: boardA.tier }), combatSide({ tier: boardB.tier }),
    );
    const cap = lossDamageCap(state.round);
    // COMBAT DAMAGE ONLY (owner ruling 2026-08-04). Stall pressure — an extra per-round hit on losers and on
    // both sides of a draw — used to be added here; `maxRounds` is now the only stalemate backstop, which does
    // mean a table of mirrored boards can run to that hard stop with everyone still alive.
    const dmgA = Math.min(cap, r.playerDamage);
    const dmgB = Math.min(cap, r.enemyDamage ?? 0);

    applyDamage(a, dmgA);
    applyDamage(b, dmgB);
    // Both seats settle from THIS ONE result. Measured over 325 real board pairings, resolving the same fight
    // with the sides swapped disagrees on the WINNER 22% of the time and on damage 62% of the time — combat is
    // not symmetric (attack order and tiebreaks favour the side passed as `player`). So a lobby that resolved
    // each seat's fight from its own perspective would routinely record two contradictory truths about one
    // encounter. Pinned by a test so nobody later "optimises" this into two resolves.
    a.driver.settle({
      round: state.round, outcome: r.result, damageTaken: dmgA, damageDealt: dmgB,
      seatResolve: a.resolve, seatArmor: a.armor,
    });
    b.driver.settle({
      round: state.round,
      outcome: r.result === 'win' ? 'lose' : r.result === 'lose' ? 'win' : 'draw',
      damageTaken: dmgB,
      damageDealt: dmgA,
      seatResolve: b.resolve, seatArmor: b.armor,
    });
    state.encounters.push({ round: state.round, a: a.id, b: b.id, outcome: r.result, damageToA: dmgA, damageToB: dmgB, fought: true });

    for (const seat of [a, b]) {
      if (seat.alive && seat.armor + seat.resolve <= 0) {
        seat.alive = false;
        seat.eliminatedRound = state.round;
        eliminatedThisRound.push(seat);
      }
    }
  }
  if (bye) state.encounters.push({ round: state.round, a: bye.id, b: bye.id, outcome: 'draw', damageToA: 0, damageToB: 0, bye: bye.id, fought: false });

  // WIPEOUT GUARD. A round can still take every remaining seat to zero at once — two seats trading lethal
  // combat damage in the same round leaves no winner at all, "last one standing" with nobody standing. (Stall
  // pressure used to be the common way in, via both sides of a draw; the guard outlives it because mutual
  // lethal combat damage does the same thing.) The seat that entered the round healthiest survives it.
  if (eliminatedThisRound.length > 0 && state.seats.every((s) => !s.alive)) {
    // Exactly ONE survivor, never "everyone who tied". Perfectly mirrored seats all enter the round on the
    // same HP, so reviving every seat on the best score resurrected all eight — every round, forever. The
    // tiebreak (healthiest first, then seat id) is arbitrary but stated and deterministic, and this is a
    // genuine edge case: it only fires when a round would otherwise leave nobody standing.
    const winner = [...eliminatedThisRound].sort(
      (x, y) => (hpBefore.get(y.id) ?? 0) - (hpBefore.get(x.id) ?? 0) || x.id.localeCompare(y.id),
    )[0]!;
    winner.alive = true;
    winner.eliminatedRound = undefined;
    eliminatedThisRound.splice(eliminatedThisRound.indexOf(winner), 1);
  }

  // Simultaneous knockouts SHARE a placement — nobody is ranked above anyone else for a tiebreak the players
  // never saw. The next placement then skips by the size of the tie.
  const remaining = state.seats.filter((s) => s.alive).length;
  for (const seat of eliminatedThisRound) seat.placement = remaining + eliminatedThisRound.length;

  state.round += 1;

  const living = state.seats.filter((s) => s.alive);
  if (living.length <= 1 || state.round > state.rules.maxRounds) {
    for (const s of living) s.placement = 1;
    state.finished = true;
  }
  return state;
}

/** Run a lobby to completion. Deterministic for a given seed + driver set. */
export function runLobby(state: LobbyState): LobbyState {
  let guard = 0;
  while (!state.finished && guard++ <= state.rules.maxRounds + 1) resolveRound(state);
  return state;
}

/** Seats in finishing order, winner first. */
export function standings(state: LobbyState): LobbySeat[] {
  return [...state.seats].sort(
    (a, b) => (a.placement ?? 99) - (b.placement ?? 99) || (b.eliminatedRound ?? 99) - (a.eliminatedRound ?? 99),
  );
}
