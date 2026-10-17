// @vitest-environment jsdom
/**
 * EMOTES IN A GAME (owner spec 2026-10-13). Pins the client half:
 *  - the 20 s cooldown on saying one (no per-turn cap), and the menu showing it;
 *  - your emote goes through the transport seam and comes straight back as YOUR bubble;
 *  - in a lobby run it is RECORDED for the round's board at its offset into the phase: a shop emote is held until the
 *    round's board is captured, a combat emote lands on the board already captured; practice records nothing;
 *  - a served seat's recorded emotes REPLAY at the same offset into your phase (fake clock), bots never;
 *  - the bubble sits by its speaker: yours as painted, a rail seat's mirrored, nothing for a face not on screen.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createLobbyRun, createRunLobby, registerOpponents, type BoardSnapshot, type EmoteMessage, type RunState } from '@game/sim';
import { mount, type Mounted } from '../renderedText.mount';
import { useGame } from '../store';
import { EMOTE_COOLDOWN_MS, closeEmoteMenu, markEmotePhase, openEmoteMenu, resetEmotesForTests, sayEmote } from './emoteRuntime';
import { resetHeldEmotes, takeShopEmotes } from './emoteRecording';
import { deliverEmote, sendEmote, setEmoteTransport, subscribeEmotes } from './emoteTransport';
import { bubbleBox, clearEmoteBubbles, setEmoteFoe, showEmoteBubble } from './emoteBubble';
import { EmoteLayer } from './EmoteLayer';
import { useProgression } from '../progression/progressionStore';

vi.mock('../identity', async (orig) => ({ ...(await orig<typeof import('../identity')>()), currentUserId: () => 'u-1' }));

/** Angry Mushy was a starter until the owner retired it on 2026-10-15 ("remove the angry mushy emote"). */
const RETIRED = 'emote_angry_mushy';
const [A, B, C] = ['emote_flirty_midas', 'emote_nervous_jensen', 'emote_zen_brian'];

const board = (author: string, heroId: string, seed: number, wave: number, emotes?: BoardSnapshot['emotes']): BoardSnapshot => ({
  v: 1, wave, heroId, resolve: 30, tier: 1, triples: 0,
  tribes: ['beast', 'undead', 'mech', 'dragon', 'demon'], threat: 'glass', power: 4,
  minions: [{ cardId: 'pack', attack: 2, health: 2, keywords: [], golden: false }],
  seed, origin: 'self', author, setId: 'set1', ...(emotes ? { emotes } : {}),
} as BoardSnapshot);
const CHATTY = Array.from({ length: 6 }, (_, i) => board('Chatty', 'albus', 6161, i + 1,
  i === 0 ? [{ id: C, phase: 'shop', at: 4200 }, { id: A, phase: 'combat', at: 1500 }] : undefined));

beforeAll(() => { registerOpponents(CHATTY); });

let ui: Mounted | null = null;
afterEach(() => {
  ui?.unmount(); ui = null;
  vi.useRealTimers();
  resetEmotesForTests();
  resetHeldEmotes();
  clearEmoteBubbles();
  setEmoteFoe(null);
  setEmoteTransport(null);
  act(() => { useGame.setState({ capturedBoards: [], combatStaged: false }); });
  document.body.querySelectorAll('.statusbar, .lobbyseat, .combatopp, .vsfoe-face').forEach((n) => n.remove());
});

const lobbyRun = (phase: RunState['phase'] = 'recruit', mode: RunState['mode'] = 'lobby'): RunState => ({ ...createLobbyRun(4242, 'warden'), phase, mode });

