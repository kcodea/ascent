import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  WIPE_ENTRY, WIPE_EXIT, WIPE_STATES, afterBeat, afterSweep, barClassFor, combatBackdropShown, curtainClassFor,
  frontClassFor, wipeCovered, wipeSweeping, wipeUp, type WipeState,
} from './wipeMachine';
import { WIPE_DEFAULTS, sanitizeWipeConfig, wipeCssVars } from './screenWipeConfig';
import { wipeOriginFor } from './wipeGeometry';

// Owner 2026-09-24: "sometimes background elements come through the wipe or it flickers, not sure what's causing it".
const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, 'styles.css'), 'utf8');

/** Walk a pass through the machine's own transitions. */
function walk(from: WipeState, n: number): WipeState[] {
  const out = [from];
  let w = from;
  for (let i = 0; i < n; i++) {
    w = wipeSweeping(w) ? afterSweep(w) : afterBeat(w);
    out.push(w);
  }
  return out;
}

describe('the wipe machine', () => {
  it('runs the entry and exit passes in order', () => {
    expect(walk('chargeIn', 4)).toEqual(WIPE_ENTRY.slice(1));
    expect(walk('primeOut', 4)).toEqual(WIPE_EXIT.slice(1));
  });

  it('the scene only swaps under FULL cover: the combat backdrop flips only between a hold and its neighbours', () => {
    for (const pass of [WIPE_ENTRY, WIPE_EXIT]) {
      for (let i = 1; i < pass.length; i++) {
        const a = pass[i - 1]!, b = pass[i]!;
        if (combatBackdropShown(a) !== combatBackdropShown(b)) {
          // The flip lands ON a hold (entry: into coveredIn; exit: into coveredOut), never mid-sweep.
          expect(wipeCovered(b), `${a} -> ${b} swaps the backdrop outside a hold`).toBe(true);
          expect(curtainClassFor(b)).toContain(' full settle');
        }
      }
    }
  });

  it('the curtain is continuous across every hop: each state is covered by its class, no bare frame between', () => {
    // A cover sweep ends on `full` and the hold wears `full settle` (full cover, transition off); the reveal starts
    // FROM that full cover. There is no state in either pass whose class drops coverage before the reveal.
    for (const pass of [WIPE_ENTRY, WIPE_EXIT]) {
      const iHold = pass.findIndex(wipeCovered);
      expect(curtainClassFor(pass[iHold - 1]!)).toMatch(/ full(?! settle)/);
      expect(curtainClassFor(pass[iHold]!)).toContain(' full settle');
      expect(curtainClassFor(pass[iHold + 1]!)).toMatch(/ gone/);
    }
    // ...and the CSS agrees: the hold's clip is the full inset with the transition off.
    expect(css).toMatch(/\.wipecurtain\.full\.settle \{ clip-path: inset\(0 0 0 0\); \}/);
    expect(css).toMatch(/\.wipecurtain\.settle \{ transition: none; \}/);
  });

  it('the tells snap (settle), so the bloom never slides its centre in from the last origin', () => {
    expect(curtainClassFor('chargeIn')).toContain(' settle');
    expect(curtainClassFor('primeOut')).toContain(' settle');
    expect(curtainClassFor('primeOut')).not.toContain(' full');
  });

  it('the fronts only show on their own sweeps', () => {
    for (const w of WIPE_STATES) {
      expect(frontClassFor(w).includes('sweeping')).toBe(w === 'coverIn' || w === 'coverOut');
      expect(barClassFor(w).includes('sweeping')).toBe(w === 'revealIn' || w === 'revealOut');
    }
  });

  it('body.wipe-up spans the whole wipe, tell to reveal', () => {
    for (const w of WIPE_STATES) expect(wipeUp(w)).toBe(w !== 'idle' && w !== 'combat');
  });
});

describe('nothing in the game paints over the curtain while it is up', () => {
  const curtainZ = Number(/\.wipecurtain \{ position: fixed; inset: 0; z-index: (\d+);/.exec(css)?.[1]);

  it('the curtain sits at z250', () => { expect(curtainZ).toBe(250); });

  it('the z2000 floats (loss tally, flying tiers, lobby damage) drop UNDER the curtain while it is up', () => {
    const rule = /body\.wipe-up \.lossdmg, body\.wipe-up \.lossfly, body\.wipe-up \.lobbydmg-float \{ z-index: (\d+); \}/.exec(css);
    expect(rule).not.toBeNull();
    expect(Number(rule![1])).toBeLessThan(curtainZ);
  });

  it('the hover layers above the curtain (card refs, cast previews, game tooltips) hide while it is up', () => {
    expect(css).toMatch(/body\.wipe-up \.cardref, body\.wipe-up \.castprev-layer \{ visibility: hidden !important; \}/);
    expect(css).toMatch(/body\.wipe-up \.gtip\[data-tip\]::after \{ visibility: hidden !important; \}/);
  });
});

describe('screen wipe config', () => {
  it('sanitizes junk back into range', () => {
    const c = sanitizeWipeConfig({ coverMs: -5, ellipse: Number.NaN, ringLine: 9 } as never);
    expect(c.coverMs).toBe(150);
    expect(c.ellipse).toBe(WIPE_DEFAULTS.ellipse);
    expect(c.ringLine).toBe(0.97);
  });

  it('writes every var the curtain, ring and bar read', () => {
    const v = wipeCssVars(WIPE_DEFAULTS, wipeOriginFor(3440, 1440, null, { ellipse: 1, ringLine: WIPE_DEFAULTS.ringLine }));
    for (const k of ['--wipe-dur', '--wipe-reveal-dur', '--wipe-ease', '--wipe-cx', '--wipe-cy', '--wipe-rx', '--wipe-ry',
      '--wipe-front-sx', '--wipe-front-sy', '--wf-in0', '--wf-in1', '--wf-line', '--wf-out1', '--wf-glow', '--wf-halo']) {
      expect(v[k], k).toBeTruthy();
      expect(css.includes(`var(${k}`), `${k} is read by styles.css`).toBe(true);
    }
    expect(v['--wipe-ease']).toBe('cubic-bezier(0.45, 0, 0.7, 0.85)');
  });
});
