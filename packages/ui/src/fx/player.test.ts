import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPlayer } from './player';
import { clearPrimitives, registerPrimitive } from './registry';
import type { FxContext, FxInstance } from './primitive';
import type { FxDef } from './def';

const spawned: { id: string; inst: FxInstance }[] = [];

const stubPrimitive = (id: string) => ({
  id,
  params: { size: { kind: 'slider' as const, label: 'Size', min: 0, max: 10, step: 1, default: 5 } },
  spawn: () => {
    const inst: FxInstance = { update: vi.fn(), setParams: vi.fn(), destroy: vi.fn() };
    spawned.push({ id, inst });
    return inst;
  },
});

const CTX = { container: { addChild: vi.fn(), removeChild: vi.fn() }, renderer: {} } as unknown as FxContext;

const DEF: FxDef = {
  id: 'test',
  duration: 500,
  layers: [
    { primitive: 'a', anchor: 'target', at: 0, life: 300, params: {} },
    { primitive: 'b', anchor: 'target', at: 200, life: 100, params: {} },
  ],
};

describe('createPlayer', () => {
  beforeEach(() => {
    spawned.length = 0;
    clearPrimitives();
    registerPrimitive(stubPrimitive('a'));
    registerPrimitive(stubPrimitive('b'));
  });

  it('spawns a layer only when its start time is reached', () => {
    const p = createPlayer(DEF, CTX);
    p.play();
    expect(spawned.map((s) => s.id)).toEqual(['a']);
    p.update(200);
    expect(spawned.map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('destroys a layer when its life elapses', () => {
    const p = createPlayer(DEF, CTX);
    p.play();
    const a = spawned[0].inst;
    p.update(299);
    expect(a.destroy).not.toHaveBeenCalled();
    p.update(2);
    expect(a.destroy).toHaveBeenCalledTimes(1);
  });

  it('scales elapsed time by speed', () => {
    const p = createPlayer(DEF, CTX);
    p.play();
    p.setSpeed(2);
    p.update(100);
    expect(p.timeMs()).toBe(200);
  });

  it('scrub rebuilds state at an arbitrary time', () => {
    const p = createPlayer(DEF, CTX);
    p.play();
    p.scrub(250);
    expect(p.timeMs()).toBe(250);
    expect(spawned.map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('scrubbing backwards destroys layers that have not started yet', () => {
    const p = createPlayer(DEF, CTX);
    p.play();
    p.scrub(250);
    const b = spawned.find((s) => s.id === 'b')!.inst;
    p.scrub(50);
    expect(b.destroy).toHaveBeenCalled();
  });

  it('loops back to zero at the duration when looping is on', () => {
    const p = createPlayer(DEF, CTX, { loop: true });
    p.play();
    p.update(520);
    expect(p.timeMs()).toBe(20);
  });

  it('stops at the duration when looping is off', () => {
    const p = createPlayer(DEF, CTX);
    p.play();
    p.update(520);
    expect(p.timeMs()).toBe(500);
    expect(p.isPlaying()).toBe(false);
  });

  it('destroys every live layer on stop', () => {
    const p = createPlayer(DEF, CTX);
    p.play();
    p.update(200);
    p.stop();
    for (const s of spawned) expect(s.inst.destroy).toHaveBeenCalled();
  });

  it('does not advance while paused', () => {
    const p = createPlayer(DEF, CTX);
    p.play();
    p.pause();
    p.update(100);
    expect(p.timeMs()).toBe(0);
  });

  it('pushes edited params to a live layer without respawning it', () => {
    const p = createPlayer(DEF, CTX);
    p.play();
    const a = spawned[0].inst;
    p.setLayerParams(0, { size: 9 });
    expect(a.setParams).toHaveBeenCalledWith({ size: 9 });
    expect(spawned).toHaveLength(1);
  });

  it('forwards setHead to the live layer and ignores primitives that do not implement it', () => {
    const p = createPlayer(DEF, CTX);
    p.play();
    expect(() => p.setHead(0, 10, 20)).not.toThrow();
    expect(() => p.setHead(99, 10, 20)).not.toThrow();
  });
});
