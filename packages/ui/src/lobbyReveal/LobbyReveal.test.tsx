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

const snd = vi.hoisted(() => ({ clip: vi.fn(() => null), ceremony: vi.fn() }));
vi.mock('../sfx', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../sfx')>();
  return { ...actual, playTailedClip: snd.clip, sfx: { ...actual.sfx, ceremony: snd.ceremony, goodLuckShine: vi.fn(() => null), goodLuckSpark: vi.fn(() => null) } };
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
/** What the hidden-rail attribute on <html> says has landed, or null when the rail is fully shown. */
const landed = (): string | null => document.documentElement.getAttribute('data-lhr');
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

  it('hides the WHOLE rail while it builds it (nothing landed yet), and shows every part of it at the end', () => {
    vi.useFakeTimers();
    railDom();
    m = mount(<><LobbyReveal /><GoodLuckIntro /></>);
    act(gameStart);
    expect(landed()).toBe('on'); // no seat, no rail panel, no round slice
    const t = revealTimeline(LHR_DEFAULTS, 4, false);
    act(() => { vi.advanceTimersByTime(t.dimOutAt + 50); });
    expect(landed()).toBe('on rail head'); // the ROUND slice opens first, before any seat (owner 2026-10-31)
    act(() => { vi.advanceTimersByTime(t.endAt); });
    expect(lobbyReveal.isActive()).toBe(false);
    expect(landed()).toBeNull();
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



  it('"Good Luck after" off: the reveal replaces the words, and the clock is free when it ends', () => {
    vi.useFakeTimers();
    setLobbyRevealValue('goodLuckAfter', 0);
    railDom();
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
    expect(landed()).toBeNull();
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

describe('Versus: the shared round-1 start accounts for the reveal', () => {
  it('the client acks its intro only once the Good Luck intro is over, which waits behind the reveal', async () => {
    // The Worker starts round 1's shop deadline when EVERY player has acked (or at VERSUS_INTRO_CAP_SECONDS). The ack
    // waits on the Good Luck store, and that store stays active for the whole reveal (pinned above), so the shared start
    // already sits after every client's reveal. A local skip ends only that screen's visuals.
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(join(__dirname, '..', 'versus', 'versusStore.ts'), 'utf8');
    const ack = src.slice(src.indexOf('function ackIntro('), src.indexOf('function driveRun('));
    expect(ack).toContain('goodLuckIntro.isActive()');
    expect(ack).toContain('mx.introDone(matchId)');
    const { VERSUS_INTRO_CAP_SECONDS } = await import('@game/sim');
    const t = revealTimeline(LHR_DEFAULTS, 8, false);
    expect(t.endAt / 1000 + 3).toBeLessThan(VERSUS_INTRO_CAP_SECONDS); // reveal + the Good Luck words, well inside the cap
  });
});

describe('the owner\x27s game-start rulings (2026-10-31)', () => {
  it('the reveal cannot be skipped: a click, Esc or any key does nothing, and no key reaches the menu or the shop', () => {
    railDom();
    m = mount(<><LobbyReveal /><GoodLuckIntro /></>);
    act(gameStart);
    const menu = vi.fn();
    window.addEventListener('keydown', menu);
    act(() => { (m!.container.querySelector('.lhr') as HTMLElement).dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })); });
    for (const key of ['Escape', 'a', ' ', 'Enter']) act(() => { document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })); });
    window.removeEventListener('keydown', menu);
    expect(lobbyReveal.isActive()).toBe(true);
    expect(menu).not.toHaveBeenCalled();
    expect(m.container.querySelector('.gli')).toBeNull(); // the words still wait behind it
  });

  it('reduced motion: the short plain fade, still unskippable', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} }));
    railDom();
    m = mount(<><LobbyReveal /><GoodLuckIntro /></>);
    act(gameStart);
    act(() => { (m!.container.querySelector('.lhr') as HTMLElement).dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })); });
    expect(lobbyReveal.isActive()).toBe(true);
  });

  it('the sounds: never a Hero Select (ceremony) clip; the owner\x27s shimmer with the sweep and his thuds on the locks', async () => {
    snd.clip.mockClear();
    snd.ceremony.mockClear();
    const cfg = await import('./lobbyRevealConfig');
    const clips = cfg.REVEAL_ALL_CLIPS;
    for (const clip of clips) expect(clip.startsWith('ceremony/')).toBe(false);
    // Not heavy, and not the Good Luck words' own shine (it plays a moment later).
    expect(clips).not.toContain('fx/universfield-cinematic-swoosh-impact-454392');
    expect(clips).not.toContain('equipmentsheen');
    // The owner's clips (2026-10-31), shipped in the bank.
    expect(cfg.REVEAL_SWEEP_SHIMMER.clip).toBe('fx/reveal-shimmer');
    expect(cfg.REVEAL_LOCK_THUDS).toEqual(['fx/reveal-impact-1', 'fx/reveal-impact-3', 'fx/reveal-impact-4']);
    const { existsSync } = await import('node:fs');
    const { join } = await import('node:path');
    for (const c of [cfg.REVEAL_SWEEP_SHIMMER.clip, ...cfg.REVEAL_LOCK_THUDS]) expect(existsSync(join(__dirname, '..', 'audio', `${c}.mp3`)), c).toBe(true);
    vi.useFakeTimers();
    railDom();
    m = mount(<><LobbyReveal /><GoodLuckIntro /></>);
    act(gameStart);
    act(() => { vi.advanceTimersByTime(revealTimeline(LHR_DEFAULTS, 4, false).endAt + 20); });
    expect(snd.ceremony).not.toHaveBeenCalled();
    const played = snd.clip.mock.calls.map((x) => (x as unknown[])[0]);
    expect(played).toContain(cfg.REVEAL_LINEUP_WHOOSH.clip);
    expect(played).toContain('fx/reveal-shimmer');
    expect(played).toContain(cfg.REVEAL_FLIGHT_WHOOSH.clip);
    // One thud per lock, rotating so neighbours differ.
    const thuds = played.filter((c) => String(c).startsWith('fx/reveal-impact-'));
    expect(thuds).toHaveLength(4);
    for (let i = 1; i < thuds.length; i++) expect(thuds[i]).not.toBe(thuds[i - 1]);
  });

  it('a turn-1 Discover (Disco Dan, a hero quest) waits for the reveal AND the Good Luck words: the shop holds every offer', async () => {
    // Recruit holds every offer overlay (Discover, quest, power, Runeforge, Choose One, scout, Ancients) on ONE flag,
    // and that flag now folds in the Good Luck store, which stays active behind the reveal and until the words are over.
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(join(__dirname, '..', 'Recruit.tsx'), 'utf8');
    expect(src).toMatch(/const introHold = useGoodLuckIntroActive\(\);\s*const overlaysHeld = !inCombat && \(wipe !== 'idle' \|\| sotPlaying \|\| introHold\);/);
    for (const offer of ['run.discover', 'run.runeforgeOffer', 'run.chooseOne']) expect(src).toContain(`!overlaysHeld && ${offer}`);
    // ...and the store is active from the curtain to the end of the words, through the reveal.
    vi.useFakeTimers();
    railDom();
    m = mount(<><LobbyReveal /><GoodLuckIntro /></>);
    act(gameStart);
    expect(goodLuckIntro.isActive()).toBe(true);
    act(() => { vi.advanceTimersByTime(revealTimeline(LHR_DEFAULTS, 4, false).endAt + 20); });
    expect(lobbyReveal.isActive()).toBe(false);
    expect(goodLuckIntro.isActive()).toBe(true); // the words are playing: offers still held
  });


  it('every portrait is the same size: yours is only highlighted, never bigger', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const css = readFileSync(join(__dirname, 'lobbyReveal.css'), 'utf8');
    expect(css).not.toMatch(/\.lhr-card\.you[^{]*\{[^}]*--lhr-px/);
  });
});
