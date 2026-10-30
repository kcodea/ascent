// @vitest-environment jsdom
/**
 * LIVE PINGS ON UI SPOTS (R-PING-08; owner 2026-10-30: "mentors/players should be able to ping discover card options,
 * runes etc as well. please fix that"). Pins:
 *  - the keys are semantic (option index + id + a signature of the whole offer), so each viewer finds the spot on its own
 *    layout, and a different offer never inherits a ping;
 *  - a right-click on a Discover option (and every other spot) opens the fan with a `ui` target, a double right-click
 *    reaches the spot's own right-click (a card option's Inspect), and the ping travels as `{ t: 'ui', k }`;
 *  - the ping sits on the spot on the receiver's screen and clears when the spot leaves (Discover closed, option taken);
 *  - the player keeps their own right-click on `data-ping-own` spots (emotes, the scout pin) and their phone hold on a
 *    choice option (its Inspect); a teammate or mentor gets the fan there;
 *  - an older client ignores the new target kind.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../identity', async (orig) => ({ ...(await orig<typeof import('../identity')>()), currentUserId: () => 'me' }));
import { PING_MENTOR_EVENT, parsePing } from '@game/versus-cf/pings';
import { useGame } from '../store';
import { useSpectate } from '../versus/spectate';
import { setWatchers } from '../versus/watchers';
import { receivePing, receivePingEvent, resetPingRuntimeForTests, sendPing, setMyMentor, setPingClockForTests, setPingSession, usePings } from './pingRuntime';
import { openCardPingMenu, pingAnchorOf, resetPingDoubleForTests, spotYields, uiSpotOf, usePingMenu } from './PingLayer';
import { discKey, forgeKey, offerSig, pingKey, powKey, railKey, runeKey } from './pingKeys';

let now = 1_000_000;
const sent: { e: string; p: unknown }[] = [];
function session(seat: 'p1' | 'p2' | null, mode: 'duel' | 'duos' | 'lobby' = 'duel'): void {
  setPingSession('test', { send: (e, p) => { sent.push({ e, p }); }, seat: () => seat, mode: () => mode, gameKey: 'g1' });
}

beforeEach(() => {
  now = 1_000_000;
  sent.length = 0;
  setPingClockForTests(() => now);
  resetPingRuntimeForTests();
  resetPingDoubleForTests();
  useSpectate.setState({ active: false, seat: 'p1', teammate: false, hero: null, teammateHero: false });
  setWatchers([]);
  const g = useGame.getState();
  useGame.setState({ showTitle: false, replaying: false, replaySession: null, run: { ...g.run, phase: 'recruit' } });
});
afterEach(() => {
  setPingSession('test', null);
  setPingClockForTests(null);
  usePingMenu.setState({ open: null });
  document.body.innerHTML = '';
});

const OFFER = ['alleycat', 'tabbycat', 'alleycat'];
/** A Discover the way DiscoverDialog draws it: each option a `.disc-slot` with its key, the card inside it clickable. */
function discover(ids: readonly string[] = OFFER): void {
  document.body.innerHTML = `<div class="discover-ov">${ids.map((id, i) => `<div class="disc-slot" data-ping="${discKey(ids, i)}"><div class="card" role="button" data-c="${id}"></div></div>`).join('')}</div>`;
}
const optCard = (i: number): Element => document.querySelectorAll('.disc-slot .card')[i]!;

describe('the keys (R-PING-08)', () => {
  it('name the option by index, id and the offer: the same card twice is two spots; a new offer is new keys', () => {
    expect(discKey(OFFER, 0)).not.toBe(discKey(OFFER, 2));
    expect(discKey(OFFER, 0)).not.toBe(discKey(['alleycat', 'foo', 'bar'], 0));
    expect(discKey(OFFER, 1)).toBe(`disc:1:tabbycat:${offerSig(OFFER)}`);
    expect(powKey(OFFER, 1)).not.toBe(discKey(OFFER, 1));
    expect(forgeKey('rune_wealth', 2)).toBe('forge:2:rune_wealth');
    expect(runeKey('rune_wealth', 0)).toBe('rune:0:rune_wealth');
    expect(railKey('s3')).toBe('rail:s3');
    // Anything a selector or the wire rule would choke on is stripped; every key passes the server's own parse.
    expect(pingKey('quest', 'a"b c]')).toBe('quest:abc');
    for (const k of [discKey(OFFER, 0), powKey(OFFER, 2), forgeKey('x', 0), railKey('s1'), 'hero', 'mate', 'equip', 'heropower2']) {
      expect(parsePing({ id: 'a.1', kind: 'check', owner: 'p1', target: { t: 'ui', k }, from: 'me' })?.target).toEqual({ t: 'ui', k });
    }
  });
});

