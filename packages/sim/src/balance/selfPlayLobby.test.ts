/**
 * B1 — the eight-seat self-play lobby: every seat live, real pairing, one fight per pair per round, real
 * settlement carried into the next recruit phase, placement by elimination, deterministic by seed.
 */
import { describe, expect, it } from 'vitest';
import { GREEDY_PILOT, pilotFor } from './pilots';
import { rotateHeroes, runSelfPlayLobby } from './selfPlayLobby';
import { NOOP_RECORDER, type ExperimentIdentity, type ExperimentManifest, type LobbyRecord, type SeatPilot } from './types';

const identity: ExperimentIdentity = { schemaVersion: 1, engineRevision: 'test', dirtyDigest: '', contentDigest: '', poolDigest: '', effectDigest: '', manifestDigest: '' };
const manifest = (setId: 'set2' | 'set3', extra: Partial<ExperimentManifest> = {}): ExperimentManifest => ({
  schemaVersion: 1, name: `b1 ${setId}`, mode: 'selfPlayLobby', setId,
  policy: { id: 'greedy', budget: { depth: 1, beam: 1, maxNodes: 1, positionCandidates: 1 } },
  seeds: { start: 1, count: 1 },
  ...extra,
});
const greedy = (): SeatPilot => pilotFor('greedy');

/** Placements form a valid ranking under the SHIPPED rule (`closeRunLobbyRound`: seats knocked out in the same
 *  round share the WORST of the ranks they vacate — `remaining + eliminated.length` — so two seats falling from
 *  seven alive are both 7th, and the ranks above them stay contiguous). */
function expectCompetitionRanking(rec: LobbyRecord): void {
  const placements = rec.seats.map((s) => s.placement!).sort((a, b) => a - b);
  expect(placements.every((p) => p >= 1 && p <= 8)).toBe(true);
  expect(placements[0]).toBe(1);
  // Walk the sorted list in tie groups: a group of n seats occupying sorted indices [i, i + n) vacated ranks
  // i+1 … i+n and carries the worst of them, i + n. (A lobby with no simultaneous knockouts is simply 1…8.)
  for (let i = 0; i < placements.length;) {
    const p = placements[i]!;
    let n = 0;
    while (i + n < placements.length && placements[i + n] === p) n++;
    // The survivors share 1st (a `maxRounds` cap can leave several); every knocked-out group carries its worst rank.
    if (p !== 1) expect(p).toBe(i + n);
    i += n;
  }
}

function checkLobby(rec: LobbyRecord): void {
  expect(rec.failure).toBeUndefined();
  expect(rec.seats).toHaveLength(8);
  expect(rec.roundsPlayed).toBeGreaterThan(0);
  expect(new Set(rec.seats.map((s) => s.heroId)).size).toBe(8); // unique heroes per lobby
  expect(rec.seats.every((s) => s.termination === 'placed')).toBe(true);
  expectCompetitionRanking(rec);
  // Exactly one seat is never eliminated (the winner) unless the cap hit; everyone else has an elimination round.
  const alive = rec.seats.filter((s) => s.eliminatedRound === undefined);
  expect(alive.length).toBeGreaterThanOrEqual(1);
  for (const s of alive) expect(s.placement).toBe(1);

  // Every round record's opponent is the seat it was PAIRED with: the opponent's own record for that round names
  // this seat back and mirrors the damage — one fight, two views.
  const byKey = new Map(rec.rounds.map((r) => [`${r.round}|${r.seatId}`, r]));
  const fights = new Set<string>();
  for (const r of rec.rounds) {
    if (r.result === 'bye') {
      // The ghost is a seat eliminated STRICTLY before this round.
      const ghost = rec.seats.find((s) => s.seatId === r.opponentSeatId);
      expect(ghost).toBeDefined();
      expect(ghost!.eliminatedRound!).toBeLessThan(r.round);
      expect(r.damageDealt).toBe(0);
      continue;
    }
    const other = byKey.get(`${r.round}|${r.opponentSeatId}`);
    expect(other, `round ${r.round} ${r.seatId} vs ${r.opponentSeatId}`).toBeDefined();
    expect(other!.opponentSeatId).toBe(r.seatId);
    expect(other!.damageTaken).toBe(r.damageDealt);
    expect(other!.damageDealt).toBe(r.damageTaken);
    expect(other!.result).toBe(r.result === 'win' ? 'loss' : r.result === 'loss' ? 'win' : 'tie');
    fights.add(`${r.round}|${[r.seatId, r.opponentSeatId].sort().join('~')}`);
  }
  // One fight per pair per round: no seat appears twice in a round.
  const seen = new Set<string>();
  for (const r of rec.rounds) {
    const k = `${r.round}|${r.seatId}`;
    expect(seen.has(k), `duplicate round record ${k}`).toBe(false);
    seen.add(k);
  }
  // Every accepted action names a seat that existed and a round that was played.
  for (const a of rec.actions) {
    expect(a.round).toBeLessThanOrEqual(rec.roundsPlayed);
    expect(rec.seats.some((s) => s.seatId === a.seatId)).toBe(true);
  }
  // Health never rises across a seat's rounds (combat damage only — no heals in this pilot's play).
  for (const s of rec.seats) {
    const mine = rec.rounds.filter((r) => r.seatId === s.seatId).sort((a, b) => a.round - b.round);
    for (let i = 1; i < mine.length; i++) {
      expect(mine[i]!.health + mine[i]!.armor).toBeLessThanOrEqual(mine[i - 1]!.health + mine[i - 1]!.armor);
    }
    // An eliminated seat's last record says so, on its elimination round.
    if (s.eliminatedRound !== undefined) {
      const last = mine[mine.length - 1]!;
      expect(last.round).toBe(s.eliminatedRound);
      expect(last.eliminated).toBe(true);
      expect(last.health + last.armor).toBeLessThanOrEqual(0);
    }
  }
}

