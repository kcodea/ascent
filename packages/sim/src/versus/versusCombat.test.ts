/**
 * VERSUS Phase 0 — the one authoritative fight (blueprint 3 + 13 "Simulation"; owner rulings 2026-10-13).
 * The parity fixture's inputs are real greedy self-play sides (`npm run versus:parity -- generate`).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { CARD_INDEX } from '@game/content';
import { makeRng, simulate } from '@game/core';
import { describe, expect, it } from 'vitest';
import { reduce } from '../reducer';
import { createRun, mixSeed, TAG, type PreparedCombatSide } from '../state';
import { canonicalJson } from './canonical';
import { preparedSideError, resolveVersusFight, versusChair, versusCombatSeed } from './combat';
import { parityRecord } from './server';
import { hitVitals, stampVersusDamage, versusArmorFloorMax, versusDuosStartingVitals, versusFreshSide, versusRoundCap, versusStartingVitals, versusVitalsBefore } from './vitals';
import { lossDamageCap } from '../lossCap';
import { getHero } from '../heroes';
import { createVersusRun } from './run';

interface Case { name: string; matchSeed: number; round: number; p1: PreparedCombatSide; p2: PreparedCombatSide }
const FIXTURE = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/parity.v1.json', import.meta.url)), 'utf8')) as { cases: Case[] };
const input = (c: Case) => ({ matchSeed: c.matchSeed, round: c.round, p1: structuredClone(c.p1), p2: structuredClone(c.p2) });

describe('Versus resolver — one fight, two perspectives', () => {
  it('the combat seed uses the sim mixer (copied so the server bundle stays core+content)', () => {
    for (const [s, r] of [[1, 1], [123456789, 7], [-5, 60]] as const) expect(versusCombatSeed(s, r)).toBe(mixSeed(s, r, TAG.COMBAT, 0x7e55));
  });

  it('same two locked sides + seed produce byte-identical canonical and mirrored results', () => {
    for (const c of FIXTURE.cases) {
      const a = parityRecord(resolveVersusFight(input(c)));
      const b = parityRecord(resolveVersusFight(input(c)));
      expect(a.canonical, c.name).toBe(b.canonical);
    }
  });

  it('survives the JSON wire unchanged (the client lands a JSON-parsed result)', () => {
    for (const c of FIXTURE.cases.slice(0, 4)) {
      const out = resolveVersusFight(input(c));
      expect(canonicalJson(JSON.parse(JSON.stringify(out.p1)))).toBe(canonicalJson(out.p1));
      expect(canonicalJson(JSON.parse(JSON.stringify(out.p2)))).toBe(canonicalJson(out.p2));
    }
  });

  it('never mutates the parked sides', () => {
    const c = FIXTURE.cases[5]!;
    const before = canonicalJson([c.p1, c.p2]);
    resolveVersusFight({ matchSeed: c.matchSeed, round: c.round, p1: c.p1, p2: c.p2 });
    expect(canonicalJson([c.p1, c.p2])).toBe(before);
  });

  it('the two perspectives agree: one winner, the loser takes damage, nobody on a draw', () => {
    for (const c of FIXTURE.cases) {
      const out = resolveVersusFight(input(c));
      const r1 = out.p1.result;
      const r2 = out.p2.result;
      if (out.outcome === 'draw') {
        expect([r1, r2]).toEqual(['draw', 'draw']);
        expect(out.loser).toBeNull();
        expect(out.damage).toEqual({ p1: 0, p2: 0 });
      } else {
        expect(out[out.outcome].result).toBe('win');
        expect(out[out.loser!].result).toBe('lose');
        expect(out.loser).not.toBe(out.outcome);
        expect(out.damage[out.outcome]).toBe(0);
        expect(out.damage[out.loser!]).toBeGreaterThan(0);
      }
      // p1's perspective IS the canonical fight; p2's is its mirror (damage and boards swapped).
      expect(out.p2.playerDamage).toBe(out.p1.enemyDamage ?? 0);
      expect(out.p2.initial.player).toEqual(out.p1.initial.enemy);
    }
  });

  it('the tie-break side reaches simulate as firstSide: p1 (player) on odd rounds, p2 (enemy) on even ones', () => {
    const c = FIXTURE.cases.find((x) => x.round % 2 === 0)!;
    const direct = (first: 'player' | 'enemy') => canonicalJson(simulate(structuredClone(c.p1.board), structuredClone(c.p2.board), makeRng(versusCombatSeed(c.matchSeed, c.round)), CARD_INDEX, structuredClone(c.p1.state), structuredClone(c.p2.state), { firstSide: first }));
    // The resolver's p1 view is the raw fight, stamped with the round's cap (R-VERSUS-HEALTH-01).
    const stamped = (json: string, round: number): string => canonicalJson(stampVersusDamage(JSON.parse(json), versusRoundCap(round)));
    expect(canonicalJson(resolveVersusFight(input(c)).p1)).toBe(stamped(direct('enemy'), c.round));
    const odd = FIXTURE.cases.find((x) => x.round % 2 === 1)!;
    expect(canonicalJson(resolveVersusFight(input(odd)).p1)).toBe(stamped(canonicalJson(simulate(structuredClone(odd.p1.board), structuredClone(odd.p2.board), makeRng(versusCombatSeed(odd.matchSeed, odd.round)), CARD_INDEX, structuredClone(odd.p1.state), structuredClone(odd.p2.state), { firstSide: 'player' })), odd.round));
  });

  it('the chair rotates by round: p1 on odd rounds, p2 on even ones (attack-first is out of Versus pools)', () => {
    expect([1, 2, 3, 4].map(versusChair)).toEqual(['p1', 'p2', 'p1', 'p2']);
    for (const c of FIXTURE.cases) expect(resolveVersusFight(input(c)).chair).toBe(versusChair(c.round));
  });

  it('a result with no pools (the hearts era) lands without touching Health or Armor', () => {
    let a = createRun(11, 'warden', 'lobby', undefined, 'set2');
    let b = createRun(12, 'warden', 'lobby', undefined, 'set2');
    a = reduce(a, { type: 'faceOmen', deferFight: true });
    b = reduce(b, { type: 'faceOmen', deferFight: true });
    const out = resolveVersusFight({ matchSeed: 9, round: 1, p1: a.pendingCombatSide!, p2: b.pendingCombatSide! });
    const a2 = reduce(a, { type: 'resolveCombat', fight: { result: out.p1, damageTaken: 0 } });
    const b2 = reduce(b, { type: 'resolveCombat', fight: { result: out.p2, damageTaken: 0 } });
    expect([a2.resolve, a2.armor]).toEqual([a.resolve, a.armor]);
    expect([b2.resolve, b2.armor]).toEqual([b.resolve, b.armor]);
    expect(a2.phase).toBe('recruit');
    expect(b2.phase).toBe('recruit');
  });

  it('refuses malformed sides before simulate sees them', () => {
    const ok = FIXTURE.cases[2]!.p1;
    expect(preparedSideError(ok)).toBeNull();
    expect(preparedSideError(null)).toBe('side_not_object');
    expect(preparedSideError({ ...ok, board: 'x' })).toBe('board_not_array');
    expect(preparedSideError({ ...ok, board: Array(8).fill(ok.board[0]) })).toBe('board_too_large');
    expect(preparedSideError({ ...ok, board: [{ ...ok.board[0], cardId: 'no-such-card' }] })).toBe('unknown_card');
    expect(preparedSideError({ ...ok, board: [{ ...ok.board[0], attack: Number.NaN }] })).toBe('minion_stats');
  });
});

describe('Versus Health and Armor (R-VERSUS-HEALTH-01: the lobby damage, the lobby cap, Armor first)', () => {
  it('the loser takes the lobby formula (striking tier + survivor tiers), capped by the lobby round cap, Armor first', () => {
    let checked = 0;
    for (const c of FIXTURE.cases) {
      const vitals = { p1: { health: 30, armor: 4 }, p2: { health: 30, armor: 4 } };
      const out = resolveVersusFight({ ...input(c), vitals });
      if (!out.loser) { expect(out.vitals).toEqual(vitals); continue; }
      const view = out[out.loser];
      const raw = view.damageBreakdown!.oppTier + view.damageBreakdown!.survivorTiers.reduce((x, y) => x + y, 0);
      expect(view.playerDamageUncapped).toBe(raw);
      expect(out.damage[out.loser]).toBe(Math.min(raw, lossDamageCap(c.round)));
      expect(view.playerDamage).toBe(out.damage[out.loser]);
      if (Number.isFinite(lossDamageCap(c.round))) expect(view.damageCap).toBe(lossDamageCap(c.round));
      expect(out.vitals![out.loser]).toEqual(hitVitals(vitals[out.loser], out.damage[out.loser]));
      expect(view.versusVitals).toEqual(out.vitals![out.loser]);
      // The winner's view shows the same (capped) blow it landed.
      expect(out[out.outcome as 'p1' | 'p2'].enemyDamage).toBe(out.damage[out.loser]);
      expect(out.vitals![out.outcome as 'p1' | 'p2']).toEqual(vitals[out.outcome as 'p1' | 'p2']);
      checked++;
    }
    expect(checked).toBeGreaterThan(3);
  });

  it('Armor absorbs before Health; Health stops at 0 (out)', () => {
    expect(hitVitals({ health: 30, armor: 10 }, 7)).toEqual({ health: 30, armor: 3 });
    expect(hitVitals({ health: 30, armor: 3 }, 7)).toEqual({ health: 26, armor: 0 });
    expect(hitVitals({ health: 2, armor: 0 }, 9)).toEqual({ health: 0, armor: 0 });
    expect(hitVitals({ health: 5, armor: 5 }, 0)).toEqual({ health: 5, armor: 5 });
  });

  it('the cap is the lobby table: 5 / 10 / 15 / 20, uncapped from round 15', () => {
    expect([1, 3, 4, 7, 8, 11, 12, 14, 15, 30].map(versusRoundCap)).toEqual([5, 5, 10, 10, 15, 15, 20, 20, Infinity, Infinity]);
  });

  it('every seat starts on its hero Health + Armor; Summit adds +10 Armor (R-VERSUS-SUMMIT-01); Duos = 30 + both Armors', () => {
    const w = getHero('warden');
    const k = getHero('keshi');
    expect(versusStartingVitals('warden', null)).toEqual({ health: w.resolve, armor: w.armor });
    expect(versusStartingVitals('warden', { v: 1, mode: 'group', modifiers: ['summit'] })).toEqual({ health: w.resolve, armor: w.armor + 10 });
    expect(versusStartingVitals('warden', { v: 1, mode: 'duel', modifiers: ['freedom'] })).toEqual({ health: w.resolve, armor: w.armor });
    expect(versusDuosStartingVitals('warden', 'keshi', { v: 1, mode: 'duos', modifiers: [] })).toEqual({ health: 30, armor: w.armor + k.armor });
    expect(versusDuosStartingVitals('warden', 'keshi', { v: 1, mode: 'duos', modifiers: ['summit'] })).toEqual({ health: 30, armor: w.armor + k.armor + 20 });
    // The run itself starts on the same pools.
    const run = createVersusRun(5, 'warden', 'set2', { v: 1, mode: 'duel', modifiers: ['summit'] });
    expect([run.resolve, run.armor, run.rift]).toEqual([w.resolve, w.armor + 10, 'summit']);
    const duo = createVersusRun(5, 'warden', 'set2', { v: 1, mode: 'duos', modifiers: ['summit'] }, 'keshi');
    expect([duo.resolve, duo.maxResolve, duo.armor, duo.maxArmor]).toEqual([30, 30, w.armor + k.armor + 20, w.armor + k.armor + 20]);
  });

  it("a fresh report raises Armor only up to the content's highest floor (Mend: 5); never Health; a stale side is dropped", () => {
    expect(versusArmorFloorMax()).toBe(5);
    expect(versusVitalsBefore({ health: 20, armor: 0 }, [{ health: 30, armor: 5 }])).toEqual({ health: 20, armor: 5 });
    expect(versusVitalsBefore({ health: 20, armor: 0 }, [{ health: 20, armor: 40 }])).toEqual({ health: 20, armor: 5 });
    expect(versusVitalsBefore({ health: 20, armor: 9 }, [{ health: 20, armor: 12 }])).toEqual({ health: 20, armor: 9 });
    expect(versusVitalsBefore({ health: 20, armor: 3 }, [{ health: 20, armor: 0 }, null])).toEqual({ health: 20, armor: 3 });
    const side = { board: [], state: {}, vitals: { resolve: 30, armor: 5 } };
    expect(versusFreshSide(side, 'lock')).toBe(side);
    expect(versusFreshSide(side, 'deadline')).toBe(side);
    expect(versusFreshSide(side, 'auto')).toEqual({ board: [], state: {} });
  });

  it('the run lands its pools on the stamped result when the fight settles, and reports them at its lock', () => {
    let a = createVersusRun(11, 'warden', 'set2', null);
    let b = createVersusRun(12, 'warden', 'set2', null);
    a = reduce(a, { type: 'faceOmen', deferFight: true });
    b = reduce(b, { type: 'faceOmen', deferFight: true });
    expect(a.pendingCombatSide!.vitals).toEqual({ resolve: a.resolve, armor: a.armor });
    const vitals = { p1: { health: 3, armor: 0 }, p2: { health: 3, armor: 0 } };
    // An empty-vs-empty fight is a draw (no damage), but the run still lands on the SERVER's pools (3 Health here).
    const out = resolveVersusFight({ matchSeed: 9, round: 1, p1: a.pendingCombatSide!, p2: b.pendingCombatSide!, vitals });
    const a2 = reduce(reduce(a, { type: 'landCombat', fight: { result: out.p1, damageTaken: 0 } }), { type: 'settleCombat' });
    expect([a2.resolve, a2.armor]).toEqual([out.vitals!.p1!.health, out.vitals!.p1!.armor]);
  });
});

describe('Versus server bundle — core + content only', () => {
  it('the Edge Function entry never pulls the reducer, the run state or any UI module into the bundle', async () => {
    const res = await build({
      entryPoints: [fileURLToPath(new URL('./server.ts', import.meta.url))],
      bundle: true, write: false, format: 'esm', platform: 'neutral', target: 'es2022',
      mainFields: ['module', 'main'], metafile: true, logLevel: 'silent',
    });
    const inputs = Object.keys(res.metafile!.inputs);
    // Pure DATA modules are allowed (the hero table, the rift table, the loss cap: R-VERSUS-HEALTH-01; and for the RANKED
    // DUOS seating, 2026-10-26: the ranked bands, the Duos rank table, generated handles); never the reducer, the run
    // state or any UI. Named one by one so nothing else slips in.
    const allowed = /sim[\\/]src[\\/](config|heroes|lossCap|rank|lobbyStrength|boardSide|lobby[\\/](strengthBands|seatCap|handles))\.ts$/;
    const leaked = inputs.filter((p) => /packages[\/](sim[\/]src[\/](?!versus[\/])|ui[\/])/.test(p) && !allowed.test(p));
    expect(leaked).toEqual([]);
  }, 60_000);
});
