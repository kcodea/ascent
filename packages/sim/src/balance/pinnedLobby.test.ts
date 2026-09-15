/**
 * The PINNED LOBBY: the pilot in seat 0 of the SHIPPED eight-seat lobby, the other seven seats real recorded
 * player runs from a registered corpus. Hermetic: the corpus is a deterministic fixture registered into the
 * module-global pool (which is why this file lives apart from the self-play tests — see snapshotSeats.test.ts).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { registerOpponents } from '../opponents';
import { playerRunsFrom } from '../lobby/snapshotSeats';
import { HERO_INDEX } from '../heroes';
import { createLobbyRun } from '../lobby/runLobby';
import { DEFAULT_LOBBY_RULES } from '../lobby/lobby';
import { lossDamageCap } from '../reducer';
import { pilotFor } from './pilots';
import { pilotHeroFor, RECORDING_POLICY_ID, runPinnedLobby } from './pinnedLobby';
import { NOOP_RECORDER, type ExperimentIdentity, type ExperimentManifest, type LobbyRecord, type SeatPilot } from './types';
import { PINNED_FIXTURE as FIXTURE, PINNED_FIXTURE_HEROES as FIXTURE_HEROES, PINNED_FIXTURE_SHUFFLED as SHUFFLED, PINNED_FIXTURE_WAVES as WAVES } from './fixtures/pinnedCorpus';

const identity: ExperimentIdentity = { schemaVersion: 1, engineRevision: 'test', dirtyDigest: '', contentDigest: '', poolDigest: '', effectDigest: '', manifestDigest: '' };
const manifest = (extra: Partial<ExperimentManifest> = {}): ExperimentManifest => ({
  schemaVersion: 1, name: 'pinned set2', mode: 'pinnedLobby', setId: 'set2',
  policy: { id: 'greedy', budget: { depth: 1, beam: 1, maxNodes: 1, positionCandidates: 1 } },
  seeds: { start: 1, count: 1 },
  corpus: { name: 'fixture', digest: 'fixture' },
  fightRules: 'shipped',
  ...extra,
});

// ── the fixture corpus (`fixtures/pinnedCorpus.ts`, shared with the tools-side funnel test) ─────────────────
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

  it('every accepted buy is an attributed `cardGained` (sourceId + route shop) — the report’s offer → buy funnel', () => {
    // Regression (2026-09-15): the pinned runner omitted `lineage`, fell through to the runner's lean `targetId`
    // diff, and every real pinned report printed `bought 0` for every minion / spell.
    const buys = rec.actions.filter((a) => a.seatId === 's0' && a.action.type === 'buy');
    expect(buys.length).toBeGreaterThan(0);
    const gained = rec.effects.filter((e) => e.seatId === 's0' && e.kind === 'cardGained' && e.route === 'shop');
    expect(gained.length).toBe(buys.length);
    for (const e of gained) { expect(e.sourceId).toBeDefined(); expect(e.sourceUid).toBeDefined(); }
    // …and a bought card that is later PLAYED keeps its lineage: the play event says it came from the shop.
    const boughtUids = new Set(gained.map((e) => e.sourceUid));
    const played = rec.effects.filter((e) => e.seatId === 's0' && e.kind === 'cardPlayed' && boughtUids.has(e.sourceUid));
    expect(played.length).toBeGreaterThan(0);
    expect(played.every((e) => e.route === 'shop')).toBe(true);
    // No event of the retired lean diff shape (a card event keyed by `targetId` alone).
    expect(rec.effects.some((e) => (e.kind === 'cardGained' || e.kind === 'cardPlayed') && !e.sourceId)).toBe(false);
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

/**
 * FAIRNESS TRIPWIRES (B10 audit, 2026-09-15 — docs/balance-bot.md "Pinned-lobby fairness audit"). The audit found no
 * handicap on the pilot relative to a real player; these pin the facts it rested on, so a later change to either the
 * runner or the shipped table trips here rather than quietly re-opening the question.
 */
