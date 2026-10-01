import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pixiFx } from '../pixiFx';
import { perfMonitor } from '../perfMonitor';
import {
  admit,
  admitPlay,
  MIN_PARTICLE_SCALE,
  rampMsOf,
  thinDef,
  culledTotal,
  expectedLoad,
  fxScene,
  livePlayCount,
  particleCapFor,
  setFxScene,
  registerLivePlay,
  resetFxBudget,
  type FxBudgetReaders,
  type FxLivePlay,
} from './fxBudget';
import { FXBUDGET_DEFAULTS, type FxBudgetConfig } from './fxBudgetConfig';
import { registerSavedDef } from './fxDefs';
import { playDef } from './playDef';
import type { FxInstance } from './primitive';
import { clearPrimitives, registerPrimitive } from './registry';
import type { StoredFxDef } from './defStore';

/**
 * The budget is a policy over a registry, so the bulk of it is provable headless: plays are registered with
 * a stub `retire`, the live totals are injected (`FxBudgetReaders`), and every assertion is about WHICH
 * play was trimmed and which was left alone. The last block wires the real `playDef` path with the overlay
 * stubbed just far enough to reach it (a truthy renderer, a no-op mount, a no-op updater) and a stub
 * primitive, so the spawn-time hook, the registration and the retire-on-trim are exercised for real.
 */

const CFG: FxBudgetConfig = { maxParticles: 1000, maxPerDef: 3, maxFilters: 8, maxParticlesDiscover: 400, maxParticlesShop: 600 };

/** A registry-backed reader: the "live" totals are the sum of what is registered, which is what the pool
 *  would report once every play's layers are acquired. */
function registryReaders(live: FxLivePlay[]): FxBudgetReaders {
  return {
    liveParticles: () => live.reduce((n, p) => n + p.load.particles, 0),
    activeFilters: () => live.reduce((n, p) => n + p.load.filters, 0),
  };
}

/** Register a play whose `retire` removes it from `live` (the way `playDef`'s teardown unregisters). */
function play(live: FxLivePlay[], id: string, particles: number, filters = 0, prot = false): FxLivePlay & { retired: () => boolean } {
  let done = false;
  let unregister: () => void = () => {};
  const p: FxLivePlay & { retired: () => boolean } = {
    id, load: { particles, filters }, protected: prot,
    retire: () => { done = true; unregister(); const i = live.indexOf(p); if (i >= 0) live.splice(i, 1); },
    retired: () => done,
  };
  unregister = registerLivePlay(p);
  live.push(p);
  return p;
}

beforeEach(() => resetFxBudget());

describe('expectedLoad', () => {
  afterEach(() => clearPrimitives());

  it('sums burst counts, emitter/smoke rate × life, and counts enabled filters + a positive core blur', () => {
    const def = {
      layers: [
        { primitive: 'burst', anchor: 'target', at: 0, params: { count: 155 } },
        { primitive: 'burst', anchor: 'target', at: 0, params: { count: 71, blur: 2, glowOn: true } },
        { primitive: 'shockwave', anchor: 'target', at: 0, params: {} },
        { primitive: 'smoke', anchor: 'target', at: 0, params: { rate: 185, life: 560, outlineOn: true, bloomOn: false } },
        { primitive: 'emitter', anchor: 'target', at: 0, params: { rate: 80, life: 700 } },
      ],
    };
    // 155 + 71 + round(185 × 0.56 = 103.6) + round(80 × 0.7 = 56) = 386; filters: blur + glowOn + outlineOn.
    expect(expectedLoad(def)).toEqual({ particles: 386, filters: 3 });
  });

  it('falls back to the primitive’s declared default when a param is absent, and to 0 when unregistered', () => {
    const def = { layers: [{ primitive: 'burst', anchor: 'target', at: 0, params: {} }] };
    expect(expectedLoad(def).particles).toBe(0); // registry empty headless — no invented number
    registerPrimitive({
      id: 'burst',
      params: { count: { kind: 'slider', label: 'Count', min: 4, max: 400, step: 1, default: 28 } },
      spawn: () => ({ update: vi.fn(), setParams: vi.fn(), destroy: vi.fn() }),
    });
    expect(expectedLoad(def).particles).toBe(28);
  });
});

