// @vitest-environment jsdom
/**
 * A SPECTATOR SEES THE WATCHED PLAYER'S DUOS SCREEN 1:1 (owner reports 2026-11-02, live spectating Versus / Duos):
 *  - "bug with spectating - mouse goes under equipment it looks like" (R-SPECTATE-CURSOR-LAYER-01): the watched hand is
 *    ONE root layer for every spectate path, never inside `.app` (a stacking context under the hero cluster);
 *  - "im spectating and antsy died and i didnt see the pass animation" (R-SPECTATE-DUOS-PASS-01): every send and every
 *    arrival the player's screen streamed plays on the stands' screen too, from the frames they receive;
 *  - "i also dont see the team names of the duos" (R-SPECTATE-DUOS-TEAMNAMES-01): the rail's team names read from the
 *    watched player's side;
 *  - "im realizing i dont see the teammate portrait at all as a spec" (R-SPECTATE-DUOS-MATEDOCK-01): the watched
 *    player's teammate portrait, bottom right, with its live signals.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createVersusRun, type BoardCard, type RunState, type VersusGroupMatchRaw } from '@game/sim';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });
vi.mock('./passLob', async (orig) => ({
  ...(await orig<typeof import('./passLob')>()),
  playEntryFlight: vi.fn(() => true),
  playWatchedDragPass: vi.fn(() => true),
  playArrival: vi.fn(),
}));

const lob = await import('./passLob');
const sp = await import('./spectate');
const { newPublisher, nextSpectatorMessage } = await import('./spectatorView');
const { useGame } = await import('../store');
const { dragStore } = await import('../dragStore');
const { watchedPasses, isDragPass } = await import('./spectatorPasses');
const { spectatorCursorOn } = await import('./SpectatorCursorLayer');
const { rankedTeamLabels } = await import('./rankedDuosView');
const { mount } = await import('../renderedText.mount');
const { DuosMateDock } = await import('./DuosMateDock');
const { useVersus } = await import('./versusStore');
const { act } = await import('react');
const duosCombat = await import('./duosCombat');

const src = (rel: string): string => readFileSync(join(__dirname, rel), 'utf8');
const strip = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');
const flush = async (): Promise<void> => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
const bc = (uid: string, cardId: string, extra: Partial<BoardCard> = {}): BoardCard => ({ uid, cardId, tribe: 'dwarf', attack: 2, health: 2, keywords: [], golden: false, ...extra }) as unknown as BoardCard;
type Duos = NonNullable<RunState['duos']>;
const duosRun = (duos: Partial<Duos> = {}, patch: Partial<RunState> = {}): RunState => ({
  ...createVersusRun(5, 'warden', 'set2'), board: [bc('b1', 'dw_foreman')], hand: [bc('h1', 'dw_pimm')],
  duos: { outbox: [], received: [], refused: [], ...duos }, ...patch,
} as RunState);
const entry = (seq: number, card: BoardCard, extra: Partial<Duos['outbox'][number]> = {}): Duos['outbox'][number] =>
  ({ seq, wave: 1, card, from: 'hand', index: 0, ...extra }) as Duos['outbox'][number];

let frames: { seat: 'p1' | 'p2'; frame: unknown }[] = [];
const io = { latestFrames: vi.fn(async () => frames), requestKey: vi.fn(), loadRounds: vi.fn(), lobbyFor: vi.fn(() => undefined) };

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (f: FrameRequestCallback) => { f(0); return 0; });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  sp.installSpectateIo(io);
});
afterEach(() => {
  sp.resetSpectate();
  sp.installSpectateIo(null);
  dragStore.reset();
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.useRealTimers();
  useVersus.setState({ room: null, match: null } as never);
});

async function watch(run: RunState, id: string): Promise<ReturnType<typeof newPublisher>> {
  const pub = newPublisher('p1');
  frames = [{ seat: 'p1', frame: nextSpectatorMessage(pub, run, run.wave, true) }];
  sp.spectateSync({ id, phase: run.phase === 'combat' ? 'combat' : 'shop', round: run.wave } as never, {});
  await flush();
  return pub;
}

describe('R-SPECTATE-CURSOR-LAYER-01: the watched hand paints over the whole HUD', () => {
  it('who draws it: the Versus stands in a shop or fight, a Live Games watcher, a recorded stream; never a Duos teammate view', () => {
    const base = { replayStream: false, watching: true, teammate: false, versusScreen: true, versusSpectator: true, liveGame: false, preRun: false };
    expect(spectatorCursorOn(base)).toBe(true);
    expect(spectatorCursorOn({ ...base, preRun: true })).toBe(false); // Hero Select: no shop on screen yet
    expect(spectatorCursorOn({ ...base, versusSpectator: false })).toBe(false); // a seated player
    expect(spectatorCursorOn({ ...base, teammate: true })).toBe(false); // a Duos player watching their teammate
    expect(spectatorCursorOn({ ...base, versusScreen: false, versusSpectator: false, liveGame: true })).toBe(true);
    expect(spectatorCursorOn({ ...base, watching: false })).toBe(false);
    expect(spectatorCursorOn({ ...base, watching: false, replayStream: true })).toBe(true);
  });

  it('ONE mount, at the app root (outside `.app` and Recruit), not inside the spectator chrome', () => {
    const game = src('../Game.tsx');
    expect(game).toContain('<SpectatorCursorLayer />');
    expect(game).not.toMatch(/<SpectatorCursor \/>/);
    expect(src('./SpectatorBar.tsx')).not.toMatch(/<SpectatorCursor\b/);
    expect(src('../live/LiveWatchBar.tsx')).not.toMatch(/<SpectatorCursor\b/);
    expect(src('../Recruit.tsx')).not.toMatch(/<SpectatorCursor(Layer)?\b/);
    // In Game it sits in the replay layers' block, after the main skin scope that holds Recruit and the StatusBar.
    expect(game.indexOf('<SpectatorCursorLayer />')).toBeGreaterThan(game.indexOf('</OwnSkins>'));
  });

  it('its rung (z540) is above every HUD piece it used to slip under: the hero cluster, the rail, the teammate portrait', () => {
    const css = strip(src('../styles.css')) + strip(src('./versus.css'));
    const zOf = (sel: RegExp): number[] => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter((m) => sel.test(m[1]!)).map((m) => /z-index:\s*(\d+)/.exec(m[2]!)?.[1]).filter(Boolean).map(Number);
    const cursor = zOf(/^\s*\.replay-dragghost\s*$/);
    expect(cursor).toEqual([540]);
    for (const hud of [/\.statusbar\s*$/, /\.lobbyrail(head)?\.vsdrawer/, /^\s*\.duosdock(\.\w+)?\s*$/, /^\s*\.duostagin\s*$/]) {
      const zs = zOf(hud);
      expect(zs.length, String(hud)).toBeGreaterThan(0);
      expect(Math.max(...zs), String(hud)).toBeLessThan(540);
    }
  });
});

describe('R-SPECTATE-DUOS-PASS-01: the passes of the watched run (pure)', () => {
  it('a new outbox entry is a send; a fight\'s gift waits for its beat; a refunded one never streams', () => {
    const a = duosRun();
    const send = entry(0, bc('h1', 'dw_pimm'), { team: { kind: 'gift', cardId: 'dw_pimm' } as never, src: { uid: 'b1' } });
    const gift = entry(1, bc('team1', '__team'), { combatIdx: 0, team: { kind: 'gift' } as never });
    const b = duosRun({ outbox: [send, gift] });
    expect(watchedPasses(a, b).sends).toEqual([send]);
    expect(watchedPasses(b, b)).toEqual({ sends: [], arrivals: [] });
    expect(watchedPasses(a, duosRun({ outbox: [{ ...send, refunded: true }] })).sends).toEqual([]);
    // Another run (a seat switch), or a run's first Duos frame: nothing to compare, nothing plays.
    expect(watchedPasses({ ...a, runId: 'other' }, b).sends).toEqual([]);
    expect(watchedPasses({ ...a, duos: undefined }, b).sends).toEqual([]);
    expect(isDragPass(entry(2, bc('h1', 'dw_pimm')))).toBe(true);
    expect(isDragPass(send)).toBe(false);
  });

  it('a newly received key that put a card in the hand is an arrival into that card; a triple shows the Gild instead', () => {
    const a = duosRun();
    const b = duosRun({ received: ['p2:3'] }, { hand: [bc('h1', 'dw_pimm'), bc('b9', 'dw_foreman', { passKey: 'p2:3' })] });
    expect(watchedPasses(a, b).arrivals).toEqual(['b9']);
    expect(watchedPasses(a, { ...b, triplesMade: (a.triplesMade ?? 0) + 1 }).arrivals).toEqual([]);
    // A teammate's gift card (no pass key) lands too.
    const g = duosRun({ received: ['p2:4'] }, { hand: [bc('h1', 'dw_pimm'), bc('b10', 'dw_foreman')] });
    expect(watchedPasses(a, g).arrivals).toEqual(['b10']);
  });
});

describe('R-SPECTATE-DUOS-PASS-01: the stands play them as the frames land', () => {
  it('an effect send streams from its source while it is still on screen, keyed by the watched run', async () => {
    const run = duosRun();
    const pub = await watch(run, 'pd1');
    let seen: RunState | null = null;
    vi.mocked(lob.playEntryFlight).mockImplementation(() => { seen = useGame.getState().run; return true; });
    const send = entry(0, bc('h1', 'dw_pimm'), { team: { kind: 'gift', cardId: 'dw_pimm' } as never, src: { uid: 'b1' } });
    sp.receiveSpectate(nextSpectatorMessage(pub, duosRun({ outbox: [send] }), run.wave)!);
    sp.flushSpectateRender();
    expect(lob.playEntryFlight).toHaveBeenCalledTimes(1);
    const [e, onScreen, id] = vi.mocked(lob.playEntryFlight).mock.calls[0]!;
    expect(e).toMatchObject({ seq: 0, src: { uid: 'b1' } });
    expect(id).toBe((onScreen as RunState).runId);
    // It played on the screen BEFORE the new frame (its source is still drawn there).
    expect(seen!.duos!.outbox).toHaveLength(0);
    expect(useGame.getState().run.duos!.outbox).toHaveLength(1);
  });

  it('a drag pass streams from the held card where it was let go (once), and the card never springs back', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'Date'] });
    const run = duosRun();
    const pub = await watch(run, 'pd2');
    const t0 = performance.now();
    const sample = (patch: object): unknown => ({ seat: 'p1', x: 0.5, y: 0.5, gx: 0.5, gy: 0.5, ...patch });
    sp.receiveSpectatorCursor(sample({ ts: t0, drag: { uid: 'h1', source: 'hand', cardId: 'dw_pimm', g: { z: 'warband', gi: 0 } } }));
    sp.receiveSpectatorCursor(sample({ ts: t0 + 50, drag: null, de: 'c' }));
    vi.advanceTimersByTime(400);
    sp.advanceCursorFeed(performance.now());
    expect(sp.cursorFeed.landing?.drag.uid).toBe('h1');
    const next = duosRun({ outbox: [entry(0, bc('h1', 'dw_pimm'), { paid: 1 })] }, { hand: [] });
    const msg = nextSpectatorMessage(pub, next, next.wave)!;
    msg.acts = [{ t: 'passCard', uid: 'h1' }];
    sp.receiveSpectate(msg);
    vi.advanceTimersByTime(100);
    expect(lob.playWatchedDragPass).toHaveBeenCalledTimes(1);
    expect(vi.mocked(lob.playWatchedDragPass).mock.calls[0]![0]).toBe('h1');
    expect(vi.mocked(lob.playWatchedDragPass).mock.calls[0]![2]).toBe(true); // a paid pass: its coin follows
    expect(sp.cursorFeed.landing).toBeNull();
    vi.advanceTimersByTime(sp.LAND_WAIT_MS + 50);
    sp.advanceCursorFeed(performance.now());
    expect(sp.cursorFeed.spring).toBeNull();
    expect(useGame.getState().run.hand).toEqual([]);
  });

  it('a drag pass from an older player (no tag, no held card) still streams, from the hand card', async () => {
    const run = duosRun();
    const pub = await watch(run, 'pd3');
    sp.receiveSpectate(nextSpectatorMessage(pub, duosRun({ outbox: [entry(0, bc('h1', 'dw_pimm'), { paid: 0 })] }, { hand: [] }), run.wave)!);
    sp.flushSpectateRender();
    expect(lob.playWatchedDragPass).toHaveBeenCalledWith('h1', null, false);
    expect(lob.playEntryFlight).not.toHaveBeenCalled();
  });

  it('a pass landing in the watched hand streams out of the teammate portrait into its slot, after the frame is in', async () => {
    const run = duosRun();
    const pub = await watch(run, 'pd4');
    let inStore = false;
    vi.mocked(lob.playArrival).mockImplementation((uid) => { inStore = useGame.getState().run.hand.some((c) => c.uid === uid); });
    sp.receiveSpectate(nextSpectatorMessage(pub, duosRun({ received: ['p2:0'] }, { hand: [bc('h1', 'dw_pimm'), bc('b7', 'dw_foreman', { passKey: 'p2:0' })] }), run.wave)!);
    sp.flushSpectateRender();
    expect(lob.playArrival).toHaveBeenCalledWith('b7');
    expect(inStore).toBe(true);
  });

  it('the stands play the fight\'s gifts on their beat of this screen\'s replay, never before it', () => {
    const { useDuosCombatSync } = duosCombat;
    sp.useSpectate.setState({ active: true, seat: 'p1' });
    useVersus.setState({ match: { group: { me: null, raw: { seats: [] } } } } as never);
    const gift = entry(0, bc('team0', '__team'), { combatIdx: 0, team: { kind: 'gift' } as never });
    const run = duosRun({ outbox: [gift] }, { phase: 'combat', wave: 1 });
    useGame.setState({ run });
    const events = [{ type: 'attack' }, { type: 'teamSend', side: 'player', member: 0, idx: 0, uid: 'u9' }] as never[];
    const combat = { events } as never;
    function Sync({ end }: { end: number }): null { useDuosCombatSync(combat, events, end, true); return null; }
    const ui = mount(<Sync end={1} />);
    try {
      expect(lob.playEntryFlight).not.toHaveBeenCalled(); // the beat is not reached yet
      ui.render(<Sync end={2} />);
      expect(lob.playEntryFlight).toHaveBeenCalledTimes(1);
      const [e, , id] = vi.mocked(lob.playEntryFlight).mock.calls[0]!;
      expect(e).toBe(gift);
      expect(id).toBe(run.runId);
    } finally { ui.unmount(); sp.useSpectate.setState({ active: false, seat: 'p1' }); }
  });
});

describe('R-SPECTATE-DUOS-TEAMNAMES-01: the rail names the teams from the watched player\'s side', () => {
  it('the watched seat stands in for a viewer seat, and its team reads its own name', () => {
    const raw = {
      id: 'm', mode: 'ranked_duos', teamName: 'Gold Rush',
      seats: [{ seat: 'p1', name: 'Ann' }, { seat: 'p2', name: 'Bob' }, { seat: 'p3', name: 'Cy', served: true, team: 'b' }, { seat: 'p4', name: 'Di', served: true, team: 'b' }],
    } as unknown as VersusGroupMatchRaw;
    const fromWatched = rankedTeamLabels(raw, 'p2', { b: 'Night Owls' });
    expect(Object.values(fromWatched).sort()).toEqual(['Gold Rush', 'Night Owls']);
    expect(fromWatched.s0).toBe('Gold Rush');
    // The rail falls back to the watched seat when the viewer has none (a spectator).
    expect(src('../LobbyPanel.tsx')).toMatch(/const rankedMe = rankedSeat \?\? watchedSeat;/);
  });
});

describe('R-SPECTATE-DUOS-MATEDOCK-01: the watched player\'s teammate portrait', () => {
  const seat = (s: string, userId: string, name: string, hero: string) => ({ seat: s, userId, name, hero });
  beforeEach(() => {
    useVersus.setState({
      room: { members: [] },
      match: { round: 2, phase: 'shop', group: { me: null, duos: { team: 'a', mate: null, first: { a: 'p1', b: 'p3' } }, raw: { seats: [
        seat('p1', 'u1', 'Ann', 'warden'), seat('p2', 'u2', 'Bob', 'warden'), seat('p3', 'u3', 'Cy', 'warden'), seat('p4', 'u4', 'Di', 'warden'),
      ] } } },
    } as never);
  });

  it('a spectator watching p3 sees p4, bottom right: a face, never a pass target or a button', () => {
    sp.useSpectate.setState({ active: true, seat: 'p3' });
    const ui = mount(<DuosMateDock watching={false} stands />);
    try {
      const hold = ui.container.querySelector('[data-duos-mate]');
      expect(hold).not.toBeNull(); // the target the pass streams fly into and out of
      expect(hold!.getAttribute('aria-label')).toContain('Di');
      expect(hold!.getAttribute('role')).toBeNull();
      act(() => { dragStore.set({ passOver: 'ok', passReason: null }); });
      expect(ui.container.querySelector('.duosdock')!.className).not.toContain('pass-ok');
    } finally { ui.unmount(); sp.useSpectate.setState({ active: false, seat: 'p1' }); }
  });

  it('switching who is watched switches the teammate; the teammate\'s tier-up plays its burst', () => {
    sp.useSpectate.setState({ active: true, seat: 'p1' });
    const ui = mount(<DuosMateDock watching={false} stands />);
    try {
      expect(ui.container.querySelector('[data-duos-mate]')!.getAttribute('aria-label')).toContain('Bob');
      act(() => { sp.useSpectate.setState({ seat: 'p4' }); });
      expect(ui.container.querySelector('[data-duos-mate]')!.getAttribute('aria-label')).toContain('Cy');
    } finally { ui.unmount(); sp.useSpectate.setState({ active: false, seat: 'p1' }); }
  });

  it('the spectator bar mounts it in the shop and the fight, and the stands record the teammates\' signals', () => {
    expect(src('./SpectatorBar.tsx')).toMatch(/mateDock && <DuosMateDock key="dock" watching=\{false\} inCombat=\{phase === 'combat'\} stands \/>/);
    expect(src('./spectate.ts')).toMatch(/if \(\(asPlayer \|\| duosStands\(\)\) && msg\.kind !== 'hero'\) noteMateFrame/);
  });
});

