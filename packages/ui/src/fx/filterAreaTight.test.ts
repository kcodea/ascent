import { readFileSync } from 'node:fs';
import { BlurFilterPass, Rectangle, Texture, TexturePool, type Container, type Filter, type ParticleContainer } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { FilterStack, filterAreaMode, type FxFilterSpec } from './filterStack';
import { fitParticleBounds, PARTICLE_BOUNDS_HALF_EXTENT } from './particleLayerPool';
import { patchBlurPassClear, tightAreasReady } from './blurPassClear';
import { hasParticleLayer } from './sharedFilters';
import { FILTERS } from './filterRegistry';

/**
 * R-PERF-FX-FILTER-AREA-01: a filter on a particle layer covers the box its particles occupy plus the filter's own
 * reach, not the whole viewport, and only for filters whose picture does not depend on where the area starts.
 */

type FakeC = { parent: FakeC | null; filters: Filter[] | null; destroyed: boolean };
const node = (parent: FakeC | null = null): FakeC => ({ parent, filters: null, destroyed: false });
const asC = (c: FakeC): Container => c as unknown as Container;

const fake = (extra: Record<string, unknown> = {}): Filter => ({ padding: 0, destroy() { /* inert */ }, ...extra }) as unknown as Filter;
/** Shaped like pixi-filters' BloomFilter: `strength` is a setter over an x / y pair, and it sets no padding. */
class FakeBloom {
  padding = 0; strengthX = 0; strengthY = 0;
  set strength(v: number) { this.strengthX = v; this.strengthY = v; }
  destroy(): void { /* inert */ }
}
const REG: readonly FxFilterSpec[] = [
  { id: 'bloom', label: 'Bloom', make: () => new FakeBloom() as unknown as Filter, amountProp: 'strength', amount: [0, 20, 6] },
  { id: 'glow', label: 'Glow', make: () => fake({ padding: 10 }), amountProp: 'outerStrength', amount: [0, 20, 4] },
  { id: 'godray', label: 'Godrays', make: () => fake(), amountProp: 'gain', amount: [0, 1, 0.5] },
];

describe('tight filter areas', () => {
  it('the blur-pass clear is in place on the installed Pixi (tight areas depend on it)', () => {
    expect(patchBlurPassClear()).toBe(true);
    expect(tightAreasReady()).toBe(true);
  });

  it('a layer with no filter above it reports nothing', () => {
    const layer = node(node()); const pc = node(layer);
    expect(filterAreaMode(asC(pc))).toBe('none');
  });

  it('a tight stack of area-independent filters is tight, and Bloom is padded by its reach', () => {
    const layer = node(node()); const pc = node(layer);
    const s = new FilterStack(asC(layer), REG, true);
    s.frame({ bloomOn: true, bloomAmt: 12.5, glowOn: true, glowAmt: 2 }, 0, 0.016);
    expect(filterAreaMode(asC(pc))).toBe('tight');
    const [bloom, glow] = layer.filters as unknown as { padding: number }[];
    expect(bloom!.padding).toBe(Math.ceil(3 * 12.5 + 8));
    expect(glow!.padding).toBe(10); // Glow keeps the padding it sets itself
    s.destroy();
    expect(filterAreaMode(asC(pc))).toBe('none');
  });

  it('a filter whose picture depends on its area keeps the whole viewport', () => {
    const layer = node(node()); const pc = node(layer);
    const s = new FilterStack(asC(layer), REG, true);
    s.frame({ glowOn: true, godrayOn: true }, 0, 0.016);
    expect(filterAreaMode(asC(pc))).toBe('full');
    s.frame({ glowOn: true, godrayOn: false }, 0, 0.016); // toggled off live: tight again
    expect(filterAreaMode(asC(pc))).toBe('tight');
    s.destroy();
  });

  it('a stack that is not tight (any other primitive, a root filter) is never padded and forces the whole viewport', () => {
    const root = node(); const layer = node(root); const pc = node(layer);
    const own = new FilterStack(asC(layer), REG, true);
    own.frame({ glowOn: true }, 0, 0.016);
    const outer = new FilterStack(asC(root), REG); // e.g. a ribbon's own stack, or a group that holds no particles
    outer.frame({ bloomOn: true, bloomAmt: 6 }, 0, 0.016);
    expect((root.filters as unknown as { padding: number }[])[0]!.padding).toBe(0);
    expect(filterAreaMode(asC(pc))).toBe('full');
    outer.destroy(); own.destroy();
  });

  it('every shipped filter is either listed as area-independent or keeps the whole viewport: the list names real ids', () => {
    const src = readFileSync(new URL('./filterStack.ts', import.meta.url), 'utf8');
    const block = src.slice(src.indexOf('const TIGHT_FILTERS'), src.indexOf('/** Tight areas need'));
    const listed = [...block.matchAll(/^\s{2}(?:\/\/.*\n\s{2})*([a-zA-Z]+):|, ([a-zA-Z]+): null|^\s{2}([a-zA-Z]+): null/gm)].map((m) => m[1] ?? m[2] ?? m[3]);
    const ids = new Set(FILTERS.map((f) => f.id));
    expect(listed.length).toBeGreaterThan(8);
    for (const id of listed) expect(ids.has(id!), id).toBe(true);
    // The filters that warp, tile or light by position must never be on it.
    for (const id of ['godray', 'zoomBlur', 'radialBlur', 'shockwave', 'twist', 'bulgePinch', 'tiltShift', 'reflection', 'crt', 'oldFilm', 'pixelate', 'ascii', 'dot', 'glitch', 'simplexNoise']) {
      expect(listed.includes(id), id).toBe(false);
    }
  });
});