describe('admitPlay — the per-def cap', () => {
  it('leaves every play alone under the cap (a single burst is untouched)', () => {
    const live: FxLivePlay[] = [];
    const a = play(live, 'strike-impact', 226);
    expect(admitPlay('strike-impact', { particles: 226, filters: 0 }, CFG, registryReaders(live))).toBe(0);
    expect(a.retired()).toBe(false);
    expect(livePlayCount('strike-impact')).toBe(1);
    expect(culledTotal()).toBe(0);
  });

  it('trims the OLDEST play of the same def, never a newer one, once the cap is reached', () => {
    const live: FxLivePlay[] = [];
    const [a, b, c] = [play(live, 'strike-impact', 226), play(live, 'strike-impact', 226), play(live, 'strike-impact', 226)];
    const other = play(live, 'impact-dust', 22);
    expect(admitPlay('strike-impact', { particles: 226, filters: 0 }, CFG, registryReaders(live))).toBe(1);
    expect(a.retired()).toBe(true);
    expect(b.retired()).toBe(false);
    expect(c.retired()).toBe(false);
    expect(other.retired()).toBe(false); // another def cannot relieve a per-def cap, so it is not touched
    expect(livePlayCount('strike-impact')).toBe(2); // room for the incoming one
    expect(culledTotal()).toBe(1);
  });

  it('never trims a protected play, and stops rather than spinning when only protected plays remain', () => {
    const live: FxLivePlay[] = [];
    const plays = [play(live, 'cia-hp', 249, 0, true), play(live, 'cia-hp', 249, 0, true), play(live, 'cia-hp', 249, 0, true)];
    expect(admitPlay('cia-hp', { particles: 249, filters: 0 }, CFG, registryReaders(live))).toBe(0);
    for (const p of plays) expect(p.retired()).toBe(false);
  });
});

describe('admitPlay — the global particle cap', () => {
  it('prefers the oldest SAME-def play, then falls back to the oldest of any def', () => {
    const live: FxLivePlay[] = [];
    const dust = play(live, 'impact-dust', 300);       // oldest overall
    const s1 = play(live, 'strike-impact', 300);       // oldest strike
    const s2 = play(live, 'strike-impact', 300);
    // live 900 + incoming 300 > 1000 → one trim: the oldest STRIKE, not the older dust.
    expect(admitPlay('strike-impact', { particles: 300, filters: 0 }, CFG, registryReaders(live))).toBe(1);
    expect(s1.retired()).toBe(true);
    expect(dust.retired()).toBe(false);
    expect(s2.retired()).toBe(false);
    // Now a def with no siblings arrives needing 500: live 600 + 500 > 1000 → the oldest of ANY def goes.
    expect(admitPlay('blast-pump', { particles: 500, filters: 0 }, CFG, registryReaders(live))).toBe(1);
    expect(dust.retired()).toBe(true);
    expect(s2.retired()).toBe(false);
  });

  it('skips plays that carry no particles — they cannot relieve this cap', () => {
    const live: FxLivePlay[] = [];
    const mesh = play(live, 'lightning', 0);
    const s1 = play(live, 'strike-impact', 900);
    expect(admitPlay('strike-impact', { particles: 300, filters: 0 }, CFG, registryReaders(live))).toBe(1);
    expect(mesh.retired()).toBe(false);
    expect(s1.retired()).toBe(true);
  });

  it('a play larger than the whole cap still spawns after everything trimmable is gone', () => {
    const live: FxLivePlay[] = [];
    const s1 = play(live, 'strike-impact', 400);
    expect(admitPlay('huge', { particles: 5000, filters: 0 }, CFG, registryReaders(live))).toBe(1);
    expect(s1.retired()).toBe(true);
    // Nothing left to trim, nothing thrown — the caller goes on to build the play.
    expect(admitPlay('huge', { particles: 5000, filters: 0 }, CFG, registryReaders(live))).toBe(0);
  });

  it('scripted stress: 40 stacked strike-impacts never push live particles over the cap', () => {
    // The recording's failure mode, replayed: clash after clash before the last one's shards have died.
    // Each admitted play is then registered as `playDef` would register it, and the live total is checked.
    const live: FxLivePlay[] = [];
    const readers = registryReaders(live);
    const cfg: FxBudgetConfig = { ...FXBUDGET_DEFAULTS, maxPerDef: 999 }; // isolate the particle cap
    let peak = 0;
    for (let i = 0; i < 40; i++) {
      admitPlay('strike-impact', { particles: 226, filters: 0 }, cfg, readers);
      play(live, 'strike-impact', 226);
      peak = Math.max(peak, readers.liveParticles());
    }
    expect(peak).toBeLessThanOrEqual(cfg.maxParticles);
    expect(peak).toBeGreaterThan(cfg.maxParticles - 226); // the cap is USED, not merely never approached
    expect(culledTotal()).toBe(40 - Math.floor(cfg.maxParticles / 226));
    // Age order held throughout: what survives is the NEWEST run of plays.
    expect(live.length).toBe(Math.floor(cfg.maxParticles / 226));
  });
});

