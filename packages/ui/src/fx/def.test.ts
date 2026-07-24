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

  it('immediately marks a layer done if it starts past the def duration', () => {
    const past: FxDef = { id: 'p', duration: 600, layers: [{ primitive: 'r', anchor: 'target', at: 700, params: {} }] };
    expect(layerStateAt(past, 700)[0].state).toBe('done');
    expect(layerStateAt(past, 700)[0].localMs).toBe(0);
  });

  it('jumps a zero-duration layer directly from pending to done without an active phase', () => {
    const instant: FxDef = { id: 'z', duration: 600, layers: [{ primitive: 'r', anchor: 'target', at: 100, life: 0, params: {} }] };
    expect(layerStateAt(instant, 99)[0].state).toBe('pending');
    expect(layerStateAt(instant, 100)[0].state).toBe('done');
    expect(layerStateAt(instant, 100)[0].localMs).toBe(0);
  });

  it('correctly handles a layer whose life extends past the def duration', () => {
    const extend: FxDef = { id: 'e', duration: 500, layers: [{ primitive: 'r', anchor: 'target', at: 200, life: 400, params: {} }] };
    expect(layerStateAt(extend, 599)[0].state).toBe('active');
    expect(layerStateAt(extend, 600)[0].state).toBe('done');
    expect(layerStateAt(extend, 600)[0].localMs).toBe(400);
  });

  it('handles a layer with a negative start time by treating it as partway through at clock 0', () => {
    const early: FxDef = { id: 'e', duration: 600, layers: [{ primitive: 'r', anchor: 'target', at: -100, life: 200, params: {} }] };
    // Layer starts at -100, life 200, so ends at 100. At clock 0 (clamped from negative input), it's 100ms in.
    expect(layerStateAt(early, 0)[0].state).toBe('active');
    expect(layerStateAt(early, 0)[0].localMs).toBe(100);
    expect(layerStateAt(early, 100)[0].state).toBe('done');
  });
});
