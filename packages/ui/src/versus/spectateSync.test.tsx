// @vitest-environment jsdom
/**
 * SPECTATING IN SYNC WITH THE PLAYER (owner reports via the coordinator, 2026-10-15). Pinned:
 *  - R-SPECTATE-CURSOR-01: a cursor sample lands on the same UI element on a spectator screen of any size / aspect
 *    (anchored to the element, else the 16:9 game box; an older sender's window fractions still decode).
 *  - R-SPECTATE-HOVER-01: the hovered element travels as a key; the spectator hovers ITS OWN element the way a mouse
 *    does, so the element's own React hover handler opens its own preview; it closes on leave / hide.
 *  - R-SPECTATE-DRAGGAP-01: the player's drag decision (the gap indices) travels and lands in the spectator's feed.
 *  - R-SPECTATE-AIM-01: the aim's end snaps to the player's target and lights it; it clears when the aim ends.
 *  - R-SPECTATE-JOIN-01: a mid-fight join asks where the fight is, starts / seeks to the player's beat, and a late
 *    fight with no beat cuts to real time when the player is back in the shop.
 *  - R-SPECTATE-WATCHERS-01: the player's "Spectating" indicator (up to three plates, then "+N"; "Spectator" with no
 *    name; the data-tip hover, never title=), fed from the watcher rows.
 *  - R-SPECTATE-AV-04: a watched shop action and a watched combat beat play their sounds; a refused action is never
 *    tagged for the stands.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { CombatEvent } from '@game/core';
import { createLobbyRun, createVersusRun, type BoardCard, type RunState } from '@game/sim';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { useGame } = await import('../store');
const sp = await import('./spectate');
const tap = await import('./spectateTap');
const space = await import('./cursorSpace');
const hover = await import('./spectatorHover');
const press = await import('../pressCue');
const { dragStore } = await import('../dragStore');
const { newPublisher, nextSpectatorMessage } = await import('./spectatorView');
const { sfx } = await import('../sfx');
const { playMomentSfx } = await import('../choreo/channels/sfx');
const { compileMoments } = await import('../choreo/compile');
const watchers = await import('./watchers');
const { WatchersBadge } = await import('./WatchersBadge');
const { versusWatchersOf } = await import('./versusStore');

const setWindow = (w: number, h: number): void => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: w });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: h });
};
/** A DOM element at a fixed screen rect (jsdom lays nothing out). */
function placed(attrs: Record<string, string>, r: { left: number; top: number; width: number; height: number }, parent: HTMLElement = document.body): HTMLElement {
  const el = document.createElement('div');
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.getBoundingClientRect = () => ({ ...r, right: r.left + r.width, bottom: r.top + r.height, x: r.left, y: r.top, toJSON: () => r }) as DOMRect;
  parent.appendChild(el);
  return el;
}
const bc = (uid: string, cardId: string): BoardCard => ({ uid, cardId, tribe: 'dwarf', attack: 2, health: 2, keywords: [], golden: false }) as unknown as BoardCard;
const flush = async (): Promise<void> => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
let frames: { seat: 'p1' | 'p2'; frame: unknown }[] = [];
const io = { latestFrames: vi.fn(async () => frames), requestKey: vi.fn(), loadRounds: vi.fn(), lobbyFor: vi.fn(() => undefined) };

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (f: FrameRequestCallback) => { f(0); return 0; });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  sp.installSpectateIo(io);
  io.requestKey.mockClear();
});
afterEach(() => {
  sp.resetSpectate();
  sp.installSpectateIo(null);
  hover.setSpectatorHover(null);
  dragStore.reset();
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
  tap.setSpectatorTap(false, null, null);
  watchers.setWatchers([]);
  setWindow(1024, 768);
});

