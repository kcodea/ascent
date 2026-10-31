// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { mount, type Mounted } from '../renderedText.mount';
import { useGame } from '../store';
import { LobbyReveal } from './LobbyReveal';
import { GoodLuckIntro } from '../goodLuck/GoodLuckIntro';
import { goodLuckIntro, resetGoodLuckIntroForTests } from '../goodLuck/goodLuckIntroStore';
import { turnClockMayTick } from '../turnClock';
import { lobbyReveal, REVEAL_SAFETY_MS, resetLobbyRevealForTests, setLobbyRevealEnabled } from './lobbyRevealStore';
import { beginLobbyRevealFor } from './beginLobbyReveal';
import { LHR_DEFAULTS, resetLobbyRevealConfig, setLobbyRevealValue } from './lobbyRevealConfig';
import { revealTimeline } from './lobbyRevealModel';

vi.mock('../sfx', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../sfx')>();
  return { ...actual, sfx: { ...actual.sfx, ceremony: vi.fn(), goodLuckShine: vi.fn(() => null), goodLuckSpark: vi.fn(() => null) } };
});

// The boot gate decodes every portrait before a game can start; jsdom loads no images, so say they are ready.
vi.mock('../artPreload', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../artPreload')>();
  return { ...actual, artReady: () => true };
});

/**
 * THE LOBBY REVEAL overlay (owner ask 2026-10-31): a real phase BEFORE round 1 ("The hero reveal animation should happen
 * before any timers obviously, the start game text should happen after the animation is complete"). The Good Luck words
 * and the shop clock wait behind it; a click, Esc or a key skips it; the rail's slots it hid always come back.
 */
let m: Mounted | null = null;
const initial = useGame.getState();
const HEROES = ['tamby', 'yazzus', 'fi', 'coran'];
const seats = HEROES.map((heroId, i) => ({ id: `s${i}`, heroId, label: `Claudebot${i + 1}`, kind: i ? 'bot' : 'player' }));
const fakeRun = { ...initial.run, mode: 'lobby', wave: 1, phase: 'recruit', sandbox: false, lobby: { ...(initial.run.lobby ?? {}), seats } } as never;

/** A stand-in rail: one row per seat and the round header, as every rail look marks them. */
function railDom(): HTMLElement {
  const rail = document.createElement('div');
  rail.className = 'lobbyrail';
  rail.innerHTML = seats.map((s) => `<div class="lobbyseat" data-seat="${s.id}"></div>`).join('') ;
  const head = document.createElement('div');
  head.className = 'lobbyrailhead';
  document.body.append(rail, head);
  return rail;
}
const waiting = (): number => document.querySelectorAll('[data-lhr="wait"]').length;
const shopTurn = { recruitPhase: true, decisionOpen: false, heroSelecting: false, overlayOpen: false, introPlaying: false };

beforeEach(() => {
  resetLobbyRevealForTests();
  resetGoodLuckIntroForTests();
  resetLobbyRevealConfig();
  setLobbyRevealEnabled(true);
  useGame.setState({ showTitle: false, run: fakeRun });
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0));
});
afterEach(() => {
  m?.unmount();
  m = null;
  document.querySelectorAll('.lobbyrail, .lobbyrailhead').forEach((el) => el.remove());
  vi.useRealTimers();
  vi.unstubAllGlobals();
  useGame.setState(initial, true);
});

/** The game start as the curtain runs it: the reveal first, then the Good Luck intro behind it. */
const gameStart = (): void => { beginLobbyRevealFor(useGame.getState().run as never); goodLuckIntro.begin(); };

