import { describe, it, expect, afterEach } from 'vitest';
import { CARD_INDEX, type SetId } from '@game/content';
import { createRun, type BoardCard, type RunState } from '../../state';
import { reduce } from '../../reducer';
import { releaseAll } from '../../productionBots/transition';
import { toBotVisibleState } from '../../productionBots/visibleState';
import { createGeneralistPilot, GENERALIST_BUDGETS } from '../generalistPilot';
import { snapshotBoard } from '../../snapshot';
import {
  DEFAULT_LAMBDA, MECHANIC_BUCKETS, VALUE_FEATURE_NAMES, bucketsOfCard, expectedTier, featuresOf, featuresOfSnapshot,
  fit, loadDefaultValueModel, predict, standardise, validateModel, valueTermOf, type ValueRow,
} from './index';

/**
 * LEARNED VALUE — the contract tests:
 *  - ONE feature function: the visible-state path and the snapshot path agree on the same board;
 *  - the term is deterministic and finite on a state a real pilot produced, with the COMMITTED model;
 *  - the fit is deterministic (row order does not matter) and recovers a planted linear signal;
 *  - the committed model matches the live feature schema (a drift refuses to load rather than mis-scoring).
 */
afterEach(() => releaseAll());

const body = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
};
const run = (over: Partial<RunState> = {}, seed = 4242, heroId = 'drakko', setId: SetId = 'set2'): RunState =>
  ({ ...createRun(seed, heroId, 'ascent', undefined, setId), phase: 'recruit', ...over } as RunState);

/** Drive the generalist through a few real recruit turns so the state is one a pilot actually reaches. */
function pilotState(seed: number, turns: number): RunState {
  const pilot = createGeneralistPilot(GENERALIST_BUDGETS.smoke, seed);
  let s = run({}, seed, 'drakko', 'set2');
  for (let t = 0; t < turns; t++) {
    for (let i = 0; i < 80; i++) {
      const a = pilot.decide(s, { seatId: 'seat', round: s.wave, scoutedOpponent: null });
      if (!a) break;
      const n = reduce(s, a);
      if (n === s) throw new Error(`refused: ${JSON.stringify(a)}`);
      s = n;
    }
    if (t < turns - 1) {
      // Skip the fight: bump the wave and reopen the recruit phase the way a bye would, keeping the board.
      s = { ...s, wave: s.wave + 1, phase: 'recruit', embers: Math.min(10, s.wave + 3), maxEmbers: Math.min(10, s.wave + 3) } as RunState;
    }
  }
  return s;
}

describe('features', () => {
  it('has wave at index 0 and one name per column', () => {
    expect(VALUE_FEATURE_NAMES[0]).toBe('wave');
    const v = toBotVisibleState(run({ board: [body('a', 'k_chipwick')] }));
    expect(featuresOf(v)).toHaveLength(VALUE_FEATURE_NAMES.length);
  });

  it('the visible-state path and the snapshot path agree on the board columns (one feature function)', () => {
    const s = run({ board: [body('a', 'k_chipwick', { attack: 5, health: 3 }), body('b', 'dw_orin', { golden: true })], tier: 3, wave: 6, embers: 4 });
    const fromState = featuresOf(toBotVisibleState(s));
    const fromSnap = featuresOfSnapshot(snapshotBoard(s), 6, { goldUnspent: 4, hand: [] });
    expect(fromSnap).toEqual(fromState);
  });

  it('a recorded snapshot has no Gold: the column is null (imputed), never a fake 0', () => {
    const s = run({ board: [body('a', 'k_chipwick')], embers: 7 });
    const f = featuresOfSnapshot(snapshotBoard(s));
    expect(f[VALUE_FEATURE_NAMES.indexOf('goldUnspent')]).toBeNull();
    expect(featuresOf(toBotVisibleState(s))[VALUE_FEATURE_NAMES.indexOf('goldUnspent')]).toBe(7);
  });

  it('mechanic buckets come from the effect vocabulary, and the expected-tier curve is the diagnosis curve', () => {
    const ids = MECHANIC_BUCKETS.map((b) => b.id);
    const chip = bucketsOfCard('k_chipwick'); // onPlay:getRubies
    expect(chip[ids.indexOf('mech_ruby')]).toBe(1);
    expect(chip[ids.indexOf('mech_onPlay')]).toBe(1);
    expect(chip[ids.indexOf('mech_death')]).toBe(0);
    const brunni = bucketsOfCard('dw_brunni'); // endOfTurn:grantRandomAle
    expect(brunni[ids.indexOf('mech_perTurn')]).toBe(1);
    expect(brunni[ids.indexOf('mech_ale')]).toBe(1);
    expect(bucketsOfCard('no-such-card').every((x) => x === 0)).toBe(true);
    expect(expectedTier(1)).toBe(1);
    expect(expectedTier(8)).toBe(4);
    expect(expectedTier(12)).toBe(6);
    expect(expectedTier(40)).toBe(6);
  });
});

