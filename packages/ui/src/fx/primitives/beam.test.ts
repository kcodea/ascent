import { describe, expect, it } from 'vitest';
import { defaultsOf, validateSpecs } from '../params';
import { beamPrimitive } from './beam';

/**
 * `BeamInstance` needs a real WebGL context (Mesh + Shader), so — exactly as `lightning.test.ts` does — the
 * instance is exercised at runtime and the unit tests cover what CAN be checked headless: the specs are
 * well-formed, and the shipped defaults are the prismatic/neutral look the owner approved. The strip geometry
 * has its own suite in `beamGeometry.test.ts`.
 */
describe('beam primitive', () => {
  it('registers with valid specs under the id "beam"', () => {
    expect(beamPrimitive.id).toBe('beam');
    expect(validateSpecs(beamPrimitive.params)).toEqual([]);
  });

  it('ships the prismatic-neutral defaults (a changed default must be a deliberate, reviewed edit)', () => {
    const d = defaultsOf(beamPrimitive.params);
    expect(d).toMatchObject({
      blendMode: 'add',
      travelMs: 200, dwellMs: 520, releaseMs: 200,
      width: 18, coreWidth: 3, segments: 24,
      waver: 0.12, waverFreq: 2.5, waverSpeed: 1.2, endSoftness: 0.12,
      flowAmt: 0.35, flowSpeed: 1.4, flowFreq: 6, flowDir: 'target',
      glowStrength: 0.7, gain: 1,
      coreColor: 0xf2f6ff, tipColor: 0xdce8ff, glowColor: 0x9fb8ff,
      flicker: 0,
    });
  });

  it('carries the full filter lab, blur and transform knobs, so every workshop filter applies', () => {
    const p = beamPrimitive.params as Record<string, unknown>;
    expect(p.blur).toBeDefined();
    expect(p.fxSpin).toBeDefined();
    expect(p.bloomOn).toBeDefined();
  });
});
