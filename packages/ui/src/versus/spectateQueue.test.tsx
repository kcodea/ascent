// @vitest-environment jsdom
/**
 * THE STANDS' ACTION QUEUE NEVER HOLDS THE SCREEN BEHIND THE PLAYER (owner 2026-10-29: "make sure spectating is also
 * extremely clean"; found by the spectator cells of the Cloudflare chaos matrix, R-SPECTATE-HARNESS-01):
 *  - R-SPECTATE-LANDWAIT-01: an action waits for the drawn hand at most MAX_LAND_WAIT_MS IN ALL. The cap used to be per
 *    retry, so a hand whose clock read ahead kept the queue waiting for as long as its cursor kept arriving (the stands
 *    sat on the shop through a whole fight).
 *  - R-SPECTATE-STALE-SHOP-01: a shop action made before the fight that is already on screen is dropped, never landed:
 *    landing it took the screen out of the fight, back to the old shop ("combat 1 -> recruit 1").
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createVersusRun, type BoardCard, type RunState } from '@game/sim';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });

const sp = await import('./spectate');
const tap = await import('./spectateTap');
const { dragStore } = await import('../dragStore');
const { newPublisher, nextSpectatorMessage } = await import('./spectatorView');
const { useGame } = await import('../store');

const flush = async (): Promise<void> => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
let frames: { seat: 'p1' | 'p2'; frame: unknown }[] = [];
const io = { latestFrames: vi.fn(async () => frames), requestKey: vi.fn(), loadRounds: vi.fn(), lobbyFor: vi.fn(() => undefined) };
const bc = (uid: string, cardId: string): BoardCard => ({ uid, cardId, tribe: 'dwarf', attack: 2, health: 2, keywords: [], golden: false }) as unknown as BoardCard;
const shopRun = (): RunState => ({ ...createVersusRun(5, 'warden', 'set2'), board: [bc('b1', 'dw_foreman')], hand: [bc('h1', 'dw_pimm')] } as RunState);
const fight = { events: [], result: 'win', playerDamage: 0, initial: { player: [], enemy: [] } };
const rounds = { 1: { round: 1, p1_result: fight, p2_result: fight } } as never;
const sample = (patch: object): unknown => ({ seat: 'p1', x: 0.5, y: 0.5, gx: 0.5, gy: 0.5, ...patch });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'Date'] });
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
  vi.useRealTimers();
  tap.setSpectatorTap(false, null, null);
});

async function watch(run: RunState, id: string): Promise<ReturnType<typeof newPublisher>> {
  const pub = newPublisher('p1');
  frames = [{ seat: 'p1', frame: nextSpectatorMessage(pub, run, run.wave, true) }];
  sp.spectateSync({ id, phase: 'shop', round: 1 } as never, rounds);
  await flush();
  return pub;
}
/** The hand keeps moving (a fresh cursor message every 100 ms), its clock reading `ahead` ms ahead of the action. */
function handMoves(t0: number, ms: number): void {
  for (let t = 0; t < ms; t += 100) {
    sp.receiveSpectatorCursor(sample({ ts: t0 + t }));
    vi.advanceTimersByTime(100);
  }
}

