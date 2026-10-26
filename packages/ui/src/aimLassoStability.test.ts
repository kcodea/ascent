/**
 * R-PHONE-LASSO-01 (owner report 2026-10-26, iPhone: "The Ruby targeting lasso is bugged on mobile"): the lasso's spring
 * must stay on the line between the source and the finger at ANY frame rate. One integration step per frame diverged
 * below ~120 fps for `ruby-target` (damping 60): on a 60 Hz phone the ribbon's points flew to ~10^5 px within a drag.
 * Every shipped aim def is checked, driven through a drag like the one in the WebKit repro, at phone and desktop rates.
 */
import { describe, expect, it } from 'vitest';
import { createLassoState, lassoSubsteps, stepLasso, type AimLassoCfg } from './aimLasso';
import rubyTarget from './fx/defs/ruby-target.json';
import spellTarget from './fx/defs/spell-target.json';
import heroPowerTarget from './fx/defs/hero-power-target.json';

type Def = { id: string; layers: { primitive: string; params: Record<string, unknown> }[] };
function cfgOf(def: Def): AimLassoCfg {
  const p = def.layers.find((l) => l.primitive === 'targeting')!.params as Record<string, number>;
  const d = (k: string, v: number): number => (typeof p[k] === 'number' ? p[k]! : v);
  return {
    segments: d('segments', 20), curve: d('curve', 0.2), curveVar: d('curveVar', 0), springStiffness: d('springStiffness', 140),
    springDamping: d('springDamping', 16), swayAmp: d('swayAmp', 0), swayFreq: d('swayFreq', 1), swaySpeed: d('swaySpeed', 1),
    motionInfluence: d('motionInfluence', 0),
  };
}
const DEFS = [rubyTarget, spellTarget, heroPowerTarget].filter((d) => (d as Def).layers.some((l) => l.primitive === 'targeting')) as Def[];

describe('the aim lasso stays on screen at any frame rate (R-PHONE-LASSO-01)', () => {
  for (const def of DEFS) {
    for (const fps of [240, 165, 120, 60, 30, 20]) {
      it(`${def.id} at ${fps} fps`, () => {
        const cfg = cfgOf(def);
        // The WebKit repro: a Ruby dragged from the hand (1105, 832) up to a Shop minion (990, 353), layout px, then held.
        const from = { x: 1105, y: 832 };
        const st = createLassoState(from, { x: 1105, y: 800 }, cfg, () => 0.5);
        const frames = Math.round(fps * 1.5);
        let pts: { x: number; y: number }[] = [];
        for (let f = 0; f < frames; f++) {
          const t = Math.min(1, f / (fps * 0.5));
          const to = { x: 1105 + (990 - 1105) * t, y: 800 + (353 - 800) * t };
          pts = stepLasso(st, from, to, 900, 1 / fps, f / fps, cfg);
          for (const p of pts) {
            expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
            // Never far outside the box spanned by the two ends (the bow and the whip stay near the chord).
            expect(p.x).toBeGreaterThan(990 - 400); expect(p.x).toBeLessThan(1105 + 400);
            expect(p.y).toBeGreaterThan(353 - 400); expect(p.y).toBeLessThan(832 + 400);
          }
        }
        // Held still for a second: the ribbon settles onto its rest bow, the cursor end on the finger.
        expect(pts[pts.length - 1]).toEqual({ x: 990, y: 353 });
      });
    }
  }

  it('a 240 Hz desktop frame is still one step for every shipped def (unchanged there)', () => {
    for (const def of DEFS) expect(lassoSubsteps(1 / 240, cfgOf(def))).toBe(1);
  });

  it('sub-steps scale with the frame length and stay bounded', () => {
    const ruby = cfgOf(rubyTarget as Def);
    expect(lassoSubsteps(1 / 60, ruby)).toBeGreaterThan(1);
    expect(lassoSubsteps(1 / 30, ruby)).toBeGreaterThan(lassoSubsteps(1 / 60, ruby));
    expect(lassoSubsteps(1, { springStiffness: 1e9, springDamping: 1e9 })).toBe(64);
    expect(lassoSubsteps(0, ruby)).toBe(1);
  });
});
