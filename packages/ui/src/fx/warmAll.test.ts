import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * THE STANDARD (owner 2026-09-03): nothing runs cold on first use. This test is how that stays true without
 * anyone remembering — it DERIVES what the boot warm-up must cover from the source and fails CI when a new
 * effect is reachable but not fired at boot.
 *
 *   • every PUBLIC method on the pixiFx controller that fires an effect must be called in `warmAll.ts`
 *     (a new hand-written effect → add it to `fireAllHandWritten`, or to NOT_A_FIRE below WITH a reason);
 *   • every crit multiplier the engine can emit must have its `${n}x` label baked
 *     (the label is part of the crit-text texture key, so a new multiplier is a new cold rasterise);
 *   • committed defs need no entry: `warmAll` plays `listDefs()`, so a new def is covered by construction.
 */
const UI = resolve(__dirname, '..');
const pixiSrc = readFileSync(resolve(UI, 'pixiFx.ts'), 'utf8');
const warmSrc = readFileSync(resolve(__dirname, 'warmAll.ts'), 'utf8');

/** Public methods on the controller that are NOT effect fires — lifecycle, dev handles, config. Adding to this
 *  list is a reviewable diff on purpose: the alternative is a cold first fire nobody notices. */
const NOT_A_FIRE: Record<string, string> = {
  setPerfLabel: 'perf-HUD label',
  setScale: 'stage scale setter',
  enableAutoIdle: 'ticker policy',
  setUnderHost: 'slot host wiring',
  ensureUnderSlot: 'slot canvas lifecycle',
  ensureAboveSlot: 'slot canvas lifecycle',
  rendererFor: 'accessor',
  mountLayer: 'def-runtime plumbing (exercised by every def the warm-up plays)',
  addUpdater: 'def-runtime plumbing',
  attach: 'lifecycle',
  onRendererReady: 'listener registration',
  detach: 'lifecycle',
  setPaused: 'playback control',
  setVisible: 'playback control',
  clearParticles: 'teardown',
  clearAimLine: 'teardown (fired by the aimLine warm via setTimeout — a clear, not a fire)',
  test: 'DEV console handle',
  testCrit: 'DEV console handle (critImpact is fired directly)',
  testFlurry: 'DEV console handle (windSlash is fired directly)',
  testExecute: 'DEV console handle (executeStrike is fired directly)',
  warmBuiltinTextures: 'the texture warm itself (called by warmFx)',
};

function publicMethods(src: string): string[] {
  // Two-space-indented class members, not `private`/`get`/`set`/`constructor`; the class is the only
  // thing in the file declared at that indent with a `name(` signature.
  const out = new Set<string>();
  for (const m of src.matchAll(/^ {2}(?:async )?([a-zA-Z]+)\(/gm)) {
    const name = m[1]!;
    if (name === 'constructor' || name === 'if' || name === 'for' || name === 'while') continue;
    out.add(name);
  }
  for (const m of src.matchAll(/^ {2}(?:private|protected|get|set) /gm)) void m; // (excluded by the regex above)
  return [...out];
}

describe('the boot warm-up fires every effect (fx/warmAll.ts)', () => {
  it('every public pixiFx fire method is called in warmAll.ts', () => {
    const privates = new Set([...pixiSrc.matchAll(/^ {2}private (?:readonly )?(?:async )?([a-zA-Z]+)\(/gm)].map((m) => m[1]!));
    const missing = publicMethods(pixiSrc)
      .filter((n) => !privates.has(n) && !(n in NOT_A_FIRE))
      .filter((n) => !new RegExp(`(pixiFx|discoverFx)\\.${n}\\(`).test(warmSrc));
    expect(missing, `add these to fireAllHandWritten in warmAll.ts (or to NOT_A_FIRE with a reason): ${missing.join(', ')}`).toEqual([]);
  });

  it('the derivation sees the real controller (guards against a vacuous pass)', () => {
    const names = publicMethods(pixiSrc);
    expect(names).toContain('critImpact');
    expect(names).toContain('deathrattle');
    expect(names.length).toBeGreaterThan(20);
  });

  it('every crit multiplier the engine can emit has its label baked at boot', () => {
    const core = resolve(UI, '../../core/src');
    const srcs = ['effects/factories.ts', 'combat/simulate.ts'].map((f) => readFileSync(resolve(core, f), 'utf8')).join('\n');
    const mults = new Set<string>();
    for (const m of srcs.matchAll(/crit\?\.\(\s*[^,]+,\s*(\d+)\s*\)/g)) mults.add(m[1]!);
    for (const m of srcs.matchAll(/critMult\s*=\s*crit\s*\?\s*(\d+)/g)) mults.add(m[1]!);
    expect(mults.size, 'the derivation found no crit multipliers — did the engine move them?').toBeGreaterThan(0);
    for (const n of mults) expect(warmSrc, `procCritText '${n}x' is not baked at boot`).toContain(`'${n}x'`);
  });
});