describe('saying an emote: the cooldown, the transport, the recording', () => {
  it('20 s between emotes, no per-turn cap; each one goes out through the transport seam', () => {
    act(() => { useGame.setState({ run: lobbyRun() }); });
    markEmotePhase('shop', 1, 1000);
    const heard: EmoteMessage[] = [];
    const off = subscribeEmotes((m) => heard.push(m));
    expect(EMOTE_COOLDOWN_MS).toBe(20_000);
    expect(sayEmote(C, 5200)).toBe(true);
    expect(sayEmote(A, 10_000)).toBe(false); // cooling
    expect(sayEmote(A, 25_199)).toBe(false);
    expect(sayEmote(A, 25_200)).toBe(true);
    expect(sayEmote(B, 45_200)).toBe(true); // a third in the same turn: no cap
    expect(sayEmote('emote_does_not_exist', 99_000)).toBe(false);
    expect(sayEmote(RETIRED, 99_000)).toBe(false); // retired 2026-10-15: known, but never live
    off();
    expect(heard).toEqual([
      { emoteId: C, seat: 's0', phase: 'shop', offsetMs: 4200, round: 1 },
      { emoteId: A, seat: 's0', phase: 'shop', offsetMs: 24_200, round: 1 },
      { emoteId: B, seat: 's0', phase: 'shop', offsetMs: 44_200, round: 1 },
    ]);
  });

  it('a lobby SHOP emote is held for the round\'s board; a COMBAT emote lands on the board captured for the round', () => {
    const run = lobbyRun();
    act(() => { useGame.setState({ run, capturedBoards: [] }); });
    markEmotePhase('shop', run.wave, 0);
    sayEmote(B, 3000);
    expect(takeShopEmotes(run.wave + 1)).toEqual([]); // another round's board never takes them
    // (store.ts folds these into the board it captures at the end of the turn)
    sayEmote(C, 30_000);
    expect(takeShopEmotes(run.wave)).toEqual([{ id: B, phase: 'shop', at: 3000 }, { id: C, phase: 'shop', at: 30_000 }]);
    expect(takeShopEmotes(run.wave)).toEqual([]); // taken once

    const captured = board('Me', 'warden', run.seed, run.wave);
    act(() => { useGame.setState({ run: { ...run, phase: 'combat' }, capturedBoards: [captured] }); });
    markEmotePhase('combat', run.wave, 100_000);
    expect(sayEmote(A, 101_500)).toBe(true);
    expect(useGame.getState().capturedBoards[0]!.emotes).toEqual([{ id: A, phase: 'combat', at: 1500 }]);
    expect(captured.emotes).toBeUndefined(); // a copy, never a mutation
  });

  it('practice (and any non-lobby run) shows the bubble but records nothing', () => {
    act(() => { useGame.setState({ run: lobbyRun('recruit', 'practice'), capturedBoards: [] }); });
    markEmotePhase('shop', 1, 0);
    expect(sayEmote(A, 1000)).toBe(true);
    expect(takeShopEmotes(1)).toEqual([]);
  });

  it('nothing can be said outside a shop turn or a combat (game over)', () => {
    act(() => { useGame.setState({ run: lobbyRun('gameover') }); });
    markEmotePhase(null, 1, 0);
    expect(sayEmote(A, 1000)).toBe(false);
  });

  it('a later transport (Versus) receives the same message; the local loopback is back when it is removed', () => {
    const sent: EmoteMessage[] = [];
    setEmoteTransport({ send: (m) => { sent.push(m); deliverEmote(m); } });
    const m: EmoteMessage = { emoteId: A, seat: 's0', phase: 'combat', offsetMs: 10, round: 3 };
    sendEmote(m);
    expect(sent).toEqual([m]);
    setEmoteTransport(null);
    const heard: EmoteMessage[] = [];
    const off = subscribeEmotes((x) => heard.push(x));
    sendEmote(m);
    off();
    expect(heard).toEqual([m]);
  });
});

