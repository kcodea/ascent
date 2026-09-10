import { describe, expect, it } from 'vitest';
import { defaultsOf, validateSpecs } from '../params';
import { lightningPrimitive } from './lightning';

/**
 * `LightningInstance` needs a real WebGL context to construct (Mesh + Shader), so — exactly as `ribbon.test.ts`
 * does — the instance itself is exercised at runtime, and the unit tests cover the two things that CAN be
 * checked headless: the param specs are well-formed, and the shipped defaults are the look the owner locked in
 * the Lightning Lab workshop reference. The bolt geometry has its own suite in `lightningGeometry.test.ts`.
 */
describe('lightning primitive', () => {
  it('registers with valid specs under the id "lightning"', () => {
    expect(lightningPrimitive.id).toBe('lightning');
    expect(validateSpecs(lightningPrimitive.params)).toEqual([]);
  });

  it('ships the workshop-locked defaults (a changed default must be a deliberate, reviewed edit)', () => {
    const d = defaultsOf(lightningPrimitive.params);
    expect(d).toMatchObject({
      mode: 'travel', blendMode: 'add',
      travelMs: 300, dwellMs: 620, releaseMs: 180,
      chaos: 0.2, smooth: 0.47, detail: 5, taper: 0.22,
      branchChance: 0.1, branchSpread: 12, branchDepth: 2,
      width: 28, coreWidth: 1.8, glowStrength: 0.8, sparkle: 0.4, gain: 1,
      coreColor: 0xeaf3ff, tipColor: 0xc58cff, glowColor: 0x5a63ff,
      flicker: 9, decay: 0.72,
      bolts: 6, radius: 200,
    });
  });

  it('carries the full filter lab, blur and transform knobs, so every workshop filter applies', () => {
    // The filter-lab specs are generated from FILTERS at runtime, so they aren't in the static param type —
    // check them by key. `blur` (BLUR_PARAM_SPECS), `fxSpin` (TRANSFORM_PARAM_SPECS) and `bloomOn` (a
    // filter-lab toggle) together prove all three groups were spread in.
    const p = lightningPrimitive.params as Record<string, unknown>;
    expect(p.blur).toBeDefined();
    expect(p.fxSpin).toBeDefined();
    expect(p.bloomOn).toBeDefined();
  });
});