describe('the pinned lobby is the client’s table (B10 fairness tripwires)', () => {
  let rec: LobbyRecord;
  beforeAll(() => { rec = run(1); });

  it('seats the SAME table the client seats on hero select — same seeds, same runs, same pools', () => {
    // The client (`store.pickHero`) calls `createLobbyRun(seed, heroId, {}, 'lobby')`; the runner adds only the
    // default `maxRounds`. Same seat ids, heroes, recordings, and starting pools — the pilot's from its hero, every
    // recording's from the lobby rules.
    const hero = pilotHeroFor(manifest(), 1).heroId!;
    const client = createLobbyRun(1, hero, {}, 'lobby', undefined, 'set2').lobby!;
    expect(client.seats.map((s) => [s.id, s.kind, s.heroId, s.runKey ?? null, s.resolve, s.armor]))
      .toEqual(rec.seats.map((s) => [s.seatId, s.seatId === 's0' ? 'player' : 'snapshot', s.heroId, s.recording?.key ?? null,
        s.seatId === 's0' ? HERO_INDEX[hero]!.resolve : DEFAULT_LOBBY_RULES.startingResolve,
        s.seatId === 's0' ? HERO_INDEX[hero]!.armor : DEFAULT_LOBBY_RULES.startingArmor]));
  });

  it('charges every fought encounter by ONE formula: the loser takes min(cap, winner tier + survivors), the winner 0 — pilot and recordings alike', () => {
    const byKey = new Map(rec.rounds.map((r) => [`${r.round}|${r.seatId}`, r]));
    let pilotLosses = 0, recordingLosses = 0;
    for (const r of rec.rounds) {
      if (r.result === 'bye' || !r.opponentSeatId) continue;
      const q = byKey.get(`${r.round}|${r.opponentSeatId}`);
      if (!q || q.opponentSeatId !== r.seatId) continue; // a ghost fight: the fallen seat has no round record
      const cap = lossDamageCap(r.round);
      if (r.result === 'win') { expect(r.damageTaken).toBe(0); expect(q.result).toBe('loss'); }
      if (r.result === 'tie') { expect(r.damageTaken).toBe(0); expect(q.damageTaken).toBe(0); }
      if (r.result === 'loss') {
        // ≥ the winner's tier (the formula's floor), ≤ the round cap — whichever seat lost.
        expect(r.damageTaken).toBeGreaterThanOrEqual(Math.min(cap, q.tier));
        expect(r.damageTaken).toBeLessThanOrEqual(cap);
        expect(q.damageTaken).toBe(0);
        if (r.seatId === 's0') pilotLosses++; else if (q.seatId !== 's0') recordingLosses++;
      }
    }
    // Both populations of fights were actually exercised.
    expect(pilotLosses).toBeGreaterThan(0);
    expect(recordingLosses).toBeGreaterThan(0);
  });

  it('places every seat by the shipped rule — simultaneous knockouts share the WORSE placement, survivors share 1st', () => {
    for (const s of rec.seats) {
      if (s.eliminatedRound === undefined) { expect(s.placement).toBe(1); continue; }
      const fellBefore = rec.seats.filter((x) => x.eliminatedRound !== undefined && x.eliminatedRound < s.eliminatedRound!).length;
      expect(s.placement).toBe(8 - fellBefore);
    }
    // So with one winner the table's placement SUM is ≥ 36 (a tie pushes every tied seat to the worse place), and
    // the recordings' mean placement is (sum − pilot) / 7 — NOT (36 − pilot) / 7. The audit's 100-lobby job summed
    // to 37.8 on average: 4.49 for the recordings beside the pilot's 6.39, exactly the complement.
    const sum = rec.seats.reduce((a, s) => a + s.placement!, 0);
    if (rec.seats.filter((s) => s.placement === 1).length === 1) expect(sum).toBeGreaterThanOrEqual(36);
  });
});