describe('admitPlay — the global filter cap', () => {
  it('trims the oldest play that HAS filters, same def first', () => {
    const live: FxLivePlay[] = [];
    const bare = play(live, 'spell-target', 100, 0);   // oldest, but filterless — cannot help
    const t1 = play(live, 'tendril-trail', 100, 4);
    const sp = play(live, 'spell-target', 100, 4);
    // live 8 + incoming 2 > 8 → the oldest SAME-def play with filters (sp), not the older tendril.
    expect(admitPlay('spell-target', { particles: 0, filters: 2 }, CFG, registryReaders(live))).toBe(1);
    expect(bare.retired()).toBe(false);
    expect(sp.retired()).toBe(true);
    expect(t1.retired()).toBe(false);
  });
});

describe('the counters', () => {
  it('fx:culled is registered as a level and tallied as a rate on every trim', () => {
    const count = vi.spyOn(perfMonitor, 'count');
    const live: FxLivePlay[] = [];
    play(live, 'a', 600);
    play(live, 'a', 600);
    admitPlay('a', { particles: 600, filters: 0 }, CFG, registryReaders(live));
    expect(culledTotal()).toBe(2);
    expect(perfMonitor.counterSnapshot()['fx:culled']).toBe(2);
    expect(count).toHaveBeenCalledTimes(2);
    expect(count).toHaveBeenCalledWith('fx:culled');
    count.mockRestore();
  });
});

