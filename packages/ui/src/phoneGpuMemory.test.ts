/**
 * R-TOUCH-GPU-MEMORY-01 (owner 2026-10-18: the iPhone still crashed within 5 s of the mode home after the audio fix;
 * the crash log read "title view modes ... images 15 (35.5 MB), WebGL 4 of 7"). On a phone the Pixi canvases are
 * lazy, capped and low power, the menus drop their looping layers and shrink the stage with zoom, and the crash log
 * records the GPU-relevant numbers and the diagnostics switches. Desktop is untouched: every helper is the identity.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { activeDiagLabel, parseDiagFlags, parseDiagQuery, phonePixiOptions, phonePixiResolution, pixiAllowed, PHONE_DIAG_FLAGS } from './phoneDiag';
import { describeCrumb } from './crashLog';
import { stageModeFor } from './stage';

const src = (f: string): string => fs.readFileSync(path.join(__dirname, f), 'utf8');

describe('phone Pixi options', () => {
  const desktop = { resizeTo: undefined, backgroundAlpha: 0, antialias: true, autoDensity: true, resolution: 2, preference: 'webgl' as const, powerPreference: 'high-performance' as const };

  it('desktop gets the very same options object back', () => {
    expect(phonePixiOptions(desktop, 1, false, 3, {})).toBe(desktop);
    expect(phonePixiOptions(desktop, 0.4, false, 3, { res1: 1, nofx: 1 })).toBe(desktop);
  });

  it('a phone renders at 1.5 (1 with res1), low power, no antialias, no preserved buffer', () => {
    const o = phonePixiOptions({ ...desktop, backgroundAlpha: 1 }, 1, true, 3, {});
    expect(o.resolution).toBe(1.5);
    expect(o.powerPreference).toBe('low-power');
    expect(o.antialias).toBe(false);
    expect(o.preserveDrawingBuffer).toBe(false);
    expect(phonePixiOptions({ ...desktop, backgroundAlpha: 1 }, 1, true, 3, { res1: 1 }).resolution).toBe(1);
    // A renderer sized in stage px scales by the stage, as before.
    expect(phonePixiOptions({ ...desktop, backgroundAlpha: 1, resolution: 0.8 }, 0.4, true, 3, {}).resolution).toBeCloseTo(0.6, 5);
    expect(phonePixiResolution(1, {})).toBe(1); // never above the device's own ratio
  });

  it('nofx forbids every Pixi app on a phone only', () => {
    expect(pixiAllowed({ nofx: 1 }, true)).toBe(false);
    expect(pixiAllowed({ nofx: 1 }, false)).toBe(true);
    expect(pixiAllowed({}, true)).toBe(true);
  });

  it('every Pixi Application in the UI goes through the phone policy', () => {
    for (const f of ['pixiFx.ts', 'wipeFx.ts', 'rankedGate/gateFx.ts', 'hero-select/HeroCeremonyPixi.ts', 'progression/crateFx/crateFxPixi.ts', 'heroBlast/HeroAttackPreview.tsx']) {
      const s = src(f);
      const inits = s.match(/\b(?:app|a)\.init\(/g)?.length ?? 0;
      const wrapped = s.match(/\b(?:app|a)\.init\(phonePixiOptions\(/g)?.length ?? 0;
      expect(wrapped, f).toBe(inits);
    }
  });
});

describe('phone diagnostics switches', () => {
  it('parse from storage and from ?phonediag=', () => {
    expect(parseDiagFlags('{"nofx":1,"bogus":1,"zoom":0}')).toEqual({ nofx: 1 });
    expect(parseDiagFlags('not json')).toEqual({});
    expect(parseDiagQuery('res1, litebd,nope')).toEqual({ res1: 1, litebd: 1 });
    expect(parseDiagQuery('0')).toEqual({});
    expect(activeDiagLabel({ litebd: 1, nofx: 1 })).toBe('nofx+litebd');
    expect(PHONE_DIAG_FLAGS.map((f) => f.id)).toEqual(['nofx', 'res1', 'noanim', 'zoom', 'nozoom', 'gamexf', 'litebd', 'pz125', 'pz135', 'pz145', 'nophonezoom', 'phonelayout']);
  });

  it('Settings offers them on a phone only', () => {
    const s = src('EscMenu.tsx');
    expect(s).toMatch(/touchDevice && PHONE_GPU && <PhoneDiagnostics \/>/);
  });
});

describe('the phone stage', () => {
  it('never transforms a phone menu by default: the page scale (R-PHONE-PAGESCALE-01); zoom / nozoom pick the old paths', () => {
    expect(stageModeFor(false, true, { zoom: 1 })).toBe('transform'); // desktop: always the transform
    expect(stageModeFor(true, true, {})).toBe('page');
    expect(stageModeFor(true, false, {})).toBe('page');
    expect(stageModeFor(true, false, { zoom: 1 })).toBe('zoom');
    expect(stageModeFor(true, true, { nozoom: 1 })).toBe('transform');
  });
});

describe('no FX context on the phone menus', () => {
  it('PixiFxLayer brings the board layers up only for hero select and the run on a phone', () => {
    const g = src('Game.tsx');
    expect(g).toMatch(/<PixiFxLayer gameplay=\{!preRun \|\| heroPicking\} inRun=\{!preRun\} \/>/);
    expect(g).toMatch(/if \(!PHONE_GPU\) warmDiscoverFx\(\)/);
    expect(g).toMatch(/if \(PHONE_GPU\) return;\s*\n\s*const ric/);
    const l = src('PixiFxLayer.tsx');
    expect(l).toMatch(/const phoneActive = PHONE_GPU \? gameplay : true;/);
    // Leaving gameplay frees every FX context: the board layers (main, under, above), Discover and the wipe.
    for (const call of ['pixiFx.detach()', 'discoverFx.detach()', 'resetDiscoverWarm()', 'wipeFx.release()']) expect(l).toContain(call);
    // The ranked confirmation does not start the gate's layer on a phone; the gate starts it as it plays.
    expect(src('rankedGate/RankedGate.tsx')).toMatch(/opts\.fx !== false && !PHONE_GPU\) gateFx\.warm\(\)/);
  });

  it('the menu loop rules are phone-keyed', () => {
    const css = src('touchUi.css');
    expect(css).toMatch(/html\[data-touch-ui\]\[data-phone-gpu\] :is\(\.titlescreen, \.lbpage\) :is\(\.titlelogo/);
    expect(css).toMatch(/animation-iteration-count: 1 !important; will-change: auto !important;/);
    expect(css).toMatch(/animation-fill-mode: backwards !important/);
  });
});

describe('crash log GPU fields', () => {
  it('describes alive contexts, their buffers, the DOM counts, the zoom and the switches', () => {
    const line = describeCrumb({ s: 'title view modes', t: 3400, g: 7, gl: 4, ga: 2, gmb: 6.4, an: 3, wc: 1, fl: 5, c2: 0, z: 1, pd: 'nofx+res1' });
    expect(line).toBe('3.4 s, WebGL 2 alive (4 in page) of 7 made, 6.4 MB, anims 3, will-change 1, filters 5, 2D canvases 0, stage zoom, switches nofx+res1');
    // An old breadcrumb (no `ga`) reads as it did.
    expect(describeCrumb({ s: 'x', t: 1000, g: 7, gl: 4 })).toBe('1.0 s, WebGL 4 of 7');
  });
});
