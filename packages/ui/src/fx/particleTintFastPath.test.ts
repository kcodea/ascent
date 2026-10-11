/**
 * `setParticleGreyTint` writes a particle's packed colour directly instead of going through Pixi's `tint` setter
 * (gameplay perf 2026-10-10). It leans on two Pixi internals (`_tint`, `_updateColor`), so this pins that it
 * produces EXACTLY the `color` the real setter does, for every grey and alpha, on the installed Pixi version. If a
 * Pixi upgrade renames the internals or changes the packing, this fails before players see wrong colours.
 */
import { describe, expect, it } from 'vitest';
import { Particle, Texture } from 'pixi.js';
import { biasTint, setParticleGreyTint } from './particleMaterial';

describe('setParticleGreyTint', () => {
  it('matches the real tint setter for every grey level and a spread of alphas', () => {
    for (const alpha of [0, 0.13, 0.5, 0.999, 1]) {
      for (let g = 0; g <= 255; g++) {
        const grey = (g << 16) | (g << 8) | g;
        const viaSetter = new Particle({ texture: Texture.WHITE });
        viaSetter.alpha = alpha;
        viaSetter.tint = grey;
        const fast = new Particle({ texture: Texture.WHITE });
        fast.alpha = alpha;
        setParticleGreyTint(fast, grey);
        expect(fast.color).toBe(viaSetter.color);
        expect(fast.tint).toBe(viaSetter.tint);
      }
    }
  });

  it('covers what the primitives actually pass (biasTint output), and alpha changes still repack', () => {
    const p = new Particle({ texture: Texture.WHITE });
    const ref = new Particle({ texture: Texture.WHITE });
    for (const bias of [0, 0.25, 0.5, 0.75, 1]) {
      p.alpha = bias; ref.alpha = bias;
      setParticleGreyTint(p, biasTint(bias)); ref.tint = biasTint(bias);
      expect(p.color).toBe(ref.color);
    }
  });
});