describe('fitParticleBounds', () => {
  const mk = (parent: FakeC, ps: { x: number; y: number; scaleX: number; scaleY: number }[]): ParticleContainer & { boundsArea: Rectangle } => ({
    parent, filters: null,
    boundsArea: new Rectangle(-PARTICLE_BOUNDS_HALF_EXTENT, -PARTICLE_BOUNDS_HALF_EXTENT, PARTICLE_BOUNDS_HALF_EXTENT * 2, PARTICLE_BOUNDS_HALF_EXTENT * 2),
    particleChildren: ps, texture: { width: 30, height: 40 },
  }) as unknown as ParticleContainer & { boundsArea: Rectangle };

  it('leaves the unbounded box alone when nothing above the layer is filtered', () => {
    const pc = mk(node(node()), [{ x: 10, y: 10, scaleX: 1, scaleY: 1 }]);
    fitParticleBounds(pc, 0, 0);
    expect(pc.boundsArea.width).toBe(PARTICLE_BOUNDS_HALF_EXTENT * 2);
  });

  it('under a tight stack, reports the particles\' box grown by the largest quad\'s diagonal', () => {
    const layer = node(node());
    const s = new FilterStack(asC(layer), REG, true);
    s.frame({ glowOn: true }, 0, 0.016);
    const pc = mk(layer, [{ x: 100, y: 200, scaleX: 0.5, scaleY: 0.5 }, { x: 160, y: 180, scaleX: -2, scaleY: 1 }]);
    fitParticleBounds(pc, 0, 0);
    const reach = Math.ceil(2 * Math.hypot(30, 40)) + 2; // 102
    expect([pc.boundsArea.x, pc.boundsArea.y, pc.boundsArea.width, pc.boundsArea.height]).toEqual([100 - reach, 180 - reach, 60 + 2 * reach, 20 + 2 * reach]);
    // every quad, at any rotation about any anchor, is inside it
    for (const q of pc.particleChildren) {
      const r = Math.max(Math.abs(q.scaleX), Math.abs(q.scaleY)) * Math.hypot(30, 40);
      expect(q.x - r).toBeGreaterThanOrEqual(pc.boundsArea.x);
      expect(q.x + r).toBeLessThanOrEqual(pc.boundsArea.x + pc.boundsArea.width);
      expect(q.y - r).toBeGreaterThanOrEqual(pc.boundsArea.y);
      expect(q.y + r).toBeLessThanOrEqual(pc.boundsArea.y + pc.boundsArea.height);
    }
    s.destroy();
    fitParticleBounds(pc, 0, 0); // the filter went away: back to the unbounded box
    expect(pc.boundsArea.width).toBe(PARTICLE_BOUNDS_HALF_EXTENT * 2);
  });

  it('an empty layer is an empty box at its head (it must not stretch a shared group to the origin)', () => {
    const layer = node(node());
    const s = new FilterStack(asC(layer), REG, true);
    s.frame({ glowOn: true }, 0, 0.016);
    const pc = mk(layer, []);
    fitParticleBounds(pc, 640, 360);
    expect([pc.boundsArea.x, pc.boundsArea.y, pc.boundsArea.width, pc.boundsArea.height]).toEqual([640, 360, 0, 0]);
    s.destroy();
  });

  it('a NaN position never produces a tight box', () => {
    const layer = node(node());
    const s = new FilterStack(asC(layer), REG, true);
    s.frame({ glowOn: true }, 0, 0.016);
    const pc = mk(layer, [{ x: NaN, y: NaN, scaleX: 1, scaleY: 1 }]);
    fitParticleBounds(pc, 0, 0);
    expect(pc.boundsArea.width).toBe(PARTICLE_BOUNDS_HALF_EXTENT * 2);
    s.destroy();
  });

  it('the three particle primitives build a tight stack and report their bounds; nothing else does', () => {
    for (const p of ['burst', 'emitter', 'smoke']) {
      const src = readFileSync(new URL(`./primitives/${p}.ts`, import.meta.url), 'utf8');
      expect(src, p).toMatch(/new FilterStack\(ctx\.container, FILTERS, true\)/);
      expect(src, p).toMatch(/\.update\(\);\n\s+fitParticleBounds\(/);
    }
    for (const p of ['ribbon', 'beam', 'shockwave', 'custom', 'lightning', 'targeting']) {
      const src = readFileSync(new URL(`./primitives/${p}.ts`, import.meta.url), 'utf8');
      expect(src, p).toMatch(/new FilterStack\(ctx\.container, FILTERS\);/);
    }
  });

  it('a shared filter group is tight only when its def draws particles', () => {
    expect(hasParticleLayer({ layers: [{ primitive: 'emitter' }] } as never)).toBe(true);
    expect(hasParticleLayer({ layers: [{ primitive: 'ribbon' }, { primitive: 'sound' }] } as never)).toBe(false);
  });
});

describe('the blur pass clears its pooled scratch texture', () => {
  it('first intermediate pass clears, the rest and the final pass are as Pixi wrote them', () => {
    expect(patchBlurPassClear()).toBe(true);
    const clears: unknown[] = [];
    const fm = { renderer: { type: 1 /* WEBGL */, renderPipes: {} }, applyFilter: (_f: unknown, _i: unknown, _o: unknown, clear: unknown) => { clears.push(clear); } };
    const self = { passes: 4, _uniforms: { uStrength: 0 }, _calculateInitialStrength: () => 8, _state: { blend: true }, groups: {}, _blurUniforms: {} };
    const input = TexturePool.getOptimalTexture(64, 64, 1, false);
    const apply = (BlurFilterPass.prototype as unknown as { _applyOptimized(fm: unknown, i: Texture, o: Texture, c: boolean): void })._applyOptimized;
    apply.call(self, fm, input, Texture.EMPTY, false);
    expect(clears).toEqual([true, false, false, false]);
    expect(self._uniforms.uStrength).toBe(1); // 8, halved after each of the three intermediate passes
    expect(self._state.blend).toBe(true);
    TexturePool.returnTexture(input);
  });

  it('is written against pixi.js 8.19: an upgrade must re-read BlurFilterPass._applyOptimized', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../../../node_modules/pixi.js/package.json', import.meta.url), 'utf8')) as { version: string };
    expect(pkg.version.startsWith('8.19.')).toBe(true);
  });
});
