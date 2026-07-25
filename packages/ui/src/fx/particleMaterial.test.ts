import { describe, expect, it } from 'vitest';
import { biasTint, tintModeValue, PARTICLE_TINT_MODES, PARTICLE_FRAG } from './particleMaterial';

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

describe('tintModeValue', () => {
  it('maps the palette mode to 0 and the texture mode to 1', () => {
    expect(tintModeValue('palette')).toBe(0);
    expect(tintModeValue('texture')).toBe(1);
  });

  it('lands unambiguously either side of the shader\'s "> 0.5" branch for every declared mode', () => {
    for (const mode of PARTICLE_TINT_MODES) {
      const v = tintModeValue(mode);
      expect(Math.abs(v - 0.5)).toBeGreaterThan(0.4);
    }
  });

  it('declares palette first, so it is the default a spec picks up', () => {
    expect(PARTICLE_TINT_MODES[0]).toBe('palette');
  });
});

/**
 * PARTICLE_FRAG is GLSL inside a JS template literal: `tsc` can't see inside it and there's no GL context in
 * vitest to actually compile it (the same constraint shaderChunks.test.ts documents). What IS checkable here
 * is the class of mistake that has actually bitten this file — a stray backtick inside a `//` comment
 * silently terminating the template literal, an unbalanced brace from an edit — plus the two lines that ARE
 * the cel look, so a future "simplification" that deletes them fails a test instead of shipping flat chips.
 */
describe('PARTICLE_FRAG source integrity', () => {
  it('contains no backtick (which would have silently truncated the template literal)', () => {
    expect(PARTICLE_FRAG).not.toContain('`');
  });

  it('has balanced braces and parentheses', () => {
    const count = (ch: string): number => PARTICLE_FRAG.split(ch).length - 1;
    expect(count('{')).toBe(count('}'));
    expect(count('(')).toBe(count(')'));
  });

  it('declares every uniform the TS side writes', () => {
    for (const u of [
      'uTexture', 'uBands', 'uPal', 'uNoise', 'uWarp', 'uScroll', 'uErode',
      'uGain', 'uTime', 'uGlow', 'uPlateau', 'uFieldMix', 'uTintMode',
    ]) {
      // The type token spans sampler2D/vec2/vec4/float, so it is case-mixed — hence [A-Za-z0-9].
      expect(PARTICLE_FRAG).toMatch(new RegExp(`uniform [A-Za-z0-9]+ ${u}\\b`));
    }
  });

  it('builds the quantisation field from a radial distance remapped by the ribbon\'s plateau, NOT from the texture alpha', () => {
    // The whole point of the fix: a hard-edged shape's interior alpha is flat 1.0, so posterizing it gives
    // one flat colour. The field has to be the procedural radial falloff (ribbon.ts's `across`/`wfall`).
    expect(PARTICLE_FRAG).toContain('float across = clamp(length(vUV - 0.5) * 2.0, 0.0, 1.0);');
    expect(PARTICLE_FRAG).toContain('float wfall = 1.0 - smoothstep(uPlateau, 1.0, across);');
    expect(PARTICLE_FRAG).toContain('float field = mix(wfall, tex.a, uFieldMix);');
    expect(PARTICLE_FRAG).toContain('float baseShape = field * mix(0.32, 1.05, bias);');
    // The pre-fix line, which fed the texture's own alpha straight into the posterize chain.
    expect(PARTICLE_FRAG).not.toContain('float shape = texture(uTexture, vUV).a;');
  });

  it('keeps the texture alpha as the silhouette mask (early-out + body-alpha multiply)', () => {
    expect(PARTICLE_FRAG).toContain('if (tex.a < 0.04) discard;');
    expect(PARTICLE_FRAG).toContain('c.a * tex.a');
  });

  it('quantises the texture tint mode with posterizePal\'s own convention', () => {
    // shaderChunks.ts: `floor(q * bands) / max(bands - 1.0, 1.0)` — same shape, per-channel, clamped.
    expect(PARTICLE_FRAG).toContain('floor(tex.rgb * uBands) / max(uBands - 1.0, 1.0)');
    expect(PARTICLE_FRAG).toMatch(/uTintMode > 0\.5/);
  });

  it('routes both tint modes through the same eroded cutoff', () => {
    expect(PARTICLE_FRAG).toContain('vec4 c = d > 0.0 ? src : vec4(0.0);');
  });
});
