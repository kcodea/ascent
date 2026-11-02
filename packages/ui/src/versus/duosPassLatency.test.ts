// @vitest-environment jsdom
/**
 * VERSUS DUOS — A PASS LANDS AS SOON AS THE SERVER HAS IT (R-DUOS-PASS-LATENCY-01; player report 2026-11-02: "i watched
 * you send over roomworks and it took like 8 seconds before it showed up in my hand"; owner: "sometimes passes take
 * literally 10 seconds"). Measured on the local Cloudflare stack (scripts/versus-qa/pass-latency.mjs): on the receiver's
 * own screen the card was in hand ~70 ms after the send, but a receiver WATCHING the sender's screen got it only when the
 * heartbeat's 12 s backstop re-read the passes (2.7 s and 11.0 s), because the pull landed it on the teammate's
 * render-only run, which swallows every dispatch. Now:
 *  - the room's `pass` push lands the row it carries at once, with no read in between;
 *  - a push that comes while I watch my teammate is kept and lands the moment I am back on my own screen;
 *  - a send that failed for a transient reason is retried on a short timer, not only on my next run change.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });

const watching = vi.hoisted(() => ({ on: false, run: null as unknown }));
const remote = vi.hoisted(() => ({
  duosPass: vi.fn(async (..._a: unknown[]): Promise<unknown> => ({})),
  duosPasses: vi.fn(async (..._a: unknown[]): Promise<unknown[]> => []),
  duosAnswerPass: vi.fn(async (..._a: unknown[]): Promise<unknown> => ({})),
  duosHandRoom: vi.fn(async (..._a: unknown[]): Promise<unknown> => null),
}));
vi.mock('./versusRemote', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  versusRemote: remote,
}));
vi.mock('./spectate', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ownRunWhileWatching: () => (watching.on ? watching.run : null),
}));
vi.mock('./passLob', () => ({ playArrival: () => undefined, playEntryFlight: () => undefined }));

const { duosAfterRun, duosBackFromMate, duosPushed, duosReset, DUOS_PASS_RETRY_MS, duosPassRetryDelay } = await import('./duosPasses');
const { useGame } = await import('../store');
const { CARD_INDEX } = await import('@game/content');
const { createVersusRun } = await import('@game/sim');

const MATCH = 'm1';
function duosRun() {
  const run = createVersusRun(11, 'warden', 'set2', { v: 1, mode: 'duos', modifiers: [] });
  return { ...run, hand: [], board: [], embers: 5, uidSeq: 300 };
}
const def = Object.values(CARD_INDEX).find((c) => c && !c.spell && !c.token && c.tier === 1)!;
const card = (uid: string) => ({ uid, cardId: def.id, tribe: def.tribe, attack: def.attack, health: def.health, keywords: [...def.keywords], golden: false, passFrom: 'hand' });
const rowTo = (to: 'p1' | 'p2', seq: number, round: number) => ({
  match_id: MATCH, round, from_seat: to === 'p1' ? 'p2' as const : 'p1' as const, to_seat: to, seq, card: card(`in${seq}`), status: 'sent' as const,
});
const flush = async (): Promise<void> => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

/** My seat (p2) with a run that has reconciled (its restore read answered: nothing to replay). */
async function readySeat() {
  const run = duosRun();
  useGame.setState({ run, replaying: false });
  duosAfterRun(MATCH, 'p2', run);
  await flush();
  return run;
}

beforeEach(() => {
  duosReset();
  watching.on = false;
  watching.run = null;
  for (const f of Object.values(remote)) f.mockClear();
});

describe('a pushed pass lands at once (R-DUOS-PASS-LATENCY-01)', () => {
  it('the push carries the row: the card is in my hand in the same tick, with no read first', async () => {
    const run = await readySeat();
    const reads = remote.duosPasses.mock.calls.length;
    duosPushed(MATCH, 'p2', rowTo('p2', 0, run.wave));
    const now = useGame.getState().run;
    expect(now.hand.map((c) => c.cardId)).toEqual([def.id]);
    expect(now.duos!.received).toEqual(['p1:0']);
    expect(remote.duosPasses.mock.calls.length).toBe(reads); // no poll / read in the delivery path
    expect(remote.duosAnswerPass).toHaveBeenCalledWith(MATCH, 'p1', 0, true);
  });

  it('the same row again (the backstop pull, a second push) lands nothing twice', async () => {
    const run = await readySeat();
    duosPushed(MATCH, 'p2', rowTo('p2', 0, run.wave));
    duosPushed(MATCH, 'p2', rowTo('p2', 0, run.wave));
    expect(useGame.getState().run.hand).toHaveLength(1);
  });

  it('watching my teammate: nothing lands on their run; it lands the moment I am back on my own screen', async () => {
    const run = await readySeat();
    // The store now holds my teammate's render-only run; mine is set aside.
    watching.on = true;
    watching.run = run;
    const theirs = { ...duosRun(), runId: 'spectate:m1:p1' };
    useGame.setState({ run: theirs, replaying: true });
    duosPushed(MATCH, 'p2', rowTo('p2', 0, run.wave));
    expect(useGame.getState().run).toBe(theirs);
    // Back: my run is restored, then the screen flag drops.
    useGame.setState({ run, replaying: false });
    watching.on = false;
    duosBackFromMate(run.wave);
    expect(useGame.getState().run.hand.map((c) => c.cardId)).toEqual([def.id]); // same tick, before any read answers
    expect(remote.duosPasses).toHaveBeenCalled(); // and a read, for anything no push carried
  });

  it('a send that fails for a transient reason goes out again on a timer, with no run change', async () => {
    vi.useFakeTimers();
    try {
      remote.duosPass.mockRejectedValueOnce(new Error('timeout'));
      const run = await readySeat();
      const sent = { ...run, hand: [card('h1')] as never };
      useGame.setState({ run: sent });
      useGame.getState().dispatch({ type: 'passCard', uid: 'h1' });
      const after = useGame.getState().run;
      duosAfterRun(MATCH, 'p2', after);
      await flush();
      expect(remote.duosPass).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(DUOS_PASS_RETRY_MS);
      expect(remote.duosPass).toHaveBeenCalledTimes(2);
      expect(remote.duosPass.mock.calls[1]![2]).toBe(remote.duosPass.mock.calls[0]![2]); // the same seq: the server takes it once
    } finally {
      vi.useRealTimers();
    }
  });

  it('the retry backs off to a cap, so an offline client is not hammered', () => {
    expect([1, 2, 3, 4, 5, 9].map(duosPassRetryDelay)).toEqual([1000, 2000, 4000, 8000, 8000, 8000]);
  });
});

describe('the store wiring (R-DUOS-PASS-LATENCY-01)', () => {
  const src = readFileSync(join(__dirname, 'versusStore.ts'), 'utf8');
  it('the room subscription hands a pushed pass row straight to the transport', () => {
    const i = src.indexOf('versusRemote.subscribeRoom(session.roomId');
    const body = src.slice(i, i + 600);
    expect(body).toMatch(/what === 'passes' && row\) pushDuosPass\(row\)/);
    expect(src).toMatch(/duosPushed\(raw\.id, me, row/);
  });
  it('leaving my teammate\'s screen lands what came while I watched', () => {
    expect(src).toMatch(/prev\.teammate && !s\.teammate && session\) backFromMate\(\)/);
    expect(src).toMatch(/duosBackFromMate\(raw\.round\)/);
  });
});