describe('R-SPECTATE-CURSOR-01: the cursor lands on the same element at any aspect ratio', () => {
  it('anchored to End Turn on a 1920x1080 player screen, it lands on End Turn on a 2000x1170 spectator screen', () => {
    // The player's screen: End Turn at the right of a 16:9 window.
    setWindow(1920, 1080);
    const theirs = placed({ 'data-spec': 'endturn' }, { left: 1700, top: 480, width: 120, height: 120 });
    const wire = space.encodePoint(1730, 510, theirs);
    expect(wire.an).toEqual({ k: 's:endturn', fx: 0.25, fy: 0.25 });
    document.body.innerHTML = '';
    // The spectator: a taller window (letterboxed), End Turn somewhere else in window terms.
    setWindow(2000, 1170);
    placed({ 'data-spec': 'endturn' }, { left: 1772, top: 522, width: 125, height: 125 });
    const at = space.decodePoint(wire);
    expect(at.x).toBeCloseTo(1772 + 0.25 * 125, 3);
    expect(at.y).toBeCloseTo(522 + 0.25 * 125, 3);
  });

  it('over no anchor, the 16:9 game box carries it (letterboxing included); an older sender\'s window fractions still decode', () => {
    setWindow(1920, 1080);
    const wire = space.encodePoint(960, 540, null);
    expect(wire.an).toBeUndefined();
    expect([wire.gx, wire.gy]).toEqual([0.5, 0.5]);
    setWindow(2000, 1170); // box 2000 x 1125, 22.5 px bars top and bottom
    expect(space.decodePoint({ x: 0, y: 0, gx: 0.5, gy: 0 })).toMatchObject({ x: 1000, y: 22.5 });
    expect(space.decodePoint({ x: 0.5, y: 0.5 })).toMatchObject({ x: 1000, y: 585 }); // no gx / gy: the old form
  });

  it('a card anchors by its uid; hover popups and drag ghosts never count as anchors', () => {
    const card = placed({ 'data-uid': 'm7' }, { left: 0, top: 0, width: 100, height: 140 });
    expect(space.anchorOf(card)?.key).toBe('u:m7');
    const pop = placed({ class: 'cardref' }, { left: 0, top: 0, width: 1, height: 1 });
    expect(space.anchorOf(placed({ 'data-uid': 'm7' }, { left: 0, top: 0, width: 1, height: 1 }, pop))).toBeNull();
  });
});

/** Watch a run from the shop (seat p1). */
async function watch(run: RunState, id: string): Promise<ReturnType<typeof newPublisher>> {
  const pub = newPublisher('p1');
  frames = [{ seat: 'p1', frame: nextSpectatorMessage(pub, run, run.wave, true) }];
  sp.spectateSync({ id, phase: run.phase === 'combat' ? 'combat' : 'shop', round: run.wave } as never, {});
  await flush();
  return pub;
}
const shopRun = (): RunState => ({ ...createVersusRun(5, 'warden', 'set2'), board: [bc('b1', 'dw_foreman'), bc('b2', 'dw_pimm')] } as RunState);

describe('R-SPECTATE-HOVER-01: the player\'s hover opens the same preview on the spectator screen', () => {
  it('the element\'s own React hover handler fires on enter and on leave; the CSS tip chain is lit with tt-on', async () => {
    await watch(shopRun(), 'hv');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const enter = vi.fn();
    const leave = vi.fn();
    const root: Root = createRoot(host);
    act(() => { root.render(<div className="heropanel"><button type="button" data-spec="heropower" onMouseEnter={enter} onMouseLeave={leave} onPointerEnter={enter}>p</button></div>); });
    act(() => { sp.receiveSpectatorCursor({ seat: 'p1', x: 0.1, y: 0.1, an: { k: 's:heropower', fx: 0.5, fy: 0.5 } }); });
    expect(enter).toHaveBeenCalledTimes(2); // onMouseEnter + onPointerEnter: whatever the preview listens to
    expect(host.querySelector('.heropanel')!.classList.contains('tt-on')).toBe(true);
    // A move within the same element sends the same key: nothing new fires.
    act(() => { sp.receiveSpectatorCursor({ seat: 'p1', x: 0.11, y: 0.1, an: { k: 's:heropower', fx: 0.6, fy: 0.5 } }); });
    expect(enter).toHaveBeenCalledTimes(2);
    // The player moves off it: the preview closes.
    act(() => { sp.receiveSpectatorCursor({ seat: 'p1', x: 0.5, y: 0.5 }); });
    expect(leave).toHaveBeenCalledTimes(1);
    expect(host.querySelector('.heropanel')!.classList.contains('tt-on')).toBe(false);
    act(() => { root.unmount(); });
  });

  it('no hover while a card is held or an aim is out; an idle hand keeps it; a hidden tab clears it', async () => {
    await watch(shopRun(), 'hv2');
    placed({ 'data-uid': 'b1' }, { left: 10, top: 10, width: 50, height: 70 });
    sp.receiveSpectatorCursor({ seat: 'p1', x: 0, y: 0, an: { k: 'u:b1', fx: 0.5, fy: 0.5 }, drag: { uid: 'h1', source: 'hand', cardId: 'dw_pimm' } });
    expect(hover.spectatorHoverKey()).toBeNull();
    sp.receiveSpectatorCursor({ seat: 'p1', x: 0, y: 0, an: { k: 'u:b1', fx: 0.5, fy: 0.5 } });
    expect(hover.spectatorHoverKey()).toBe('u:b1');
    sp.receiveSpectatorCursor({ seat: 'p1', x: 0, y: 0, hide: true, an: { k: 'u:b1', fx: 0.5, fy: 0.5 } }); // idle, still over it
    expect(hover.spectatorHoverKey()).toBe('u:b1');
    sp.receiveSpectatorCursor({ seat: 'p1', x: 0, y: 0, hide: true }); // the tab went to the background
    expect(hover.spectatorHoverKey()).toBeNull();
  });

  it('the sender puts the element under the pointer on the sample, and a hover change alone is a send', async () => {
    vi.useFakeTimers();
    setWindow(1920, 1080);
    const sent: { event: string; payload: { an?: { k: string } } }[] = [];
    tap.setSpectatorTap(true, 'p1', (event, payload) => sent.push({ event, payload: payload as never }));
    const card = placed({ 'data-uid': 's3' }, { left: 100, top: 100, width: 100, height: 100 });
    const inner = document.createElement('span');
    card.appendChild(inner);
    const ev = new MouseEvent('pointermove', { clientX: 150, clientY: 150, bubbles: true });
    inner.dispatchEvent(ev);
    vi.advanceTimersByTime(tap.CURSOR_TICK_MS + 1);
    expect(sent.at(-1)?.payload.an?.k).toBe('u:s3');
  });
});

