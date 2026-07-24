import { describe, expect, it } from 'vitest';
import { biasTint } from './particleMaterial';

// `createParticleMaterial`/`updateParticleMaterial` build a real Pixi `Shader` (GL program compilation,
// texture/uniform resource binding) and so need a live Renderer to exercise meaningfully — the same
// constraint burst.test.ts/ribbon.test.ts document for their own Renderer-dependent constructors ("can't be
// exercised without a WebGL context... covered by the coordinator's manual/visual verification instead").
// `biasTint` is the one piece of this module's logic that's pure (no Pixi/GL dependency), so it's what's
// unit-tested here.
describe('biasTint', () => {
  it('maps 0 to black and 1 to white', () => {
    expect(biasTint(0)).toBe(0x000000);
    expect(biasTint(1)).toBe(0xffffff);
  });

  it('produces an equal-channel (R === G === B) grey for any bias, so luminance == bias regardless of weights', () => {
    for (const bias of [0.1, 0.25, 0.5, 0.73, 0.99]) {
      const tint = biasTint(bias);
      const r = (tint >> 16) & 0xff;
      const g = (tint >> 8) & 0xff;
      const b = tint & 0xff;
      expect(r).toBe(g);
      expect(g).toBe(b);
    }
  });

  it('is monotonic in bias', () => {
    let prev = -1;
    for (let i = 0; i <= 10; i++) {
      const tint = biasTint(i / 10);
      const grey = tint & 0xff;
      expect(grey).toBeGreaterThanOrEqual(prev);
      prev = grey;
    }
  });

  it('clamps out-of-range input instead of wrapping or throwing', () => {
    expect(biasTint(-5)).toBe(0x000000);
    expect(biasTint(5)).toBe(0xffffff);
  });

  it('round-trips close to the input bias (within 8-bit quantisation)', () => {
    for (const bias of [0, 0.2, 0.4, 0.6, 0.8, 1]) {
      const tint = biasTint(bias);
      const grey = tint & 0xff;
      expect(grey / 255).toBeCloseTo(bias, 1);
    }
  });
});
