// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// R-PERF-BOOT-WARM-01 / R-PERF-PIXI-KEEPALIVE-01 (desktop jank pass 2026-10-18): on desktop the boot splash waits for the
// FX shader warm-up and the extra Pixi contexts (Discover, wipe, ranked gate), capped; phones keep their short gate.
const { state, pending } = vi.hoisted(() => {
  const state = { lite: false, resolvers: [] as Array<() => void>, calls: [] as string[] };
  const pending = (name: string) => () => new Promise<void>((r) => { state.calls.push(name); state.resolvers.push(r); });
  return { state, pending };
});
vi.mock('./phoneArt', () => ({ get LITE_ART() { return state.lite; } }));
vi.mock('./fx/playDef', () => ({ whenFxPrewarmed: pending('fx') }));
vi.mock('./pixiFx', () => ({ warmDiscoverFxNow: pending('discover') }));
vi.mock('./wipeFx', () => ({ wipeFx: { warm: () => state.calls.push('wipe.warm'), ready: pending('wipe') } }));
vi.mock('@game/sim', () => ({ loadStrengthReference: pending('strength') }));
vi.mock('./rankedGate/gateFx', () => ({ gateFx: { warm: () => state.calls.push('gate.warm'), ready: pending('gate') } }));

import { bootWarm } from './bootWarm';

describe('the boot warm-up', () => {
  beforeEach(() => { vi.useFakeTimers(); state.lite = false; state.resolvers = []; state.calls = []; });
  afterEach(() => { vi.useRealTimers(); });

  it('on desktop it starts every warm-up and resolves only once all of them have finished', async () => {
    let done = false;
    void bootWarm(4000).then(() => { done = true; });
    expect(state.calls).toEqual(expect.arrayContaining(['wipe.warm', 'gate.warm', 'fx', 'discover', 'wipe', 'gate', 'strength']));
    for (const r of state.resolvers.slice(0, -1)) r();
    await vi.advanceTimersByTimeAsync(10);
    expect(done).toBe(false); // one still running
    state.resolvers[state.resolvers.length - 1]!();
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(true);
  });

  it('never holds the splash past its cap (a GPU that never answers)', async () => {
    let done = false;
    void bootWarm(4000).then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(3999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    expect(done).toBe(true);
  });

  it('phones and iPads (LITE_ART) warm nothing and do not wait', async () => {
    state.lite = true;
    let done = false;
    void bootWarm(4000).then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(true);
    expect(state.calls).toEqual([]);
  });
});

describe('the splash waits on it, and only its own fade removes it', () => {
  const src = readFileSync(join(__dirname, 'Boot.tsx'), 'utf8');
  it('the fade-out starts after bootWarm()', () => {
    expect(src).toMatch(/bootWarm\(\)\.then\([\s\S]*?classList\.add\('is-out'\)/);
  });
  it('a child transition (the bar fill, the art fade-in) can never cut the splash', () => {
    expect(src).toMatch(/e\.target === el && e\.propertyName === 'opacity'/);
  });
});

describe('desktop keeps the ranked gate layer', () => {
  it('release() frees the WebGL context on phones only', () => {
    const src = readFileSync(join(__dirname, 'rankedGate', 'gateFx.ts'), 'utf8');
    expect(src).toMatch(/release\(\): void \{[\s\S]*?if \(!PHONE_GPU\) return;[\s\S]*?this\.releaseWhenIdle = true;/);
  });
});
