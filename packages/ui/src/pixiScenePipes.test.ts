// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Application } from 'pixi.js';
import { checkScenePipes, missingScenePipes, REQUIRED_SCENE_PIPES } from './pixiScenePipes';
import { fxFaultStats, resetFxFaultStats } from './pixiAppSafety';

/**
 * R-FX-SCENE-PIPES-01 (mobile perf pass 2026-10-18). The overlay renderer must be created with the `particle` and
 * `nineSliceSprite` pipes. They are registered by evaluating the class modules, which the production bundle only
 * did inside the lazily loaded FX primitives chunk, so a renderer that initialised first could never draw a
 * particle effect and threw on every frame one changed. The race only exists in a tree-shaken production bundle
 * (vitest evaluates all of Pixi), so the contract is pinned at its two seams: the entry module imports Pixi's side-effect
 * entry points for both, and a renderer missing a pipe is reported instead of failing silently.
 */
describe('Pixi scene pipes', () => {
  beforeEach(() => resetFxFaultStats());

  it('registers both pipes through the Pixi side-effect entry points (a class reference is tree-shaken away)', () => {
    const src = readFileSync(join(__dirname, 'pixiScenePipes.ts'), 'utf8');
    expect(src).toMatch(/^import 'pixi\.js\/particle-container';$/m);
    expect(src).toMatch(/^import 'pixi\.js\/sprite-nine-slice';$/m);
    expect([...REQUIRED_SCENE_PIPES]).toEqual(['particle', 'nineSliceSprite']);
  });

  it('pixiFx.ts (the entry-chunk module that creates the overlay renderers) imports it', () => {
    const src = readFileSync(join(__dirname, 'pixiFx.ts'), 'utf8');
    expect(src).toMatch(/from '\.\/pixiScenePipes'/);
    // and checks each of its three renderers after init
    expect(src.match(/checkScenePipes\(app,/g)?.length).toBe(3);
  });

  it('names the missing pipes, and reports a renderer built without them as an FX fault', () => {
    expect(missingScenePipes({ particle: {}, nineSliceSprite: {} })).toEqual([]);
    expect(missingScenePipes({ sprite: {}, graphics: {} })).toEqual(['particle', 'nineSliceSprite']);
    expect(missingScenePipes(undefined)).toEqual(['particle', 'nineSliceSprite']);

    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const good = { renderer: { renderPipes: { particle: {}, nineSliceSprite: {} } } } as unknown as Application;
    const bad = { renderer: { renderPipes: { sprite: {} } } } as unknown as Application;
    expect(checkScenePipes(good, 'test')).toBe(true);
    expect(fxFaultStats().faults).toBe(0);
    expect(checkScenePipes(bad, 'test')).toBe(false);
    expect(fxFaultStats().faults).toBe(1);
    err.mockRestore();
  });
});
