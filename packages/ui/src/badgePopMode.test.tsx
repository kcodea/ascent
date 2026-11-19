// @vitest-environment jsdom
/**
 * R-PERF-BADGE-POP-01 — A STAT BADGE'S NUMBER POP RUNS ON THE COMPOSITOR WHEN IT IS THE ONLY POP (2026-11-19).
 *
 * The same keyframes and timing as before. An additive (`composite: 'add'`) animation cannot run on the compositor, so
 * the pop is additive only while another scale pop (a `react` layer pop: a Ruby gem) is playing or built and waiting on
 * that badge, so the two still multiply exactly as before.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { mount, type Mounted } from './renderedText.mount';
import { Card, type CardView } from './Card';
import { releaseAllStats } from './fx/statHold';
import { noteScheduledPop } from './fx/popStack';

interface Call { el: Element; frames: Keyframe[]; opts: KeyframeAnimationOptions }
const calls: Call[] = [];
let frameCbs: FrameRequestCallback[] = [];
const flushFrames = (): void => { const cbs = frameCbs; frameCbs = []; for (const cb of cbs) cb(0); };
const origAnimate = (HTMLElement.prototype as { animate?: unknown }).animate;

beforeAll(() => {
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frameCbs.push(cb); return frameCbs.length; });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  (HTMLElement.prototype as unknown as { animate: unknown }).animate = function animate(this: Element, frames: Keyframe[], opts: KeyframeAnimationOptions) {
    calls.push({ el: this, frames, opts });
    return { cancel: () => undefined, addEventListener: () => undefined };
  };
});
afterAll(() => {
  vi.unstubAllGlobals();
  (HTMLElement.prototype as unknown as { animate: unknown }).animate = origAnimate;
});

const view = (attack: number, health: number): CardView => ({
  name: 'Test', cardId: 'ce3_seer', tribe: 'neutral', attack, health, keywords: [], text: '', tier: 1, baseAttack: 1, baseHealth: 1,
} as CardView);

let m: Mounted | null = null;
afterEach(() => { m?.unmount(); m = null; calls.length = 0; frameCbs = []; releaseAllStats(); });

const pops = (): Call[] => calls.filter((c) => (c.el as HTMLElement).classList.contains('badge'));

describe('the badge number pop (R-PERF-BADGE-POP-01)', () => {
  it('alone on the badge: the authored keyframes and timing, in the replace mode', () => {
    m = mount(<Card uid="b1" card={view(3, 3)} />);
    act(() => { m!.render(<Card uid="b1" card={view(3, 7)} />); });
    releaseAllStats();
    act(() => { m!.render(<Card uid="b1" card={view(3, 7)} />); });
    act(() => { flushFrames(); });
    const p = pops();
    expect(p.length).toBeGreaterThan(0);
    for (const c of p) {
      expect(c.frames.map((f) => f.transform)).toEqual(['scale(1)', expect.stringMatching(/^scale\(1\.\d+\)$/), 'scale(1)']);
      expect(c.opts.composite).toBeUndefined();
      expect(c.opts.easing).toBe('ease-out');
    }
  });

  it('over a react pop built on the same badge: additive, as before', () => {
    m = mount(<Card uid="b2" card={view(3, 3)} />);
    const hp = m.container.querySelector('.badge.hp');
    expect(hp).not.toBeNull();
    noteScheduledPop(hp!, { effect: { getComputedTiming: () => ({ progress: 0 }) } });
    act(() => { m!.render(<Card uid="b2" card={view(3, 9)} />); });
    releaseAllStats();
    act(() => { m!.render(<Card uid="b2" card={view(3, 9)} />); });
    act(() => { flushFrames(); });
    const onHp = pops().filter((c) => c.el === hp);
    expect(onHp.length).toBeGreaterThan(0);
    for (const c of onHp) expect(c.opts.composite).toBe('add');
  });
});
