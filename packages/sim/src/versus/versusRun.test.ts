/**
 * VERSUS Phase 1 — the client run (owner rulings 2026-10-13): hearts not Resolve, no course clock, attack-first out
 * of every pool, the random-legal timeout policy, the clone-only candidate and the land → replay → settle flow.
 */
import { CARD_INDEX, poolFor } from '@game/content';
import { makeRng } from '@game/core';
import { describe, expect, it } from 'vitest';
import { GREEDY_PILOT } from '../balance/pilots';
import { poolOf } from '../cardPool';
import { CONFIG } from '../config';
import { reduce } from '../reducer';
import { modalOpen } from '../recruit';
import { runSpells } from '../spellPool';
import { canonicalJson } from './canonical';
import { resolveVersusFight } from './combat';
import { buildVersusCandidate, createVersusRun, legalModalAnswers, versusAutoResolve, versusHeroOffer, versusTimeoutRng } from './run';
import type { RunState } from '../state';

const ctx = (round: number) => ({ seatId: 'p1', round, scoutedOpponent: null });

describe('Versus pool: attack-first is out (R-VERSUS-POOL-01)', () => {
  it('Pre-emptive Assault is in the ordinary set 1 pool but never in a Versus run\'s pool or spell draws', () => {
    expect(poolFor('set1').spells.some((c) => c.id === 'preemptive')).toBe(true);
    const run = createVersusRun(7, 'warden', 'set1');
    expect(poolOf(run).all.some((c) => c.id === 'preemptive')).toBe(false);
    expect(runSpells(run).some((c) => c.id === 'preemptive')).toBe(false);
    for (const set of ['set1', 'set2', 'set3'] as const) {
      const pool = poolOf(createVersusRun(3, 'warden', set));
      expect(pool.all.filter((c) => (c.effects ?? []).some((e) => e.do === 'spellAttackFirst'))).toEqual([]);
    }
  });
});

describe('Versus run', () => {
  it('createVersusRun stamps the mode and the hero', () => {
    const run = createVersusRun(5, 'indy', 'set2');
    expect([run.mode, run.heroId, run.setId, run.phase]).toEqual(['versus', 'indy', 'set2', 'recruit']);
  });

  it('the hero offer is three distinct heroes, deterministic from the private seeds', () => {
    const a = versusHeroOffer(11, 22, 'set3');
    expect(a).toHaveLength(3);
    expect(new Set(a).size).toBe(3);
    expect(versusHeroOffer(11, 22, 'set3')).toEqual(a);
  });

  it('land → replay → settle → resolve: a lost fight never moves Resolve or Armor and never ends the run, past the old course length', () => {
    let a = createVersusRun(1, 'warden', 'set2');
    let b = createVersusRun(2, 'warden', 'set2');
    const startA = [a.resolve, a.armor];
    for (let round = 1; round <= CONFIG.courseRounds + 3; round++) {
      a = reduce(versusAutoResolve(a, makeRng(round)), { type: 'faceOmen', deferFight: true });
      b = reduce(versusAutoResolve(b, makeRng(round)), { type: 'faceOmen', deferFight: true });
      // b fights with a fat board so a loses every round.
      const fat = structuredClone(b.pendingCombatSide!);
      fat.board = [{ cardId: Object.keys(CARD_INDEX).find((id) => !CARD_INDEX[id]!.spell && !CARD_INDEX[id]!.token)!, attack: 50, health: 50 }];
      const fight = resolveVersusFight({ matchSeed: 9, round, p1: a.pendingCombatSide!, p2: fat });
      const landed = reduce(a, { type: 'landCombat', fight: { result: fight.p1, damageTaken: 0 } });
      expect(landed.phase).toBe('combat');
      expect(landed.lastCombat?.result).toBe(fight.p1.result);
      expect(landed.combatSettled).toBe(false);
      expect(reduce(landed, { type: 'landCombat', fight: { result: fight.p1, damageTaken: 0 } })).toBe(landed); // once only
      const settled = reduce(landed, { type: 'settleCombat' });
      a = reduce(settled, { type: 'resolveCombat' });
      expect(a.phase).toBe('recruit');
      expect([a.resolve, a.armor]).toEqual(startA);
      b = reduce(b, { type: 'landCombat', fight: { result: fight.p2, damageTaken: 0 } });
      b = reduce(b, { type: 'resolveCombat' });
    }
    expect(a.history.filter((h) => h === 'lose').length).toBeGreaterThan(CONFIG.courseRounds);
    expect(a.wave).toBe(CONFIG.courseRounds + 4);
  });

  it('a bare landCombat is refused on a run that did not defer its fight', () => {
    const run = createVersusRun(1, 'warden', 'set2');
    const other = reduce(createVersusRun(2, 'warden', 'set2'), { type: 'faceOmen', deferFight: true });
    const fight = resolveVersusFight({ matchSeed: 1, round: 1, p1: other.pendingCombatSide!, p2: other.pendingCombatSide! });
    expect(reduce(run, { type: 'landCombat', fight: { result: fight.p1, damageTaken: 0 } })).toBe(run);
  });
});