describe('R-SPECTATE-DRAGGAP-01: the player\'s drop gap reaches the spectator\'s rows', () => {
  it('the decision travels in short form and lands as the drag store\'s decision, one object per distinct decision', async () => {
    const g = tap.wireDecisionOf('warband', { gapIndex: 2, shopGapIndex: -1, handGapIndex: -1, overWarband: true, collapsedLift: false, wouldMagnetize: false });
    expect(g).toEqual({ z: 'warband', gi: 2, ow: 1 });
    await watch(shopRun(), 'dg');
    sp.receiveSpectatorCursor({ seat: 'p1', x: 0.5, y: 0.6, drag: { uid: 'h1', source: 'hand', cardId: 'dw_pimm', g } });
    const d1 = sp.cursorFeed.drag!;
    expect(d1.overZone).toBe('warband');
    expect(d1.decision).toMatchObject({ gapIndex: 2, overWarband: true, shopGapIndex: -1 });
    sp.receiveSpectatorCursor({ seat: 'p1', x: 0.51, y: 0.6, drag: { uid: 'h1', source: 'hand', cardId: 'dw_pimm', g: { ...g } } });
    expect(sp.cursorFeed.drag!.decision).toBe(d1.decision); // unchanged: no re-render of the rows
    sp.receiveSpectatorCursor({ seat: 'p1', x: 0.6, y: 0.6, drag: { uid: 'h1', source: 'hand', cardId: 'dw_pimm', g: { ...g, gi: 0 } } });
    expect(sp.cursorFeed.drag!.decision.gapIndex).toBe(0);
    // An older sender: the card is lifted with no gap, as before.
    expect(sp.wireDecision(undefined).decision).toMatchObject({ gapIndex: -1, collapsedLift: true });
  });
});

describe('R-SPECTATE-AIM-01: the aim follows the player and lands on their target', () => {
  it('the line ends on the target minion\'s centre and lights it; the aim ending clears it', async () => {
    await watch(shopRun(), 'am');
    placed({ 'data-uid': 'b2' }, { left: 400, top: 300, width: 100, height: 140 });
    sp.receiveSpectatorCursor({ seat: 'p1', x: 0.3, y: 0.3, aim: { x: 0.1, y: 0.8, on: true, t: 'b2' } });
    expect(sp.cursorFeed.aim?.end).toEqual({ x: 450, y: 370 });
    expect(dragStore.get().aimTargetUid).toBe('b2');
    sp.receiveSpectatorCursor({ seat: 'p1', x: 0.3, y: 0.3, aim: { x: 0.1, y: 0.8, on: false } });
    expect(sp.cursorFeed.aim?.end).toBeNull();
    expect(dragStore.get().aimTargetUid).toBeNull();
    sp.receiveSpectatorCursor({ seat: 'p1', x: 0, y: 0, hide: true });
    expect(sp.cursorFeed.aim).toBeNull();
  });
});

