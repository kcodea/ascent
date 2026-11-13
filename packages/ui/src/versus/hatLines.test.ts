// @vitest-environment jsdom
/**
 * THE MAGICIAN'S PASS LINES ON THE TEAMMATE'S SCREEN (owner 2026-11-12, R-DUOS-MAGICIAN-01): "Come up with 5 different
 * pass lines that he can randomly say when triggering his hero power. The teammate should hear these lines too."
 *
 * The teammate's side, through the real pass transport (`duosPasses.ts`, a pushed pass row): they hear the line the
 * sender's screen played for that copy, as the copy arrives, once. The choice itself (a pure function of the copy's
 * uid) and the sender's side are pinned in `magicHat.test.tsx`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

const { duosAfterRun, duosBackFromMate, duosPushed, duosReset } = await import('./duosPasses');
const { hatLineOf, resetHatLines, speakHatLine } = await import('./hatLines');
const { sfx } = await import('../sfx');
const { useGame } = await import('../store');
const { CARD_INDEX } = await import('@game/content');
const { createVersusRun, duosWaitingCount, duosWireOf, handCap, reduce } = await import('@game/sim');
type RunState = ReturnType<typeof createVersusRun>;

const MATCH = 'hatline';
const DUOS = { v: 1 as const, mode: 'duos' as const, modifiers: [] };
const PLAIN = Object.values(CARD_INDEX).filter((c) => c && !c.spell && !c.token && !c.duos && !c.ruby && c.tier <= 2 && c.effects.length === 0).map((c) => c!.id);

/** A real Magician run's third buy: its outbox entry is the copy, and `duosWireOf` is the row's card. */
function hatEntry() {
  let s = { ...createVersusRun(11, 'magician', 'set2', DUOS), phase: 'recruit', hand: [], board: [], embers: 100, shop: [], spell: null } as RunState;
  for (let i = 0; i < 3; i++) s = { ...reduce({ ...s, shop: [{ uid: `s${i}`, cardId: PLAIN[i]! }] }, { type: 'buy', uid: `s${i}` }), hand: [] };
  return s.duos!.outbox[0]!;
}
const entry = hatEntry();
type Row = Parameters<typeof duosPushed>[2];
const rowOf = (seq: number, card: unknown = duosWireOf(entry), match = MATCH): Row =>
  ({ match_id: match, round: 1, from_seat: 'p1', to_seat: 'p2', seq, card, status: 'sent' }) as unknown as Row;
const mateRun = (over: Partial<RunState> = {}): RunState => ({ ...createVersusRun(12, 'warden', 'set2', DUOS), hand: [], board: [], embers: 5, uidSeq: 300, ...over } as RunState);
const flush = async (): Promise<void> => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
async function readySeat(run: RunState = mateRun(), match = MATCH): Promise<RunState> {
  useGame.setState({ run, replaying: false });
  duosAfterRun(match, 'p2', run);
  await flush();
  return run;
}

let said: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  duosReset();
  resetHatLines();
  watching.on = false;
  watching.run = null;
  for (const f of Object.values(remote)) f.mockClear();
  said = vi.spyOn(sfx, 'magicianPass').mockImplementation(() => undefined);
});
afterEach(() => { said.mockRestore(); });

describe('the teammate hears the line the Magician said', () => {
  it('the hat copy is what the row carries: a Magic Hat wire card with the copy uid', () => {
    expect(entry.hat).toBe(true);
    expect(duosWireOf(entry)).toMatchObject({ passHat: true, passFrom: 'sale', uid: entry.card.uid });
  });

  it('as the copy arrives: the same line the sender played for that copy, once', async () => {
    await readySeat();
    duosPushed(MATCH, 'p2', rowOf(0));
    expect(useGame.getState().run.hand.map((c) => c.cardId)).toEqual([entry.card.cardId]);
    expect(said).toHaveBeenCalledTimes(1);
    expect(said).toHaveBeenCalledWith(hatLineOf(entry.card.uid)); // what the sender's `playEntryFlight` says (magicHat.test.tsx)
  });

  it('a row delivered again says nothing (the copy was answered)', async () => {
    await readySeat();
    duosPushed(MATCH, 'p2', rowOf(0));
    duosPushed(MATCH, 'p2', rowOf(0));
    expect(useGame.getState().run.hand).toHaveLength(1);
    expect(said).toHaveBeenCalledTimes(1);
  });

  it('a copy that waits for hand room speaks as it arrives, and not again when it lands', async () => {
    const filler = Object.values(CARD_INDEX).filter((c) => c && !c.spell && !c.token && !c.duos && !PLAIN.includes(c.id) && c.tier <= 2).slice(0, 10)
      .map((d, i) => ({ uid: `h${i}`, cardId: d!.id, tribe: d!.tribe, attack: d!.attack, health: d!.health, keywords: [...d!.keywords], golden: false }));
    const full = mateRun({ hand: filler });
    expect(full.hand.length).toBe(handCap(full));
    await readySeat(full);
    duosPushed(MATCH, 'p2', rowOf(0));
    expect(duosWaitingCount(useGame.getState().run)).toBe(1);
    expect(said).toHaveBeenCalledTimes(1);
    // Room opens: the waiting copy lands through the reducer's own after-action step.
    const now = useGame.getState().run;
    useGame.setState({ run: reduce({ ...now, hand: now.hand.slice(2) }, { type: 'roll' }) });
    expect(duosWaitingCount(useGame.getState().run)).toBe(0);
    expect(useGame.getState().run.hand.some((c) => c.cardId === entry.card.cardId)).toBe(true);
    duosPushed(MATCH, 'p2', rowOf(0)); // and the row read once more
    expect(said).toHaveBeenCalledTimes(1);
  });

  it('heard while watching the Magician board: silent when the row lands back on my own screen', async () => {
    const run = await readySeat();
    watching.on = true;
    watching.run = run;
    duosPushed(MATCH, 'p2', rowOf(0)); // kept: my screen shows their run
    expect(said).not.toHaveBeenCalled();
    expect(speakHatLine(entry.card.uid)).toBe(true); // the watched send played it (`watchedPassFlights`)
    watching.on = false;
    duosBackFromMate(run.wave);
    expect(useGame.getState().run.hand).toHaveLength(1);
    expect(said).toHaveBeenCalledTimes(1);
  });

  it('not heard while watching (no watched send was seen): it speaks when the row lands back on my screen', async () => {
    const run = await readySeat();
    watching.on = true;
    watching.run = run;
    duosPushed(MATCH, 'p2', rowOf(0));
    watching.on = false;
    duosBackFromMate(run.wave);
    expect(said).toHaveBeenCalledTimes(1);
    expect(said).toHaveBeenCalledWith(hatLineOf(entry.card.uid));
  });

  it('an ordinary effect pass from the teammate says nothing', async () => {
    await readySeat();
    const { passHat: _h, ...plain } = duosWireOf(entry);
    void _h;
    duosPushed(MATCH, 'p2', rowOf(1, { ...plain, passFrom: 'spell' }));
    expect(useGame.getState().run.hand).toHaveLength(1);
    expect(said).not.toHaveBeenCalled();
  });

  it('a new match starts over: the same copy uid speaks again', async () => {
    await readySeat();
    duosPushed(MATCH, 'p2', rowOf(0));
    duosReset();
    await readySeat(mateRun(), 'another');
    duosPushed('another', 'p2', rowOf(0, duosWireOf(entry), 'another'));
    expect(said).toHaveBeenCalledTimes(2);
  });
});
