// @vitest-environment jsdom
/**
 * CINDY'S GOLDEN GRATITUDE ON SCREEN (owner 2026-11-14, R-DUOS-CINDY-01): the teammate's side of the real pass transport
 * (`duosPasses.ts`): the arm row lands on their run (so their portrait of Cindy glows) and they hear her line, once; the
 * payout streams from the bought minion with its face; and a reload's restore replay never arms or pays twice.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });

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
  ownRunWhileWatching: () => null,
}));
vi.mock('./passLob', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  playArrival: () => undefined, playEntryFlight: () => undefined,
}));

const { duosAfterRun, duosPushed, duosReset, replayRestore } = await import('./duosPasses');
const { passFlightOf } = await import('./passLob');
const { resetGratitudeVoice, speakGratitude } = await import('./gratitudeVoice');
const { sfx } = await import('../sfx');
const { useGame } = await import('../store');
const { CARD_INDEX } = await import('@game/content');
const { createVersusRun, duosWireOf, reduce } = await import('@game/sim');
type RunState = ReturnType<typeof createVersusRun>;
type Row = Parameters<typeof duosPushed>[2];

const MATCH = 'gratitude';
const DUOS = { v: 1 as const, mode: 'duos' as const, modifiers: [] };
const PLAIN = Object.values(CARD_INDEX).filter((c) => c && !c.spell && !c.token && !c.duos && !c.ruby && c.tier <= 2 && c.effects.length === 0).map((c) => c!.id);

const cindy = (): RunState => ({ ...createVersusRun(11, 'cindy', 'set2', DUOS), phase: 'recruit', hand: [], board: [], embers: 10 } as RunState);
const mateRun = (): RunState => ({ ...createVersusRun(12, 'warden', 'set2', DUOS), phase: 'recruit', hand: [], board: [], embers: 50, spell: null, shop: [{ uid: 's0', cardId: PLAIN[0]! }], uidSeq: 300 } as RunState);
const armedCindy = reduce(cindy(), { type: 'heroPower' });
const armEntry = armedCindy.duos!.outbox[0]!;
const row = (seq: number, card: unknown, over: Partial<Row> = {}): Row =>
  ({ match_id: MATCH, round: 1, from_seat: 'p1', to_seat: 'p2', seq, card, status: 'sent', ...over }) as unknown as Row;
const flush = async (): Promise<void> => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

let said: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  duosReset();
  resetGratitudeVoice();
  for (const f of Object.values(remote)) f.mockClear();
  said = vi.spyOn(sfx, 'cindyGratitude').mockImplementation(() => undefined);
});
afterEach(() => { said.mockRestore(); });

describe('the teammate: the arm lands, the glow reads it, the line plays once', () => {
  it('the arm row arms my run and Cindy speaks on my screen, once per row', async () => {
    const run = mateRun();
    useGame.setState({ run, replaying: false });
    duosAfterRun(MATCH, 'p2', run);
    await flush();
    duosPushed(MATCH, 'p2', row(0, duosWireOf(armEntry)));
    expect(useGame.getState().run.duos!.gratitude).toBe(true); // what DuosMateDock's glow reads
    expect(said).toHaveBeenCalledTimes(1);
    duosPushed(MATCH, 'p2', row(0, duosWireOf(armEntry)));
    expect(said).toHaveBeenCalledTimes(1);
  });

  it('the voice helper says each key once', () => {
    expect(speakGratitude('a')).toBe(true);
    expect(speakGratitude('a')).toBe(false);
    expect(said).toHaveBeenCalledTimes(1);
  });

  it('the dock wears the glow class from the run, and its loops animate opacity / transform only', () => {
    const dock = readFileSync(join(__dirname, 'DuosMateDock.tsx'), 'utf8');
    expect(dock).toContain("useGame((s) => !heroSelect && !!s.run.duos?.gratitude)");
    expect(dock).toContain("${gratitude ? ' gratitude' : ''}");
    const css = readFileSync(join(__dirname, 'duosMateSignals.css'), 'utf8');
    const rules = css.slice(css.indexOf('.duosdock-gratitude'));
    expect(rules).toContain('animation: kwglow');
    for (const m of rules.matchAll(/@keyframes duosgratring \{([^}]*\})*[^}]*\}/g)) expect(m[0]).not.toMatch(/box-shadow|filter|background/);
  });
});

describe('the payout streams from the bought minion, with its face', () => {
  it('passFlightOf: a Golden Gratitude copy leaves the minion that stays, face on', () => {
    let mate = reduce(mateRun(), { type: 'receivePass', from: 'p1', seq: 0, card: duosWireOf(armEntry) });
    mate = reduce(mate, { type: 'buy', uid: 's0' });
    const e = mate.duos!.outbox.find((x) => x.gratitude)!;
    expect(passFlightOf(e)).toEqual({ at: 'card', uid: mate.hand[0]!.uid, leaves: false, face: true });
    // The arm itself streams nothing (it hands nothing over).
    expect(passFlightOf(armEntry)).toBeNull();
  });
});

describe('a reload: the restore replay puts the rows back', () => {
  it('Cindy: her own arm row re-arms her run once; a press after it is refused', () => {
    let run = cindy();
    const act = (a: Parameters<typeof reduce>[1]): void => { run = reduce(run, a); };
    const res = replayRestore(() => run, act as never, 'p1', [row(0, duosWireOf(armEntry), { from_seat: 'p1', to_seat: 'p2', round: run.wave, status: 'landed' })]);
    expect(run.cindyGratitude).toBe('armed');
    expect(run.heroPowerSpent).toBe(true);
    expect(res.shipped.has(0)).toBe(true); // never sent again
    expect(reduce(run, { type: 'heroPower' })).toBe(run);
  });

  it('the teammate: the copy row spends the arm; nothing leaves, and the next buy sends nothing', () => {
    let sent = reduce(mateRun(), { type: 'receivePass', from: 'p1', seq: 0, card: duosWireOf(armEntry) });
    sent = reduce(sent, { type: 'buy', uid: 's0' });
    const copy = sent.duos!.outbox.find((x) => x.gratitude)!;
    // The reload put the run back to just after the arm landed (the buy was dropped).
    let run = reduce(mateRun(), { type: 'receivePass', from: 'p1', seq: 0, card: duosWireOf(armEntry) });
    const act = (a: Parameters<typeof reduce>[1]): void => { run = reduce(run, a); };
    replayRestore(() => run, act as never, 'p2', [row(0, duosWireOf(copy), { from_seat: 'p2', to_seat: 'p1', round: run.wave, status: 'landed' })]);
    expect(run.duos!.gratitude).toBeUndefined();
    expect(run.shop.map((o) => o.uid)).toEqual(['s0']);
    const again = reduce(run, { type: 'buy', uid: 's0' });
    expect(again.duos!.outbox.filter((x) => x.gratitude && !x.restored)).toHaveLength(0);
  });
});
