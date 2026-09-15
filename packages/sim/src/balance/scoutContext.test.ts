/**
 * THE SCOUTING CONTEXT RULES — what both runners hand the pilot is exactly what a player could see
 * (`productionBots/scout.ts` documents the rule and its sources), and NEVER a board from a wave the pilot has
 * not met. Hermetic: a fixture corpus is registered into the module-global pool (own worker, like the pinned test).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { registerOpponents } from '../opponents';
import type { BoardSnapshot } from '../snapshot';
import { GREEDY_PILOT, pilotFor } from './pilots';
import { runPinnedLobby } from './pinnedLobby';
import { runSelfPlayLobby } from './selfPlayLobby';
import { createGeneralistPilot } from './generalistPilot';
import { NOOP_RECORDER, type ExperimentIdentity, type ExperimentManifest, type LobbyRecord, type SeatContext, type SeatPilot } from './types';

const identity: ExperimentIdentity = { schemaVersion: 1, engineRevision: 'test', dirtyDigest: '', contentDigest: '', poolDigest: '', effectDigest: '', manifestDigest: '' };
const pinnedManifest: ExperimentManifest = {
  schemaVersion: 1, name: 'scout pinned', mode: 'pinnedLobby', setId: 'set2',
  policy: { id: 'greedy', budget: { depth: 1, beam: 1, maxNodes: 1, positionCandidates: 1 } },
  seeds: { start: 1, count: 1 }, corpus: { name: 'fixture', digest: 'fixture' }, fightRules: 'shipped',
};
const selfPlayManifest: ExperimentManifest = { ...pinnedManifest, name: 'scout selfplay', mode: 'selfPlayLobby', corpus: undefined, fightRules: 'corrected' };

// ── the fixture corpus: nine recorded set-2 runs whose boards CHANGE every wave (attack = f(wave)), so a board
//    from the wrong wave is distinguishable from the right one. ──────────────────────────────────────────────
const FIXTURE_HEROES = ['warden', 'indy', 'myra', 'soren', 'rohan', 'nadja', 'cassen', 'drakko', 'robin'];
const WAVES = 14;
const fixtureBoard = (author: string, heroId: string, seed: number, wave: number, strength: number): BoardSnapshot => ({
  v: 1, wave, heroId, resolve: 30, armor: 0, tier: Math.min(6, 1 + Math.floor(wave / 3)), triples: wave % 3,
  tribes: ['dragon', 'demon', 'beast', 'dwarf', 'kobold'], threat: 'glass', power: 0,
  minions: Array.from({ length: Math.min(7, wave) }, () => ({ cardId: 'n2_spellsword', attack: 3 + 2 * wave + 4 * strength, health: 4 + 2 * wave + 3 * strength, keywords: [], golden: false })),
  marksCarried: true, seed, origin: 'self', author, setId: 'set2', patch: '0.1.0+test',
} as BoardSnapshot);
const FIXTURE: BoardSnapshot[] = FIXTURE_HEROES.flatMap((heroId, i) =>
  Array.from({ length: WAVES }, (_, w) => fixtureBoard(`author${i}`, heroId, 5000 + i, w + 1, i)));
const boardAt = (heroId: string, wave: number): BoardSnapshot => {
  const snaps = FIXTURE.filter((s) => s.heroId === heroId).sort((a, b) => a.wave - b.wave);
  return snaps.find((s) => s.wave === wave) ?? snaps.filter((s) => s.wave < wave).pop() ?? snaps[snaps.length - 1]!;
};

beforeAll(() => { registerOpponents(FIXTURE); });

/** A pilot that plays greedy and keeps every context it was handed. */
function capturing(): SeatPilot & { seen: SeatContext[] } {
  const seen: SeatContext[] = [];
  return { id: 'greedy', seen, decide: (run, ctx) => { if (seen[seen.length - 1] !== ctx) seen.push(ctx); return GREEDY_PILOT.decide(run, ctx); } };
}

