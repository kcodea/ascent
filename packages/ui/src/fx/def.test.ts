import { describe, expect, it } from 'vitest';
import { layerStateAt, type FxDef } from './def';

const DEF: FxDef = {
  id: 'test',
  duration: 600,
  layers: [
    { primitive: 'ribbon', anchor: 'travel', at: 0, life: 400, params: {} },
    { primitive: 'burst', anchor: 'target', at: 180, life: 200, params: {} },
  ],
};

describe('layerStateAt', () => {
  it('reports a layer pending before its start time', () => {
    expect(layerStateAt(DEF, 0).map((l) => l.state)).toEqual(['active', 'pending']);
  });

  it('reports a layer active once its start time is reached', () => {
    expect(layerStateAt(DEF, 180).map((l) => l.state)).toEqual(['active', 'active']);
  });

  it('reports a layer done once its life has elapsed', () => {
    expect(layerStateAt(DEF, 420).map((l) => l.state)).toEqual(['done', 'done']);
  });

  it('gives each active layer its local elapsed time, not the global clock', () => {
    const [ribbon, burst] = layerStateAt(DEF, 200);
    expect(ribbon.localMs).toBe(200);
    expect(burst.localMs).toBe(20);
  });

  it('treats a layer with no life as running to the end of the def', () => {
    const open: FxDef = { id: 'o', duration: 500, layers: [{ primitive: 'r', anchor: 'target', at: 100, params: {} }] };
    expect(layerStateAt(open, 499)[0].state).toBe('active');
    expect(layerStateAt(open, 500)[0].state).toBe('done');
  });

  it('clamps a negative clock to the start rather than reporting nonsense', () => {
    expect(layerStateAt(DEF, -50).map((l) => l.state)).toEqual(['active', 'pending']);
  });
});