describe('Versus timeout policy (ruling 7): random legal pick, never cancel', () => {
  it('answers every decision greedy self-play meets, deterministically, and the candidate never touches the live run', () => {
    const seen = new Set<string>();
    for (const [seed, hero, set] of [[1, 'warden', 'set2'], [2, 'indy', 'set3'], [3, 'keshi', 'set2'], [4, 'warden', 'set3'], [5, 'brackus', 'set2'], [6, 'brackus', 'set3']] as const) {
      let run: RunState = createVersusRun(seed, hero, set);
      for (let round = 1; round <= 12; round++) {
        // Play greedily, but stop at every open decision and let the timeout policy answer it.
        for (let step = 0; step < 80; step++) {
          if (modalOpen(run)) {
            const kind = run.discover ? 'discover' : run.chooseOne ? 'chooseOne' : run.pendingTarget ? 'target' : run.questOffer ? 'quest' : run.powerOffer ? 'power' : run.runeforgeOffer ? 'runeforge' : 'scout';
            seen.add(kind);
            const answers = legalModalAnswers(run);
            if (kind !== 'target') expect(answers.length, kind).toBeGreaterThan(0);
            const x = versusAutoResolve(run, versusTimeoutRng(seed, round, 'p1'));
            const y = versusAutoResolve(run, versusTimeoutRng(seed, round, 'p1'));
            expect(canonicalJson(x)).toBe(canonicalJson(y));
            expect(modalOpen(x)).toBe(false);
            run = x;
            continue;
          }
          const a = GREEDY_PILOT.decide(run, ctx(round));
          if (!a) break;
          const next = reduce(run, a);
          if (next === run) break;
          run = next;
        }
        const before = canonicalJson(run);
        const cand = buildVersusCandidate(run, versusTimeoutRng(seed, round, 'p1'));
        expect(cand).not.toBeNull();
        expect(canonicalJson(run)).toBe(before);
        run = reduce(run, { type: 'faceOmen', deferFight: true });
        const fight = resolveVersusFight({ matchSeed: seed, round, p1: run.pendingCombatSide!, p2: cand! });
        run = reduce(run, { type: 'resolveCombat', fight: { result: fight.p1, damageTaken: 0 } });
      }
    }
    // The decisions this sample reliably raises (the Runeforge every run; Brackus opens turn 1 on a Discover).
    expect([...seen]).toEqual(expect.arrayContaining(['runeforge', 'discover']));
  }, 120_000);

  it('a Discover left open at the deadline is answered with a random option, not the first', () => {
    const picks = new Set<number>();
    const base = createVersusRun(1, 'warden', 'set2');
    base.discover = base.shop.slice(0, 3).map((o) => o.cardId);
    for (let s = 0; s < 40; s++) {
      const out = versusAutoResolve(base, makeRng(s));
      expect(out.discover).toBeUndefined();
      const got = out.hand[out.hand.length - 1]?.cardId;
      picks.add(base.discover.indexOf(got!));
    }
    expect(picks.size).toBeGreaterThan(1);
  });
});
