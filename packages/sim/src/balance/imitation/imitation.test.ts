/**
 * IMITATION (B7) — the fitter, the term and the line hook, on a synthetic corpus whose answer is known, plus the
 * committed set-2 model's sanity.
 */
import { describe, expect, it } from 'vitest';
import type { BoardSnapshot } from '../../snapshot';
import { fitImitation, scoreBoard, crossValidateImitation, presenceLLR, cardWeight, DEFAULT_FIT } from './model';
import { isSurvivor, trajectoriesOf } from './trajectories';
import { studyCorpus, renderStudy } from './study';
import { loadDefaultImitationModel } from './index';
import { imitationTermOf } from './term';
import { lineSurvivorAffinity } from './lineFit';
import { packageById } from '../strategy/packages';
import { pickLineForRun, rankPackages } from '../strategy/lines';
import { linePriorBreakdown } from '../strategy/prior';
import type { BotVisibleState } from '../../productionBots/types';

const GOOD = 'dm_gourmand'; // Bob Blart — the synthetic survivors' engine
const BAD = 'd2_embermouth'; // the synthetic early-outs' filler
const FILL = 'dw_pimm';

function snap(author: string, seed: number, wave: number, cardIds: string[], golden = 0): BoardSnapshot {
  return {
    v: 1, wave, heroId: 'flint', resolve: 30, tier: Math.min(6, 1 + Math.floor(wave / 2)), triples: 0, tribes: ['dwarf', 'demon', 'dragon', 'beast', 'kobold'],
    threat: 'glass' as never, power: 0, seed, author, setId: 'set2', origin: 'self',
    minions: cardIds.map((cardId, i) => ({ cardId, attack: 2 + wave, health: 2 + wave, keywords: [], ...(i < golden ? { golden: true } : {}) })),
  } as unknown as BoardSnapshot;
}

/** 24 runs: 12 "engine" runs hold GOOD from wave 5 and reach wave 15; 12 "filler" runs hold BAD and die at wave 8–9. */
function syntheticCorpus(): BoardSnapshot[] {
  const out: BoardSnapshot[] = [];
  for (let r = 0; r < 24; r++) {
    const engine = r % 2 === 0;
    const last = engine ? 15 : 8 + (r % 3 === 0 ? 1 : 0);
    for (let w = 1; w <= last; w++) {
      const n = Math.min(7, w);
      const ids: string[] = [];
      for (let i = 0; i < n; i++) ids.push(w >= 5 && i === 0 ? (engine ? GOOD : BAD) : FILL);
      out.push(snap(`p${r % 4}`, 1000 + r, w, ids, engine && w >= 8 ? 1 : 0));
    }
  }
  return out;
}

describe('B7 imitation — trajectories + label', () => {
  it('groups boards into runs and labels survival with the horizon AND the floor', () => {
    const runs = trajectoriesOf(syntheticCorpus(), 'set2');
    expect(runs).toHaveLength(24);
    const engine = runs.find((r) => r.lastWave === 15)!;
    const filler = runs.find((r) => r.lastWave === 8)!;
    expect(engine.reachedEnd).toBe(true);
    expect(filler.reachedEnd).toBe(false);
    // Wave 2 of a run that died at 8: it lasted 6 more waves (≥ horizon 3) but never reached the floor (12) → not a survivor.
    expect(isSurvivor(filler.boards[1]!)).toBe(false);
    expect(isSurvivor(engine.boards[1]!)).toBe(true);
    // Wave 7 of the same short run: one wave left → not a survivor by either rule.
    expect(isSurvivor(filler.boards[6]!)).toBe(false);
  });

  it('presenceLLR shrinks thin evidence and is monotone in the holders’ rate', () => {
    expect(presenceLLR(4, 4, 0.5, 8)).toBeGreaterThan(0);
    expect(presenceLLR(4, 4, 0.5, 8)).toBeLessThan(presenceLLR(40, 40, 0.5, 8));
    expect(presenceLLR(0, 10, 0.5, 8)).toBeLessThan(0);
    expect(presenceLLR(5, 10, 0.5, 8)).toBeCloseTo(0, 6);
  });
});