describe('the pinned lobby scouts exactly what the rail shows', () => {
  let rec: LobbyRecord; let seen: SeatContext[];
  beforeAll(() => {
    const p = capturing();
    rec = runPinnedLobby(pinnedManifest, 1, p, NOOP_RECORDER, identity);
    seen = p.seen;
  });

  it('hands the pilot a context every round, with its own live health and the printed loss cap', () => {
    expect(rec.failure).toBeUndefined();
    expect(seen.length).toBeGreaterThan(2);
    for (const ctx of seen) {
      expect(ctx.nextOpponent).not.toBeUndefined();
      expect(ctx.field).toBeDefined();
      expect(ctx.myHealth).toBeGreaterThanOrEqual(0);
      expect(ctx.myArmor).toBeGreaterThanOrEqual(0);
      expect(ctx.lossCap).toBe(ctx.round <= 3 ? 5 : ctx.round <= 7 ? 10 : ctx.round <= 11 ? 15 : ctx.round <= 15 ? 20 : Infinity);
      expect(ctx.seatedRecordings!.length).toBe(7);
    }
  });

  it('the next opponent is the seat the pilot then actually fought (the NEXT chip is the pairing)', () => {
    for (const ctx of seen) {
      const mine = rec.rounds.find((r) => r.round === ctx.round && r.seatId === 's0');
      if (!mine || mine.result === 'bye') continue;
      expect(ctx.nextOpponent!.seatId).toBe(mine.opponentSeatId);
    }
  });

  it('the next opponent\'s intel is THIS round\'s board read as tier/triples/tribe — never its bodies', () => {
    for (const ctx of seen) {
      const next = ctx.nextOpponent;
      if (!next || next.ghost) continue;
      const served = boardAt(next.heroId, ctx.round);
      expect(next.intel).toMatchObject({ tier: served.tier, triples: served.triples, round: ctx.round });
      expect(next.intel).not.toHaveProperty('minions');
      expect(Object.keys(next)).not.toContain('minions');
    }
  });

  it('every other seat\'s intel is from a round BEFORE this one (recorded at settle), never the current or a later one', () => {
    for (const ctx of seen) {
      for (const s of ctx.field!) {
        if (s.seatId === ctx.nextOpponent?.seatId) continue;
        if (s.intel) expect(s.intel.round).toBeLessThan(ctx.round);
      }
      if (ctx.round === 1) for (const s of ctx.field!) if (s.seatId !== ctx.nextOpponent?.seatId) expect(s.intel).toBeNull();
    }
  });

  it('a remembered board is one the pilot FOUGHT, from the round it fought it — never a later wave of that recording', () => {
    let remembered = 0;
    for (const ctx of seen) {
      for (const s of [...ctx.field!, ...(ctx.nextOpponent ? [ctx.nextOpponent] : [])]) {
        const b = s.lastFought;
        if (!b) continue;
        remembered++;
        expect(b.round).toBeLessThan(ctx.round);
        // The pilot met this seat in that round (the record says so)…
        const met = rec.rounds.find((r) => r.round === b.round && r.seatId === 's0');
        expect(met?.opponentSeatId).toBe(s.seatId);
        // …and the bodies are the recording's board for THAT wave, not any later one.
        const atFought = boardAt(s.heroId, b.round);
        expect(b.minions.map((m) => m.attack)).toEqual(atFought.minions.map((m) => m.attack));
        for (let w = b.round + 1; w <= WAVES; w++) {
          const later = boardAt(s.heroId, w);
          expect(b.minions.map((m) => m.attack)).not.toEqual(later.minions.map((m) => m.attack));
        }
      }
    }
    expect(remembered).toBeGreaterThan(0);
  });

  it('the field is the living seats only, with their live health', () => {
    for (const ctx of seen) {
      const living = rec.rounds.filter((r) => r.round === ctx.round - 1 && r.seatId !== 's0' && !r.eliminated).map((r) => r.seatId);
      if (ctx.round > 1) expect(new Set(ctx.field!.map((s) => s.seatId))).toEqual(new Set(living));
      for (const s of ctx.field!) { expect(s.alive).toBe(true); expect(s.health + s.armor).toBeGreaterThan(0); }
    }
  });

  it('the generalist with scouting on plays the same table without failing', () => {
    const p = createGeneralistPilot({ depth: 1, beam: 1, maxNodes: 20, positionCandidates: 2, scouting: true, survivalWeight: 8 }, 7);
    const r = runPinnedLobby({ ...pinnedManifest, policy: { id: 'generalist', budget: p.budget } }, 2, p, NOOP_RECORDER, identity);
    expect(r.failure).toBeUndefined();
    expect(r.seats.find((s) => s.seatId === 's0')!.termination).toBe('placed');
  });
});

describe('the self-play lobby scouts strictly past information', () => {
  it('next opponent + field carry last-round intel, own health, and only boards the seat itself fought', () => {
    const pilots = Array.from({ length: 8 }, () => capturing());
    const rec = runSelfPlayLobby(selfPlayManifest, 3, (i) => pilots[i]!, NOOP_RECORDER, identity);
    expect(rec.failure).toBeUndefined();
    let contexts = 0; let remembered = 0;
    for (const p of pilots) {
      for (const ctx of p.seen) {
        contexts++;
        expect(ctx.myHealth).toBeGreaterThan(0);
        // Every seat's intel (the next opponent included) is from a settled round: strictly before this one.
        for (const s of [...ctx.field!, ...(ctx.nextOpponent ? [ctx.nextOpponent] : [])]) {
          if (s.intel) expect(s.intel.round).toBeLessThan(ctx.round);
          if (ctx.round === 1) expect(s.intel).toBeNull();
          if (s.lastFought) {
            remembered++;
            expect(s.lastFought.round).toBeLessThan(ctx.round);
            const met = rec.rounds.find((r) => r.round === s.lastFought!.round && r.seatId === ctx.seatId);
            expect(met?.opponentSeatId).toBe(s.seatId);
          }
        }
        // The pairing is the one the table then fought.
        const mine = rec.rounds.find((r) => r.round === ctx.round && r.seatId === ctx.seatId);
        if (mine && ctx.nextOpponent) expect(ctx.nextOpponent.seatId).toBe(mine.opponentSeatId);
      }
    }
    expect(contexts).toBeGreaterThan(8);
    expect(remembered).toBeGreaterThan(0);
  });

  it('a pilot without scouting still gets the legacy context shape', () => {
    const rec = runSelfPlayLobby(selfPlayManifest, 4, () => pilotFor('greedy'), NOOP_RECORDER, identity);
    expect(rec.failure).toBeUndefined();
  });
});