describe('pinging a Discover option (owner 2026-10-30)', () => {
  it('the player: right-click opens the fan on the option, the ping goes out as a ui target, a double right-click inspects', () => {
    session('p1');
    discover();
    const inspect = vi.fn();
    expect(openCardPingMenu({ clientX: 5, clientY: 5, currentTarget: optCard(1) }, null, inspect)).toBe(true);
    const k = discKey(OFFER, 1)!;
    expect(usePingMenu.getState().open?.target).toEqual({ t: 'ui', k });
    expect(usePingMenu.getState().open?.inspect).toBe(inspect);
    // The double: the fan goes at once and the card's Inspect opens.
    now += 100;
    expect(openCardPingMenu({ clientX: 5, clientY: 5, currentTarget: optCard(1) }, null, inspect)).toBe(true);
    expect(inspect).toHaveBeenCalledTimes(1);
    expect(usePingMenu.getState().open).toBeNull();
    // The fan takes the top three only.
    expect(sendPing('sell', { t: 'ui', k })).toBe(false);
    expect(sendPing('check', { t: 'ui', k })).toBe(true);
    expect(sent.at(-1)!.p).toMatchObject({ owner: 'p1', role: 'self', target: { t: 'ui', k } });
    expect(pingAnchorOf({ t: 'ui', k })).toBe(document.querySelectorAll('.disc-slot')[1]);
  });

  it('a mentor watching the player pings the SAME option; the player sees it on that option on their own screen', () => {
    // The mentor's client, on the watch screen (spectate.ts sets `replaying` there).
    session(null, 'lobby');
    useGame.setState({ replaying: true });
    useSpectate.setState({ active: true, seat: 'p1' });
    receivePingEvent(PING_MENTOR_EVENT, { seat: 'p1', mentor: 'me', name: 'Me' });
    discover();
    expect(openCardPingMenu({ clientX: 5, clientY: 5, currentTarget: optCard(2) }, null, () => undefined)).toBe(true);
    const target = usePingMenu.getState().open!.target;
    expect(sendPing('question', target)).toBe(true);
    const wire = sent.at(-1)!.p as Record<string, unknown>;
    expect(wire).toMatchObject({ role: 'mentor', owner: 'p1', target: { t: 'ui', k: discKey(OFFER, 2) } });
    // The player's client: the mentor ping lands on option 3 of THEIR Discover (their own layout).
    resetPingRuntimeForTests();
    useGame.setState({ replaying: false });
    useSpectate.setState({ active: false });
    session('p1', 'lobby');
    setWatchers([{ id: 'me2', name: 'Mentor', profile: null }]);
    setMyMentor({ id: 'me2', name: 'Mentor' });
    expect(receivePing({ ...wire, from: 'me2' })).toBe(true);
    const shown = usePings.getState().list[0]!;
    expect(shown).toMatchObject({ role: 'mentor', target: { t: 'ui', k: discKey(OFFER, 2) } });
    discover();
    expect(pingAnchorOf(shown.target)).toBe(document.querySelectorAll('.disc-slot')[2]);
    // The Discover closed (the option was taken): its spot is gone, and the next offer's keys are new.
    discover(['foo', 'bar', 'baz']);
    expect(pingAnchorOf(shown.target)).toBeNull();
  });

  it('where pings are off (the menus, a plain spectator) a right-click on an option inspects at once, as before', () => {
    discover();
    useGame.setState({ showTitle: true });
    expect(openCardPingMenu({ clientX: 5, clientY: 5, currentTarget: optCard(0) }, null, () => undefined)).toBe(false);
    useGame.setState({ showTitle: false });
    session(null, 'lobby');
    useGame.setState({ replaying: true });
    useSpectate.setState({ active: true, seat: 'p1' });
    expect(openCardPingMenu({ clientX: 5, clientY: 5, currentTarget: optCard(0) }, null, () => undefined)).toBe(false);
  });

  it('an Inspect copy or a hover popup of an option is never a spot', () => {
    document.body.innerHTML = `<div class="inspect-ov"><div data-ping="disc:0:x:y"><div class="card"></div></div></div>`;
    expect(uiSpotOf(document.querySelector('.card'))).toBeNull();
    expect(pingAnchorOf({ t: 'ui', k: 'disc:0:x:y' })).toBeNull();
  });
});

