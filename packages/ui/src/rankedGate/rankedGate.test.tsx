// @vitest-environment jsdom
/**
 * THE RANKED GATE (owner 2026-10-12), verbatim: "once the player hits the 'yes continue' button, i want an animation
 * equipped with sound effects and everything. where two gates slide in with a grinding motion and sound and slam
 * shut with smoke and sparks that emit from the impact. and then after a brief 1 second delay, they shudder and open
 * again to reveal the hero select screen".
 *
 * Pinned here:
 *   - the clock: close, slam, the 1 second hold, shudder, open, in that order, with the swap hidden behind shut doors;
 *   - the seam: `onShut` runs exactly once whatever happens (no gate mounted, a gate that throws, a second press);
 *   - the real component on fake timers: each phase, each of the owner's four cues, the smoke and sparks at the slam,
 *     the swap after the slam and before the doors part, and nothing left mounted at the end;
 *   - reduced motion: no gate, the swap at once;
 *   - the shipped assets exist, the four cues have faders, and the motion is transform + opacity only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mount, type Mounted } from '../renderedText.mount';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });

const fx = vi.hoisted(() => ({ warm: vi.fn(), slam: vi.fn(), shudder: vi.fn(), clear: vi.fn(), release: vi.fn() }));
vi.mock('./gateFx', () => ({ gateFx: fx }));
const snd = vi.hoisted(() => ({ gate: vi.fn(), warmGate: vi.fn() }));
vi.mock('../sfx', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../sfx')>();
  return { ...actual, sfx: { ...actual.sfx, gate: snd.gate, warmGate: snd.warmGate } };
});

import { RankedGate, warmRankedGate } from './RankedGate';
import { registerRankedGate, requestRankedGate, resetRankedGateForTests } from './rankedGateController';
import { RANKED_GATE_TIMING, rankedGateCssVars, rankedGateTimeline } from './rankedGateTiming';
import { CATEGORY_BUS, CATEGORY_GAINS, CATEGORY_LABEL } from '../audio/config';
import { familyOf } from '../audio/clipFamily';

let ui: Mounted | null = null;
const phaseOf = (): string | null => {
  const el = document.querySelector('.rgate');
  return el ? [...el.classList].find((c) => c.startsWith('is-'))!.slice(3) : null;
};
const advance = (ms: number): void => { act(() => { vi.advanceTimersByTime(ms); }); };
const reducedMotion = (on: boolean): void => {
  window.matchMedia = ((q: string) => ({ matches: on && q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
};

beforeEach(() => {
  resetRankedGateForTests();
  for (const f of [fx.warm, fx.slam, fx.shudder, fx.clear, fx.release, snd.gate, snd.warmGate]) f.mockClear();
  reducedMotion(false);
});
afterEach(() => { ui?.unmount(); ui = null; vi.useRealTimers(); });

describe('the clock', () => {
  const at = rankedGateTimeline();

  it('runs close, slam, a 1 second hold, shudder, open, in that order', () => {
    expect(at.closeAt).toBe(0);
    expect(at.slamAt).toBe(RANKED_GATE_TIMING.closeMs);
    expect(at.shudderAt - at.slamAt, 'the owner\'s "brief 1 second delay"').toBe(1000);
    expect(at.openAt).toBe(at.shudderAt + RANKED_GATE_TIMING.shudderMs);
    expect(at.endAt).toBe(at.openAt + RANKED_GATE_TIMING.openMs);
    expect([at.closeAt, at.slamAt, at.shudderAt, at.openAt, at.endAt]).toEqual([...[at.closeAt, at.slamAt, at.shudderAt, at.openAt, at.endAt]].sort((a, b) => a - b));
  });

  it('swaps the screen only while the doors are shut', () => {
    expect(at.handoffAt).toBeGreaterThan(at.slamAt);
    expect(at.handoffAt).toBeLessThan(at.openAt);
    // Even a silly dial cannot put the swap in view.
    const wild = rankedGateTimeline({ ...RANKED_GATE_TIMING, handoffMs: 99_999 });
    expect(wild.handoffAt).toBeLessThan(wild.openAt);
    expect(wild.handoffAt).toBeGreaterThanOrEqual(wild.slamAt);
  });

  it('starts the opening cue before the doors part, never before the shudder', () => {
    expect(at.openSoundAt).toBeLessThanOrEqual(at.openAt);
    expect(at.openSoundAt).toBeGreaterThanOrEqual(at.shudderAt);
    expect(at.openAt - at.openSoundAt).toBe(RANKED_GATE_TIMING.openSoundLeadMs);
  });

  it('hands the same durations to the stylesheet', () => {
    expect(rankedGateCssVars()).toEqual({ '--rg-close': '1500ms', '--rg-shake': '460ms', '--rg-shudder': '700ms', '--rg-open': '1500ms' });
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
  const at = rankedGateTimeline();
  const start = (): { onShut: ReturnType<typeof vi.fn>; done: ReturnType<typeof vi.fn> } => {
    vi.useFakeTimers();
    ui = mount(<RankedGate />);
    // The doors have a real box on screen (jsdom lays nothing out).
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: 1920, bottom: 1080, width: 1920, height: 1080, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
    Object.defineProperty(window, 'innerHeight', { value: 1080, configurable: true });
    const onShut = vi.fn(), done = vi.fn();
    act(() => { void requestRankedGate(onShut).then(done); });
    return { onShut, done };
  };

  it('renders nothing until it is asked for', () => {
    ui = mount(<RankedGate />);
    expect(document.querySelector('.rgate')).toBeNull();
  });

  it('closes with the grind: two doors, the close cue, nothing swapped yet', () => {
    const { onShut } = start();
    expect(phaseOf()).toBe('closing');
    expect(document.querySelectorAll('.rgate-door')).toHaveLength(2);
    expect(document.querySelector('.rgate-door-l .rgate-face')).not.toBeNull();
    expect(document.querySelector('.rgate-door-r .rgate-face')).not.toBeNull();
    expect(document.querySelector<HTMLElement>('.rgate')!.style.getPropertyValue('--rg-close')).toBe('1500ms');
    expect(snd.gate.mock.calls.map((c) => c[0])).toEqual(['close']);
    advance(at.slamAt - 1);
    expect(phaseOf()).toBe('closing');
    expect(fx.slam).not.toHaveBeenCalled();
    expect(onShut, 'the mode picker is still in view').not.toHaveBeenCalled();
  });

  it('slams shut: the slam cue, smoke and sparks off the centre seam, then the swap behind the doors', () => {
    const { onShut } = start();
    advance(at.slamAt);
    expect(phaseOf()).toBe('shut');
    expect(snd.gate.mock.calls.map((c) => c[0])).toEqual(['close', 'slam']);
    expect(fx.slam).toHaveBeenCalledTimes(1);
    expect(fx.slam.mock.calls[0]![0], 'the seam, measured once, in screen px').toEqual({ x: 960, top: 0, bottom: 1080 });
    expect(onShut, 'not on the very frame they meet').not.toHaveBeenCalled();
    advance(at.handoffAt - at.slamAt);
    expect(onShut).toHaveBeenCalledTimes(1);
    expect(phaseOf(), 'still shut while the screen changes').toBe('shut');
  });

  it('holds a second, shudders with the rattle, then grinds open and leaves nothing behind', async () => {
    const { onShut, done } = start();
    advance(at.shudderAt - 1);
    expect(phaseOf()).toBe('shut');
    expect(fx.shudder).not.toHaveBeenCalled();
    advance(1);
    expect(phaseOf()).toBe('shudder');
    expect(fx.shudder).toHaveBeenCalledTimes(1);
    expect(fx.shudder.mock.calls[0]![1]).toBe(RANKED_GATE_TIMING.shudderMs);
    advance(at.openSoundAt - at.shudderAt);
    expect(snd.gate.mock.calls.map((c) => c[0])).toEqual(['close', 'slam', 'rattle', 'open']);
    expect(phaseOf(), 'the cue leads the doors').toBe('shudder');
    advance(at.openAt - at.openSoundAt);
    expect(phaseOf()).toBe('opening');
    advance(at.endAt - at.openAt - 1);
    expect(phaseOf()).toBe('opening');
    advance(1);
    expect(document.querySelector('.rgate'), 'the gate unmounts once clear').toBeNull();
    expect(fx.release, 'the FX layer is let go (its WebGL context is freed once the dust has faded)').toHaveBeenCalledTimes(1);
    expect(fx.clear, 'but the dust still drifting is not cut off').not.toHaveBeenCalled();
    await act(async () => { await Promise.resolve(); });
    expect(done).toHaveBeenCalledTimes(1);
    expect(onShut).toHaveBeenCalledTimes(1);
    expect(snd.gate).toHaveBeenCalledTimes(4);
  });

  it('unmounted mid-sequence it stops the clock, drops the FX and still makes the swap', () => {
    const { onShut } = start();
    advance(at.slamAt - 200);
    ui!.unmount(); ui = null;
    expect(onShut).toHaveBeenCalledTimes(1);
    expect(fx.clear).toHaveBeenCalled();
    expect(fx.release).toHaveBeenCalled();
    advance(at.endAt);
    expect(snd.gate.mock.calls.map((c) => c[0]), 'no cue fires after the gate is gone').toEqual(['close']);
  });

  it('reduced motion: no gate, no cues, the swap at once', () => {
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

  it('the two door images and the four cues are committed, and the stylesheet points at the doors', () => {
    for (const door of ['ranked-gate-left.webp', 'ranked-gate-right.webp']) {
      expect(existsSync(pub('frames', door)), door).toBe(true);
      expect(css).toContain(`url('/frames/${door}')`);
    }
    for (const cue of ['gateclose', 'gateslam', 'gaterattle', 'gateopen']) {
      expect(existsSync(ui$('audio', `${cue}.mp3`)), cue).toBe(true);
    }
  });

  it('each cue has its own fader, on the ui bus, with a name', () => {
    for (const cue of ['gateclose', 'gateslam', 'gaterattle', 'gateopen']) {
      expect(familyOf(cue), cue).toBe(cue);
      expect(CATEGORY_GAINS[cue], cue).toBeGreaterThan(0);
      expect(CATEGORY_BUS[cue], cue).toBe('ui');
      expect(CATEGORY_LABEL[cue], cue).toMatch(/^Ranked gate: /);
    }
  });

  it('the doors meet on the seam: each half is anchored to its seam side and covers its door', () => {
    expect(css).toMatch(/\.rgate-face \{[^}]*url\('\/frames\/ranked-gate-left\.webp'\) 100% 50% \/ cover/);
    expect(css).toMatch(/\.rgate-door-r \.rgate-face \{[^}]*background-position: 0% 50%/);
    expect(css).toMatch(/\.rgate-door \{[^}]*width: 50%/);
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
    expect(blocks.map((b) => b[0]).sort()).toEqual(['rg-close-l', 'rg-close-r', 'rg-flash', 'rg-grind', 'rg-impact', 'rg-open-l', 'rg-open-r', 'rg-shudder']);
    for (const [name, body] of blocks) {
      const props = [...body.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]).filter((p) => p !== 'animation-timing-function');
      expect(props.length, name).toBeGreaterThan(0);
      expect(props.filter((p) => p !== 'transform' && p !== 'opacity'), name).toEqual([]);
    }
    const noComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(noComments).not.toMatch(/\d(vw|vh)\b/);
    expect(noComments).not.toMatch(/cursor\s*:/);
    expect(noComments).not.toMatch(/@media/);
    // The doors close fully and open fully.
    expect(css).toMatch(/rg-close-l \{[\s\S]*?100% \{ transform: translateX\(0\); \}/);
    expect(css).toMatch(/rg-open-r \{[\s\S]*?100% \{ transform: translateX\(102%\); \}/);
  });
});