describe('the lobby reveal', () => {
  it('shows every hero of the game with its player name, you highlighted', () => {
    railDom();
    m = mount(<><LobbyReveal /><GoodLuckIntro /></>);
    act(gameStart);
    const cards = [...m.container.querySelectorAll('.lhr-card')];
    expect(cards).toHaveLength(4);
    expect(cards.map((c) => c.querySelector('.lhr-name')?.textContent).sort()).toEqual(['Claudebot1', 'Claudebot2', 'Claudebot3', 'Claudebot4']);
    expect(m.container.querySelectorAll('.lhr-card.you')).toHaveLength(1);
    expect(m.container.querySelector('.lhr-card.you')?.getAttribute('data-seat')).toBe('s0');
  });

  it('hides the rail slots and the round slice while it builds them, and puts every one back at the end', () => {
    vi.useFakeTimers();
    railDom();
    m = mount(<><LobbyReveal /><GoodLuckIntro /></>);
    act(gameStart);
    expect(waiting()).toBe(5);
    act(() => { vi.advanceTimersByTime(revealTimeline(LHR_DEFAULTS, 4, false).endAt + 20); });
    expect(lobbyReveal.isActive()).toBe(false);
    expect(waiting()).toBe(0);
  });

  it('holds the Good Luck words (and so the shop clock) until it is over, then the words play', () => {
    vi.useFakeTimers();
    railDom();
    m = mount(<><LobbyReveal /><GoodLuckIntro /></>);
    act(gameStart);
    expect(m.container.querySelector('.gli')).toBeNull();
    // Recruit folds the Good Luck store into the clock gate: it stays held for the whole reveal.
    expect(goodLuckIntro.isActive()).toBe(true);
    expect(turnClockMayTick({ ...shopTurn, introPlaying: goodLuckIntro.isActive() })).toBe(false);
    act(() => { vi.advanceTimersByTime(revealTimeline(LHR_DEFAULTS, 4, false).endAt + 20); });
    expect(lobbyReveal.isActive()).toBe(false);
    expect(m.container.querySelector('.gli-text')?.textContent).toBe('Good Luck');
    expect(goodLuckIntro.isActive()).toBe(true); // the words are up; the clock starts when they go
  });

  it('a click skips it straight to the Good Luck words, with every slot back', () => {
    railDom();
    m = mount(<><LobbyReveal /><GoodLuckIntro /></>);
    act(gameStart);
    act(() => { (m!.container.querySelector('.lhr') as HTMLElement).dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })); });
    expect(lobbyReveal.isActive()).toBe(false);
    expect(lobbyReveal.wasSkipped()).toBe(true);
    expect(waiting()).toBe(0);
    expect(m.container.querySelector('.gli-text')).not.toBeNull();
  });

  it('Esc or any key skips, and the press never reaches the Esc menu', () => {
    railDom();
    m = mount(<><LobbyReveal /><GoodLuckIntro /></>);
    act(gameStart);
    const menu = vi.fn();
    window.addEventListener('keydown', menu);
    act(() => { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    window.removeEventListener('keydown', menu);
    expect(lobbyReveal.isActive()).toBe(false);
    expect(menu).not.toHaveBeenCalled();
    // The same Esc did not also skip the words that follow.
    expect(goodLuckIntro.isActive()).toBe(true);
    act(gameStart);
    act(() => { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true })); });
    expect(lobbyReveal.isActive()).toBe(false);
  });

  it('"Good Luck after" off: the reveal replaces the words, and the clock is free when it ends', () => {
    vi.useFakeTimers();
    setLobbyRevealValue('goodLuckAfter', 0);
    m = mount(<><LobbyReveal /><GoodLuckIntro /></>);
    act(gameStart);
    act(() => { vi.advanceTimersByTime(revealTimeline(LHR_DEFAULTS, 4, false).endAt + 20); });
    expect(goodLuckIntro.isActive()).toBe(false);
  });

  it('reduced motion: the same pass, ending sooner, nothing left hidden', () => {
    vi.useFakeTimers();
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} }));
    railDom();
    m = mount(<><LobbyReveal /><GoodLuckIntro /></>);
    act(gameStart);
    act(() => { vi.advanceTimersByTime(revealTimeline(LHR_DEFAULTS, 4, true).endAt + 20); });
    expect(lobbyReveal.isActive()).toBe(false);
    expect(waiting()).toBe(0);
  });

  it('the Settings switch off: no reveal, the words play at once', () => {
    setLobbyRevealEnabled(false);
    m = mount(<><LobbyReveal /><GoodLuckIntro /></>);
    act(gameStart);
    expect(lobbyReveal.isActive()).toBe(false);
    expect(m.container.querySelector('.lhr')).toBeNull();
    expect(m.container.querySelector('.gli-text')).not.toBeNull();
  });

  it('never strands anything: with no overlay mounted the safety timer ends it', () => {
    vi.useFakeTimers();
    act(gameStart);
    expect(lobbyReveal.isActive()).toBe(true);
    act(() => { vi.advanceTimersByTime(REVEAL_SAFETY_MS + 1); });
    expect(lobbyReveal.isActive()).toBe(false);
  });
});