describe('spots that keep their own right-click (R-PING-08)', () => {
  it('the player keeps the emotes / scout pin and the phone hold on an option; a teammate or mentor gets the fan', () => {
    document.body.innerHTML = `
      <div class="f" data-ping="hero" data-ping-own=""></div>
      <div class="disc-slot" data-ping="disc:0:a:b"><div class="card" role="button"></div></div>
      <div class="rfe-slot" data-ping="forge:0:r"><button class="runecard"></button></div>
      <div class="questbadge" data-ping="quest:q"></div>`;
    const spot = (sel: string): { el: Element } => ({ el: document.querySelector(sel)! });
    const self = { role: 'self' }, mentor = { role: 'mentor' }, mate = { role: 'mate' };
    expect(spotYields(spot('.f'), self, false)).toBe(true);
    expect(spotYields(spot('.f'), mentor, false)).toBe(false);
    expect(spotYields(spot('.f'), mate, true)).toBe(false);
    expect(spotYields(spot('.disc-slot'), self, false)).toBe(false); // a mouse: the fan (double right-click inspects)
    expect(spotYields(spot('.disc-slot'), self, true)).toBe(true); // a phone: the hold stays its Inspect
    expect(spotYields(spot('.rfe-slot'), self, true)).toBe(true);
    expect(spotYields(spot('.disc-slot'), mentor, true)).toBe(false);
    expect(spotYields(spot('.questbadge'), self, true)).toBe(false);
    expect(spotYields(spot('.questbadge'), null, false)).toBe(true); // no pings here at all
  });

  it('the layer: right-click on a rune badge opens the fan and stops the spot\'s own handler; a double lets it through', async () => {
    const { act } = await import('react');
    const { createRoot } = await import('react-dom/client');
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const { PingLayer } = await import('./PingLayer');
    session('p1');
    document.body.innerHTML = `<div class="questbadge runebadge" data-ping="rune:0:rune_wealth"><span class="questbadge-inner"></span></div>`;
    const own = vi.fn();
    document.querySelector('.runebadge')!.addEventListener('contextmenu', own);
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => root.render(<PingLayer />));
    const fire = (): MouseEvent => { const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 1, clientY: 1 }); act(() => { document.querySelector('.questbadge-inner')!.dispatchEvent(ev); }); return ev; };
    const a = fire();
    expect(a.defaultPrevented).toBe(true);
    expect(own).not.toHaveBeenCalled();
    expect(usePingMenu.getState().open?.target).toEqual({ t: 'ui', k: 'rune:0:rune_wealth' });
    fire(); // the double: the fan closes and the spot's own right-click runs
    expect(usePingMenu.getState().open).toBeNull();
    expect(own).toHaveBeenCalledTimes(1);
    // A ping on it renders INSIDE the spot (so it rides the layout of each screen), and goes when the spot does.
    act(() => { sendPing('x', { t: 'ui', k: 'rune:0:rune_wealth' }); });
    expect(document.querySelector('.runebadge .ping-mark.pm-ui')).not.toBeNull();
    act(() => root.unmount());
  });
});

describe('older clients (backward compatible)', () => {
  it('a ui target an older build cannot read is simply dropped (its parser answers null for an unknown kind)', () => {
    // This build reads `ui`; an unknown kind from a newer build is dropped the same way an older build drops `ui`.
    expect(receivePing({ id: 'z.1', kind: 'check', owner: 'p1', target: { t: 'later', k: 'x' }, from: 'friend' })).toBe(false);
    expect(usePings.getState().list).toHaveLength(0);
  });
});