describe('B7 imitation — the fitter', () => {
  const corpus = syntheticCorpus();
  const model = fitImitation(corpus, { setId: 'set2', name: 'synthetic' });

  it('is deterministic and learns the planted signal: the engine card positive, the filler negative, in the mid bands', () => {
    expect(fitImitation(corpus, { setId: 'set2', name: 'synthetic' })).toEqual(model);
    for (const band of ['build', 'scale']) {
      expect(cardWeight(model, GOOD, band)).toBeGreaterThan(0.3);
      expect(cardWeight(model, BAD, band)).toBeLessThan(-0.3);
    }
    // The shared filler carries no signal.
    expect(Math.abs(cardWeight(model, FILL, 'build'))).toBeLessThan(0.15);
    // Goldens: only the engine runs formed one at 8+, so the scale band credits a golden.
    expect(model.golden['scale']!.perGolden).toBeGreaterThan(0);
    // Focus is OFF by default (noise on the real corpus).
    expect(model.focus['build']!.slope).toBe(0);
    expect(DEFAULT_FIT.terms.focus).toBe(false);
  });

  it('scores an engine board above a filler board at the same wave, credits hand minions only while the board has room, and has no opinion outside its bands', () => {
    const wave = 6;
    const engine = scoreBoard(model, { wave, board: [{ cardId: GOOD, golden: false }, { cardId: FILL, golden: false }] })!;
    const filler = scoreBoard(model, { wave, board: [{ cardId: BAD, golden: false }, { cardId: FILL, golden: false }] })!;
    expect(engine.total).toBeGreaterThan(filler.total);
    const inHand = scoreBoard(model, { wave, board: [{ cardId: FILL, golden: false }], hand: [{ cardId: GOOD, golden: false }] })!;
    const noHand = scoreBoard(model, { wave, board: [{ cardId: FILL, golden: false }] })!;
    expect(inHand.total).toBeGreaterThan(noHand.total);
    expect(inHand.cards.find((c) => c.inHand)!.weight).toBeCloseTo(cardWeight(model, GOOD, 'build') * 0.5, 9);
    const full = Array<{ cardId: string; golden: boolean }>(7).fill({ cardId: FILL, golden: false });
    const fullHand = scoreBoard(model, { wave, board: full, hand: [{ cardId: GOOD, golden: false }] })!;
    expect(fullHand.cards.some((c) => c.inHand)).toBe(false);
    expect(scoreBoard(fitImitation(corpus, { setId: 'set2', bands: [{ id: 'only', from: 1, to: 3 }] }), { wave: 9, board: [] })).toBeNull();
  });

  it('cross-validates by run and separates the planted classes held out', () => {
    const v = crossValidateImitation(corpus, { setId: 'set2', folds: 4 });
    expect(v.byBand['build']!.auc).toBeGreaterThan(0.9);
    expect(v.byBand['scale']!.auc).toBeGreaterThan(0.9);
  });

  it('renders a study with the per-wave curve and the card tables', () => {
    const md = renderStudy(studyCorpus(corpus, { setId: 'set2' }), { corpusName: 'synthetic' });
    expect(md).toContain('## The per-wave curve');
    expect(md).toContain('Bob Blart');
    expect(md).toMatch(/\| 15 \| 12 \| 12 \|/); // wave 15: 12 boards, 12 runs alive
  });
});

