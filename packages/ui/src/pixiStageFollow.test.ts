// @vitest-environment jsdom
/**
 * R-PHONE-FXSIZE-01 (owner report 2026-10-26: "some pixi effects dont seem to be firing and that animations also seem to
 * be offset up and to the left"). WebKit fires no window `resize` when the page scale's meta viewport changes, so a Pixi
 * renderer sized by `resizeTo: window` kept its old size while its canvas box (`--lvw` x `--lvh`) took the new one, and
 * every effect drew at old/new of its coordinates. The renderer now follows the stage's fit on every stage change.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { followStage, followedResolution, followedWindowSize } from './pixiStageFollow';
import { applyStage, stageFit } from './stage';

function fakeApp(resizeTo: Window | HTMLElement, resolution = 0.546) {
  const calls: [number, number, number | undefined][] = [];
  const app = {
    resizeTo,
    resize: vi.fn(),
    render: vi.fn(),
    renderer: { resolution, resize: (w: number, h: number, r?: number) => { calls.push([w, h, r]); } },
    destroy: vi.fn(),
  };
  return { app, calls };
}

describe('R-PHONE-FXSIZE-01: the Pixi renderers follow the stage on a phone', () => {
  it('a window renderer is sized from the fit (its canvas box), not innerWidth', () => {
    expect(followedWindowSize({ lw: 2212, lh: 1020, s: 1 })).toEqual({ w: 2212, h: 1020 }); // the page scale
    expect(followedWindowSize({ lw: 2000, lh: 1125, s: 0.5 })).toEqual({ w: 1000, h: 562.5 }); // a transformed stage
  });
  it('the resolution re-folds the page scale it was created under', () => {
    expect(followedResolution(0.546, 0.3639, 0.3852)).toBeCloseTo(0.578, 3);
    expect(followedResolution(1.5, 1, 1)).toBe(1.5);
    expect(followedResolution(1.5, 0, 0.4)).toBe(1.5);
  });
  it('resizes at once and again on every stage change, and stops when the app is destroyed', () => {
    const { app, calls } = fakeApp(window);
    const stop = followStage(app as never, true);
    const f = stageFit();
    expect(calls.at(-1)?.slice(0, 2)).toEqual([f.lw * f.s, f.lh * f.s]);
    const n = calls.length;
    applyStage();
    expect(calls.length).toBe(n + 2);
    (app as unknown as { destroy: () => void }).destroy();
    applyStage();
    expect(calls.length).toBe(n + 2);
    stop();
  });
  it('resizes in two steps, so a same-backing-size change (size and resolution inverse) still moves the screen', () => {
    const { app, calls } = fakeApp(window);
    followStage(app as never, true);
    expect(calls.slice(-2).map((c) => c[2])).toEqual([undefined, 0.546]);
  });
  it('desktop never changes: no wrapper, the Pixi resize untouched', () => {
    const { app, calls } = fakeApp(window);
    const before = app.resize;
    followStage(app as never, false);
    expect(app.resize).toBe(before);
    expect(calls.length).toBe(0);
  });
  it('every screen-space Pixi app follows the stage', () => {
    for (const f of ['pixiFx.ts', 'wipeFx.ts', 'rankedGate/gateFx.ts', 'hero-select/HeroCeremonyPixi.ts', 'progression/crateFx/crateFxPixi.ts', 'heroBlast/HeroAttackPreview.tsx']) {
      const src = readFileSync(join(__dirname, f), 'utf8');
      expect((src.match(/new Application\(\)/g) ?? []).length, f).toBe((src.match(/followStage\(/g) ?? []).length);
    }
  });
});
