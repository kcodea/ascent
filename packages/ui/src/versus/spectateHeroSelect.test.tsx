// @vitest-environment jsdom
/**
 * HERO SELECT IS SPECTATABLE (owner 2026-10-26, verbatim: "I want spectating to show up when a player goes into hero
 * select. this should work in all modes. hero select should be spectatable."; R-SPECTATE-HEROSELECT-01) and, in Duos,
 * THE TEAMMATE'S HERO CHOICES (owner 2026-10-26: "in duos, the teammate's hero options should be visible as well. there
 * should be teammate portrait in the bottom right, like it is in game, but have the player's portrait to be clickable and
 * view the hero options so they can work together on who to pick"; R-DUOS-HEROSELECT-01).
 *
 * Pinned:
 *  - THE WIRE: a Hero Select frame is the screen whole (offer, pick, re-roll, mode), sanitised on the way in, sent only
 *    when it changes (or a watcher asks), and the first run message after it is a keyframe that replaces it.
 *  - THE STANDS (Versus 1v1 / Group / Duos): a spectator at Hero Select asks the players for their screen, opens the
 *    watch screen on it, follows the pick live, and flows into the shop on the first keyframe.
 *  - DUOS: a seated player caches the teammate's Hero Select (their portrait's face is their pick) but sees it only when
 *    they ask; it closes when Hero Select is over. Never another team's frames (the room filter: `isMateFrame`).
 *  - THE SCREEN: the real Hero Select, read only: the three heroes, inert re-roll buttons, the watched pick's ceremony,
 *    no Back and no Start Game.
 *  - LIVE GAMES: a ranked Hero Select is listed (phase 'hero'), its frame published and stored while watched, and the
 *    pick flows into the same listed game.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createLobbyRun, createVersusRun, HEROES, type RunState } from '@game/sim';
import type { LiveRemote } from '../live/liveRemote';
import { mount, type Mounted } from '../renderedText.mount';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });

const { useGame } = await import('../store');
const identity = await import('../identity');
const sp = await import('./spectate');
const view = await import('./spectatorView');
const { HeroSelect } = await import('../HeroSelect');
const { setOwnHeroPick } = await import('../hero-select/ownHeroPick');
const pubMod = await import('../live/livePublisher');
await import('./teammateView'); // the launch curtain closes the teammate's choices (its store subscription)

const OFFER = HEROES.filter((h) => !h.practiceOnly).slice(0, 3).map((h) => h.id);
const frameOf = (p: Partial<import('./spectatorView').HeroSelectFrame> = {}) =>
  view.heroSelectFrame({ offer: OFFER, picked: null, reroll: null, canReroll: true, mode: 'versus', ...p })!;
const heroMsg = (seat: 'p1' | 'p2' | 'p3' | 'p4', seq: number, p: Partial<import('./spectatorView').HeroSelectFrame> = {}, m = 'm1') =>
  ({ kind: 'hero', seat, seq, round: 0, hero: frameOf(p), m });

const io = { latestFrames: vi.fn(async () => [] as { seat: 'p1'; frame: unknown }[]), requestKey: vi.fn(), loadRounds: vi.fn(), lobbyFor: vi.fn(() => undefined) };
const flush = async (): Promise<void> => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
let ui: Mounted | null = null;

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (f: FrameRequestCallback) => { f(0); return 0; });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  io.latestFrames.mockClear(); io.requestKey.mockClear();
  sp.installSpectateIo(io);
  useGame.setState({ showTitle: true, replaying: false, inspect: null, heroChoices: null, heroReroll: null, pendingMode: 'lobby', rankedEntry: null });
});
afterEach(() => { ui?.unmount(); ui = null; sp.resetSpectate(); sp.installSpectateIo(null); vi.unstubAllGlobals(); setOwnHeroPick(null); });

describe('the wire: a Hero Select frame (R-SPECTATE-HEROSELECT-01)', () => {
  it('is sanitised: a pick must be offered, the mode known; a spent or picked re-roll is no longer on offer', () => {
    expect(view.heroSelectFrame({ offer: OFFER, picked: 'nobody', reroll: null, canReroll: true, mode: 'versus' })!.picked).toBeNull();
    expect(view.heroSelectFrame({ offer: OFFER, picked: OFFER[1], reroll: null, canReroll: true, mode: 'lobby' })).toEqual({ offer: OFFER, picked: OFFER[1], reroll: null, canReroll: false, mode: 'lobby' });
    expect(view.heroSelectFrame({ offer: OFFER, mode: 'practice' })).toBeNull();
    expect(view.heroSelectFrame({ offer: [], mode: 'versus' })).toBeNull();
    expect(view.heroSelectFrame({ offer: [42], mode: 'versus' })).toBeNull();
    // nothing beyond the screen travels (no seed, no entry id)
    expect(Object.keys(frameOf({ seed: 1, runId: 'x' } as never)).sort()).toEqual(['canReroll', 'mode', 'offer', 'picked', 'reroll']);
  });

  it('goes out only when it changes (or a watcher asks), and the first run message after it is a keyframe that replaces it', () => {
    const pub = view.newPublisher('p2', 1000);
    const a = view.nextHeroSelectMessage(pub, frameOf())!;
    expect(a).toMatchObject({ kind: 'hero', seat: 'p2', seq: 1001 });
    expect(view.nextHeroSelectMessage(pub, frameOf())).toBeNull();
    expect(view.nextHeroSelectMessage(pub, frameOf(), true)!.seq).toBe(1002);
    const b = view.nextHeroSelectMessage(pub, frameOf({ picked: OFFER[2] }))!;
    let rx = view.applySpectatorMessage(view.newReceiver(), a).rx;
    expect(rx.hero?.picked).toBeNull();
    rx = view.applySpectatorMessage(rx, b).rx;
    expect(rx.hero?.picked).toBe(OFFER[2]);
    // a stale Hero Select never steps back over a newer one; the same screen keeps its object
    expect(view.applySpectatorMessage(rx, a).rx).toBe(rx);
    const again = view.applySpectatorMessage(rx, { ...b, seq: ++pub.seq }).rx; // re-sent on a request
    expect(again.hero).toBe(rx.hero);
    // the run begins: a keyframe, which replaces the Hero Select
    const key = view.nextSpectatorMessage(pub, createVersusRun(5, OFFER[2]!, 'set2'), 1)!;
    expect(key.kind).toBe('key');
    const after = view.applySpectatorMessage(again, key).rx;
    expect(after.view).not.toBeNull();
    expect(after.hero ?? null).toBeNull();
  });
});

const match = (p: Record<string, unknown> = {}) => ({ id: 'm1', phase: 'hero_select', round: 0, p1_name: 'Ann', p2_name: 'Bo', p1_hearts: 7, p2_hearts: 7, ...p }) as never;

describe('the stands: Versus Hero Select is watched (R-SPECTATE-HEROSELECT-01)', () => {
  it('asks the players for their screen, opens on it, follows the pick, then flows into the shop', async () => {
    sp.spectateSync(match(), {});
    await flush();
    expect(io.requestKey).toHaveBeenCalled(); // nothing is stored at Hero Select: the players are asked
    expect(sp.useSpectate.getState().active).toBe(false);
    sp.receiveSpectate(heroMsg('p1', 10));
    await flush();
    expect(sp.useSpectate.getState().active).toBe(true);
    expect(sp.useSpectate.getState().hero?.offer).toEqual(OFFER);
    expect(useGame.getState().replaying).toBe(true); // the watch screen's render-only mode
    expect(useGame.getState().showTitle).toBe(false);
    expect(useGame.getState().heroChoices).toBeNull(); // never MY Hero Select: the watch layer draws theirs
    // the other seat's screen is cached, never shown while I watch p1
    sp.receiveSpectate(heroMsg('p2', 20, { picked: OFFER[0] }));
    expect(sp.useSpectate.getState().hero?.picked).toBeNull();
    sp.receiveSpectate(heroMsg('p1', 11, { picked: OFFER[1] }));
    expect(sp.useSpectate.getState().hero?.picked).toBe(OFFER[1]);
    // switching player is instant (cached)
    sp.watchSeat('p2');
    expect(sp.useSpectate.getState().hero?.picked).toBe(OFFER[0]);
    sp.watchSeat('p1');
    // the shop opens: the first keyframe takes over from the Hero Select
    sp.spectateSync(match({ phase: 'shop', round: 1 }), {});
    const run = createVersusRun(7, OFFER[1]!, 'set2');
    sp.receiveSpectate({ ...view.nextSpectatorMessage(view.newPublisher('p1', 12), run, 1, true)!, m: 'm1' });
    await flush();
    expect(sp.useSpectate.getState().hero ?? null).toBeNull();
    expect(useGame.getState().run.heroId).toBe(OFFER[1]);
    // Leave goes back to the room
    sp.leaveSpectating();
    expect(useGame.getState().replaying).toBe(false);
    expect(useGame.getState().showTitle).toBe(true);
  });

  it('a frame from another match never opens anything', async () => {
    sp.spectateSync(match(), {});
    sp.receiveSpectate(heroMsg('p1', 10, {}, 'another-match'));
    await flush();
    expect(sp.useSpectate.getState().active).toBe(false);
    expect(sp.useSpectate.getState().hero ?? null).toBeNull();
  });
});

describe('Duos: the teammate\'s hero choices (R-DUOS-HEROSELECT-01)', () => {
  it('cached for the portrait (their pick is its face), shown only on request, closed when Hero Select is over', async () => {
    sp.trackDuosMatch(match({ group: { duos: { mate: 'p2' } } }), {});
    sp.receiveSpectate(heroMsg('p2', 30));
    sp.receiveSpectate(heroMsg('p2', 31, { picked: OFFER[2] }));
    await flush();
    expect(sp.useSpectate.getState().matePick).toBe(OFFER[2]);
    expect(sp.useSpectate.getState().hero ?? null).toBeNull(); // not asked: my own Hero Select stays on screen
    expect(sp.useSpectate.getState().active).toBe(false);
    sp.watchTeammateHero('p2');
    expect(sp.useSpectate.getState().teammateHero).toBe(true);
    expect(sp.useSpectate.getState().hero?.picked).toBe(OFFER[2]);
    expect(sp.useSpectate.getState().active).toBe(false); // my run and my screen are never set aside for it
    sp.leaveTeammateHero();
    expect(sp.useSpectate.getState().hero ?? null).toBeNull();
    useGame.setState({ heroChoices: [...OFFER], pendingMode: 'versus' });
    sp.watchTeammateHero('p2');
    // The last pick ends Hero Select on the server, but my screen still plays my ceremony: the view stays...
    sp.trackDuosMatch(match({ phase: 'shop', round: 1, group: { duos: { mate: 'p2' } } }), {});
    expect(sp.useSpectate.getState().teammateHero).toBe(true);
    // ...until the launch curtain takes my Hero Select
    useGame.setState({ heroChoices: null });
    expect(sp.useSpectate.getState().teammateHero).toBe(false);
    expect(sp.useSpectate.getState().hero ?? null).toBeNull();
  });

  it('a teammate whose screen is not here yet is asked for it', () => {
    sp.trackDuosMatch(match({ group: { duos: { mate: 'p4' } } }), {});
    io.requestKey.mockClear();
    sp.watchTeammateHero('p4');
    expect(io.requestKey).toHaveBeenCalledTimes(1);
  });
});

describe('the screen: the real Hero Select, read only', () => {
  it('shows their three, inert re-roll buttons, no Back; a click picks nothing; their pick plays its ceremony with no Start Game', () => {
    ui = mount(<HeroSelect watch={{ frame: frameOf({ mode: 'lobby' }), fx: false, clock: 'none' }} />);
    const root = document.querySelector('.heroselect.hswatch')!;
    expect(root).not.toBeNull();
    expect([...root.querySelectorAll('.herocard .hcname')].map((n) => n.textContent)).toEqual(OFFER.map((id) => HEROES.find((h) => h.id === id)!.name));
    expect(root.querySelectorAll('.hcreroll')).toHaveLength(3);
    expect(root.querySelector('.hsback')).toBeNull();
    act(() => root.querySelector<HTMLButtonElement>('.herocard')!.click());
    expect(root.classList.contains('hsc-active')).toBe(false); // a watcher's click picks nothing
    act(() => root.querySelector<HTMLButtonElement>('.hcreroll')!.click());
    expect(useGame.getState().heroReroll).toBeNull(); // nor re-rolls anything
    ui.render(<HeroSelect watch={{ frame: frameOf({ mode: 'lobby', picked: OFFER[1] }), fx: false, clock: 'none' }} />);
    const after = document.querySelector('.heroselect.hswatch')!;
    expect(after.classList.contains('hsc-active')).toBe(true); // the watched pick's ceremony
    expect(document.querySelector('.hsc-start')).toBeNull(); // it never launches anything
    expect(useGame.getState().heroChoices).toBeNull();
  });

  it('a re-roll the player spends swaps on the watcher\'s screen; the buttons go', () => {
    ui = mount(<HeroSelect watch={{ frame: frameOf({ mode: 'lobby' }), fx: false, clock: 'none' }} />);
    const to = HEROES.find((h) => !OFFER.includes(h.id) && !h.practiceOnly)!.id;
    const offer = [OFFER[0]!, to, OFFER[2]!];
    ui.render(<HeroSelect watch={{ frame: view.heroSelectFrame({ offer, picked: null, reroll: { slot: 1, from: OFFER[1]!, to }, canReroll: false, mode: 'lobby' })!, fx: false, clock: 'none' }} />);
    expect(document.querySelectorAll('.hcreroll')).toHaveLength(0);
    expect(document.querySelector('.herocard.hcswapping')).not.toBeNull();
  });
});

describe('Live Games: a ranked Hero Select is listed and watched (R-SPECTATE-HEROSELECT-01)', () => {
  function fakeRemote(watchers: () => number) {
    const sent: { event: string; payload: any }[] = [];
    let onBroadcast: ((e: string, p: unknown) => void) | null = null;
    const r = {
      heartbeat: vi.fn(async (_g: { phase: string; heroId: string }) => watchers()),
      end: vi.fn(async () => undefined),
      publishFrame: vi.fn(async () => undefined),
      latestFrame: vi.fn(async () => null as unknown),
      watchers: vi.fn(async () => null),
      channel: vi.fn((_: string, cb: (e: string, p: unknown) => void) => { onBroadcast = cb; return { send: (event: string, payload: unknown) => sent.push({ event, payload }), close: vi.fn() }; }),
    };
    return { r: r as unknown as LiveRemote & typeof r, sent, push: (e: string, p: unknown) => onBroadcast?.(e, p) };
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    identity.setIdentity({ userId: 'u-player', isAnonymous: true } as never);
  });
  afterEach(() => { vi.useRealTimers(); identity.setIdentity(null); });

  it('lists the game from Hero Select, sends and stores the screen while watched, and the pick flows into the same game', async () => {
    let watching = 0;
    const net = fakeRemote(() => watching);
    pubMod.setLiveRemoteForTests(net.r);
    const off = pubMod.installLivePublisher();
    useGame.setState({ heroChoices: [...OFFER], pendingMode: 'lobby', rankedEntry: { runId: 'rank-1', seed: 77, heroChoices: [...OFFER], at: 'now' }, showTitle: false, replaying: false });
    await flush();
    expect(pubMod.liveState()?.gameId).toBe('rank-1');
    expect(net.r.heartbeat).toHaveBeenLastCalledWith(expect.objectContaining({ gameId: 'rank-1', phase: 'hero', round: 1, heroId: OFFER[0] }));
    expect(net.sent).toEqual([]); // nobody watching: nothing sent
    watching = 1;
    net.push('spectate_key', {});
    await vi.advanceTimersByTimeAsync(400);
    const hero = net.sent.filter((s) => s.event === 'spectate' && s.payload.kind === 'hero');
    expect(hero).toHaveLength(1);
    expect(hero[0]!.payload).toMatchObject({ m: 'rank-1', hero: { offer: OFFER, picked: null, mode: 'lobby' } });
    expect(net.r.publishFrame).toHaveBeenCalledWith('rank-1', hero[0]!.payload.seq, 0, hero[0]!.payload); // stored for late joiners
    // the pick shows live
    act(() => setOwnHeroPick(OFFER[1]!));
    await vi.advanceTimersByTimeAsync(400);
    const picked = net.sent.filter((s) => s.payload?.kind === 'hero').at(-1)!;
    expect(picked.payload.hero.picked).toBe(OFFER[1]);
    // Start Game: the run takes the entry's id, so the same listed game goes on, and its first message is a keyframe
    const run = createLobbyRun(77, OFFER[1]!);
    const rated = { ...run, runId: 'rank-1', lobby: { ...run.lobby!, unrated: undefined, seats: run.lobby!.seats.map((s, i) => (i === 1 ? { ...s, kind: 'snapshot' } : s)) } } as RunState;
    useGame.setState({ run: rated, heroChoices: null, rankedEntry: null });
    setOwnHeroPick(null);
    await vi.advanceTimersByTimeAsync(400);
    expect(net.r.end).not.toHaveBeenCalled();
    expect(pubMod.liveState()?.gameId).toBe('rank-1');
    const next = net.sent.filter((s) => s.event === 'spectate').at(-1)!;
    expect(next.payload.kind).toBe('key');
    expect(next.payload.seq).toBeGreaterThan(picked.payload.seq);
    off();
  });

  it('backing out of a ranked Hero Select delists it', async () => {
    const net = fakeRemote(() => 0);
    pubMod.setLiveRemoteForTests(net.r);
    const off = pubMod.installLivePublisher();
    useGame.setState({ heroChoices: [...OFFER], pendingMode: 'lobby', rankedEntry: { runId: 'rank-2', seed: 78, heroChoices: [...OFFER], at: 'now' }, showTitle: false, replaying: false });
    await flush();
    expect(pubMod.liveState()?.gameId).toBe('rank-2');
    useGame.setState({ heroChoices: null, rankedEntry: null, showTitle: true });
    await flush();
    expect(net.r.end).toHaveBeenCalledWith('rank-2', null);
    expect(pubMod.liveState()).toBeNull();
    off();
  });

  it('Practice or an unranked Hero Select is never listed', () => {
    expect(pubMod.liveHeroSelectGameId({ replaying: false, showTitle: false, heroChoices: OFFER, pendingMode: 'practice', rankedEntry: { runId: 'x' } })).toBeNull();
    expect(pubMod.liveHeroSelectGameId({ replaying: false, showTitle: false, heroChoices: OFFER, pendingMode: 'lobby', rankedEntry: null })).toBeNull();
    expect(pubMod.liveHeroSelectGameId({ replaying: true, showTitle: false, heroChoices: OFFER, pendingMode: 'lobby', rankedEntry: { runId: 'x' } })).toBeNull();
    expect(pubMod.liveHeroSelectGameId({ replaying: false, showTitle: false, heroChoices: OFFER, pendingMode: 'lobby', rankedEntry: { runId: 'x' } })).toBe('x');
  });

  // (Last in the file: it turns the hero phase off for the module's session.)
  it('a server without the migration refuses the hero phase once; Hero Select is then not listed again this session', async () => {
    const { LiveError } = await import('../live/liveRemote');
    const net = fakeRemote(() => 0);
    net.r.heartbeat.mockImplementation(async (g: { phase: string }) => { if (g.phase === 'hero') throw new LiveError('bad_phase'); return 0; });
    pubMod.setLiveRemoteForTests(net.r);
    const off = pubMod.installLivePublisher();
    useGame.setState({ heroChoices: [...OFFER], pendingMode: 'lobby', rankedEntry: { runId: 'rank-3', seed: 79, heroChoices: [...OFFER], at: 'now' }, showTitle: false, replaying: false });
    await flush();
    expect(net.r.heartbeat).toHaveBeenCalledTimes(1);
    expect(pubMod.liveHeroSelectGameId(useGame.getState())).toBeNull();
    vi.advanceTimersByTime(pubMod.LIVE_HEARTBEAT_MS * 3);
    await flush();
    expect(net.r.heartbeat.mock.calls.filter(([g]) => g.phase === 'hero')).toHaveLength(1); // never every 15 s
    off();
  });
});
