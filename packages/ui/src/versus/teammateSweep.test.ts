// @vitest-environment jsdom
/**
 * VERSUS DUOS — THE SWAP SWEEP (R-DUOS-VIEW-01, perf: the owner's >160 fps bar). Entering the teammate view moves ONE
 * pre-made panel (transform keyframes only, never the stage root); the screens swap only once it covers them, and it
 * sweeps out only after the new screen has settled.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });
const watch = vi.fn();
vi.mock('./spectate', async (orig) => ({ ...(await orig<typeof import('./spectate')>()), watchTeammate: (...a: unknown[]) => watch(...a) }));

const { useGame } = await import('../store');
const { useVersus } = await import('./versusStore');
const view = await import('./teammateView');

interface FakeAnim { keyframes: Keyframe[]; target: Element; onfinish: (() => void) | null; oncancel: (() => void) | null; cancel: () => void }
const anims: FakeAnim[] = [];
beforeEach(() => {
  anims.length = 0;
  (Element.prototype as { animate?: unknown }).animate = function (this: Element, keyframes: Keyframe[]) {
    const a: FakeAnim = { keyframes, target: this, onfinish: null, oncancel: null, cancel() {} };
    anims.push(a);
    return a;
  };
  useVersus.setState({ match: { phase: 'shop', paused_at: null, group: { me: 'p1', duos: { team: 'a', mate: 'p2', first: { a: 'p1', b: 'p3' } } } } } as never);
  useGame.setState({ run: { ...useGame.getState().run, mode: 'versus', phase: 'recruit' } } as never);
});
afterEach(() => { useVersus.setState({ match: null } as never); vi.useRealTimers(); });

describe('the swap sweep', () => {
  it('moves only the pre-made panel, by transform, and swaps the screens once it covers them', () => {
    view.prepareTeammateSweep();
    const panel = document.querySelector('.duosswap');
    expect(panel).not.toBeNull();
    view.enterTeammateView();
    expect(anims).toHaveLength(1);
    expect(anims[0]!.target).toBe(panel);
    for (const f of anims[0]!.keyframes) for (const k of Object.keys(f)) expect(['transform', 'offset']).toContain(k);
    expect(anims.some((a) => a.target === document.getElementById('root'))).toBe(false);
    expect(watch).not.toHaveBeenCalled(); // still sweeping in
    anims[0]!.onfinish?.();
    expect(watch).toHaveBeenCalledWith('p2'); // covered: swap
    expect(anims).toHaveLength(1); // the sweep out waits for the new screen to settle
  });
});
