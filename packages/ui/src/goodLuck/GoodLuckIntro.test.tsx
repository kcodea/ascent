// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { mount, type Mounted } from '../renderedText.mount';
import { useGame } from '../store';
import { GoodLuckIntro } from './GoodLuckIntro';
import { HeroLaunchCurtain } from '../hero-select/HeroLaunchCurtain';
import { requestLaunch, resetLaunchControllerForTests } from '../hero-select/heroLaunchController';
import { goodLuckIntro, resetGoodLuckIntroForTests } from './goodLuckIntroStore';
import { GLI_DEFAULTS, goodLuckTimeline } from './goodLuckIntroConfig';

/**
 * THE "GOOD LUCK" INTRO overlay + its hand-off from the launch curtain (owner ask 2026-09-24). The overlay ends
 * on its own timer, on Esc and on a click, and each of those releases the shop clock; the curtain begins it
 * only for a lobby / Practice start.
 */
let m: Mounted | null = null;
const initial = useGame.getState();

beforeEach(() => {
  resetGoodLuckIntroForTests();
  resetLaunchControllerForTests();
  useGame.setState({ showTitle: false });
  // jsdom paints no frames: the curtain's "two frames" wait needs a rAF that actually fires.
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0));
});
afterEach(() => {
  m?.unmount();
  m = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  useGame.setState(initial, true);
});

describe('the Good Luck overlay', () => {
  it('renders nothing until begun, then shows the words', () => {
    m = mount(<GoodLuckIntro />);
    expect(m.container.querySelector('.gli')).toBeNull();
    act(() => goodLuckIntro.begin());
    expect(m.container.querySelector('.gli-text')?.textContent).toBe('Good Luck');
  });

  it('ends on its own when the timeline finishes (and only then)', () => {
    vi.useFakeTimers();
    m = mount(<GoodLuckIntro />);
    act(() => goodLuckIntro.begin());
    const end = goodLuckTimeline(GLI_DEFAULTS, false).endAt;
    act(() => { vi.advanceTimersByTime(end - 50); });
    expect(goodLuckIntro.isActive()).toBe(true);
    act(() => { vi.advanceTimersByTime(100); });
    expect(goodLuckIntro.isActive()).toBe(false);
    expect(m.container.querySelector('.gli')).toBeNull();
  });

  it('Esc skips straight to the game, and the press does not reach the Esc menu', () => {
    m = mount(<GoodLuckIntro />);
    act(() => goodLuckIntro.begin());
    const menu = vi.fn();
    window.addEventListener('keydown', menu);
    act(() => { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    window.removeEventListener('keydown', menu);
    expect(goodLuckIntro.isActive()).toBe(false);
    expect(menu).not.toHaveBeenCalled();
  });

  it('a click skips straight to the game', () => {
    m = mount(<GoodLuckIntro />);
    act(() => goodLuckIntro.begin());
    const el = m.container.querySelector('.gli') as HTMLElement;
    act(() => { el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })); });
    expect(goodLuckIntro.isActive()).toBe(false);
  });

  it('leaving to the title never strands the clock held', () => {
    m = mount(<GoodLuckIntro />);
    act(() => goodLuckIntro.begin());
    act(() => useGame.setState({ showTitle: true }));
    expect(goodLuckIntro.isActive()).toBe(false);
  });
});

describe('the launch curtain begins the intro only for a real lobby / Practice start', () => {
  const launchWith = async (mode: string, extra: Record<string, unknown> = {}): Promise<boolean> => {
    // A stand-in pickHero: the real one builds a whole lobby, which is not what this pins.
    useGame.setState({
      replaySession: null,
      pickHero: () => useGame.setState({ run: { ...useGame.getState().run, mode, wave: 1, sandbox: false, ...extra } as never, heroChoices: null }),
    });
    m = mount(<HeroLaunchCurtain />);
    // Start the launch in a SYNC act (it flushes the curtain's state + effect, which runs the sequence), then
    // await it: awaiting inside one async act would deadlock, since act only flushes when its callback settles.
    let p: Promise<void> = Promise.resolve();
    act(() => { p = requestLaunch({ heroId: 'x', accent: 'gold' }); });
    await act(async () => { await p; });
    return goodLuckIntro.isActive();
  };

  it('lobby: begins', async () => { expect(await launchWith('lobby')).toBe(true); });
  it('practice: begins', async () => { expect(await launchWith('practice')).toBe(true); });
  it('tutorial: does not', async () => { expect(await launchWith('tutorial')).toBe(false); });
  it('sandbox: does not', async () => { expect(await launchWith('practice', { sandbox: true })).toBe(false); });
});