describe('the menu (right-click your portrait)', () => {
  /** The signed-in account's progression mirror, owning `cosmetics` (every emote but Zen Brian is a crate drop). */
  const owning = (cosmetics: string[]): void => {
    useProgression.setState({ mirror: { userId: 'u-1', accountXp: 0, accountLevel: 1, revision: 1, equippedTitleId: null, titles: [], cosmetics } });
  };
  afterEach(() => { useProgression.setState({ mirror: null }); });
  const slots = (): HTMLElement[] => [...document.body.querySelectorAll<HTMLElement>('.emote-menu .emote-grid > .emote-pick')];

  it('always FOUR slots (owner 2026-10-15): a fresh account has Zen Brian and three visibly empty, unclickable slots', () => {
    act(() => { useGame.setState({ run: lobbyRun() }); owning([]); });
    ui = mount(<EmoteLayer />);
    act(() => { openEmoteMenu({ x: 200, y: 700 }); });
    expect(slots()).toHaveLength(4);
    expect(slots().map((e) => e.tagName)).toEqual(['BUTTON', 'SPAN', 'SPAN', 'SPAN']);
    expect(slots()[0]!.getAttribute('aria-label')).toBe('Say Zen Brian');
    const empty = slots().slice(1);
    expect(empty.every((e) => e.classList.contains('emote-slot-empty') && e.getAttribute('aria-disabled') === 'true')).toBe(true);
    expect(empty.map((e) => e.getAttribute('aria-label'))).toEqual(['Slot 2 is empty', 'Slot 3 is empty', 'Slot 4 is empty']);
    expect(empty[0]!.textContent).toBe('Empty');
    expect(empty[0]!.classList.contains('gtip')).toBe(true); // the game's hover bubble, never a native title
    expect(empty[0]!.getAttribute('data-tip')).toBe('Empty slot. Find more emotes in crates.');
    expect(document.body.querySelector('.emote-menu .emote-none')).toBeNull(); // no "No emotes yet" line any more
    act(() => { closeEmoteMenu(); });
  });

  it('shows the emotes you OWN after Zen Brian (catalog order), says one, closes, then shows the cooldown when reopened', () => {
    act(() => { useGame.setState({ run: lobbyRun() }); owning([A, B, 'title_wanderer']); });
    ui = mount(<EmoteLayer />);
    act(() => { openEmoteMenu({ x: 200, y: 700 }); });
    const picks = (): HTMLButtonElement[] => [...document.body.querySelectorAll<HTMLButtonElement>('.emote-menu button.emote-pick')];
    expect(picks().map((b) => b.getAttribute('aria-label'))).toEqual(['Say Zen Brian', 'Say Nervous Jensen', 'Say Flirty Midas']); // starter, Rare, Epic
    expect(slots()).toHaveLength(4); // and one empty slot
    expect(document.body.querySelector('.emote-menu')!.hasAttribute('title')).toBe(false);
    act(() => { picks()[2]!.click(); });
    expect(document.body.querySelector('.emote-menu')).toBeNull(); // saying one closes it
    act(() => { openEmoteMenu({ x: 200, y: 700 }); });
    expect(picks().every((b) => b.disabled)).toBe(true);
    expect(document.body.querySelector('.emote-menu .emote-cd-txt')!.textContent).toMatch(/^Ready in (19|20)s$/);
    act(() => { closeEmoteMenu(); });
  });
});

describe('a served seat replays its recorded emotes at the same offset into your phase', () => {
  it('the snapshot seat\'s shop emote fires 4.2 s into your turn, beside its seat; nothing else does', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance'] });
    const run: RunState = { ...lobbyRun(), lobby: createRunLobby(4321, 'cia') };
    const seat = run.lobby!.seats.find((s) => s.kind === 'snapshot' && s.heroId === 'albus');
    expect(seat).toBeDefined();
    act(() => { useGame.setState({ run }); });
    const heard: EmoteMessage[] = [];
    const off = subscribeEmotes((m) => heard.push(m));
    ui = mount(<EmoteLayer />); // the shop turn starts now
    act(() => { vi.advanceTimersByTime(4199); });
    expect(heard).toEqual([]);
    act(() => { vi.advanceTimersByTime(2); });
    expect(heard).toEqual([{ emoteId: C, seat: seat!.id, phase: 'shop', offsetMs: 4200, round: 1 }]);
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(heard).toHaveLength(1); // the bots and generated seats never emote
    off();
  });
});

