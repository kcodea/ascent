// @vitest-environment jsdom
/**
 * THE SPECTATOR'S HUD, EMOTES AND LOCAL PANELS (owner 2026-10-16, via the coordinator). Pinned:
 *  - R-SPECTATE-EMOTE-01: a spectator's emote goes out on the spectate channel (`{ e, from }`, no timestamp) with the
 *    player's own cooldown, and pops from that spectator's chip in the player's "Spectating" indicator; the receiver
 *    refuses an unknown sender (held a moment for their row), a second one inside the cooldown on its OWN clock, a burst,
 *    a muted spectator and everything while "Spectator emotes" is off. Fellow spectators are the other room spectators.
 *  - R-SPECTATE-HUD-01: top left is ME as a spectator (my plate, Spectating, Leave); the watched player and the switcher
 *    are bottom right (Versus: the two seat buttons; a live game: one compact name + rank plate).
 *  - R-SPECTATE-CURSOR-02: no bare keyword cursor anywhere in the spectator HUD or the watchers indicator.
 *  - R-SPECTATE-LOCAL-01: a spectator flips the rail to their guides, reads them (no Edit), pins a scout card, all
 *    without sending anything; the player's hover never opens a rail card on the spectator's screen; the fight's odds
 *    are the player's own numbers, carried on the channel, and the watch screen runs no probe.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createLobbyRun, type CombatOdds } from '@game/sim';
import { mount, type Mounted } from '../renderedText.mount';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });
vi.mock('../identity', async (orig) => ({ ...(await orig<typeof import('../identity')>()), currentUserId: () => 'spec-me' }));

const { useGame } = await import('../store');
const rt = await import('../emotes/emoteRuntime');
const bubble = await import('../emotes/emoteBubble');
const se = await import('./spectatorEmotes');
const watchers = await import('./watchers');
const sp = await import('./spectate');
const tap = await import('./spectateTap');
const space = await import('./cursorSpace');
const { WatchersBadge } = await import('./WatchersBadge');
const { SpectatorSelf, WatchedPanel } = await import('./SpectatorHud');
const { LobbyPanel } = await import('../LobbyPanel');
const { versusWatchersOf } = await import('./versusStore');

const ZEN = 'emote_zen_brian'; // the starter: every account has it equipped
const SAM = 'u-sam';
const rect = (el: Element, r: { left: number; top: number; width: number; height: number }): void => {
  (el as HTMLElement).getBoundingClientRect = () => ({ ...r, right: r.left + r.width, bottom: r.top + r.height, x: r.left, y: r.top, toJSON: () => r }) as DOMRect;
};
const click = (el: Element, type = 'click'): void => { act(() => { el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true })); }); };

let ui: Mounted | null = null;
beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (f: FrameRequestCallback) => { f(0); return 0; });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
});
afterEach(() => {
  ui?.unmount(); ui = null;
  se.resetSpectatorEmotesForTests();
  rt.resetEmotesForTests();
  bubble.clearEmoteBubbles();
  act(() => { watchers.setWatchers([]); });
  sp.resetSpectate();
  sp.installSpectateIo(null);
  tap.setSpectatorTap(false, null, null);
  act(() => { useGame.setState({ combatStaged: false }); });
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('R-SPECTATE-EMOTE-01: a spectator emotes to the player', () => {
  it('round trip: the spectator says one on the channel, it pops from their chip on the player screen', () => {
    // THE SPECTATOR: the same menu and cooldown, out on the spectate channel as themselves.
    const sent: { event: string; payload: unknown }[] = [];
    se.installSpectatorEmotes('spec-me', (event, payload) => { sent.push({ event, payload }); });
    expect(rt.canEmoteNow()).toBe(true); // a spectator (render-only watch screen) may emote
    expect(rt.sayEmote(ZEN, 1000)).toBe(true);
    expect(sent).toEqual([{ event: se.SPECTATOR_EMOTE_EVENT, payload: { e: ZEN, from: 'spec-me' } }]); // no timestamp
    expect(rt.sayEmote(ZEN, 1000 + rt.EMOTE_COOLDOWN_MS - 1)).toBe(false); // the player's own 8 s cooldown
    expect(rt.sayEmote('emote_flirty_midas', 1000 + rt.EMOTE_COOLDOWN_MS)).toBe(false); // not equipped: refused
    expect(sent).toHaveLength(1);
    se.uninstallSpectatorEmotes();

    // THE PLAYER: the spectator is in their stands; the chip carries the bubble's anchor.
    act(() => { watchers.setWatchers([{ id: 'spec-me', name: 'Claudebot2', profile: null }]); });
    ui = mount(<WatchersBadge />);
    const chip = ui.container.querySelector('[data-watcher="spec-me"]')!;
    expect(chip).not.toBeNull();
    rect(chip, { left: 20, top: 12, width: 160, height: 44 });
    expect(se.receiveSpectatorEmote(sent[0]!.payload, 50_000)).toBe(true);
    const b = document.body.querySelector<HTMLElement>('.emote-bubble[data-seat="w:spec-me"]')!;
    expect(b).not.toBeNull();
    expect(b.className).not.toMatch(/\bflip\b/); // top left: it opens to the right, art as painted
    // beside the plate, its tail over the plate's right edge (R-EMOTE-LAYOUT-01: it eclipses the portrait a little)
    expect(Number.parseFloat(b.style.left)).toBeGreaterThan(20);
    expect(Number.parseFloat(b.style.left)).toBeLessThan(20 + 160);
  });

  it('the receiver guards the channel on its own clock: cooldown, burst, unknown senders, junk', () => {
    act(() => { watchers.setWatchers([{ id: SAM, name: 'Sam', profile: null }, { id: 'u-b', name: 'B', profile: null }, { id: 'u-c', name: 'C', profile: null }, { id: 'u-d', name: 'D', profile: null }]); });
    ui = mount(<WatchersBadge />);
    for (const n of ui.container.querySelectorAll('[data-watcher]')) rect(n, { left: 20, top: 12, width: 160, height: 44 });
    // the fourth spectator is folded into the "+1" chip: their bubble pops from it
    rect(ui.container.querySelector('.vswatch-more')!, { left: 400, top: 20, width: 30, height: 24 });
    const say = (from: string, at: number, extra: Record<string, unknown> = {}): boolean => se.receiveSpectatorEmote({ e: ZEN, from, ...extra }, at);
    expect(say(SAM, 100_000, { at: 0, sentAt: 1 })).toBe(true); // a client "timestamp" is ignored, never trusted
    expect(say(SAM, 100_000 + se.SPECTATOR_EMOTE_GAP_MS - 1)).toBe(false); // inside the cooldown on MY clock
    expect(say('u-b', 100_100)).toBe(true);
    expect(say('u-c', 100_200)).toBe(true);
    expect(say('u-d', 100_300)).toBe(false); // the burst cap: three in any three seconds
    expect(say('u-d', 100_000 + se.STANDS_BURST.windowMs + 1)).toBe(true);
    expect(se.receiveSpectatorEmote({ e: 'not an id!', from: SAM }, 200_000)).toBe(false);
    expect(se.receiveSpectatorEmote({ e: 'emote_from_the_future', from: 'u-e' }, 200_000)).toBe(false);
    expect(se.receiveSpectatorEmote(null, 200_000)).toBe(false);
  });

  it('an unknown sender is held for their watcher row, then shown from their new chip; a stranger never is', async () => {
    ui = mount(<WatchersBadge />);
    expect(se.receiveSpectatorEmote({ e: ZEN, from: 'u-new' })).toBe(false);
    expect(se.receiveSpectatorEmote({ e: ZEN, from: 'u-stranger' })).toBe(false);
    expect(document.body.querySelector('.emote-bubble')).toBeNull();
    // the row arrives (the player's watcher read lands a moment after the join): the chip renders, then the hold flushes
    act(() => { watchers.setWatchers([{ id: 'u-new', name: 'New', profile: null }]); });
    rect(ui.container.querySelector('[data-watcher="u-new"]')!, { left: 20, top: 12, width: 160, height: 44 });
    await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
    expect(document.body.querySelector('.emote-bubble[data-seat="w:u-new"]')).not.toBeNull();
    expect(document.body.querySelector('.emote-bubble[data-seat="w:u-stranger"]')).toBeNull();
  });

  it('mute: right-click a chip mutes that spectator; the Esc switch hides every spectator emote', () => {
    act(() => { watchers.setWatchers([{ id: SAM, name: 'Sam', profile: null }]); });
    ui = mount(<WatchersBadge />);
    rect(ui.container.querySelector('[data-watcher]')!, { left: 20, top: 12, width: 160, height: 44 });
    click(ui.container.querySelector(`[data-watcher="${SAM}"]`)!, 'contextmenu');
    expect(ui.container.querySelector(`[data-watcher="${SAM}"]`)!.classList.contains('muted')).toBe(true);
    expect(ui.container.querySelector('.vswatch-tag')!.textContent).toBe('Muted');
    expect(se.receiveSpectatorEmote({ e: ZEN, from: SAM }, 300_000)).toBe(false);
    click(ui.container.querySelector(`[data-watcher="${SAM}"]`)!, 'contextmenu'); // unmute
    act(() => { se.setSpectatorEmotesOn(false); });
    expect(se.receiveSpectatorEmote({ e: ZEN, from: SAM }, 300_000)).toBe(false);
    act(() => { se.setSpectatorEmotesOn(true); });
    expect(se.receiveSpectatorEmote({ e: ZEN, from: SAM }, 300_000)).toBe(true);
  });

  it('fellow spectators: a spectator stands list is the other spectators of the room, never themselves', () => {
    const room = { members: [
      { userId: 'p1', role: 'p1', displayName: 'P1', profile: {}, lastSeenAt: '' },
      { userId: 'spec-me', role: 'spectator', displayName: 'Me', profile: {}, lastSeenAt: '' },
      { userId: SAM, role: 'spectator', displayName: 'Sam', profile: {}, lastSeenAt: '' },
    ] } as unknown as Parameters<typeof versusWatchersOf>[0];
    expect(versusWatchersOf(room, false, 'spec-me').map((w) => w.id)).toEqual([SAM]);
    expect(versusWatchersOf(room, true, 'p1').map((w) => w.id)).toEqual(['spec-me', SAM]);
    expect(versusWatchersOf(room, false, 'stranger')).toEqual([]);
  });

  it('R-SPECTATE-WATCHERS-02: a player knocked out to the stands, still seated while the last fight plays, never sees their own chip', () => {
    // Group and Duos: the server moves a knocked-out player to the stands (role spectator) while their match seat
    // still holds (mySeat is truthy), so the seated branch runs with me among the spectators.
    const room = { members: [
      { userId: 'p1', role: 'p1', displayName: 'P1', profile: {}, lastSeenAt: '' },
      { userId: 'ko-me', role: 'spectator', displayName: 'Me', profile: {}, lastSeenAt: '' },
      { userId: 'ko-mate', role: 'spectator', displayName: 'Mate', profile: {}, lastSeenAt: '' },
    ] } as unknown as Parameters<typeof versusWatchersOf>[0];
    expect(versusWatchersOf(room, true, 'ko-me').map((w) => w.id)).toEqual(['ko-mate']);
    expect(versusWatchersOf(room, true, 'p1').map((w) => w.id)).toEqual(['ko-me', 'ko-mate']);
  });
});

describe('R-SPECTATE-HUD-01: me top left, the watched player and the switcher bottom right', () => {
  it('top left: my plate (Spectating, opens the emote menu under it), the other spectators, Leave', () => {
    se.installSpectatorEmotes('spec-me', () => undefined);
    act(() => { watchers.setWatchers([{ id: SAM, name: 'Sam', profile: null }]); });
    const leave = vi.fn();
    ui = mount(<SpectatorSelf onLeave={leave} />);
    const self = ui.container.querySelector('.vsspec.vsself')!;
    const mine = self.querySelector<HTMLElement>('.vsself-seat')!;
    expect(mine.dataset.watcher).toBe('spec-me');
    expect(mine.querySelector('.vswatch-tag')!.textContent).toBe('Spectating');
    expect(self.querySelector(`[data-watcher="${SAM}"]`)).not.toBeNull();
    rect(mine.querySelector('.portring')!, { left: 20, top: 12, width: 54, height: 54 });
    click(mine);
    expect(rt.useEmoteUi.getState().menu).toMatchObject({ below: true });
    // the watched player's portrait (bottom left) never opens a spectator's menu
    act(() => { rt.closeEmoteMenu(); });
    rt.openEmoteMenu({ x: 0, y: 0 });
    expect(rt.useEmoteUi.getState().menu).toBeNull();
    click(self.querySelector('.vsspec-leave')!);
    expect(leave).toHaveBeenCalledOnce();
  });

  it('bottom right: Versus shows the two-seat switcher; a live game one compact name + rank plate', () => {
    const pick = vi.fn();
    ui = mount(<WatchedPanel seats={[
      { key: 'p1', name: 'Rooks', heroId: 'warden', profile: null, health: 30, armor: 5, on: true, pick: () => undefined },
      { key: 'p2', name: 'Claudebot1', heroId: 'warden', profile: null, health: 24, armor: 0, on: false, pick },
    ]} />);
    const panel = ui.container.querySelector('.vswatchpanel')!;
    expect(panel.querySelectorAll('button.vsspec-seat')).toHaveLength(2);
    click(panel.querySelectorAll('button.vsspec-seat')[1]!);
    expect(pick).toHaveBeenCalledOnce();
    ui.render(<WatchedPanel single={{ name: 'Rooks', divisionIndex: 0, rankPoints: 10 }} />);
    const one = ui.container.querySelector('.vswatchpanel.vswatchpanel-one')!;
    expect(one.textContent).toContain('Rooks');
    expect(one.querySelector('.portring:not(.rankcrest)')).toBeNull(); // no second portrait: theirs is bottom left
    // the panel is anchored bottom right, above the corner buttons; the self plate keeps the top-left anchor
    const css = readFileSync(join(__dirname, 'versus.css'), 'utf8');
    const rule = css.match(/\.vswatchpanel \{([^}]*)\}/)![1]!;
    expect(rule).toMatch(/left: auto/);
    expect(rule).toMatch(/right: calc/);
    // It rides the corner buttons, which sit on the real screen edge since R-TOUCH-FILL-01 (2026-10-18).
    expect(rule).toMatch(/bottom: calc\(var\(--edge-b, 0px\) \+ 16px \+ 40 \* var\(--u\)/);
  });
});

describe('R-SPECTATE-CURSOR-02: the spectator HUD never swaps the OS cursor in', () => {
  it('no bare keyword cursor in the HUD, the indicator, the live bar or their styles', () => {
    const files = ['SpectatorHud.tsx', 'SpectatorBar.tsx', 'WatchersBadge.tsx', 'MemberRing.tsx', 'versus.css', '../live/LiveWatchBar.tsx', '../live/live.css'];
    for (const f of files) {
      const src = readFileSync(join(__dirname, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      // CSS `cursor: <keyword>` without the gauntlet url(), or a React `cursor:` style
      expect(src, f).not.toMatch(/cursor\s*:\s*(?!url\()[a-z-]+/);
    }
  });
});

describe('R-SPECTATE-LOCAL-01: a spectator uses their own rail, guides and Summary, locally', () => {
  it('opens their guides from the corner and pins a scout card without sending anything', () => {
    const sends = vi.fn();
    const io = { latestFrames: vi.fn(async () => []), requestKey: sends, loadRounds: vi.fn(), lobbyFor: vi.fn(() => undefined) };
    sp.installSpectateIo(io);
    se.installSpectatorEmotes('spec-me', sends);
    const run = createLobbyRun(5151, 'warden');
    act(() => { useGame.setState({ run, combatStaged: false, replaying: true }); sp.useSpectate.setState({ active: true }); });
    ui = mount(<LobbyPanel lobby={run.lobby!} />);
    const tab = ui.container.querySelector('.guidesbtn')!;
    click(tab);
    expect(ui.container.querySelector('.guidesdock')).not.toBeNull();
    // read only: no Edit button on any guide
    expect(ui.container.querySelector('.lobbyguide-editbtn')).toBeNull();
    click(ui.container.querySelector('.guidesbtn')!);
    const seat = [...ui.container.querySelectorAll('.lobbyseat')].find((s) => !s.classList.contains('you'))!;
    click(seat);
    expect(document.body.querySelector('.lobbyscout.pinned')).not.toBeNull();
    expect(sends).not.toHaveBeenCalled(); // nothing went to the player
    // the player's hover can never drive the spectator's rail: a rail seat is not a hover anchor
    expect(space.anchorOf(seat)).toBeNull();
    // and the CSS lets these (and only the spectator's own panels) take a press on the inert watch screen
    const css = readFileSync(join(__dirname, 'versus.css'), 'utf8');
    for (const sel of [':is(.guidesbtn, .guidesdock button, .guidesdock [role="button"])', '.combatsummary', '.vsfoe:not(.guides-open) .vsfoe-guides', ':is(.lobbyrail, .lobbyrailhead) :is(button']) {
      expect(css).toContain(sel);
    }
    act(() => { useGame.setState({ replaying: false }); sp.useSpectate.setState({ active: false }); });
  });

  it('the Summary odds are the player own numbers: tapped once, carried on the channel, stored per seat', () => {
    const odds: CombatOdds = { win: 61.5, draw: 3, lose: 35.5, avgLossDamage: 7, lossDamageRange: [5, 9], avgWinDamage: 8 };
    // THE PLAYER: nobody watching keeps nothing
    tap.tapOdds(4, odds);
    expect(tap.takeOdds({ phase: 'combat', wave: 4 }, true)).toBeNull();
    tap.setSpectatorTap(true, 'p1', () => undefined, () => undefined);
    tap.tapOdds(4, odds);
    expect(tap.hasPendingActs()).toBe(true); // it asks for a publish
    const od = tap.takeOdds({ phase: 'combat', wave: 4 }, false);
    expect(od).toEqual({ w: 4, o: odds });
    expect(tap.takeOdds({ phase: 'combat', wave: 4 }, false)).toBeNull(); // once on a delta
    expect(tap.takeOdds({ phase: 'combat', wave: 4 }, true)).toEqual({ w: 4, o: odds }); // and on every keyframe
    expect(tap.takeOdds({ phase: 'recruit', wave: 5 }, true)).toBeNull(); // never outside that fight
    // THE SPECTATOR: the message stores them for that seat, exactly
    sp.liveSync('g-1');
    sp.receiveSpectate({ kind: 'delta', seat: 'p1', seq: 1, round: 4, changed: {}, removed: [], m: 'g-1', od });
    expect(sp.useSpectate.getState().odds?.p1).toEqual({ w: 4, o: odds });
    expect(sp.parseWireOdds({ w: 4, o: { win: 'x' } })).toBeNull();
    sp.liveSync(null);
  });
});

describe('R-SPECTATE-HUD-03: spectators are drawn like players', () => {
  it('portrait on top, the name plate under it, a small Spectating tag, larger rings, one tidy column (R-EMOTE-LAYOUT-01)', () => {
    const css = readFileSync(join(__dirname, 'versus.css'), 'utf8');
    expect(css).toContain('.vswatch-seat { flex-direction: column; align-items: center; gap: 0; }');
    expect(css).toMatch(/\.vswatch-seat \.vsspec-info \{[^}]*margin-top: calc\(-11 \* var\(--u\)\)/);
    // every plate the same, larger ring (owner 2026-10-29: "They are also kinda small"), the player's and a spectator's own
    expect(css).toContain('.vswatch .vswatch-ring, .vsself .vsspec-ring { --ring: calc(88 * var(--u)); }');
    // one column, never wrapping into the tier gem or the timer (owner 2026-10-29: "It's cluttered")
    expect(css).toMatch(/\.vswatch \.vsspec-seats, \.vsself \.vsspec-seats \{[^}]*flex-direction: column[^}]*flex-wrap: nowrap/);
    // the tag stays under the name in the same info column (the markup is unchanged: ring, then name, then tag)
    const badge = readFileSync(join(__dirname, 'WatchersBadge.tsx'), 'utf8');
    expect(badge.indexOf('vswatch-ring')).toBeLessThan(badge.indexOf('vsspec-name hudpill-name">{name}'));
    expect(badge.indexOf('vsspec-name hudpill-name">{name}')).toBeLessThan(badge.indexOf('vswatch-tag'));
  });
});
