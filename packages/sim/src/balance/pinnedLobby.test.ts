/**
 * The PINNED LOBBY: the pilot in seat 0 of the SHIPPED eight-seat lobby, the other seven seats real recorded
 * player runs from a registered corpus. Hermetic: the corpus is a deterministic fixture registered into the
 * module-global pool (which is why this file lives apart from the self-play tests — see snapshotSeats.test.ts).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { registerOpponents } from '../opponents';
import { playerRunsFrom } from '../lobby/snapshotSeats';
import type { BoardSnapshot } from '../snapshot';
import { HERO_INDEX } from '../heroes';
import { pilotFor } from './pilots';
import { pilotHeroFor, RECORDING_POLICY_ID, runPinnedLobby } from './pinnedLobby';
import { NOOP_RECORDER, type ExperimentIdentity, type ExperimentManifest, type LobbyRecord, type SeatPilot } from './types';

const identity: ExperimentIdentity = { schemaVersion: 1, engineRevision: 'test', dirtyDigest: '', contentDigest: '', poolDigest: '', effectDigest: '', manifestDigest: '' };
const manifest = (extra: Partial<ExperimentManifest> = {}): ExperimentManifest => ({
  schemaVersion: 1, name: 'pinned set2', mode: 'pinnedLobby', setId: 'set2',
  policy: { id: 'greedy', budget: { depth: 1, beam: 1, maxNodes: 1, positionCandidates: 1 } },
  seeds: { start: 1, count: 1 },
  corpus: { name: 'fixture', digest: 'fixture' },
  fightRules: 'shipped',
  ...extra,
});

// ── the fixture corpus: nine recorded set-2 runs, distinct authors + heroes, 14 waves each ──────────────────
const FIXTURE_HEROES = ['warden', 'indy', 'myra', 'soren', 'rohan', 'nadja', 'cassen', 'drakko', 'robin'];
const WAVES = 14;
/** A vanilla set-2 body, scaled with the wave so the greedy pilot LOSES and the elimination path is exercised, and
 *  by `strength` (the run's index) so the recordings' own fights resolve rather than draw forever. */
const fixtureBoard = (author: string, heroId: string, seed: number, wave: number, patch: string, strength: number): BoardSnapshot => ({
  v: 1, wave, heroId, resolve: 30, armor: 0, tier: Math.min(6, 1 + Math.floor(wave / 3)), triples: 0,
  tribes: ['dragon', 'demon', 'beast', 'dwarf', 'kobold'], threat: 'glass', power: 0,
  minions: Array.from({ length: Math.min(7, wave) }, () => ({ cardId: 'n2_spellsword', attack: 3 + 2 * wave + 4 * strength, health: 4 + 2 * wave + 3 * strength, keywords: [], golden: false })),
  marksCarried: true, seed, origin: 'self', author, setId: 'set2', patch,
} as BoardSnapshot);
const FIXTURE: BoardSnapshot[] = FIXTURE_HEROES.flatMap((heroId, i) =>
  Array.from({ length: WAVES }, (_, w) => fixtureBoard(`author${i}`, heroId, 5000 + i, w + 1, i % 2 ? '0.1.0+aaaa' : '0.1.0+bbbb', i)));
// Registration order is shuffled to prove the fill does not depend on it (playerRunsFrom sorts by key).
const SHUFFLED = [...FIXTURE].sort((a, b) => ((a.seed * 31 + a.wave * 7) % 97) - ((b.seed * 31 + b.wave * 7) % 97));

/** The board a recording fields for `round` — the shipped `boardAt` + exhaustion (repeat final) rule. */
function expectedBoard(heroId: string, round: number): string[] {
  const snaps = FIXTURE.filter((s) => s.heroId === heroId).sort((a, b) => a.wave - b.wave);
  const exact = snaps.find((s) => s.wave === round);
  const earlier = snaps.filter((s) => s.wave < round).pop();
  const snap = round > WAVES ? snaps[snaps.length - 1]! : (exact ?? earlier ?? snaps[0]!);
  return snap.minions.map((m) => m.cardId);
}

