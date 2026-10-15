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

  it('the two perspectives agree: one winner, one heart lost, none on a draw', () => {
    for (const c of FIXTURE.cases) {
      const out = resolveVersusFight(input(c));
      const r1 = out.p1.result;
      const r2 = out.p2.result;
      if (out.outcome === 'draw') {
        expect([r1, r2]).toEqual(['draw', 'draw']);
        expect(out.heartLostBy).toBeNull();
      } else {
        expect(out[out.outcome].result).toBe('win');
        expect(out[out.heartLostBy!].result).toBe('lose');
        expect(out.heartLostBy).not.toBe(out.outcome);
      }
      // p1's perspective IS the canonical fight; p2's is its mirror (damage and boards swapped).
      expect(out.p2.playerDamage).toBe(out.p1.enemyDamage ?? 0);
      expect(out.p2.initial.player).toEqual(out.p1.initial.enemy);
    }
  });

  it('the tie-break side reaches simulate as firstSide: p1 (player) on odd rounds, p2 (enemy) on even ones', () => {
    const c = FIXTURE.cases.find((x) => x.round % 2 === 0)!;
    const direct = (first: 'player' | 'enemy') => canonicalJson(simulate(structuredClone(c.p1.board), structuredClone(c.p2.board), makeRng(versusCombatSeed(c.matchSeed, c.round)), CARD_INDEX, structuredClone(c.p1.state), structuredClone(c.p2.state), { firstSide: first }));
    expect(canonicalJson(resolveVersusFight(input(c)).p1)).toBe(direct('enemy'));
    const odd = FIXTURE.cases.find((x) => x.round % 2 === 1)!;
    expect(canonicalJson(resolveVersusFight(input(odd)).p1)).toBe(canonicalJson(simulate(structuredClone(odd.p1.board), structuredClone(odd.p2.board), makeRng(versusCombatSeed(odd.matchSeed, odd.round)), CARD_INDEX, structuredClone(odd.p1.state), structuredClone(odd.p2.state), { firstSide: 'player' })));
  });

  it('the chair rotates by round: p1 on odd rounds, p2 on even ones (attack-first is out of Versus pools)', () => {
    expect([1, 2, 3, 4].map(versusChair)).toEqual(['p1', 'p2', 'p1', 'p2']);
    for (const c of FIXTURE.cases) expect(resolveVersusFight(input(c)).chair).toBe(versusChair(c.round));
  });

  it('landing with damageTaken 0 never touches Resolve or Armor (hearts, not health)', () => {
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

describe('Versus server bundle — core + content only', () => {
  it('the Edge Function entry never pulls the reducer, the run state or any UI module into the bundle', async () => {
    const res = await build({
      entryPoints: [fileURLToPath(new URL('./server.ts', import.meta.url))],
      bundle: true, write: false, format: 'esm', platform: 'neutral', target: 'es2022',
      mainFields: ['module', 'main'], metafile: true, logLevel: 'silent',
    });
    const inputs = Object.keys(res.metafile!.inputs);
    const leaked = inputs.filter((p) => /packages[\\/](sim[\\/]src[\\/](?!versus[\\/])|ui[\\/])/.test(p));
    expect(leaked).toEqual([]);
  }, 60_000);
});
