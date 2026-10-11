// @vitest-environment jsdom
/**
 * Perf 2026-10-11: a long fight (Rad Rachel) sat at 30-40 fps. The combat auto-ramp wrote `--combat-speed` and
 * every float var onto <html> EVERY FRAME for up to ~20 s of a fight, and any write to a root custom property
 * restyles the whole document (~1,000 elements, ~19 ms a frame). The ramp now records the live speed in memory
 * and the elements that animate at that speed stamp it on themselves when they start (floatConfig.ts
 * "The LIVE speed"). Pinned here:
 *  - `setLiveCombatSpeed` writes NO DOM;
 *  - `speedVars` yields exactly the values the root would have held at that speed;
 *  - `applyFloatConfig` / `applyFloatSpeed` skip unchanged root values (a same-value write still invalidates);
 *  - the source contract: the ramp tick in useCombatReplay.ts never touches :root, and the stampers stamp.
 * Same file pins the hand-glide seed's read-then-write order (Recruit.tsx), the other 2026-10-11 restyle fix.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { applyFloatSpeed, floatDurations, getFloatConfig, liveCombatSpeed, setLiveCombatSpeed, speedVars } from './floatConfig';

const src = (f: string): string => readFileSync(join(__dirname, f), 'utf8');

describe('the live combat speed never writes :root', () => {
  it('setLiveCombatSpeed touches no DOM', () => {
    const spy = vi.spyOn(document.documentElement.style, 'setProperty');
    setLiveCombatSpeed(2.37);
    expect(liveCombatSpeed()).toBe(2.37);
    expect(spy).not.toHaveBeenCalled();
    setLiveCombatSpeed(0);
    expect(liveCombatSpeed()).toBe(1); // a non-positive speed falls back to 1x, like the root writer
    spy.mockRestore();
  });

  it('speedVars equals what the root carried at that speed', () => {
    for (const sp of [0.5, 1, 1.6, 2.37, 3, 5]) {
      const { floatDur, deathFloatDur } = floatDurations(sp);
      expect(speedVars(sp)).toEqual({
        '--combat-speed': String(sp),
        '--float-dur': `${floatDur}ms`,
        '--death-float-dur': `${deathFloatDur}ms`,
        '--dmg-pop-dur': `${Math.round(getFloatConfig().popMs / sp)}ms`,
      });
    }
  });

  it('applyFloatSpeed re-pushes only the values that changed', () => {
    applyFloatSpeed(1);
    const spy = vi.spyOn(document.documentElement.style, 'setProperty');
    applyFloatSpeed(1); // nothing changed
    expect(spy).not.toHaveBeenCalled();
    applyFloatSpeed(2); // only the speed-scaled durations move
    const names = spy.mock.calls.map((c) => c[0]).sort();
    expect(names).toEqual(['--death-float-dur', '--dmg-pop-dur', '--float-dur']);
    expect(liveCombatSpeed()).toBe(2); // the base also resets the live speed
    spy.mockRestore();
    applyFloatSpeed(1);
  });
});

describe('source contracts', () => {
  it('the auto-ramp tick records the live speed and never writes the root', () => {
    const s = src('useCombatReplay.ts');
    const tick = s.slice(s.indexOf('const tick = (now: number): void => {'), s.indexOf('raf = requestAnimationFrame(tick);\n    };'));
    expect(tick).toContain('setLiveCombatSpeed(spd)');
    expect(tick).not.toMatch(/setProperty|applyFloatSpeed|applyFloatConfig/);
  });

  it('every --combat-speed consumer stamps the speed it starts at', () => {
    expect(src('useCombatReplay.ts')).toMatch(/onFloats: \(spawnedRaw\) => \{[\s\S]{0,300}speedVars\(combatSpeedRef\.current\)/);
    expect(src('useCombatReplay.ts')).toMatch(/onDeathFloats: \(deathsRaw\) => \{[\s\S]{0,200}speedVars\(combatSpeedRef\.current\)/);
    expect(src('Recruit.tsx')).toContain('style={{ ...f.sv, left: toStage(f.x), top: toStage(f.y), width: toStage(f.w), height: toStage(f.h) }');
    expect(src('Recruit.tsx')).toContain('className="deathfloat" style={{ ...f.sv,');
    expect(src('Unit.tsx')).toContain("'--combat-speed': String(liveCombatSpeed())");
    expect(src('fx/rebirthPillar.ts').match(/'--combat-speed', String\(liveCombatSpeed\(\)\)/g)?.length).toBe(2);
  });

  it('the hand-glide seed reads every position before it writes any style', () => {
    const s = src('Recruit.tsx');
    const body = s.slice(s.indexOf("perfMonitor.measure('layout:handglide:seed'"), s.indexOf('void document.body.offsetWidth;                    // commit the seed'));
    const read = body.indexOf('el.offsetLeft');
    const firstWrite = body.indexOf('el.style.setProperty');
    expect(read).toBeGreaterThan(0);
    expect(firstWrite).toBeGreaterThan(read);
    // the read loop holds no write: the first write comes after the loop that collects `moved`
    expect(body.slice(read, firstWrite)).toContain('if (moved.length === 0) return;');
  });

  it('--hand-glide is registered non-inherited (a write restyles one card, not its subtree)', () => {
    expect(src('styles.css')).toContain("@property --hand-glide { syntax: '<length>'; inherits: false; initial-value: 0px; }");
  });
});
