import { describe, expect, it } from 'vitest';
import { defaultsOf, validateSpecs } from '../params';
import { targetingPrimitive } from './targeting';
import { PRIMITIVE_COPY } from '../ui/copy';

/**
 * `TargetingInstance` renders through PixiJS `Graphics` (a real GL context), so — like `beam`/`lightning` —
 * the visual is verified by eye in the workshop and the headless tests cover what CAN be: the specs are
 * well-formed, the shipped defaults are the approved starting look, the full filter lab is present, and the
 * primitive is discoverable (registered id + workshop copy). The motion itself is covered by `aimLasso.test.ts`.
 */
describe('targeting primitive', () => {
  it('registers with valid specs under the id "targeting"', () => {
    expect(targetingPrimitive.id).toBe('targeting');
    expect(validateSpecs(targetingPrimitive.params)).toEqual([]);
  });

  it('ships the approved lasso defaults (a changed default must be a deliberate, reviewed edit)', () => {
    const d = defaultsOf(targetingPrimitive.params);
    expect(d).toMatchObject({
      blendMode: 'add',
      coreWidth: 8, coreAlpha: 0.95, glowWidth: 12, glowAlpha: 0.7, taper: 0.5, breathe: 0.5,
      colorCore: 0xffd9a0, colorGlow: 0xffa82e,
      segments: 22, curve: 0.26, curveVar: 0.4,
      springStiffness: 150, springDamping: 16,
      swayAmp: 7, swayFreq: 1.6, swaySpeed: 2, motionInfluence: 0.012, cursorLead: 0,
      pointerSize: 12, pointerGlow: 10, pointerTicks: 4, pointerSpin: 1.5, onTargetGrow: 1.6,
      colorPointer: 0xffe6b0, onTargetPreview: false,
      sparkleOn: true, sparkleAlong: 28, sparklePointer: 40, sparkleAlpha: 0.95, sparkleSize: 3, sparkleSizeDecay: 0.7,
      sparkleLife: 650, sparkleSpeed: 55, sparkleGravity: -40, sparkleDrag: 0.25, sparkleFling: 0.5,
      sparkleSpread: 0.7, sparkleTwinkle: 7, sparkleColor: 0xffe6b0, sparkleColor2: 0xffa82e,
    });
  });

  it('carries the full filter lab, blur and transform knobs, so every workshop filter applies', () => {
    const p = targetingPrimitive.params as Record<string, unknown>;
    expect(p.blur).toBeDefined();
    expect(p.fxSpin).toBeDefined();
    expect(p.bloomOn).toBeDefined();
  });

  it('has a workshop copy label so it shows in the primitive picker', () => {
    expect(PRIMITIVE_COPY.targeting?.label).toBe('Targeting');
    expect(PRIMITIVE_COPY.targeting?.blurb.length).toBeGreaterThan(20);
  });
});
