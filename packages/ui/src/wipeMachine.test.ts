import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  WIPE_ENTRY, WIPE_EXIT, WIPE_STATES, afterBeat, afterSweep, barClassFor, combatBackdropShown, curtainClassFor,
  frontClassFor, vistaClassFor, wipeCovered, wipeSweeping, wipeUp, type WipeState,
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
    // ...and the CSS agrees: covering is the gate at rest on the floor, and the holds snap (transition off).
    expect(css).toMatch(/\.wipecurtain\.full \{ transform: translateY\(0\); \}/);
    expect(css).toMatch(/\.wipecurtain\.settle \{ transition: none; \}/);
  });

  // Owner 2026-10-21: "something that falls from the ceiling of the screen and lands at the bottom of the screen with a
  // bang, like a big stone gate ... then it quickly cranks back up". It moves by transform ONLY (a clip-path bloom could
  // drop a frame and let the game pop through).
  it('the gate only moves by transform: no clip-path, the stone art on a transform-only transition', () => {
    const rule = /\.wipecurtain \{ position: fixed; inset: 0; z-index: \d+; pointer-events: none;([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toContain("url('/transition-gate.webp')");
    expect(rule).toMatch(/transition: transform /);
    expect(rule).not.toMatch(/clip-path/);
    expect(css).not.toMatch(/\.wipecurtain[^{]*\{[^}]*clip-path/);
    // (…and the poster swinging on its nail, owner 2026-10-22: "the poster sort of wiggles separately".)
    expect(css).toMatch(/\.wipecurtain\.gone\.parked \.wipeposter \{ animation: none; \}/);
    for (const k of ['wipeslam', 'wipecrank', 'posterslam', 'postercrank']) {
      const frames = new RegExp(`@keyframes ${k} \\{([\\s\\S]*?)\\} \\}`).exec(css)?.[1] ?? '';
      expect(frames, k).toMatch(/transform/);
      expect(frames.replace(/transform: [^;]*;|animation-timing-function: [^;]*;/g, ''), k).not.toMatch(/:\s*[^;{}]+;/);
    }
  });

  it('the gate drops from above and is cranked back up, the same both ways, never jumping on screen', () => {
    // Where each state's class puts the gate, as a share of its height (mirrors the transform rules, asserted below).
    const y = (w: WipeState): number => (curtainClassFor(w).includes(' full') ? 0 : -100);
    expect(css).toMatch(/\.wipecurtain \{[^}]*transform: translateY\(-100%\);/);
    expect(css).toMatch(/\.wipecurtain\.gone \{ transform: translateY\(-100%\); animation: wipecrank /);
    expect(WIPE_ENTRY.map(y)).toEqual([-100, -100, 0, 0, -100, -100]);
    expect(WIPE_EXIT.map(y)).toEqual([-100, -100, 0, 0, -100, -100]);
    // Every hop that does NOT animate (into a tell, a hold or a parked state) is between equal positions.
    for (const pass of [WIPE_ENTRY, WIPE_EXIT]) {
      for (let i = 1; i < pass.length; i++) {
        if (!wipeSweeping(pass[i]!)) expect(y(pass[i]!), `${pass[i - 1]} -> ${pass[i]}`).toBe(y(pass[i - 1]!));
      }
    }
    // The crank plays on the reveals only: parked in combat (e.g. a run resumed mid-fight) it never replays.
    expect(curtainClassFor('combat')).toContain(' parked');
    expect(curtainClassFor('revealIn')).not.toContain(' parked');
    expect(css).toMatch(/\.wipecurtain\.gone\.parked \{ animation: none; \}/);
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

// Owner 2026-10-23: "i want to separate the returnn to shop experience from the door and gate". The exit pass is the
// shop's vista: it fades in, pushes in, and dives through the door, by opacity + transform only.
describe('the return trip is the vista, not the gate', () => {
  it('shows the vista across the exit pass only, fully covering at the hold where the shop swaps in', () => {
    for (const w of WIPE_STATES) {
      const on = w === 'coverOut' || w === 'coveredOut' || w === 'revealOut';
      expect(vistaClassFor(w).includes(' on'), w).toBe(on);
    }
    expect(vistaClassFor('coveredOut')).toContain(' held');
    // The Shop swaps in (the backdrop flips) only while the vista is held fully opaque.
    expect(combatBackdropShown('coverOut')).toBe(true);
    expect(combatBackdropShown('coveredOut')).toBe(false);
    // No fade (owner 2026-10-23): the vista is shown at once and its layers fly in from off the screen.
    expect(css).toContain('.wipevista.in { opacity: 1; }');
    expect(css).toMatch(/\.wipevista\.held \{ transition: none; \}/);
  });

  // Owner 2026-10-23: "its really these hard lines im trying to get rid of" (the sideways fly-in showed each layer's cut
  // edges). The arrival is a flash into the sky, a pull back, and the land rising from below.
  it('arrives out of the sky: a flash hides the cut, the camera pulls back, the land rises with no cut edge showing', () => {
    expect(css).toContain('@keyframes vistapullback { 0% { transform: scale(1.6); } 100% { transform: scale(1); } }');
    expect(css).toMatch(/\.wipevista\.in \.wipevista-flash \{ animation: vistaflash /);
    // The sky never moves (it fills the screen from the first frame), so nothing behind the rising land can show.
    expect(css).not.toMatch(/\.wipevista\.on \.wipevista-dive-sky \{/);
    // The rise distances that keep every flat bottom edge behind the flowers' grass or below the screen (see styles.css).
    const rise = (n: string): number => Number(new RegExp(`@keyframes vistarise${n} \\{ 0% \\{ translate: 0 (\\d+)%; \\}`).exec(css)?.[1]);
    expect([rise('far'), rise('mid'), rise('shop'), rise('fore')]).toEqual([58, 64, 80, 40]);
    // The art bounds (fractions of 1440) and the flowers' solid grass top: each layer's bottom edge stays covered or off-screen.
    const fore = { solidTop: 0.82, bottom: 1, d: 0.4 };
    for (const [n, bottom] of [['far', 0.924], ['mid', 0.984], ['shop', 0.964]] as const) {
      const d = rise(n) / 100;
      for (let x = 0; x <= 1; x += 0.05) {
        const edge = bottom + d * x, solid = fore.solidTop + fore.d * x, foreEnd = fore.bottom + fore.d * x;
        expect(edge >= solid && (edge <= foreEnd || edge >= 1), `${n} at ${x.toFixed(2)}`).toBe(true);
      }
    }
    // The shop and the door's interior + glow rise together (same rise, same delay), and the hole opens only after landing.
    const flight = /\.wipevista\.on \.wipevista-shop \{ animation: (vistariseshop [^;]*?) both; \}/.exec(css)?.[1];
    expect(flight).toBeTruthy();
    expect(css).toContain(`.wipevista.on .wipevista-doorwrap { animation: vistapushshop 2s cubic-bezier(.25, .6, .35, 1) both, ${flight} both; }`);
    expect(css).toContain(".wipevista.held .wipevista-masked, .wipevista.dive .wipevista-masked { -webkit-mask: url('/vista-doormask.png')");
  });

  it('keeps the gate parked and silent on the exit pass', () => {
    expect(css).toMatch(/\.wipecurtain\.exit \{ visibility: hidden; transform: translateY\(-100%\) !important; transition: none !important; animation: none !important; \}/);
    for (const w of WIPE_EXIT.slice(1, -1)) expect(curtainClassFor(w), w).toContain(' exit');
  });

  it('moves by opacity and transform only', () => {
    // (…and the portal: the doorway's interior fading open, owner 2026-10-23.)
    for (const k of ['vistaflash', 'vistacut', 'vistapullback', 'vistarisefar', 'vistarisemid', 'vistariseshop', 'vistarisefore', 'vistadoorglow', 'vistadusk', 'vistadivesky', 'vistadivefar', 'vistadivemid', 'vistadivefore', 'vistadooropen', 'vistadoordark', 'vistafade', 'vistadive', 'vistapushsky', 'vistapushfar', 'vistapushmid', 'vistapushshop', 'vistapushfore']) {
      const frames = new RegExp(`@keyframes ${k} \\{([\\s\\S]*?)\\} \\}`).exec(css)?.[1] ?? '';
      // (`translate` is the individual transform property: compositor-only like `transform`.)
      expect(frames, k).toMatch(/transform|translate|opacity/);
      expect(frames.replace(/(transform|translate|opacity|animation-timing-function): [^;]*;/g, ''), k).not.toMatch(/:\s*[^;{}]+;/);
    }
  });
});

describe('nothing in the game paints over the curtain while it is up', () => {
  const curtainZ = Number(/\.wipecurtain \{ position: fixed; inset: 0; z-index: (\d+);/.exec(css)?.[1]);

  // z3000 since 2026-10-19 (above every in-game layer; curtainLadder.test.ts holds the whole ladder).
  it('the curtain sits at z3000', () => { expect(curtainZ).toBe(3000); });

  it('the z2000 float (lobby damage) drops UNDER the curtain while it is up', () => {
    // (The loss tally and its flying tiers were retired 2026-09-28 for the shared damage formation, whose layer sits at
    // z240, already under the curtain.)
    const rule = /body\.wipe-up \.lobbydmg-float \{ z-index: (\d+); \}/.exec(css);
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
    // (`--wipe-rx` / `--wipe-ry` are still written, but only the retired clip-path bloom read them: the curtain slides
    // since 2026-10-21.)
    for (const k of ['--wipe-dur', '--wipe-reveal-dur', '--wipe-ease', '--wipe-cx', '--wipe-cy',
      '--wipe-front-sx', '--wipe-front-sy', '--wf-in0', '--wf-in1', '--wf-line', '--wf-out1', '--wf-glow', '--wf-halo']) {
      expect(v[k], k).toBeTruthy();
      expect(css.includes(`var(${k}`), `${k} is read by styles.css`).toBe(true);
    }
    expect(v['--wipe-ease']).toBe('cubic-bezier(0.45, 0, 0.7, 0.85)');
  });
});