describe('the bubble sits by its speaker', () => {
  const stubRect = (el: Element, r: { left: number; top: number; width: number; height: number }): void => {
    (el as HTMLElement).getBoundingClientRect = () => ({ ...r, right: r.left + r.width, bottom: r.top + r.height, x: r.left, y: r.top, toJSON: () => ({}) }) as DOMRect;
  };
  const place = (html: string, sel: string, r: { left: number; top: number; width: number; height: number }): void => {
    const host = document.createElement('div');
    host.innerHTML = html;
    document.body.appendChild(host.firstElementChild!);
    stubRect(document.body.querySelector(sel)!, r);
  };

  it('yours: from your portrait\'s upper-right, art as painted (tail down-left)', () => {
    place('<div class="statusbar"><div class="hero"><div class="f"></div></div></div>', '.statusbar .hero .f', { left: 40, top: 800, width: 200, height: 200 });
    expect(showEmoteBubble('s0', RETIRED)).toBe(false); // a retired emote (an old recording, an old client) shows nothing
    expect(showEmoteBubble('s0', A)).toBe(true);
    const img = document.body.querySelector<HTMLElement>('.emote-bubble.self')!;
    expect(img.className).not.toMatch(/\bflip\b/);
    expect(img.getAttribute('aria-hidden')).toBe('true');
    expect(img.querySelector('img')!.getAttribute('src')).toMatch(/emote_flirty_midas/);
    const box = bubbleBox({ x: 40 + 200 - 60, y: 800 - 8, width: 300, flip: false });
    expect([img.style.left, img.style.top, img.style.width]).toEqual([`${box.left}px`, `${box.top}px`, '300px']);
    expect(box.left).toBeGreaterThan(40); // it opens to the right of the face
  });

  it('a rail seat: to the LEFT of its face, mirrored; a seat with no face on screen gets nothing', () => {
    place('<div class="lobbyseat" data-seat="s3"><span class="lobbyface"></span></div>', '.lobbyseat[data-seat="s3"] .lobbyface', { left: 1700, top: 300, width: 60, height: 60 });
    expect(showEmoteBubble('s3', B)).toBe(true);
    const img = document.body.querySelector<HTMLElement>('.emote-bubble.flip')!;
    expect(img.dataset.seat).toBe('s3');
    expect(Number.parseFloat(img.style.left) + Number.parseFloat(img.style.width)).toBeLessThan(1760);
    expect(showEmoteBubble('s5', B)).toBe(false);
    // a new emote from the same seat replaces its bubble
    expect(showEmoteBubble('s3', C)).toBe(true);
    expect(document.body.querySelectorAll('.emote-bubble[data-seat="s3"]')).toHaveLength(1);
  });

  it('in combat the rail is away: only the foe you fight shows one, beside the foe portrait', () => {
    place('<div class="lobbyseat" data-seat="s3"><span class="lobbyface"></span></div>', '.lobbyseat[data-seat="s3"] .lobbyface', { left: 1700, top: 300, width: 60, height: 60 });
    place('<div class="combatopp"><div class="combatopp-body"></div></div>', '.combatopp-body', { left: 1500, top: 120, width: 180, height: 180 });
    act(() => { useGame.setState({ combatStaged: true }); });
    expect(showEmoteBubble('s3', A)).toBe(false);
    setEmoteFoe('s3');
    expect(showEmoteBubble('s3', A)).toBe(true);
    expect(showEmoteBubble('s4', A)).toBe(false);
  });

  it('VERSUS shop (no rail): the opponent emote opens beside their block portrait, mirrored (R-EMOTE-VERSUS-SHOP-01)', () => {
    // The Versus shop draws the opponent's block (VersusFoe) where the rail would stand; there is no `.lobbyseat` row.
    place('<div class="vsfoe-face" data-seat="s1"><div class="combatopp-portrait vsfoe-disc"></div></div>', '.vsfoe-face[data-seat="s1"] .vsfoe-disc', { left: 1600, top: 380, width: 160, height: 160 });
    expect(showEmoteBubble('s1', A)).toBe(true);
    const el = document.body.querySelector<HTMLElement>('.emote-bubble[data-seat="s1"]')!;
    expect(el.className).toMatch(/\bflip\b/);
    expect(Number.parseFloat(el.style.left)).toBeLessThan(1600); // it opens to the LEFT of the face
    // your own bubble in the same shop still rises from your portrait
    place('<div class="statusbar"><div class="hero"><div class="f"></div></div></div>', '.statusbar .hero .f', { left: 40, top: 800, width: 200, height: 200 });
    expect(showEmoteBubble('s0', B)).toBe(true);
    // and in combat the same seat shows beside the combat foe portrait, as before
    place('<div class="combatopp"><div class="combatopp-body"></div></div>', '.combatopp-body', { left: 1500, top: 120, width: 180, height: 180 });
    act(() => { useGame.setState({ combatStaged: true }); });
    setEmoteFoe('s1');
    expect(showEmoteBubble('s1', C)).toBe(true);
  });

  it('an unknown emote id (a newer client\'s) shows nothing', () => {
    place('<div class="statusbar"><div class="hero"><div class="f"></div></div></div>', '.statusbar .hero .f', { left: 40, top: 800, width: 200, height: 200 });
    expect(showEmoteBubble('s0', 'emote_from_the_future')).toBe(false);
  });
});
