/**
 * SHARED FILTER GROUPS (perf report 2026-09-30). A late-game board of 7 units over 5,000 Attack and Health held
 * 14 milestone-badge loops and 112 live filters (Bloom + Glow per layer per draining cycle, each a full-screen
 * pass); the FX tick measured 16-24 ms. With `shareFilters` the same board runs 4 (one Bloom + Glow per stat).
 * Pinned: which defs may share, what stripping changes, and that N plays build ONE stack per group.
 */
import { Container } from 'pixi.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerFxRuntimeHooks, type FxRuntimeHooks } from './fxRuntime';
import { filterGroupCount, joinFilterGroup, sharedFilterParams, stripFilters } from './sharedFilters';
import attackDef from './defs/test-ascent-frame-attack.json';
import healthDef from './defs/test-ascent-frame-health.json';

const IDS = ['bloom', 'glow', 'outline'];
const layer = (params: Record<string, unknown>) => ({ primitive: 'emitter', anchor: 'source', at: 0, params });
const BASE: FxRuntimeHooks = {
  resetPools: () => {},
  poolSize: () => 0,
  liveParticles: () => 0,
  liveLayers: () => 0,
  activeFilters: () => 0,
};

describe('sharedFilterParams / stripFilters', () => {
  it('both milestone defs qualify: constant Bloom + Glow on one layer', () => {
    for (const def of [attackDef, healthDef]) {
      const fp = sharedFilterParams(def as never, IDS);
      expect(fp).not.toBeNull();
      expect(fp!.bloomOn).toBe(true);
      expect(fp!.glowOn).toBe(true);
    }
  });

  it('declines an animated curve, layers with different filters, a clock-driven filter, and a filter-free def', () => {
    expect(sharedFilterParams({ layers: [layer({ bloomOn: true, bloomCurve: [[0, 0], [1, 1]] })] } as never, IDS)).toBeNull();
    expect(sharedFilterParams({ layers: [layer({ bloomOn: true }), layer({ glowOn: true })] } as never, IDS)).toBeNull();
    expect(sharedFilterParams({ layers: [layer({ bloomOn: true, godrayOn: true })] } as never, IDS)).toBeNull();
    expect(sharedFilterParams({ layers: [layer({ rate: 5 })] } as never, IDS)).toBeNull();
  });

  it('strip turns the toggles and the core blur off and touches nothing else', () => {
    const def = { layers: [layer({ bloomOn: true, glowOn: true, blur: 2, rate: 60, glowAmt: 3 })] };
    const out = stripFilters(def as never, IDS) as unknown as typeof def;
    expect(out.layers[0]!.params).toEqual({ bloomOn: false, glowOn: false, blur: 0, rate: 60, glowAmt: 3 });
    expect(def.layers[0]!.params.bloomOn).toBe(true); // input untouched
  });
});

describe('joinFilterGroup', () => {
  afterEach(() => registerFxRuntimeHooks(BASE));

  it('fourteen plays across two stats build TWO stacks, mount two hosts, and tear each down with its last play', () => {
    const stacks: { frame: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> }[] = [];
    registerFxRuntimeHooks({
      ...BASE,
      makeFilterStack: () => {
        const s = { frame: vi.fn(), destroy: vi.fn() };
        stacks.push(s);
        return s;
      },
    });
    const unmounts: ReturnType<typeof vi.fn>[] = [];
    const mount = vi.fn(() => {
      const u = vi.fn();
      unmounts.push(u);
      return u;
    });
    const attack = [];
    const health = [];
    for (let i = 0; i < 7; i++) {
      attack.push(joinFilterGroup('test-ascent-frame-attack|milestone', 'under', { bloomOn: true }, mount));
      health.push(joinFilterGroup('test-ascent-frame-health|milestone', 'under', { glowOn: true }, mount));
    }
    expect(stacks.length, 'one filter stack per group, not per play').toBe(2);
    expect(mount).toHaveBeenCalledTimes(2);
    expect(filterGroupCount()).toBe(2);
    for (const s of stacks) expect(s.frame).toHaveBeenCalledTimes(1); // time-invariant: written once
    expect(attack[0]!.host).toBeInstanceOf(Container);
    for (const s of attack.slice(0, 6)) s!.release();
    expect(stacks[0]!.destroy).not.toHaveBeenCalled();
    attack[6]!.release();
    attack[6]!.release(); // idempotent
    expect(stacks[0]!.destroy).toHaveBeenCalledTimes(1);
    expect(unmounts[0]).toHaveBeenCalledTimes(1);
    expect(filterGroupCount()).toBe(1);
    for (const s of health) s!.release();
    expect(filterGroupCount()).toBe(0);
  });

  it('returns null (caller falls back to per-play filters) before the FX runtime can build a stack', () => {
    registerFxRuntimeHooks(BASE);
    expect(joinFilterGroup('x', 'over', { bloomOn: true }, () => () => {})).toBeNull();
    expect(filterGroupCount()).toBe(0);
  });
});