describe('the committed set-2 model', () => {
  it('loads, matches the live feature schema, and has a band for every wave', () => {
    const m = loadDefaultValueModel('set2');
    expect(m).not.toBeNull();
    expect(validateModel(m)).toBe(true);
    expect(m!.featureNames).toEqual([...VALUE_FEATURE_NAMES]);
    for (const w of [1, 5, 6, 10, 11, 20]) expect(m!.bands.some((b) => w >= b.lo && w <= b.hi && b.n > 0)).toBe(true);
    expect(loadDefaultValueModel('set1')).toBeNull();
  });

  it('valueTermOf is deterministic and finite on states a real pilot reached', () => {
    const m = loadDefaultValueModel('set2')!;
    for (const [seed, turns] of [[11, 1], [23, 4], [37, 7]] as const) {
      const s = pilotState(seed, turns);
      const v = toBotVisibleState(s);
      const a = valueTermOf(v, m);
      const b = valueTermOf(toBotVisibleState(s), m);
      expect(a).not.toBeNull();
      expect(Number.isFinite(a!)).toBe(true);
      expect(b).toBe(a);
      // A plausible survival estimate — a linear model may stray a little past [0, 1], never wildly.
      expect(a!).toBeGreaterThan(-0.5);
      expect(a!).toBeLessThan(1.5);
    }
  });

  it('prefers a board the recordings say survives: a tiered board over a wave-1 filler board at wave 8', () => {
    const m = loadDefaultValueModel('set2')!;
    const filler = run({ wave: 8, tier: 2, board: ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((u) => body(u, 'k_chipwick')) });
    const tiered = run({ wave: 8, tier: 4, board: [body('a', 'k_geode', { attack: 12, health: 14 }), body('b', 'k_alchemist', { attack: 10, health: 12 }), body('c', 'k_deepdelve', { attack: 9, health: 9 }), body('d', 'dw_brunni', { attack: 8, health: 8 })] });
    expect(valueTermOf(toBotVisibleState(tiered), m)!).toBeGreaterThan(valueTermOf(toBotVisibleState(filler), m)!);
  });

  it('refuses a schema drift instead of mis-scoring', () => {
    const m = loadDefaultValueModel('set2')!;
    expect(validateModel({ ...m, featureNames: [...m.featureNames.slice(1)] })).toBe(false);
    expect(predict(m, featuresOf(toBotVisibleState(run())).slice(1))).toBeNull();
  });
});

describe('fit', () => {
  const synthRows = (n: number, shuffleSeed: number): ValueRow[] => {
    // Deterministic pseudo-data: label = 0.5 + 0.3·z(tier) − 0.2·z(boardSize) + small structured noise.
    const rows: ValueRow[] = [];
    let h = 0x9e3779b9 ^ shuffleSeed;
    const next = (): number => { h ^= h << 13; h >>>= 0; h ^= h >>> 17; h ^= h << 5; h >>>= 0; return h / 0x100000000; };
    for (let i = 0; i < n; i++) {
      const wave = 1 + (i % 10);
      const tier = 1 + Math.floor(next() * 6); const size = 1 + Math.floor(next() * 7);
      const f = new Array<number | null>(VALUE_FEATURE_NAMES.length).fill(0);
      f[0] = wave; f[VALUE_FEATURE_NAMES.indexOf('tier')] = tier; f[VALUE_FEATURE_NAMES.indexOf('boardSize')] = size;
      f[VALUE_FEATURE_NAMES.indexOf('goldUnspent')] = i % 3 === 0 ? null : Math.floor(next() * 10);
      const y = 0.5 + 0.1 * (tier - 3.5) - 0.05 * (size - 4) + 0.02 * (next() - 0.5);
      rows.push({ group: `run-${i % 40}`, wave, features: f, survival: y });
    }
    return rows;
  };

  it('is deterministic regardless of row order and recovers the planted signs', () => {
    const rows = synthRows(600, 1);
    const a = fit(rows, { lambda: 1 });
    const reversed = fit([...rows].reverse(), { lambda: 1 });
    expect(reversed.bands).toEqual(a.bands);
    expect(reversed.waveStats).toEqual(a.waveStats);
    for (const b of a.bands.filter((x) => x.n > 0)) {
      expect(b.weights[VALUE_FEATURE_NAMES.indexOf('tier')]!).toBeGreaterThan(0);
      expect(b.weights[VALUE_FEATURE_NAMES.indexOf('boardSize')]!).toBeLessThan(0);
    }
    expect(DEFAULT_LAMBDA).toBeGreaterThan(0);
  });

  it('standardises per wave and imputes null to the wave mean (0)', () => {
    const rows = synthRows(300, 2);
    const m = fit(rows);
    const f = new Array<number | null>(VALUE_FEATURE_NAMES.length).fill(0);
    f[0] = 3; f[VALUE_FEATURE_NAMES.indexOf('goldUnspent')] = null;
    const z = standardise(m, 3, f)!;
    expect(z[VALUE_FEATURE_NAMES.indexOf('goldUnspent')]).toBe(0);
    expect(z.every((x) => Math.abs(x) <= 6)).toBe(true);
    expect(predict(m, f)).not.toBeNull();
  });
});