describe('R-SPECTATE-JOIN-01: a mid-fight join lands at the player\'s moment', () => {
  const fight = { events: [], result: 'win', playerDamage: 0, initial: { player: [], enemy: [] } };
  const combatRun = (): RunState => ({ ...shopRun(), phase: 'combat' } as RunState);

  it('the player\'s keyframe carries its beat while the fight plays, never outside it', () => {
    tap.notePlayerBeat(1, 7);
    expect(tap.combatBeatFor({ phase: 'combat', wave: 1 })).toEqual({ w: 1, b: 7 });
    expect(tap.combatBeatFor({ phase: 'recruit', wave: 1 })).toBeNull();
    expect(tap.combatBeatFor({ phase: 'combat', wave: 2 })).toBeNull();
  });

  it('arriving mid-fight asks for a keyframe, and the fight starts at the beat the answer carries', async () => {
    const pub = newPublisher('p1');
    frames = [{ seat: 'p1', frame: nextSpectatorMessage(pub, combatRun(), 1, true) }];
    sp.spectateSync({ id: 'jn', phase: 'combat', round: 1 } as never, { 1: { round: 1, p1_result: fight, p2_result: fight } } as never);
    await flush();
    expect(useGame.getState().run.phase).toBe('combat');
    expect(io.requestKey).toHaveBeenCalledTimes(1);
    const key = nextSpectatorMessage(pub, combatRun(), 1, true)!;
    sp.receiveSpectate({ ...key, cb: { w: 1, b: 8 } });
    expect(sp.takeSpectatorResume(1)).toBe(8); // Recruit seeks the fight there as it mounts
  });

  it('a fight already on screen and behind seeks to the player\'s beat; a small lag plays on', async () => {
    const pub = newPublisher('p1');
    frames = [{ seat: 'p1', frame: nextSpectatorMessage(pub, combatRun(), 1, true) }];
    sp.spectateSync({ id: 'jn2', phase: 'combat', round: 1 } as never, { 1: { round: 1, p1_result: fight, p2_result: fight } } as never);
    await flush();
    sp.noteSpectatorBeat(1, 4); // the arena is on beat 4
    sp.receiveSpectate({ ...nextSpectatorMessage(pub, combatRun(), 1, true)!, cb: { w: 1, b: 5 } });
    expect(sp.useSpectate.getState().seek ?? null).toBeNull();
    sp.receiveSpectate({ ...nextSpectatorMessage(pub, combatRun(), 1, true)!, cb: { w: 1, b: 11 } });
    expect(sp.useSpectate.getState().seek).toMatchObject({ wave: 1, beat: 11 });
  });

  it('a late fight with no beat (an older player) cuts to the shop once the player is back there, without waiting for the replay', async () => {
    const pub = newPublisher('p1');
    frames = [{ seat: 'p1', frame: nextSpectatorMessage(pub, combatRun(), 1, true) }];
    sp.spectateSync({ id: 'jn3', phase: 'combat', round: 1 } as never, { 1: { round: 1, p1_result: fight, p2_result: fight } } as never);
    await flush();
    vi.useFakeTimers();
    const relight = vi.fn();
    const off = press.onPressCue('endCombat', relight);
    sp.receiveSpectate(nextSpectatorMessage(pub, { ...shopRun(), wave: 2 } as RunState, 2)!);
    expect(relight).toHaveBeenCalledTimes(1); // the exit starts at once (no replay-done, no strike wait)
    sp.spectatorFightCovered();
    expect(useGame.getState().run.phase).toBe('recruit');
    off();
  });
});