describe('the stands\' queue', () => {
  it('an action whose moment the hand never seems to reach still lands within MAX_LAND_WAIT_MS (R-SPECTATE-LANDWAIT-01)', async () => {
    const run = shopRun();
    const pub = await watch(run, 'q1');
    const t0 = performance.now();
    sp.receiveSpectatorCursor(sample({ ts: t0 }));
    const next = { ...run, hand: [], board: [bc('h1', 'dw_pimm'), ...run.board] } as RunState;
    const msg = nextSpectatorMessage(pub, next, 1)!;
    msg.acts = [{ t: 'play', uid: 'h1', ts: t0 + 60_000 }]; // stamped far ahead of the hand's clock
    sp.receiveSpectate(msg);
    handMoves(t0, 700);
    expect(useGame.getState().run.board.map((c) => c.uid)).toEqual(['h1', 'b1']);
  });

  it('a shop action from before the fight on screen is dropped: the screen never goes back to that shop (R-SPECTATE-STALE-SHOP-01)', async () => {
    const run = shopRun();
    const pub = await watch(run, 'q2');
    const t0 = performance.now();
    sp.receiveSpectatorCursor(sample({ ts: t0 }));
    // The last shop action, still waiting for the hand...
    const played = { ...run, hand: [], board: [bc('h1', 'dw_pimm'), ...run.board] } as RunState;
    const msg = nextSpectatorMessage(pub, played, 1)!;
    msg.acts = [{ t: 'play', uid: 'h1', ts: t0 + 300 }];
    sp.receiveSpectate(msg);
    // ...when the fight arrives, and a match update puts it on screen.
    sp.receiveSpectate(nextSpectatorMessage(pub, { ...played, phase: 'combat' } as RunState, 1)!);
    sp.spectateSync({ id: 'q2', phase: 'combat', round: 1 } as never, rounds);
    expect(useGame.getState().run.phase).toBe('combat');
    const seen: string[] = [];
    const off = useGame.subscribe((s) => seen.push(`${s.run.phase} ${s.run.wave}`));
    handMoves(t0, 4000); // past the exit curtain's safety (a mounted Recruit covers sooner)
    off();
    expect(seen).not.toContain('recruit 1');
    expect(useGame.getState().run.phase).toBe('combat');
  });
});

describe('the blow lands on the beat (R-SPECTATE-STRIKE-01)', () => {
  // Owner 2026-10-29: "spectating is doing some janky stuff at end of combat ... showing a hit or something weird".
  async function intoFight(id: string): Promise<{ pub: ReturnType<typeof newPublisher>; fightRun: RunState }> {
    const run = shopRun();
    const pub = await watch(run, id);
    const fightRun = { ...run, phase: 'combat' } as RunState;
    sp.receiveSpectate(nextSpectatorMessage(pub, fightRun, 1)!);
    sp.spectateSync({ id, phase: 'combat', round: 1 } as never, rounds);
    expect(useGame.getState().run.phase).toBe('combat');
    return { pub, fightRun };
  }

  it('the watched Health drops at the strike impact, never a fixed time after the replay (and never mid-strike)', async () => {
    const { pub, fightRun } = await intoFight('st1');
    const before = useGame.getState().run.resolve;
    // The player's own screen settles at its impact: their settled view arrives while this screen still plays the fight.
    sp.receiveSpectate(nextSpectatorMessage(pub, { ...fightRun, combatSettled: true, resolve: before - 7 } as RunState, 1)!);
    useGame.setState({ combatReplayDone: true });
    sp.spectatorStrikeStarted();
    vi.advanceTimersByTime(4000); // a long cosmetic strike: past the old fixed 2.6 s
    sp.flushSpectateRender();
    expect(useGame.getState().run.resolve).toBe(before);
    expect(useGame.getState().run.combatSettled).toBe(false);
    sp.spectatorStrikeLanded(); // the impact
    sp.flushSpectateRender();
    expect(useGame.getState().run.resolve).toBe(before - 7);
    expect(useGame.getState().run.phase).toBe('combat');
  });

  it('a strike that never reports its impact still lets the fight go (safety)', async () => {
    const { pub, fightRun } = await intoFight('st2');
    const before = useGame.getState().run.resolve;
    sp.receiveSpectate(nextSpectatorMessage(pub, { ...fightRun, combatSettled: true, resolve: before - 3 } as RunState, 1)!);
    useGame.setState({ combatReplayDone: true });
    sp.spectatorStrikeStarted();
    vi.advanceTimersByTime(10_000);
    sp.flushSpectateRender();
    expect(useGame.getState().run.resolve).toBe(before - 3);
  });
});