describe('B7 imitation — the committed set-2 model', () => {
  const model = loadDefaultImitationModel('set2')!;

  it('loads, names its corpus, and carries a run-split validation', () => {
    expect(model).not.toBeNull();
    expect(model.setId).toBe('set2');
    expect(model.meta.corpus?.name).toBe('set2-players-v1');
    expect(model.meta.validation?.folds).toBe(5);
    expect(loadDefaultImitationModel('set3')).toBeNull();
  });

  it('reads the recorded field the way the study does: Bob Blart and Brakka positive, Embermouth Whelp negative in the build band', () => {
    expect(cardWeight(model, 'dm_gourmand', 'build')).toBeGreaterThan(0.3);
    expect(cardWeight(model, 'dw_brakka', 'scale')).toBeGreaterThan(0.2);
    expect(cardWeight(model, 'd2_embermouth', 'build')).toBeLessThan(-0.5);
  });

  it('the term and the prior: a visible state with survivor cards scores above the same state with early-out cards; weight 0 is inert', () => {
    const base = (board: { cardId: string; golden: boolean }[]): BotVisibleState => ({
      version: 1, setId: 'set2', riftId: null, phase: 'recruit', wave: 6,
      economy: { gold: 0, maxGold: 8, tier: 3, upgradeCost: 7, refreshCost: 1, freeRolls: 0, goldSpentThisTurn: 8 },
      hero: { heroId: 'flint', powerKind: 'passive', powerReady: false } as never,
      board: board.map((c, i) => ({ uid: `u${i}`, cardId: c.cardId, tribe: 'neutral', attack: 5, health: 5, keywords: [], golden: c.golden })),
      hand: [], shop: [], spellOffer: null, frozen: false,
      runCounters: { tavernBuyBonus: { attack: 0, health: 0 } } as never,
      auras: { spellPower: { attack: 0, health: 0 }, rubyBonus: { attack: 0, health: 0 }, impBuff: { attack: 0, health: 0 }, beastBuyAtk: 0, undeadBuyAtk: 0, magneticBuy: { attack: 0, health: 0 } } as never,
      runes: [], quests: [], equipment: [], starform: null, friendly: { minions: [] } as never, mandatoryDecision: null, opponentKnowledge: [],
    });
    const good = base([{ cardId: 'dm_gourmand', golden: false }, { cardId: 'dw_brakka', golden: false }]);
    const bad = base([{ cardId: 'd2_embermouth', golden: false }, { cardId: 'k_chipwick', golden: false }]);
    expect(imitationTermOf(good, model)!).toBeGreaterThan(imitationTermOf(bad, model)!);
    const line = pickLineForRun('flint', good.board.map(() => 'dwarf'), 1, 0, 'set2');
    const off = linePriorBreakdown(good, line, undefined, { imitation: model }, { imitation: 0, value: 0 });
    expect(off.imitation).toBe(0);
    const on = linePriorBreakdown(good, line, undefined, { imitation: model }, { imitation: 6, value: 0 });
    expect(on.imitation).toBeGreaterThan(0);
    expect(on.total - off.total).toBeCloseTo(on.imitation, 9);
  });

  it('line choice: the survivors’ affinity is non-negative per package, reshapes the ranking, and never makes an unviable line viable', () => {
    const tribes = ['dwarf', 'demon', 'dragon', 'beast', 'kobold'] as const;
    const consume = lineSurvivorAffinity(packageById('demonConsume'), 'set2', model); // Bob Blart is the survivors' engine
    expect(consume).toBeGreaterThan(0.1);
    const plain = rankPackages('flint', tribes, 'set2', 7);
    const shaped = rankPackages('flint', tribes, 'set2', 7, { model, weight: 1 });
    for (const f of shaped) {
      const p = plain.find((x) => x.id === f.id)!;
      expect(f.survivorAffinity).toBeGreaterThanOrEqual(0);
      if (p.fit === 0) expect(f.fit).toBe(0);
      else expect(f.fit).toBeGreaterThanOrEqual(p.fit);
    }
    // Mech is unsupported in set 2: shaped or not, it stays out.
    const noMech = rankPackages('flint', ['dwarf'], 'set2', 7, { model, weight: 5 }).find((f) => f.id === 'mechAttach')!;
    expect(noMech.fit).toBe(0);
    // Deterministic.
    expect(pickLineForRun('flint', tribes, 3, 0, 'set2', { model, weight: 1 })).toEqual(pickLineForRun('flint', tribes, 3, 0, 'set2', { model, weight: 1 }));
  });
});