describe('R-SPECTATE-WATCHERS-01: the player sees who is spectating', () => {
  let root: Root | null = null;
  let host: HTMLElement;
  const render = (): void => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); act(() => { root!.render(<WatchersBadge />); }); };
  afterEach(() => { if (root) act(() => { root!.unmount(); }); root = null; });

  it('one plate per watcher (portrait ring, name, "Spectating") up to three, then "+N" with the names on the data-tip', () => {
    render();
    expect(host.querySelector('.vswatch')).toBeNull(); // nobody watching: nothing
    act(() => { watchers.setWatchers([
      { id: 'a', name: 'Ann', profile: null }, { id: 'b', name: '', profile: null },
      { id: 'c', name: 'Cid', profile: { avatar: 'x' } }, { id: 'd', name: 'Dee', profile: null },
    ]); });
    const plates = host.querySelectorAll('.vswatch-seat');
    expect(plates).toHaveLength(3);
    expect([...plates].map((p) => p.querySelector('.vsspec-name')!.textContent)).toEqual(['Ann', 'Spectator', 'Cid']);
    expect([...plates].every((p) => p.querySelector('.vswatch-tag')!.textContent === 'Spectating')).toBe(true);
    expect(host.querySelectorAll('.portring')).toHaveLength(3);
    const more = host.querySelector('.vswatch-more')!;
    expect(more.textContent).toBe('+1');
    expect(more.getAttribute('data-tip')).toBe('Dee');
    expect(host.querySelector('[title]')).toBeNull(); // never a native tooltip
    expect(host.textContent).not.toMatch(/[—–]/); // no dashes in player text
    // they leave: it goes
    act(() => { watchers.setWatchers([]); });
    expect(host.querySelector('.vswatch')).toBeNull();
  });

  it('re-renders only on a join or leave; order is stable; hidden on the watch screen itself', () => {
    const list = [{ id: 'a', name: 'Ann', profile: null }];
    watchers.setWatchers(list);
    const before = watchers.useWatchers.getState().list;
    watchers.setWatchers([{ id: 'a', name: 'Ann', profile: null }]);
    expect(watchers.useWatchers.getState().list).toBe(before);
    watchers.setWatchers([{ id: 'b', name: 'Bo', profile: null }, { id: 'a', name: 'Ann', profile: null }]);
    expect(watchers.useWatchers.getState().list.map((w) => w.id)).toEqual(['a', 'b']);
    sp.useSpectate.setState({ active: true });
    render();
    expect(host.querySelector('.vswatch')).toBeNull();
    sp.useSpectate.setState({ active: false });
  });

  it('Versus: the room\'s spectator members, only while I hold a seat', () => {
    const room = { members: [
      { userId: 'p1', role: 'p1', displayName: 'Me', profile: {} },
      { userId: 's1', role: 'spectator', displayName: 'Sam', profile: { avatar: 'a1' } },
    ] } as never;
    expect(versusWatchersOf(room, true)).toEqual([{ id: 's1', name: 'Sam', profile: { avatar: 'a1' } }]);
    expect(versusWatchersOf(room, false)).toEqual([]);
  });
});

describe('R-SPECTATE-AV-04: sounds on the watch screen', () => {
  it('a watched shop action plays its sound', async () => {
    const run0 = shopRun();
    const pub = await watch(run0, 'au');
    vi.useFakeTimers();
    const buy = vi.spyOn(sfx, 'buy').mockImplementation(() => {});
    const offer = run0.shop.find(Boolean)!;
    const bought = { ...run0, shop: run0.shop.map((o) => (o?.uid === offer.uid ? null : o)), hand: [...run0.hand, bc(offer.uid, offer.cardId)] } as RunState;
    const m = nextSpectatorMessage(pub, bought, 1)!;
    m.acts = [{ t: 'buy', uid: offer.uid }];
    sp.receiveSpectate(m);
    vi.advanceTimersByTime(200);
    expect(buy).toHaveBeenCalledTimes(1);
  });

  it('a watched combat beat plays its sounds through the same channel, on the watch screen', async () => {
    await watch(shopRun(), 'au2');
    expect(useGame.getState().replaying && useGame.getState().replaySession === null).toBe(true); // the watch screen
    const attack = vi.spyOn(sfx, 'attack').mockImplementation(() => {});
    const death = vi.spyOn(sfx, 'death').mockImplementation(() => {});
    const events = [
      { type: 'attack', attacker: 'b1', defender: 'e1', swing: 0 },
      { type: 'dmg', target: 'e1', source: 'b1', amount: 3, remainingHp: 0 },
      { type: 'death', target: 'e1', side: 'enemy' },
    ] as unknown as CombatEvent[];
    for (const m of compileMoments(events)) playMomentSfx(m, events);
    expect(attack).toHaveBeenCalled();
    expect(death).toHaveBeenCalled();
  });

  it('a refused action is never tagged for the stands; an accepted one is', () => {
    const run = createLobbyRun(4321, 'warden');
    useGame.setState({ run: { ...run, embers: 0 } as RunState, replaying: false, showTitle: false });
    tap.setSpectatorTap(true, 'p1', vi.fn());
    tap.takeActs();
    const offer = useGame.getState().run.shop.find(Boolean)!;
    useGame.getState().dispatch({ type: 'buy', uid: offer.uid }); // no Gold: refused
    expect(tap.takeActs()).toEqual([]);
    useGame.getState().dispatch({ type: 'freeze' });
    expect(tap.takeActs().map((a) => a.t)).toEqual(['freeze']);
  });
});