beforeAll(() => { registerOpponents(SHUFFLED); });

const greedy = (): SeatPilot => pilotFor('greedy');
const run = (seed: number, m = manifest()): LobbyRecord => runPinnedLobby(m, seed, greedy(), NOOP_RECORDER, identity);

describe('the fixture corpus seats', () => {
  it('reassembles into nine runs on distinct heroes', () => {
    const runs = playerRunsFrom(undefined, undefined, 'set2');
    expect(runs.length).toBeGreaterThanOrEqual(9);
    expect(new Set(runs.map((r) => r.heroId)).size).toBeGreaterThanOrEqual(9);
  });
});

describe('the pinned lobby', () => {
  // Built in `beforeAll` (not at collection time), AFTER the corpus is registered.
  let rec: LobbyRecord; let pilot: LobbyRecord['seats'][number]; let others: LobbyRecord['seats'];
  beforeAll(() => {
    rec = run(1);
    pilot = rec.seats.find((s) => s.seatId === 's0')!;
    others = rec.seats.filter((s) => s.seatId !== 's0');
  });

  it('completes: no failure, eight seats, the pilot placed', () => {
    expect(rec.failure).toBeUndefined();
    expect(rec.seats).toHaveLength(8);
    expect(rec.manifest.fightRules).toBe('shipped');
    expect(pilot.policyId).toBe('greedy');
    expect(pilot.termination).toBe('placed');
    expect(pilot.placement).toBeGreaterThanOrEqual(1);
    expect(pilot.placement).toBeLessThanOrEqual(8);
    expect(pilot.heroId).toBe(pilotHeroFor(manifest(), 1).heroId);
  });

  it('the seven other seats are RECORDED seats: fixture heroes, unique, never the pilot’s', () => {
    expect(others).toHaveLength(7);
    for (const s of others) {
      expect(s.policyId).toBe(RECORDING_POLICY_ID);
      expect(FIXTURE_HEROES).toContain(s.heroId);
      expect(s.heroId).not.toBe(pilot.heroId);
      expect(s.recording).toBeDefined();
      expect(s.recording!.waves).toBe(WAVES);
      expect(s.recording!.author).toMatch(/^author\d$/);
      expect(s.recording!.patch).toMatch(/^0\.1\.0\+/);
    }
    expect(new Set(rec.seats.map((s) => s.heroId)).size).toBe(8);
    expect(new Set(others.map((s) => s.recording!.key)).size).toBe(7);
  });

  it('the pilot fights exactly its paired seat’s SERVED board each round — the recording’s board for that wave', () => {
    const mine = rec.rounds.filter((r) => r.seatId === 's0');
    expect(mine.length).toBeGreaterThan(0);
    const byKey = new Map(rec.rounds.map((r) => [`${r.round}|${r.seatId}`, r]));
    for (const r of mine) {
      expect(r.opponentSeatId).not.toBeNull();
      const foe = rec.seats.find((s) => s.seatId === r.opponentSeatId)!;
      expect(foe.policyId).toBe(RECORDING_POLICY_ID);
      if (r.result === 'bye') continue; // a ghost fight: the fallen seat's dying-round board, checked below
      const theirs = byKey.get(`${r.round}|${r.opponentSeatId}`)!;
      expect(theirs.opponentSeatId).toBe('s0');
      // The bodies that actually entered the fight (`lastCombat.initial.enemy`) ARE the recording's board.
      expect(theirs.board).toEqual(expectedBoard(foe.heroId, r.round));
      expect(theirs.damageTaken).toBe(r.damageDealt);
      expect(theirs.damageDealt).toBe(r.damageTaken);
      expect(theirs.result).toBe(r.result === 'win' ? 'loss' : r.result === 'loss' ? 'win' : 'tie');
    }
    // One record per (round, seat).
    const seen = new Set<string>();
    for (const r of rec.rounds) { const k = `${r.round}|${r.seatId}`; expect(seen.has(k), k).toBe(false); seen.add(k); }
  });

  it('damage lands armor-first and health carries round to round, for every seat', () => {
    const bySeat = new Map<string, typeof rec.rounds>();
    for (const r of rec.rounds) (bySeat.get(r.seatId) ?? bySeat.set(r.seatId, []).get(r.seatId)!).push(r);
    for (const [seatId, rounds] of bySeat) {
      rounds.sort((a, b) => a.round - b.round);
      // The pilot's seat is seeded from its RUN (the hero's own pools, `createLobbyRun`); a recording's from the
      // lobby rules.
      const hero = HERO_INDEX[pilot.heroId]!;
      let health = seatId === 's0' ? hero.resolve : 30, armor = seatId === 's0' ? hero.armor : 15;
      for (const r of rounds) {
        // The pilot's own run can raise its pools during the shop (Mend etc.); the greedy pilot on this fixture does
        // not, and recorded seats never do — so the carry is exact.
        const fromArmor = Math.min(armor, r.damageTaken);
        armor -= fromArmor;
        health = Math.max(0, health - (r.damageTaken - fromArmor));
        expect({ seat: seatId, round: r.round, health: r.health, armor: r.armor }).toEqual({ seat: seatId, round: r.round, health, armor });
        expect(r.eliminated).toBe(health + armor <= 0);
      }
    }
  });

  it('elimination ends the pilot’s run with the right placement', () => {
    const mine = rec.rounds.filter((r) => r.seatId === 's0').sort((a, b) => a.round - b.round);
    const last = mine[mine.length - 1]!;
    // Against wave-scaled 7-wide boards the greedy pilot loses every fight and is knocked out.
    expect(last.eliminated).toBe(true);
    expect(pilot.eliminatedRound).toBe(last.round);
    expect(mine.every((r) => r.round <= last.round)).toBe(true);
    // Shipped placement rule (`closeRunLobbyRound`): seats knocked out in the same round share
    // `remaining alive + eliminated this round`.
    const fellWithMe = rec.rounds.filter((r) => r.round === last.round && r.eliminated).length;
    const fellBefore = rec.seats.filter((s) => s.eliminatedRound !== undefined && s.eliminatedRound < last.round).length;
    expect(pilot.placement).toBe(8 - fellBefore);
    for (const s of rec.seats.filter((x) => x.eliminatedRound === last.round)) expect(s.placement).toBe(8 - fellBefore);
    expect(fellWithMe).toBeGreaterThanOrEqual(1);
    // The table was played out so every recording carries a placement. Under the shipped rules the seats still
    // standing at the end share 1st — one winner, or several when the stalemate backstop (`maxRounds`) fired, in
    // which case they are `capped`, never `placed`.
    expect(rec.seats.every((s) => s.placement !== undefined)).toBe(true);
    const winners = rec.seats.filter((s) => s.placement === 1);
    expect(winners.length).toBeGreaterThanOrEqual(1);
    for (const w of winners) expect(w.termination).toBe(winners.length > 1 ? 'capped' : 'placed');
  });

  it('is deterministic: the same seed produces a byte-identical record', () => {
    expect(JSON.stringify(run(1))).toBe(JSON.stringify(rec));
  });

  it('a failing pilot censors the lobby: every seat `failed`, no placements', () => {
    const boom: SeatPilot = { id: 'boom', decide() { throw new Error('kaboom'); } };
    const r = runPinnedLobby(manifest(), 1, boom, NOOP_RECORDER, identity);
    expect(r.failure).toMatch(/kaboom/);
    expect(r.seats).toHaveLength(8);
    for (const s of r.seats) { expect(s.termination).toBe('failed'); expect(s.placement).toBeUndefined(); }
  });

  it('rotates the pilot’s hero by seed under the production rules', () => {
    const ids = new Set([1, 2, 3, 4].map((s) => pilotHeroFor(manifest(), s).heroId));
    expect(ids.size).toBe(4);
    expect(pilotHeroFor(manifest({ heroes: ['warden'] }), 7).heroId).toBe('warden');
  });
});
