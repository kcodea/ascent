// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { mount, type Mounted } from '../renderedText.mount';
import { useGame } from '../store';
import { GoodLuckIntro } from './GoodLuckIntro';
import { HeroLaunchCurtain } from '../hero-select/HeroLaunchCurtain';
import { requestLaunch, resetLaunchControllerForTests } from '../hero-select/heroLaunchController';
import { goodLuckIntro, resetGoodLuckIntroForTests } from './goodLuckIntroStore';
import { GLI_DEFAULTS, GLI_REPLAY_EVENT, goodLuckTimeline, resetGoodLuckIntroConfig, setGoodLuckIntroValue } from './goodLuckIntroConfig';

// The intro's two sounds, spied: each play hands back a handle whose `stop` a skip must call.
const snd = vi.hoisted(() => {
  const stops: { shine: ReturnType<typeof vi.fn>[]; spark: ReturnType<typeof vi.fn>[] } = { shine: [], spark: [] };
  const make = (bucket: 'shine' | 'spark') => vi.fn(() => { const stop = vi.fn(); stops[bucket].push(stop); return { stop }; });
  return { stops, shine: make('shine'), spark: make('spark') };
});
vi.mock('../sfx', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../sfx')>();
  return { ...actual, sfx: { ...actual.sfx, goodLuckShine: snd.shine, goodLuckSpark: snd.spark } };
});

/**
 * THE "GOOD LUCK" INTRO overlay + its hand-off from the launch curtain (owner ask 2026-09-24). The overlay ends
 * on its own timer, on Esc and on a click, and each of those releases the shop clock; the curtain begins it
 * only for a lobby / Practice start.
 */
let m: Mounted | null = null;
const initial = useGame.getState();

beforeEach(() => {
  resetGoodLuckIntroForTests();
  resetGoodLuckIntroConfig();
  snd.shine.mockClear();
  snd.spark.mockClear();
  snd.stops.shine.length = 0;
  snd.stops.spark.length = 0;
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

describe('the Good Luck sounds (owner 2026-09-24: "it needs a sound effect")', () => {
  it('queues the shine sound for the moment the sweep starts, and the sparkle for the spark burst', () => {
    m = mount(<GoodLuckIntro />);
    act(() => goodLuckIntro.begin());
    const t = goodLuckTimeline(GLI_DEFAULTS, false);
    expect(t.shineSoundAt).toBe(t.shineAt);
    expect(snd.shine).toHaveBeenCalledTimes(1);
    expect(snd.shine).toHaveBeenCalledWith(GLI_DEFAULTS.shineSoundGain, t.shineAt);
    expect(snd.spark).toHaveBeenCalledTimes(1);
    expect(snd.spark).toHaveBeenCalledWith(GLI_DEFAULTS.sparkSoundGain, t.sparkAt);
  });

  it('follows the tuner: the offset moves the shine sound, gains pass through, 0 sparks = no spark sound', () => {
    setGoodLuckIntroValue('shineSoundOffsetMs', -120);
    setGoodLuckIntroValue('shineSoundGain', 0.5);
    setGoodLuckIntroValue('sparkCount', 0);
    m = mount(<GoodLuckIntro />);
    act(() => goodLuckIntro.begin());
    const shineAt = goodLuckTimeline(GLI_DEFAULTS, false).shineAt;
    expect(snd.shine).toHaveBeenCalledWith(0.5, shineAt - 120);
    expect(snd.spark).not.toHaveBeenCalled();
  });

  it('Esc stops both sounds (the queued shine never rings)', () => {
    m = mount(<GoodLuckIntro />);
    act(() => goodLuckIntro.begin());
    act(() => { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(snd.stops.shine[0]).toHaveBeenCalledTimes(1);
    expect(snd.stops.spark[0]).toHaveBeenCalledTimes(1);
  });

  it('a click stops them too', () => {
    m = mount(<GoodLuckIntro />);
    act(() => goodLuckIntro.begin());
    act(() => { (m!.container.querySelector('.gli') as HTMLElement).dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })); });
    expect(snd.stops.shine[0]).toHaveBeenCalledTimes(1);
  });

  it('the natural end lets the shine ring out (no stop)', () => {
    vi.useFakeTimers();
    m = mount(<GoodLuckIntro />);
    act(() => goodLuckIntro.begin());
    act(() => { vi.advanceTimersByTime(goodLuckTimeline(GLI_DEFAULTS, false).endAt + 10); });
    expect(goodLuckIntro.isActive()).toBe(false);
    expect(snd.stops.shine[0]).not.toHaveBeenCalled();
    expect(snd.stops.spark[0]).not.toHaveBeenCalled();
  });

  it('the tuner replay plays them again, cutting off the play it interrupts', () => {
    useGame.setState({ run: { mode: 'lobby', wave: 1 } as never, showTitle: false });
    m = mount(<GoodLuckIntro />);
    act(() => { window.dispatchEvent(new Event(GLI_REPLAY_EVENT)); });
    expect(snd.shine).toHaveBeenCalledTimes(1);
    act(() => { window.dispatchEvent(new Event(GLI_REPLAY_EVENT)); });
    expect(snd.shine).toHaveBeenCalledTimes(2);
    expect(snd.stops.shine[0]).toHaveBeenCalledTimes(1);
    expect(snd.stops.shine[1]).not.toHaveBeenCalled();
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