describe('B1 — the eight-seat self-play lobby', () => {
  it('set3: terminates, places every seat, pairs and fights once per round, handles byes with ghosts', () => {
    const rec = runSelfPlayLobby(manifest('set3'), 1, greedy, NOOP_RECORDER, identity);
    checkLobby(rec);
    expect(rec.rounds.some((r) => r.result === 'bye')).toBe(true); // an 8-seat lobby goes odd after the first knockout
    expect(rec.manifest.setId).toBe('set3');
    expect(rec.identity).toBe(identity);
  });

  it('set2: the same, on the live set', () => {
    const rec = runSelfPlayLobby(manifest('set2'), 2, greedy, NOOP_RECORDER, identity);
    checkLobby(rec);
  });

  it('is deterministic: two runs of one seed produce identical records', () => {
    const one = runSelfPlayLobby(manifest('set2'), 5, greedy, NOOP_RECORDER, identity);
    const two = runSelfPlayLobby(manifest('set2'), 5, greedy, NOOP_RECORDER, identity);
    expect(JSON.stringify(two)).toBe(JSON.stringify(one));
    // …and a different seed is a different lobby.
    const other = runSelfPlayLobby(manifest('set2'), 6, greedy, NOOP_RECORDER, identity);
    expect(JSON.stringify(other)).not.toBe(JSON.stringify(one));
  });

  it('`shipped` fight rules run to completion too and are labelled on the record', () => {
    const rec = runSelfPlayLobby(manifest('set2', { fightRules: 'shipped' }), 3, greedy, NOOP_RECORDER, identity);
    checkLobby(rec);
    expect(rec.manifest.fightRules).toBe('shipped');
  });

  it('rotates the manifest heroes across seats per seed, unique per lobby, tribe-gated heroes only where eligible', () => {
    const a = rotateHeroes(manifest('set2'), 1, 8);
    const b = rotateHeroes(manifest('set2'), 2, 8);
    expect(a.failure).toBeUndefined();
    expect(new Set(a.heroIds).size).toBe(8);
    expect(a.heroIds).not.toEqual(b.heroIds);
    const pinned = rotateHeroes(manifest('set2', { heroes: ['warden', 'myra', 'soren', 'rohan', 'nadja', 'cassen', 'drakko', 'robin'] }), 4, 8);
    expect(pinned.failure).toBeUndefined();
    expect([...pinned.heroIds].sort()).toEqual(['cassen', 'drakko', 'myra', 'nadja', 'robin', 'rohan', 'soren', 'warden']);
    // Too few heroes to fill eight unique seats is a manifest error, reported — never padded.
    const short = rotateHeroes(manifest('set2', { heroes: ['warden', 'myra'] }), 1, 8);
    expect(short.failure).toMatch(/no eligible hero for seat 2/);
  });

  it('a seat failure censors the LOBBY: every run terminates `failed`, nothing is recorded as a loss', () => {
    // Seat 3 goes silent on round 2 with a Discover-like modal it will not answer: it proposes an illegal move forever.
    const stuck: SeatPilot = { id: 'stuck', decide: (run, ctx) => (ctx.round >= 2 ? { type: 'upgrade' } : GREEDY_PILOT.decide(run, ctx)) };
    const rec = runSelfPlayLobby(manifest('set2', { maxActionsPerTurn: 20 }), 9, (i) => (i === 3 ? stuck : greedy()), NOOP_RECORDER, identity);
    expect(rec.failure).toMatch(/seat s3 round 2/);
    expect(rec.seats).toHaveLength(8);
    expect(rec.seats.every((s) => s.termination === 'failed' && s.failure === rec.failure && s.placement === undefined)).toBe(true);
    expect(rec.roundsPlayed).toBe(1);
  });

  it('the manifest round cap terminates a lobby as `capped` for the seats still standing', () => {
    const rec = runSelfPlayLobby(manifest('set2', { maxRounds: 2 }), 1, greedy, NOOP_RECORDER, identity);
    expect(rec.failure).toBeUndefined();
    expect(rec.roundsPlayed).toBe(2);
    const standing = rec.seats.filter((s) => s.eliminatedRound === undefined);
    expect(standing.length).toBeGreaterThan(1);
    expect(standing.every((s) => s.termination === 'capped' && s.placement === 1)).toBe(true);
  });
});