describe('through playDef (the real spawn-time hook)', () => {
  const destroyed: number[] = [];
  let spawnedN = 0;

  beforeEach(() => {
    destroyed.length = 0;
    spawnedN = 0;
    clearPrimitives();
    registerPrimitive({
      id: 'stub',
      params: { count: { kind: 'slider', label: 'Count', min: 0, max: 1000, step: 1, default: 50 } },
      spawn: () => {
        const n = spawnedN++;
        const inst: FxInstance = { update: vi.fn(), setParams: vi.fn(), isComplete: () => false, destroy: () => { destroyed.push(n); } };
        return inst;
      },
    });
    const def: StoredFxDef = {
      version: 1, id: 'budget-test', duration: 800,
      layers: [{ primitive: 'stub', anchor: 'target', at: 0, params: { count: 50 } }],
    };
    registerSavedDef(def);
    vi.spyOn(pixiFx, 'rendererFor').mockReturnValue({} as never);
    vi.spyOn(pixiFx, 'mountLayer').mockReturnValue(() => {});
    vi.spyOn(pixiFx, 'addUpdater').mockReturnValue(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    clearPrimitives();
  });

  it('registers each play, trims the oldest same-def play past maxPerDef, and unregisters on retire', () => {
    const stops: (() => void)[] = [];
    for (let i = 0; i < FXBUDGET_DEFAULTS.maxPerDef; i++) {
      const stop = playDef('budget-test', { target: { x: 0, y: 0 } });
      expect(stop).not.toBeNull();
      stops.push(stop!);
    }
    expect(livePlayCount('budget-test')).toBe(FXBUDGET_DEFAULTS.maxPerDef);
    expect(destroyed).toEqual([]); // at the cap, nothing trimmed yet — a full fan looks as authored

    // One more: the OLDEST (instance 0) is retired for real — its primitive instance is destroyed — and the
    // count holds at the cap. The play just fired is live, untouched.
    playDef('budget-test', { target: { x: 0, y: 0 } });
    expect(destroyed).toEqual([0]);
    expect(livePlayCount('budget-test')).toBe(FXBUDGET_DEFAULTS.maxPerDef);
    expect(culledTotal()).toBe(1);

    // Retiring the trimmed play again is the same idempotent teardown: no double destroy, no registry drift.
    stops[0]!();
    expect(destroyed).toEqual([0]);
    expect(livePlayCount('budget-test')).toBe(FXBUDGET_DEFAULTS.maxPerDef);

    // A natural / caller retire leaves the registry too.
    stops[1]!();
    expect(destroyed).toEqual([0, 1]);
    expect(livePlayCount('budget-test')).toBe(FXBUDGET_DEFAULTS.maxPerDef - 1);
  });

  it('a play with an onDone is protected: it is never the one trimmed', () => {
    const onDone = vi.fn();
    playDef('budget-test', { target: { x: 0, y: 0 } }, { onDone }); // instance 0 — protected
    for (let i = 0; i < FXBUDGET_DEFAULTS.maxPerDef; i++) playDef('budget-test', { target: { x: 0, y: 0 } });
    expect(onDone).not.toHaveBeenCalled();
    expect(destroyed).toEqual([1]); // the oldest UNPROTECTED play went instead
  });
});

/**
 * THE DISCOVER SCENE CAP (perf handoff 2026-09-17, PR 3). While the Discover overlay is open, the live
 * particle ceiling is the LOWER of the global cap and `maxParticlesDiscover`. Same trim policy, same
 * protections — only the number changes, and only for that scene.
 */
describe('the Discover scene cap', () => {
  afterEach(() => setFxScene(null));

  it('particleCapFor is the global cap outside the Discover and the lower of the two inside it', () => {
    expect(particleCapFor(CFG, null)).toBe(1000);
    expect(particleCapFor(CFG, 'discover')).toBe(400);
    expect(particleCapFor({ ...CFG, maxParticlesDiscover: 5000 }, 'discover'), 'never ABOVE the global cap').toBe(1000);
  });

  it('outside the Discover a pile-up under the global cap is left alone', () => {
    const live: FxLivePlay[] = [];
    play(live, 'a', 300);
    play(live, 'b', 300);
    expect(admitPlay('c', { particles: 300, filters: 0 }, CFG, registryReaders(live), null)).toBe(0);
    expect(live).toHaveLength(2);
  });

  it('inside the Discover the same pile-up is trimmed oldest-first down to the scene cap', () => {
    const live: FxLivePlay[] = [];
    const a = play(live, 'a', 300);
    const b = play(live, 'b', 300);
    // 600 live + 300 incoming > 400 → trim a (300 + 300 > 400) → trim b (300 ≤ 400 fits) → 2 trimmed
    expect(admitPlay('c', { particles: 300, filters: 0 }, CFG, registryReaders(live), 'discover')).toBe(2);
    expect(a.retired()).toBe(true);
    expect(b.retired()).toBe(true);
    expect(live).toHaveLength(0);
  });

  it('still never trims a protected play (a looping card treatment on a Discover card)', () => {
    const live: FxLivePlay[] = [];
    const loop = play(live, 'choose-one-both', 217, 0, true);
    const old = play(live, 'a', 300);
    expect(admitPlay('c', { particles: 300, filters: 0 }, CFG, registryReaders(live), 'discover')).toBe(1);
    expect(loop.retired()).toBe(false);
    expect(old.retired()).toBe(true);
  });

  it('admitPlay reads the module scene by default, set through setFxScene', () => {
    const live: FxLivePlay[] = [];
    play(live, 'a', 300);
    play(live, 'b', 300);
    expect(fxScene()).toBeNull();
    setFxScene('discover');
    expect(fxScene()).toBe('discover');
    expect(admitPlay('c', { particles: 300, filters: 0 }, CFG, registryReaders(live))).toBe(2);
    setFxScene(null);
    expect(fxScene()).toBeNull();
  });
});

/**
 * PENDING LOAD + THINNING (perf report 2026-09-30). The owner's capture peaked at 8,661 live particles in a shop
 * second; on the dev build a same-frame fan of 7 x `shop-buff-purple` reached 6,993 against the 4,000 cap with
 * `fx:culled` at 0, because every sibling read the pool before any of them had emitted. These pin the fix: a
 * play still ramping counts at its expected load, is never a victim, and a fan that cannot fit is THINNED.
 */
describe('admit — pending load and thinning (the 2026-09-30 particle blow-up)', () => {
  /** A play that has emitted NOTHING yet (born at `now`, still ramping) — the pool cannot see it. */
  function pendingPlay(id: string, particles: number, now: number, prot = false): FxLivePlay {
    const p: FxLivePlay = { id, load: { particles, filters: 0 }, protected: prot, retire: () => {}, bornAt: now, rampMs: 300 };
    registerLivePlay(p);
    return p;
  }
  const emptyPool = (now: number): FxBudgetReaders => ({ liveParticles: () => 0, activeFilters: () => 0, now: () => now });

  it('a same-frame fan can never exceed the cap: siblings count while pending and the overflow is thinned', () => {
    const now = 1000;
    let committed = 0;
    for (let i = 0; i < 7; i++) {
      const { particleScale } = admit('shop-buff-purple', { particles: 300, filters: 0 }, {}, { ...CFG, maxPerDef: 24 }, emptyPool(now), null);
      const spawned = Math.round(300 * particleScale);
      pendingPlay('shop-buff-purple', spawned, now);
      committed += spawned;
    }
    // 7 x 300 = 2,100 authored against a 1,000 cap: every play still fires, the total stays at the cap plus at most
    // the floor-thinned tail (the floor keeps a play recognisable even when the cap is full).
    expect(committed).toBeLessThanOrEqual(1000 + 4 * Math.round(300 * MIN_PARTICLE_SCALE));
    expect(committed).toBeLessThan(2100);
  });

  it('never trims a pending play (it is the moment landing now); an emitted old play still goes first', () => {
    const now = 5000;
    const live: FxLivePlay[] = [];
    const old = play(live, 'old', 600);                // registered without a ramp → already emitted
    const fresh = pendingPlay('fresh', 300, now);       // fired this frame
    const readers: FxBudgetReaders = { liveParticles: () => 600, activeFilters: () => 0, now: () => now };
    const r = admit('incoming', { particles: 300, filters: 0 }, {}, CFG, readers, null);
    expect(r.trimmed).toBe(1);
    expect(old.retired()).toBe(true);
    expect(livePlayCount('fresh')).toBe(1);
    void fresh;
  });

  it('a play under the cap spawns as authored; a non-thinnable (loop/follow) play is never thinned', () => {
    expect(admit('a', { particles: 200, filters: 0 }, {}, CFG, emptyPool(0), null).particleScale).toBe(1);
    pendingPlay('big', 950, 0);
    expect(admit('b', { particles: 200, filters: 0 }, { thinnable: false }, CFG, emptyPool(0), null).particleScale).toBe(1);
    expect(admit('c', { particles: 200, filters: 0 }, {}, CFG, emptyPool(0), null).particleScale).toBeLessThan(1);
  });

  it('the shop scene carries its own, lower cap', () => {
    expect(particleCapFor(CFG, 'shop')).toBe(600);
    expect(particleCapFor({ ...CFG, maxParticlesShop: 5000 }, 'shop')).toBe(1000);
  });

  it('rampMsOf: latest burst `at`, emitter `at + life`, plus a frame of grace; 0 for a particle-free def', () => {
    expect(rampMsOf({ layers: [{ primitive: 'burst', at: 110, params: { count: 10 } }, { primitive: 'burst', at: 0, params: { count: 5 } }] })).toBe(152);
    expect(rampMsOf({ layers: [{ primitive: 'emitter', at: 20, params: { rate: 60, life: 500 } }] })).toBe(562);
    expect(rampMsOf({ layers: [{ primitive: 'ribbon', at: 0, params: {} }] })).toBe(0);
  });

  it('thinDef scales burst count and emitter/smoke rate only, and is the identity at 1', () => {
    const def = {
      id: 'x', duration: 600,
      layers: [
        { primitive: 'burst', anchor: 'target', at: 0, params: { count: 200, size: 9 } },
        { primitive: 'emitter', anchor: 'target', at: 0, params: { rate: 100, life: 400 } },
        { primitive: 'ribbon', anchor: 'target', at: 0, params: { width: 4 } },
      ],
    } as unknown as Parameters<typeof thinDef>[0];
    expect(thinDef(def, 1)).toBe(def);
    const t = thinDef(def, 0.5);
    expect((t.layers[0]!.params as Record<string, number>).count).toBe(100);
    expect((t.layers[0]!.params as Record<string, number>).size).toBe(9);
    expect((t.layers[1]!.params as Record<string, number>).rate).toBe(50);
    expect(t.layers[2]).toBe(def.layers[2]);
    expect(expectedLoad(t).particles).toBe(100 + 20);
  });
});
