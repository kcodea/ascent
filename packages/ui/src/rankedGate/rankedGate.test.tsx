// @vitest-environment jsdom
/**
 * THE RANKED GATE (owner 2026-10-12), verbatim: "once the player hits the 'yes continue' button, i want an animation
 * equipped with sound effects and everything. where two gates slide in with a grinding motion and sound and slam
 * shut with smoke and sparks that emit from the impact. and then after a brief 1 second delay, they shudder and open
 * again to reveal the hero select screen".
 *
 * THE CRYSTAL (owner 2026-10-13) replaced the fixed delay, verbatim: "once the gate closes with the slam. i want it
 * to sit in that position as the center gold diamond forms the blue crystal ... then i want the crystal to be
 * steadily pulsing until the player clicks it with their mouse. upon clicking it, i want the crystal to shatter,
 * which then triggers the gate to slide open, revealing the character select screen".
 *
 * Pinned here:
 *   - the two clocks: close, slam, the swap, the crystal forming, armed; then, from the press, shatter, shudder, open;
 *   - the crystal's place on the art's centre diamond, at a 16:9 window and at an ultrawide one;
 *   - the seam: `onShut` runs exactly once whatever happens (no gate mounted, a gate that throws, a second press);
 *   - the real component on fake timers: each phase and cue, the gate WAITING on the crystal for as long as it is
 *     left alone, only an armed left press (or the keyboard) opening it, and nothing left mounted at the end;
 *   - reduced motion: no gate, the swap at once;
 *   - the shipped assets exist, the cues have faders, and the motion is transform + opacity only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mount, type Mounted } from '../renderedText.mount';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });

const fx = vi.hoisted(() => ({
  warm: vi.fn(), slam: vi.fn(), shudder: vi.fn(), gather: vi.fn(), ambient: vi.fn(), stopAmbient: vi.fn(), shatter: vi.fn(),
  clear: vi.fn(), release: vi.fn(),
}));
vi.mock('./gateFx', () => ({ gateFx: fx }));
const snd = vi.hoisted(() => ({ gate: vi.fn(), warmGate: vi.fn() }));
vi.mock('../sfx', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../sfx')>();
  return { ...actual, sfx: { ...actual.sfx, gate: snd.gate, warmGate: snd.warmGate } };
});

import { RankedGate, warmRankedGate } from './RankedGate';
import { registerRankedGate, requestRankedGate, resetRankedGateForTests } from './rankedGateController';
import {
  RANKED_GATE_ART, RANKED_GATE_TIMING, rankedGateCloseTimeline, rankedGateCrystalAt, rankedGateCssVars, rankedGateOpenTimeline,
} from './rankedGateTiming';
import { CATEGORY_BUS, CATEGORY_GAINS, CATEGORY_LABEL } from '../audio/config';
import { familyOf } from '../audio/clipFamily';

let ui: Mounted | null = null;
const phaseOf = (): string | null => {
  const el = document.querySelector('.rgate');
  return el ? [...el.classList].find((c) => c.startsWith('is-'))!.slice(3) : null;
};
const advance = (ms: number): void => { act(() => { vi.advanceTimersByTime(ms); }); };
const cues = (): string[] => snd.gate.mock.calls.map((c) => c[0] as string);
const crystalEl = (): HTMLButtonElement | null => document.querySelector<HTMLButtonElement>('.rgate-crystal');
const pressCrystal = (button = 0): void => { act(() => { crystalEl()!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button })); }); };
const reducedMotion = (on: boolean): void => {
  window.matchMedia = ((q: string) => ({ matches: on && q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
};

beforeEach(() => {
  resetRankedGateForTests();
  for (const f of [...Object.values(fx), snd.gate, snd.warmGate]) f.mockClear();
  reducedMotion(false);
});
afterEach(() => { ui?.unmount(); ui = null; vi.useRealTimers(); vi.restoreAllMocks(); });

describe('the two clocks', () => {
  const close = rankedGateCloseTimeline();
  const open = rankedGateOpenTimeline();

  it('the first runs close, slam, the swap, the crystal forming, armed, in that order', () => {
    expect(close.closeAt).toBe(0);
    expect(close.slamAt).toBe(RANKED_GATE_TIMING.closeMs);
    expect(close.formAt).toBe(close.slamAt + RANKED_GATE_TIMING.crystalDelayMs);
    expect(close.armedAt).toBe(close.formAt + RANKED_GATE_TIMING.crystalFormMs);
    const order = [close.closeAt, close.slamAt, close.handoffAt, close.formAt, close.armedAt];
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(close.formAt, 'the gate sits after the slam before the diamond stirs').toBeGreaterThan(close.slamAt + RANKED_GATE_TIMING.slamShakeMs);
  });

  it('swaps the screen while the doors are shut, and always before the crystal can be pressed', () => {
    expect(close.handoffAt).toBeGreaterThan(close.slamAt);
    expect(close.handoffAt).toBeLessThan(close.armedAt);
    // Even a silly dial cannot make the gate openable onto a screen that has not been swapped.
    const wild = rankedGateCloseTimeline({ ...RANKED_GATE_TIMING, handoffMs: 99_999 });
    expect(wild.handoffAt).toBeLessThan(wild.armedAt);
    expect(wild.handoffAt).toBeGreaterThanOrEqual(wild.slamAt);
  });

  it('the second runs from the press: shatter at once, the shudder, then the doors part', () => {
    expect(open.shatterAt).toBe(0);
    expect(open.openAt).toBe(RANKED_GATE_TIMING.shudderMs);
    expect(open.endAt).toBe(open.openAt + RANKED_GATE_TIMING.openMs);
    expect(open.openSoundAt, 'the opening cue leads the doors').toBe(open.openAt - RANKED_GATE_TIMING.openSoundLeadMs);
    expect(open.openSoundAt).toBeGreaterThanOrEqual(0);
  });

  it('hands the durations and the crystal\'s place to the stylesheet', () => {
    expect(rankedGateCssVars()).toEqual({
      '--rg-close': '1500ms', '--rg-shake': '460ms', '--rg-form': '1100ms', '--rg-shatter': '420ms', '--rg-shudder': '700ms', '--rg-open': '1500ms',
      '--rg-art-hw': '836', '--rg-art-h': '941', '--rg-cry-dy': '-40', '--rg-cry-size': '236',
    });
  });
});

describe('the crystal sits on the art\'s centre diamond', () => {
  it('on a 16:9 gate the art is shown whole, so the crystal is at its art position, scaled', () => {
    // 1672 x 941 doors: one art px = one screen px.
    const c = rankedGateCrystalAt({ left: 0, top: 0, width: 1672, height: 941 });
    expect(c.x).toBe(836);
    expect(c.y).toBeCloseTo(RANKED_GATE_ART.crystalCy, 5);
    expect(c.size).toBe(236);
    expect(c.y, 'the diamond is above the art\'s centre row').toBeLessThan(941 / 2);
    // Twice the size, and offset: everything doubles around the box's centre.
    const d = rankedGateCrystalAt({ left: 100, top: 50, width: 3344, height: 1882 });
    expect(d).toEqual({ x: 100 + 1672, y: 50 + RANKED_GATE_ART.crystalCy * 2, size: 472 });
  });

  it('on an ultrawide gate the art is scaled to the WIDTH (and cropped top and bottom), and the crystal follows', () => {
    const c = rankedGateCrystalAt({ left: 0, top: 0, width: 3440, height: 1440 });
    const u = 3440 / 2 / 836; // wider than tall: the half-width sets the scale
    expect(u).toBeGreaterThan(1440 / 941);
    expect(c.x).toBe(1720);
    expect(c.y).toBeCloseTo(720 + (RANKED_GATE_ART.crystalCy - 941 / 2) * u, 5);
    expect(c.size).toBeCloseTo(236 * u, 5);
  });
});

describe('the seam: onShut runs exactly once, whatever happens', () => {
  it('with no gate mounted it runs at once', async () => {
    const onShut = vi.fn();
    await requestRankedGate(onShut);
    expect(onShut).toHaveBeenCalledTimes(1);
  });

  it('a gate that throws still makes the swap, and the request never rejects', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    registerRankedGate(() => { throw new Error('boom'); });
    const onShut = vi.fn();
    await expect(requestRankedGate(onShut)).resolves.toBeUndefined();
    expect(onShut).toHaveBeenCalledTimes(1);
    registerRankedGate(() => Promise.reject(new Error('later')));
    const again = vi.fn();
    await requestRankedGate(again);
    expect(again).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('a gate that forgets to call it still makes the swap when it ends', async () => {
    registerRankedGate(() => Promise.resolve());
    const onShut = vi.fn();
    await requestRankedGate(onShut);
    expect(onShut).toHaveBeenCalledTimes(1);
  });

  it('a second press joins the gate in flight: one gate, one swap', async () => {
    let release: () => void = () => {};
    const plays = vi.fn((onShut: () => void) => new Promise<void>((resolve) => { release = () => { onShut(); resolve(); }; }));
    registerRankedGate(plays);
    const first = vi.fn(), second = vi.fn();
    const a = requestRankedGate(first);
    const b = requestRankedGate(second);
    expect(b).toBe(a);
    release();
    await a;
    expect(plays).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second, 'the first press owns the swap').not.toHaveBeenCalled();
  });
});

describe('the gate plays', () => {
  const close = rankedGateCloseTimeline();
  const open = rankedGateOpenTimeline();
  const start = (): { onShut: ReturnType<typeof vi.fn>; done: ReturnType<typeof vi.fn> } => {
    vi.useFakeTimers();
    ui = mount(<RankedGate />);
    // The doors have a real box on screen (jsdom lays nothing out): a 1672 x 941 gate, one art px per screen px.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: 1672, bottom: 941, width: 1672, height: 941, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
    Object.defineProperty(window, 'innerHeight', { value: 941, configurable: true });
    const onShut = vi.fn(), done = vi.fn();
    act(() => { void requestRankedGate(onShut).then(done); });
    return { onShut, done };
  };
  const CRYSTAL = { x: 836, y: RANKED_GATE_ART.crystalCy, size: 236 };

  it('renders nothing until it is asked for', () => {
    ui = mount(<RankedGate />);
    expect(document.querySelector('.rgate')).toBeNull();
  });

  it('closes with the grind: two doors, the close cue, no crystal, nothing swapped yet', () => {
    const { onShut } = start();
    expect(phaseOf()).toBe('closing');
    expect(document.querySelectorAll('.rgate-door')).toHaveLength(2);
    expect(document.querySelector('.rgate-door-l .rgate-face')).not.toBeNull();
    expect(document.querySelector('.rgate-door-r .rgate-face')).not.toBeNull();
    expect(document.querySelector<HTMLElement>('.rgate')!.style.getPropertyValue('--rg-close')).toBe('1500ms');
    expect(crystalEl()).toBeNull();
    expect(cues()).toEqual(['close']);
    advance(close.slamAt - 1);
    expect(phaseOf()).toBe('closing');
    expect(fx.slam).not.toHaveBeenCalled();
    expect(onShut, 'the mode picker is still in view').not.toHaveBeenCalled();
  });

  it('slams shut: the slam cue, smoke, sparks and embers off the centre seam, then the swap behind the doors', () => {
    const { onShut } = start();
    advance(close.slamAt);
    expect(phaseOf()).toBe('shut');
    expect(cues()).toEqual(['close', 'slam']);
    expect(fx.slam).toHaveBeenCalledTimes(1);
    expect(fx.slam.mock.calls[0]![0], 'the seam, measured once, in screen px').toEqual({ x: 836, top: 0, bottom: 941 });
    expect(onShut, 'not on the very frame they meet').not.toHaveBeenCalled();
    advance(close.handoffAt - close.slamAt);
    expect(onShut).toHaveBeenCalledTimes(1);
    expect(phaseOf(), 'still shut while the screen changes').toBe('shut');
    expect(crystalEl(), 'the gate sits before the diamond stirs').toBeNull();
  });

  it('the centre diamond forms the crystal: the form cue, the motes gathering on it, not pressable yet', () => {
    start();
    advance(close.formAt);
    expect(phaseOf()).toBe('forming');
    expect(cues()).toEqual(['close', 'slam', 'form']);
    expect(fx.gather).toHaveBeenCalledTimes(1);
    expect(fx.gather.mock.calls[0]![0]).toEqual(CRYSTAL);
    expect(fx.gather.mock.calls[0]![1]).toBe(RANKED_GATE_TIMING.crystalFormMs);
    const el = crystalEl()!;
    expect(el).not.toBeNull();
    expect(el.getAttribute('aria-disabled')).toBe('true');
    expect(el.querySelector('img')!.getAttribute('src')).toContain('frames/ranked-gate-crystal.webp');
    expect(el.querySelector('.rgate-crystal-lit'), 'the brightened copy that carries the pulse').not.toBeNull();
    expect(el.querySelector('.rgate-crystal-glint .rgate-crystal-twinkle'), 'the glint and its star').not.toBeNull();
    // A press while it is still forming does nothing.
    pressCrystal();
    expect(phaseOf()).toBe('forming');
    expect(fx.shatter).not.toHaveBeenCalled();
  });

  it('then it WAITS: armed, pulsing, shedding embers, for as long as it is left alone', () => {
    const { done } = start();
    advance(close.armedAt);
    expect(phaseOf()).toBe('armed');
    expect(fx.ambient).toHaveBeenCalledTimes(1);
    expect(fx.ambient.mock.calls[0]![0]).toEqual(CRYSTAL);
    const el = crystalEl()!;
    expect(el.getAttribute('aria-disabled')).toBe('false');
    expect(el.tabIndex).toBe(0);
    expect(el.getAttribute('aria-label')).toBe('Shatter the crystal to open the gate');
    expect(document.activeElement, 'it takes focus, so the keyboard can open the gate').toBe(el);
    // Ten minutes later nothing has moved on by itself.
    advance(600_000);
    expect(phaseOf()).toBe('armed');
    expect(cues(), 'no rattle, no opening').toEqual(['close', 'slam', 'form']);
    expect(done).not.toHaveBeenCalled();
    // And only the left button is a press.
    pressCrystal(2);
    expect(phaseOf()).toBe('armed');
  });

  it('pressing it shatters it, the doors shudder, then grind open and leave nothing behind', async () => {
    const { onShut, done } = start();
    advance(close.armedAt + 2_345);
    pressCrystal();
    expect(phaseOf()).toBe('shatter');
    expect(cues(), 'the shatter, the cinematic hit and the rattle all land on the press').toEqual(['close', 'slam', 'form', 'shatter', 'intro', 'rattle']);
    expect(fx.stopAmbient).toHaveBeenCalledTimes(1);
    expect(fx.shatter).toHaveBeenCalledTimes(1);
    expect(fx.shatter.mock.calls[0]![0]).toEqual(CRYSTAL);
    expect(fx.shudder).toHaveBeenCalledTimes(1);
    expect(crystalEl(), 'its burst is still playing').not.toBeNull();
    // The release that follows the press (a click) is not a second one, nor is a second press.
    act(() => { crystalEl()!.click(); });
    pressCrystal();
    expect(fx.shatter).toHaveBeenCalledTimes(1);
    advance(open.openSoundAt);
    expect(cues().at(-1)).toBe('open');
    expect(phaseOf(), 'the cue leads the doors').toBe('shatter');
    advance(open.openAt - open.openSoundAt);
    expect(phaseOf()).toBe('opening');
    expect(crystalEl(), 'nothing of the crystal rides the opening doors').toBeNull();
    advance(open.endAt - open.openAt - 1);
    expect(phaseOf()).toBe('opening');
    advance(1);
    expect(document.querySelector('.rgate'), 'the gate unmounts once clear').toBeNull();
    expect(fx.release, 'the FX layer is let go (its WebGL context is freed once the last ember has faded)').toHaveBeenCalledTimes(1);
    expect(fx.clear, 'but what is still drifting is not cut off').not.toHaveBeenCalled();
    await act(async () => { await Promise.resolve(); });
    expect(done).toHaveBeenCalledTimes(1);
    expect(onShut).toHaveBeenCalledTimes(1);
    expect(cues()).toEqual(['close', 'slam', 'form', 'shatter', 'intro', 'rattle', 'open']);
  });

  it('the keyboard opens it too (Enter / Space on the focused crystal arrive as a click)', () => {
    start();
    advance(close.armedAt);
    act(() => { crystalEl()!.click(); });
    expect(phaseOf()).toBe('shatter');
    expect(fx.shatter).toHaveBeenCalledTimes(1);
  });

  it('unmounted mid-sequence it stops the clock, drops the FX and still makes the swap', () => {
    const { onShut } = start();
    advance(close.slamAt - 200);
    ui!.unmount(); ui = null;
    expect(onShut).toHaveBeenCalledTimes(1);
    expect(fx.clear).toHaveBeenCalled();
    expect(fx.release).toHaveBeenCalled();
    advance(close.armedAt + open.endAt);
    expect(cues(), 'no cue fires after the gate is gone').toEqual(['close']);
  });

  it('reduced motion: no gate, no crystal to press, no cues, the swap at once', () => {
    reducedMotion(true);
    vi.useFakeTimers();
    ui = mount(<RankedGate />);
    const onShut = vi.fn();
    act(() => { void requestRankedGate(onShut); });
    expect(onShut).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.rgate')).toBeNull();
    expect(snd.gate).not.toHaveBeenCalled();
    expect(fx.slam).not.toHaveBeenCalled();
  });

  it('warming it readies the cues and the FX layer', () => {
    warmRankedGate();
    expect(snd.warmGate).toHaveBeenCalledTimes(1);
    expect(fx.warm).toHaveBeenCalledTimes(1);
  });
});

describe('what ships', () => {
  const ui$ = (...p: string[]): string => join(__dirname, '..', ...p);
  const pub = (...p: string[]): string => join(__dirname, '..', '..', '..', '..', 'apps', 'web', 'public', ...p);
  const css = readFileSync(join(__dirname, 'rankedGate.css'), 'utf8');
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, '');

  it('the door and crystal images and the recorded cues are committed, and the stylesheet points at the doors', () => {
    for (const door of ['ranked-gate-left.webp', 'ranked-gate-right.webp']) {
      expect(existsSync(pub('frames', door)), door).toBe(true);
      expect(css).toContain(`url('/frames/${door}')`);
    }
    expect(existsSync(pub('frames', 'ranked-gate-crystal.webp'))).toBe(true);
    for (const cue of ['gateintro', 'gateclose', 'gateslam', 'gaterattle', 'gateopen', 'gateshatter']) {
      expect(existsSync(ui$('audio', `${cue}.mp3`)), cue).toBe(true);
    }
    // The crystal FORMING has no recorded cue yet: it borrows a clip already in the game.
    expect(existsSync(ui$('audio', 'gemapply.mp3'))).toBe(true);
  });

  it('each cue has its own fader, on the ui bus, with a name', () => {
    for (const cue of ['gateintro', 'gateclose', 'gateslam', 'gaterattle', 'gateopen', 'gateform', 'gateshatter']) {
      expect(CATEGORY_GAINS[cue], cue).toBeGreaterThan(0);
      expect(CATEGORY_BUS[cue], cue).toBe('ui');
      expect(CATEGORY_LABEL[cue], cue).toMatch(/^Ranked gate: /);
    }
    for (const clip of ['gateintro', 'gateclose', 'gateslam', 'gaterattle', 'gateopen', 'gateshatter']) expect(familyOf(clip), clip).toBe(clip);
  });

  it('the doors meet on the seam: each half is anchored to its seam side and covers its door', () => {
    expect(css).toMatch(/\.rgate-face \{[^}]*url\('\/frames\/ranked-gate-left\.webp'\) 100% 50% \/ cover/);
    expect(css).toMatch(/\.rgate-door-r \.rgate-face \{[^}]*background-position: 0% 50%/);
    expect(css).toMatch(/\.rgate-door \{[^}]*width: 50%/);
  });

  it('the crystal is placed in art pixels by the doors\' own cover scale, and is pressable only when armed', () => {
    expect(noComments).toMatch(/\.rgate-doors \{[^}]*container-type: size/);
    const rule = noComments.slice(noComments.indexOf('.rgate-crystal {'), noComments.indexOf('}', noComments.indexOf('.rgate-crystal {')));
    expect(rule).toContain('--rg-u: max(calc(50cqw / var(--rg-art-hw, 836)), calc(100cqh / var(--rg-art-h, 941)))');
    expect(rule).toContain('top: calc(50% + var(--rg-cry-dy, -40) * var(--rg-u))');
    expect(rule).toContain('width: calc(var(--rg-cry-size, 236) * var(--rg-u))');
    expect(rule).toContain('pointer-events: none');
    expect(noComments).toMatch(/\.rgate\.is-armed \.rgate-crystal \{ pointer-events: auto; \}/);
  });

  it('while it waits the crystal does not move: the pulse is its light, and a glint crosses it now and then', () => {
    // Owner 2026-10-13: "i dont want the crystal to physically move while its pulsing. leave that to the lighting".
    const armedBody = /\.rgate\.is-armed \.rgate-crystal-body \{([^}]*)\}/.exec(noComments)![1]!;
    expect(armedBody).not.toMatch(/animation|transform/);
    expect(armedBody).toContain('opacity: 1');
    // The light: the glow behind it and a brightened copy of it, both forever, both on the same beat.
    expect(noComments).toMatch(/\.rgate\.is-armed \.rgate-crystal-glow \{[^}]*rg-cry-glow-pulse 1\.7s ease-in-out infinite/);
    expect(noComments).toMatch(/\.rgate\.is-armed \.rgate-crystal-lit \{[^}]*rg-cry-lit-pulse 1\.7s ease-in-out infinite/);
    const lit = /@keyframes rg-cry-lit-pulse \{([\s\S]*?)\n\}/.exec(css)![1]!;
    expect(lit, 'the lit copy only fades: it never scales').not.toMatch(/transform/);
    expect(noComments, 'its brightness is a static filter, not an animated one').toMatch(/\.rgate-crystal-lit \{[^}]*filter: brightness\(/);
    // The glint: masked to the crystal's own shape, on a slow cycle that is mostly rest.
    expect(noComments).toMatch(/\.rgate-crystal-glint \{[^}]*mask: url\('\/frames\/ranked-gate-crystal\.webp'\)/);
    expect(noComments).toMatch(/\.rgate\.is-armed \.rgate-crystal-glint::before \{[^}]*rg-cry-glint 3\.8s linear infinite/);
    expect(noComments).toMatch(/\.rgate\.is-armed \.rgate-crystal-twinkle \{[^}]*rg-cry-twinkle 3\.8s linear infinite/);
    expect(css).toMatch(/@keyframes rg-cry-glint \{\s*0%, 62% \{/);
  });

  it('the motion is compositor-only, in stage units, with no bare cursor', () => {
    const blocks = [...css.matchAll(/@keyframes ([\w-]+) \{/g)].map((m) => {
      let depth = 0;
      for (let i = css.indexOf('{', m.index); i < css.length; i++) {
        if (css[i] === '{') depth++;
        else if (css[i] === '}' && --depth === 0) return [m[1]!, css.slice(m.index, i + 1)] as const;
      }
      throw new Error(`unterminated @keyframes ${m[1]}`);
    });
    expect(blocks.map((b) => b[0]).sort()).toEqual([
      'rg-close-l', 'rg-close-r', 'rg-cry-break', 'rg-cry-burst', 'rg-cry-form', 'rg-cry-glint', 'rg-cry-glow-in', 'rg-cry-glow-out',
      'rg-cry-glow-pulse', 'rg-cry-lit-pulse', 'rg-cry-shatter', 'rg-cry-twinkle', 'rg-flash', 'rg-grind', 'rg-impact', 'rg-open-l', 'rg-open-r',
      'rg-shudder',
    ]);
    for (const [name, body] of blocks) {
      const props = [...body.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]).filter((p) => p !== 'animation-timing-function');
      expect(props.length, name).toBeGreaterThan(0);
      expect(props.filter((p) => p !== 'transform' && p !== 'opacity'), name).toEqual([]);
    }
    expect(noComments).not.toMatch(/\d(vw|vh)\b/);
    expect(noComments).not.toMatch(/cursor\s*:/);
    expect(noComments).not.toMatch(/@media/);
    // The doors close fully and open fully.
    expect(css).toMatch(/rg-close-l \{[\s\S]*?100% \{ transform: translateX\(0\); \}/);
    expect(css).toMatch(/rg-open-r \{[\s\S]*?100% \{ transform: translateX\(102%\); \}/);
  });
});
