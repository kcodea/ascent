import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { patchGodrayFragment, GODRAY_OPAQUE_LINE, GODRAY_ALPHA_FIX } from './godrayFilter';

// Constructing a real GodrayFilter needs a GL canvas (unavailable in the node test env), so we test the pure
// string patch + guard the marker against the shader files pixi-filters actually ships on disk.

describe('patchGodrayFragment', () => {
  it('replaces the opaque-alpha line with the ray-tracking one', () => {
    const out = patchGodrayFragment(`  vec4 mist = vec4(vec3(noise), 1.0);\n  ${GODRAY_OPAQUE_LINE}\n  mist *= alpha;`);
    expect(out).not.toContain(GODRAY_OPAQUE_LINE);
    expect(out).toContain(GODRAY_ALPHA_FIX);
  });

  it('is a safe no-op when the marker is absent (fails safe on a lib rewrite)', () => {
    expect(patchGodrayFragment('finalColor = vec4(1.0);')).toBe('finalColor = vec4(1.0);');
  });
});

describe('pixi-filters godray shaders still ship the patched line', () => {
  // If a pixi-filters bump renames/removes this line, createGodrayFilter() silently no-ops and the black box
  // returns. These read the shipped shader sources and fail loudly so we notice at CI, not in playtest.
  const require = createRequire(import.meta.url);
  const dir = dirname(require.resolve('pixi-filters/godray'));
  const read = (f: string): string => readFileSync(join(dir, f), 'utf8');

  it('GLSL fragment (god-ray2) contains the marker', () => {
    expect(read('god-ray2.mjs')).toContain(GODRAY_OPAQUE_LINE);
  });
  it('WGSL fragment (god-ray) contains the marker', () => {
    expect(read('god-ray.mjs')).toContain(GODRAY_OPAQUE_LINE);
  });
});
