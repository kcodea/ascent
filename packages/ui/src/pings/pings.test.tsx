// @vitest-environment jsdom
/**
 * LIVE PINGS + MENTORS, the client (R-PING-01..05; owner 2026-10-29). Pins:
 *  - send / receive per mode: a solo player's ping is a local note; a watched player's reaches the stream; a Duos
 *    teammate's shows; an opponent's never does; a mentor ping only reaches its player, only from that player's mentor;
 *  - mentor promote / demote, re-announced, and the player as the authority on its own mentor;
 *  - who may open the menu (pingContext): a player in a game, a mentor on the watch screen; never a plain spectator,
 *    a replay or the menus (there right-click goes straight to Inspect);
 *  - the rate limit, the anchor (by uid, in its zone), clearing on a click / a drag, the menu layouts, the phone hold.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../identity', async (orig) => ({ ...(await orig<typeof import('../identity')>()), currentUserId: () => 'me' }));
import { PING_CLEAR_EVENT, PING_EVENT, PING_MENTOR_EVENT, routePing, type PingMessage } from '@game/versus-cf/pings';
import { useGame } from '../store';
import { useSpectate } from '../versus/spectate';
import { setWatchers } from '../versus/watchers';
import { holdFiresOn, setCardHoldGate } from '../touchInput';
import {
  acceptPing,
  clearPing,
  clearPingsOnCard,
  expirePings,
  pingContext,
  receivePing,
  receivePingEvent,
  resetPingRuntimeForTests,
  sendPing,
  setMyMentor,
  setPingClockForTests,
  setPingSession,
  useMentors,
  usePings,
} from './pingRuntime';
import { cardZoneOf, fanOptions, fanPositions, openCardPingMenu, PING_DOUBLE_MS, pingAnchorOf, resetPingDoubleForTests, usePingMenu } from './PingLayer';

let now = 1_000_000;
const sent: { e: string; p: unknown }[] = [];
const msg = (over: Partial<PingMessage> = {}): PingMessage => ({ id: 'x.1', kind: 'check', owner: 'p1', target: { t: 'card', uid: '7', zone: 'shop' }, from: 'friend', ...over });

function inGame(): void {
  const g = useGame.getState();
  useGame.setState({ showTitle: false, replaying: false, run: { ...g.run, phase: 'recruit' } });
}
function session(seat: 'p1' | 'p2' | 'p3' | 'p4' | null, mode: 'duel' | 'duos' | 'lobby' = 'duel', gameKey = 'g1'): void {
  setPingSession('test', { send: (e, p) => { sent.push({ e, p }); }, seat: () => seat, mode: () => mode, gameKey });
}

beforeEach(() => {
  now = 1_000_000;
  sent.length = 0;
  setPingClockForTests(() => now);
  resetPingRuntimeForTests();
  resetPingDoubleForTests();
  useSpectate.setState({ active: false, seat: 'p1', teammate: false, hero: null, teammateHero: false });
  setWatchers([]);
  inGame();
});
afterEach(() => {
  setPingSession('test', null);
  setPingClockForTests(null);
  usePingMenu.setState({ open: null });
  document.body.innerHTML = '';
});

describe('sending (R-PING-01)', () => {
  it('a solo player pings with no stream: a local note to self', () => {
    expect(pingContext()).toEqual({ owner: 'p1', role: 'self' });
    expect(sendPing('check', { t: 'card', uid: '7', zone: 'shop' })).toBe(true);
    expect(usePings.getState().list).toHaveLength(1);
    expect(usePings.getState().list[0]).toMatchObject({ mine: true, role: 'self', owner: 'p1' });
  });

  it('a seated player in a game sends on the stream as self (spectators see it)', () => {
    session('p2');
    expect(sendPing('sell', { t: 'button', id: 'refresh' })).toBe(false); // a button takes Check, X, Question only
    sendPing('question', { t: 'button', id: 'refresh' });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.e).toBe(PING_EVENT);
    expect(sent[0]!.p).toMatchObject({ kind: 'question', owner: 'p2', role: 'self', target: { t: 'button', id: 'refresh' } });
  });

  it('rate limit: 3 pings per 2 s per sender', () => {
    const t = { t: 'card' as const, uid: '7', zone: 'shop' as const };
    expect([sendPing('check', t), sendPing('x', t), sendPing('pass', t), sendPing('sell', t)]).toEqual([true, true, true, false]);
    now += 2001;
    expect(sendPing('check', t)).toBe(true);
  });

  it('outside a game (menus, a replay) there is no ping menu', () => {
    useGame.setState({ showTitle: true });
    expect(pingContext()).toBeNull();
    useGame.setState({ showTitle: false, replaying: true });
    expect(pingContext()).toBeNull();
  });
});

describe('receiving per mode (R-PING-02)', () => {
  it('Duos: my teammate\'s ping on my board shows; the other team\'s never does', () => {
    session('p1', 'duos');
    expect(receivePingEvent(PING_EVENT, msg({ owner: 'p1', role: 'mate', from: 'amy' }))).toBe(true);
    expect(usePings.getState().list).toHaveLength(1);
    receivePingEvent(PING_EVENT, msg({ id: 'y.1', owner: 'p3', role: 'self', from: 'bob' }));
    expect(usePings.getState().list).toHaveLength(1);
  });

  it('1v1: an opponent\'s ping is never shown to the other player', () => {
    session('p1', 'duel');
    receivePingEvent(PING_EVENT, msg({ owner: 'p2', role: 'self', from: 'bob' }));
    expect(usePings.getState().list).toHaveLength(0);
  });

  it('a spectator sees the watched player\'s own pings, never a mentor ping', () => {
    session(null, 'lobby');
    receivePingEvent(PING_EVENT, msg({ role: 'self', from: 'ann' }));
    expect(usePings.getState().list).toHaveLength(1);
    receivePingEvent(PING_EVENT, msg({ id: 'm.1', role: 'mentor', from: 'sam' }));
    expect(usePings.getState().list).toHaveLength(1);
  });

  it('a mentor ping reaches the player only from the mentor they named', () => {
    session('p1', 'lobby');
    receivePingEvent(PING_EVENT, msg({ role: 'mentor', from: 'sam' }));
    expect(usePings.getState().list).toHaveLength(0); // no mentor yet
    setWatchers([{ id: 'sam', name: 'Sam', profile: null }, { id: 'tia', name: 'Tia', profile: null }]);
    setMyMentor({ id: 'sam', name: 'Sam' });
    receivePingEvent(PING_EVENT, msg({ id: 'm.2', role: 'mentor', from: 'tia' }));
    expect(usePings.getState().list).toHaveLength(0); // not my mentor
    receivePingEvent(PING_EVENT, msg({ id: 'm.3', role: 'mentor', from: 'sam' }));
    expect(usePings.getState().list).toHaveLength(1);
    expect(usePings.getState().list[0]).toMatchObject({ role: 'mentor', mine: false });
  });

  it('receivers rate limit each sender too', () => {
    session(null, 'lobby');
    for (let i = 0; i < 5; i++) receivePingEvent(PING_EVENT, msg({ id: `r.${i}`, from: 'ann', target: { t: 'card', uid: String(i), zone: 'board' } }));
    expect(usePings.getState().list).toHaveLength(3);
  });

  it('acceptPing is the server rule, client side', () => {
    const none = () => null;
    expect(acceptPing(msg({ role: 'mentor', from: 'sam' }), { mySeat: 'p1', mode: 'lobby', mentorOf: () => 'sam' })).toBe(true);
    expect(acceptPing(msg({ role: 'mentor', from: 'sam' }), { mySeat: null, mode: 'lobby', mentorOf: () => 'sam' })).toBe(false);
    expect(acceptPing(msg({ owner: 'p4' }), { mySeat: 'p3', mode: 'duos', mentorOf: none })).toBe(true);
    expect(acceptPing(msg({ owner: 'p2' }), { mySeat: 'p3', mode: 'duos', mentorOf: none })).toBe(false);
  });
});

describe('mentors (R-PING-03)', () => {
  it('promote, announce, demote; one at a time; the stands label follows', () => {
    session('p1', 'lobby');
    setWatchers([{ id: 'sam', name: 'Sam', profile: null }, { id: 'tia', name: 'Tia', profile: null }]);
    expect(setMyMentor({ id: 'sam', name: 'Sam' })).toBe(true);
    expect(useMentors.getState().bySeat.p1).toEqual({ id: 'sam', name: 'Sam' });
    expect(sent.at(-1)).toEqual({ e: PING_MENTOR_EVENT, p: { seat: 'p1', mentor: 'sam', name: 'Sam' } });
    setMyMentor({ id: 'tia', name: 'Tia' });
    expect(useMentors.getState().bySeat.p1?.id).toBe('tia');
    setMyMentor(null);
    expect(useMentors.getState().bySeat.p1).toBeUndefined();
    expect(sent.at(-1)).toEqual({ e: PING_MENTOR_EVENT, p: { seat: 'p1', mentor: null } });
  });

  it('a mentor who leaves the stands is demoted; a new game forgets the mentor', () => {
    session('p1', 'lobby');
    setWatchers([{ id: 'sam', name: 'Sam', profile: null }]);
    setMyMentor({ id: 'sam', name: 'Sam' });
    setWatchers([{ id: 'tia', name: 'Tia', profile: null }]);
    expect(useMentors.getState().bySeat.p1).toBeUndefined();
    setWatchers([{ id: 'sam', name: 'Sam', profile: null }]);
    setMyMentor({ id: 'sam', name: 'Sam' });
    session('p1', 'lobby', 'g2');
    expect(useMentors.getState().bySeat.p1).toBeUndefined();
  });

  it('the player is the authority on its own mentor: a forged mentor message for my seat is ignored', () => {
    session('p1', 'lobby');
    receivePingEvent(PING_MENTOR_EVENT, { seat: 'p1', mentor: 'mallory' });
    expect(useMentors.getState().bySeat.p1).toBeUndefined();
  });

  it('a spectator named mentor may ping the watched screen; a plain spectator may not', () => {
    session(null, 'lobby');
    useSpectate.setState({ active: true, seat: 'p1' });
    expect(pingContext()).toBeNull();
    receivePingEvent(PING_MENTOR_EVENT, { seat: 'p1', mentor: 'me', name: 'Me' });
    expect(pingContext()).toEqual({ owner: 'p1', role: 'mentor' });
    receivePingEvent(PING_MENTOR_EVENT, { seat: 'p1', mentor: null });
    expect(pingContext()).toBeNull();
  });

  it('Duos: watching my teammate, I ping their screen as their mate', () => {
    session('p1', 'duos');
    useSpectate.setState({ active: true, seat: 'p2', teammate: true });
    expect(pingContext()).toEqual({ owner: 'p2', role: 'mate' });
  });
});

// R-PING-06 (owner 2026-10-29: "players should be able to ping their teammates board/minions etc as well"). The watch
// screen (the teammate view, the mentor's screen) sets `replaying` so nothing commits against the synthetic run; the
// menu used to read that as "a replay" and close, so neither a teammate nor a mentor could ever ping there.
describe('pinging on the watch screen as it really is (`replaying` set by spectate.ts)', () => {
  const watchScreen = (seat: 'p1' | 'p2', teammate: boolean): void => {
    useGame.setState({ replaying: true });
    useSpectate.setState({ active: true, seat, teammate });
  };

  it('the teammate view: the menu opens on their shop, board and hand, and the ping is sent as mate', () => {
    session('p1', 'duos');
    watchScreen('p2', true);
    expect(pingContext()).toEqual({ owner: 'p2', role: 'mate' });
    document.body.innerHTML = `
      <div data-zone="tavern"><div class="card" data-uid="t1"></div></div>
      <div data-zone="warband"><div class="row"><div class="card" data-uid="w1"></div></div></div>
      <div data-zone="hand"><div class="row hand"><div class="card" data-uid="h1"></div></div></div>`;
    for (const [uid, zone] of [['t1', 'shop'], ['w1', 'board'], ['h1', 'hand']] as const) {
      const el = document.querySelector(`[data-uid="${uid}"]`)!;
      expect(openCardPingMenu({ clientX: 5, clientY: 5, currentTarget: el }, uid, () => undefined)).toBe(true);
      expect(usePingMenu.getState().open?.target).toEqual({ t: 'card', uid, zone });
      usePingMenu.setState({ open: null });
    }
    expect(sendPing('question', { t: 'card', uid: 'w1', zone: 'board' })).toBe(true);
    expect(sent[0]!.p).toMatchObject({ owner: 'p2', role: 'mate', target: { t: 'card', uid: 'w1', zone: 'board' } });
    // ...and it shows on MY screen (the teammate's, on display) at once.
    expect(usePings.getState().list[0]).toMatchObject({ owner: 'p2', role: 'mate', mine: true });
  });

  it('the server rule delivers it to the teammate and the stands, never the other team', () => {
    session('p1', 'duos');
    watchScreen('p2', true);
    sendPing('check', { t: 'card', uid: 'h1', zone: 'hand' });
    const room = { mode: 'duos' as const, mentors: {}, members: [
      { userId: 'ann', role: 'p1' }, { userId: 'amy', role: 'p2' }, { userId: 'cy', role: 'p3' }, { userId: 'di', role: 'p4' }, { userId: 'sam', role: 'spectator' },
    ] };
    const route = routePing(room, 'ann', sent[0]!.p); // sent from my client (Ann, p1); the server stamps who sent it
    expect(route.ok).toBe(true);
    if (!route.ok) return;
    expect(route.ping.role).toBe('mate');
    expect(new Set(route.to)).toEqual(new Set(['amy', 'sam']));
    // The teammate's client (p2, on its own screen) shows it on its own hand card.
    resetPingRuntimeForTests();
    useGame.setState({ replaying: false });
    useSpectate.setState({ active: false, seat: 'p1', teammate: false });
    session('p2', 'duos');
    expect(receivePing(route.ping)).toBe(true);
    expect(usePings.getState().list[0]).toMatchObject({ owner: 'p2', role: 'mate', mine: false });
    // The other team's client never shows it (the Supabase relay cannot filter, so the receiver re-checks).
    resetPingRuntimeForTests();
    session('p3', 'duos');
    expect(receivePing(route.ping)).toBe(false);
  });

  it("a mentor pings the watched player's screen there too; a recorded replay still has no menu", () => {
    session(null, 'lobby');
    watchScreen('p1', false);
    receivePingEvent(PING_MENTOR_EVENT, { seat: 'p1', mentor: 'me', name: 'Me' });
    expect(pingContext()).toEqual({ owner: 'p1', role: 'mentor' });
    useSpectate.setState({ active: false });
    expect(pingContext()).toBeNull(); // replaying, not the watch screen
    useGame.setState({ replaySession: {} as never, replaying: true });
    useSpectate.setState({ active: true });
    expect(pingContext()).toBeNull(); // a replay session never pings
    useGame.setState({ replaySession: null });
  });
});

describe('the layer (R-PING-04/05)', () => {
  function board(): HTMLElement {
    document.body.innerHTML = `
      <div data-zone="tavern"><div class="card" data-uid="7"></div></div>
      <div data-zone="warband"><div class="row"><div class="card" data-uid="9"></div></div></div>
      <div data-zone="hand"><div class="row hand"><div class="card" data-uid="11"></div></div></div>
      <div class="discover"><div class="card" data-uid="13"></div></div>
      <button data-spec="upgrade"></button>`;
    return document.body;
  }

  it('anchors a ping by uid in its zone (it follows the card; a card gone from its zone is not found)', () => {
    board();
    expect(pingAnchorOf({ t: 'card', uid: '9', zone: 'board' })?.getAttribute('data-uid')).toBe('9');
    expect(pingAnchorOf({ t: 'button', id: 'upgrade' })?.tagName).toBe('BUTTON');
    // the card is re-mounted elsewhere in the zone (a reorder re-render): still found
    const row = document.querySelector('[data-zone="warband"] .row')!;
    row.innerHTML = '<div class="card" data-uid="1"></div><div class="card" data-uid="9"></div>';
    expect(pingAnchorOf({ t: 'card', uid: '9', zone: 'board' })).toBe(row.children[1]);
    // played / sold out of the zone: gone
    row.innerHTML = '';
    expect(pingAnchorOf({ t: 'card', uid: '9', zone: 'board' })).toBeNull();
  });

  it('right-click opens the menu on a play-zone card, else inspects straight away', () => {
    board();
    const inspect = vi.fn();
    const shop = document.querySelector('[data-uid="7"]')!;
    expect(openCardPingMenu({ clientX: 10, clientY: 10, currentTarget: shop }, '7', inspect)).toBe(true);
    expect(usePingMenu.getState().open?.target).toEqual({ t: 'card', uid: '7', zone: 'shop' });
    const discover = document.querySelector('[data-uid="13"]')!;
    expect(openCardPingMenu({ clientX: 10, clientY: 10, currentTarget: discover }, '13', inspect)).toBe(false);
    useGame.setState({ showTitle: true }); // the menus / Compendium
    expect(openCardPingMenu({ clientX: 10, clientY: 10, currentTarget: shop }, '7', inspect)).toBe(false);
    expect(cardZoneOf(document.querySelector('[data-uid="11"]')!)).toBe('hand');
  });

  it('a DOUBLE right-click on a card inspects (owner 2026-10-29): the fan goes at once, no menu is left open', () => {
    board();
    const inspect = vi.fn();
    const shop = document.querySelector('[data-uid="7"]')!;
    const hand = document.querySelector('[data-uid="11"]')!;
    const at = { clientX: 10, clientY: 10 };
    const t0 = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(t0);
    expect(openCardPingMenu({ ...at, currentTarget: shop }, '7', inspect)).toBe(true);
    expect(usePingMenu.getState().open).not.toBeNull();
    expect(inspect).not.toHaveBeenCalled();
    clock.mockReturnValue(t0 + 200);
    expect(openCardPingMenu({ ...at, currentTarget: shop }, '7', inspect)).toBe(true);
    expect(inspect).toHaveBeenCalledTimes(1);
    expect(usePingMenu.getState().open).toBeNull();
    // Too slow: the second right-click opens the fan again, no Inspect.
    clock.mockReturnValue(t0 + 1000);
    openCardPingMenu({ ...at, currentTarget: shop }, '7', inspect);
    clock.mockReturnValue(t0 + 1000 + PING_DOUBLE_MS + 1);
    openCardPingMenu({ ...at, currentTarget: shop }, '7', inspect);
    expect(inspect).toHaveBeenCalledTimes(1);
    expect(usePingMenu.getState().open?.target).toEqual({ t: 'card', uid: '7', zone: 'shop' });
    // A second right-click on ANOTHER card is a new fan, not a double.
    clock.mockReturnValue(t0 + 5000);
    openCardPingMenu({ ...at, currentTarget: shop }, '7', inspect);
    clock.mockReturnValue(t0 + 5100);
    openCardPingMenu({ ...at, currentTarget: hand }, '11', inspect);
    expect(inspect).toHaveBeenCalledTimes(1);
    expect(usePingMenu.getState().open?.target).toEqual({ t: 'card', uid: '11', zone: 'hand' });
    clock.mockRestore();
  });

  it('phone: a hold on a play-zone card fires (opens the menu) only while pings are available', () => {
    board();
    const hand = document.querySelector('[data-uid="11"]')!;
    expect(holdFiresOn(hand)).toBe(false);
    setCardHoldGate((el) => !!pingContext() && !!cardZoneOf(el));
    expect(holdFiresOn(hand)).toBe(true);
    useGame.setState({ showTitle: true });
    expect(holdFiresOn(hand)).toBe(false);
    setCardHoldGate(null);
  });

  it('a ping is cleared by a click on it, or when its card is dragged', () => {
    sendPing('check', { t: 'card', uid: '7', zone: 'shop' });
    sendPing('x', { t: 'card', uid: '9', zone: 'board' });
    const [a] = usePings.getState().list;
    clearPing(a!.key);
    expect(usePings.getState().list.map((p) => p.kind)).toEqual(['x']);
    clearPingsOnCard('9');
    expect(usePings.getState().list).toHaveLength(0);
  });

  it('a clear travels: my click or drag tells the other screens; theirs clears mine; an opponent clear never does', () => {
    session('p1', 'duos');
    sendPing('check', { t: 'card', uid: '7', zone: 'shop' });
    clearPing(usePings.getState().list[0]!.key);
    expect(sent.filter((x) => x.e === PING_CLEAR_EVENT).map((x) => x.p)).toEqual([{ owner: 'p1', target: { t: 'card', uid: '7', zone: 'shop' } }]);
    sent.length = 0;
    sendPing('x', { t: 'card', uid: '9', zone: 'board' });
    clearPingsOnCard('9');
    expect(sent.filter((x) => x.e === PING_CLEAR_EVENT)).toHaveLength(1);
    // My teammate's ping on my card, cleared on their screen: it goes from mine too.
    receivePingEvent(PING_EVENT, msg({ owner: 'p1', from: 'amy', role: 'mate' }));
    expect(usePings.getState().list).toHaveLength(1);
    receivePingEvent(PING_CLEAR_EVENT, { owner: 'p3', target: { t: 'card', uid: '7', zone: 'shop' } });
    expect(usePings.getState().list).toHaveLength(1);
    receivePingEvent(PING_CLEAR_EVENT, { owner: 'p1', target: { t: 'card', uid: '7', zone: 'shop' } });
    expect(usePings.getState().list).toHaveLength(0);
  });

  it('a plain spectator clears only on their own screen (nothing sent)', () => {
    session(null);
    useSpectate.setState({ active: true, seat: 'p1' });
    receivePingEvent(PING_EVENT, msg());
    clearPing(usePings.getState().list[0]!.key);
    expect(usePings.getState().list).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });

  it('a ping lasts 5 s if nobody clears it (owner 2026-10-29), timed locally from its arrival on each screen, nothing sent', () => {
    session('p1', 'duos');
    sendPing('check', { t: 'card', uid: '7', zone: 'shop' });
    now += 3000;
    receivePingEvent(PING_EVENT, msg({ owner: 'p1', from: 'amy', role: 'mate', target: { t: 'card', uid: '9', zone: 'board' } }));
    expirePings(now + 1999);
    expect(usePings.getState().list).toHaveLength(2);
    expirePings(now + 2000); // my ping: 5 s since it landed here
    expect(usePings.getState().list.map((p) => p.mine)).toEqual([false]);
    expirePings(now + 5000); // the teammate's: 5 s since it ARRIVED here, not since it was sent
    expect(usePings.getState().list).toHaveLength(0);
    expect(sent.filter((x) => x.e !== PING_EVENT)).toHaveLength(0); // the timer sends nothing (no clear)
  });

  it('the fan (owner 2026-10-29): Check, X, Question above; Pass and Sell below (no Inspect); a shop button gets the top three only', () => {
    expect(fanOptions(true)).toEqual({ top: ['check', 'x', 'question'], bottom: ['pass', 'sell'] });
    expect(fanOptions(false)).toEqual({ top: ['check', 'x', 'question'], bottom: [] });
    const box = { left: 100, top: 200, width: 120, height: 160, right: 220, bottom: 360, x: 100, y: 200 };
    const card = fanPositions({ top: 3, bottom: 2 }, { x: 160, y: 280, box });
    expect(card.slice(0, 3).every((p) => p.y < box.top)).toBe(true);
    expect(card.slice(3).every((p) => p.y > box.bottom)).toBe(true);
    // Left to right in the top arc, the middle bowing furthest out.
    expect(card[0]!.x < card[1]!.x && card[1]!.x < card[2]!.x).toBe(true);
    expect(card[1]!.y < card[0]!.y).toBe(true);
    // Pass left, Sell right, level, spaced evenly about the card's centre.
    expect(card[3]!.x).toBeLessThan(160);
    expect(card[4]!.x).toBeGreaterThan(160);
    expect(card[3]!.y).toBe(card[4]!.y);
    expect(160 - card[3]!.x).toBeCloseTo(card[4]!.x - 160, 6);
    const button = fanPositions({ top: 3, bottom: 0 }, { x: 160, y: 280, box });
    expect(button).toHaveLength(3);
    expect(button.every((p) => p.y < box.top)).toBe(true);
  });
});
