import { describe, it, expect, beforeEach } from 'vitest';
import { loadStages, saveStageFor, stageFor, STAGES_KEY } from './stageStore';
import { DEFAULT_STAGE, setPoint } from './stageModel';

describe('stageStore', () => {
  beforeEach(() => {
    try {
      localStorage?.removeItem(STAGES_KEY);
    } catch {
      /* no storage */
    }
  });

  it('stageFor falls back to last then default', () => {
    expect(stageFor('unknown')).toEqual(DEFAULT_STAGE);
  });

  it('saveStageFor(defId) round-trips per def', () => {
    const s = setPoint(DEFAULT_STAGE, 'source', { x: 0.1, y: 0.2 });
    saveStageFor('coin', s);
    expect(stageFor('coin').source).toEqual({ x: 0.1, y: 0.2 });
  });

  it('saveStageFor(null) sets last but not a def entry', () => {
    const s = setPoint(DEFAULT_STAGE, 'target', { x: 0.9, y: 0.5 });
    saveStageFor(null, s);
    expect(stageFor(null).target).toEqual({ x: 0.9, y: 0.5 });
    expect(stageFor('brand-new').target).toEqual({ x: 0.9, y: 0.5 }); // falls to last
  });

  it('round-trips through loadStages after a save', () => {
    const s = setPoint(DEFAULT_STAGE, 'cursor', { x: 0.3, y: 0.7 });
    saveStageFor('rune-x', s);
    const loaded = loadStages();
    expect(loaded.byDef['rune-x']?.cursor).toEqual({ x: 0.3, y: 0.7 });
    expect(loaded.last.cursor).toEqual({ x: 0.3, y: 0.7 });
  });

  it('junk in storage normalizes to a valid SavedStages', () => {
    try {
      localStorage?.setItem(STAGES_KEY, '{not valid json');
    } catch {
      /* no storage; the in-memory cache path is what's under test then */
    }
    const loaded = loadStages();
    expect(loaded).toHaveProperty('byDef');
    expect(loaded).toHaveProperty('last');
    expect(typeof loaded.byDef).toBe('object');
  });
});
