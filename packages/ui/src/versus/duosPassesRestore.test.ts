// @vitest-environment jsdom
/**
 * VERSUS DUOS — A RESTORED RUN'S PASSES LINE UP WITH THE SERVER BY IDENTITY (R-DUOS-PASS-01, phase-3 live test
 * 2026-10-25). The live bug: a pass the server refused up front ("Their hand is full") never gets a row, and the old
 * positional line-up then paired every later outbox entry with the wrong row, so after a reload the sender kept a card
 * the teammate had already received. Entries and rows now pair by card uid + round (+ refused with refunded).
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });
const { lineUpOutbox } = await import('./duosPasses');

const entry = (wave: number, uid: string, refunded = false) => ({ wave, card: { uid }, ...(refunded ? { refunded: true as const } : {}) });
const row = (seq: number, round: number, uid: string, status: 'sent' | 'landed' | 'refused' = 'landed') => ({ seq, round, card: { uid }, status });

describe('lining a restored outbox up with the server rows', () => {
  it('the live case: an up-front refusal (no row), then two passes; the restored run has only the refusal', () => {
    // Round 7: b4 refused up front (refunded, no row). Round 8: b4 passed (seq 0), b9 passed (seq 1). The run came back
    // from its round-8 lock, so its outbox holds only the round-7 refusal.
    const plan = lineUpOutbox([entry(7, 'b4', true)], [row(0, 8, 'b4'), row(1, 8, 'b9')]);
    expect([...plan.seqOf]).toEqual([]); // the refunded entry is NOT the round-8 pass
    expect(plan.repass.map((r) => r.seq)).toEqual([0, 1]); // both are played again on the run (card leaves, Gold paid)
    expect(plan.unsent).toEqual([]);
  });

  it('a full outbox lines up whatever the server numbered, and a pass the server never saw still goes out', () => {
    const plan = lineUpOutbox(
      [entry(3, 'a', true), entry(3, 'a'), entry(4, 'c'), entry(4, 'd')],
      [row(5, 3, 'a'), row(6, 4, 'c')],
    );
    expect([...plan.seqOf].sort()).toEqual([[1, 5], [2, 6]]);
    expect(plan.repass).toEqual([]);
    expect(plan.unsent).toEqual([3]); // d: recorded on the run, never reached the server
  });

  it('a pass the receiver refused pairs with the refunded entry, not with a later pass of the same card', () => {
    const plan = lineUpOutbox(
      [entry(5, 'x', true), entry(5, 'x')],
      [row(0, 5, 'x', 'refused'), row(1, 5, 'x', 'sent')],
    );
    expect([...plan.seqOf].sort()).toEqual([[0, 0], [1, 1]]);
    expect(plan.repass).toEqual([]);
    expect(plan.unsent).toEqual([]);
  });
});

// ── PASSING BACK (owner 2026-10-25: "you should be able to pass cards back to your teammate") ─────────────────────────
// A real ping-pong through the real reducer and a fake server table, then a reload of either side mid-way: the restored
// run must end exactly where the live one did (the card once, every hop's Gold paid once), and so must its outbox line-up.
const { replayRestore, atMicros } = await import('./duosPasses');
const { CARD_INDEX } = await import('@game/content');
const { createVersusRun, duosWireCard, reduce } = await import('@game/sim');
type Run = ReturnType<typeof createVersusRun>;
type Row = Parameters<typeof replayRestore>[3][number];

function duos(uidSeq: number): Run {
  const run = createVersusRun(11, 'warden', 'set2', { v: 1, mode: 'duos', modifiers: [] });
  return { ...run, hand: [], board: [], embers: 5, uidSeq };
}
function minion(uid: string) {
  const def = Object.values(CARD_INDEX).find((c) => c && !c.spell && !c.token && c.tier === 1)!;
  return { uid, cardId: def.id, tribe: def.tribe, attack: def.attack + 4, health: def.health + 4, keywords: [...def.keywords], golden: false };
}

/** Two live runs + the server's table. `pass` = the sender's passCard, shipped as a row; `land` = the receiver lands it. */
function table() {
  const runs: Record<'p1' | 'p2', Run> = { p1: { ...duos(100), hand: [minion('a1')] }, p2: duos(200) };
  const rows: Row[] = [];
  let tick = 0;
  const pass = (from: 'p1' | 'p2', uid: string): void => {
    const before = runs[from];
    runs[from] = reduce(before, { type: 'passCard', uid });
    const e = runs[from].duos!.outbox.at(-1)!;
    expect(runs[from].duos!.outbox.length).toBe(before.duos!.outbox.length + 1);
    const seq = rows.filter((r) => r.from_seat === from).length;
    rows.push({ match_id: 'm', round: e.wave, from_seat: from, to_seat: from === 'p1' ? 'p2' : 'p1', seq, card: duosWireCard(e.card) as unknown as Record<string, unknown>, status: 'sent', created_at: `2026-10-25T12:00:00.${String(++tick).padStart(6, '0')}+00:00` });
  };
  const land = (to: 'p1' | 'p2'): void => {
    for (const r of rows.filter((x) => x.to_seat === to && x.status === 'sent')) {
      runs[to] = reduce(runs[to], { type: 'receivePass', from: r.from_seat, seq: r.seq, card: r.card as never });
      r.status = runs[to].duos!.received.includes(`${r.from_seat}:${r.seq}`) ? 'landed' : 'refused';
    }
  };
  /** The reload: the run comes back as it was at the start of the round, then the restore replay runs. */
  const reload = (who: 'p1' | 'p2', start: Run): Run => {
    let run = start;
    const res = replayRestore(() => run, (a) => { run = reduce(run, a); }, who, rows);
    expect(res.next).toBe(rows.filter((r) => r.from_seat === who).length);
    return run;
  };
  return { runs, rows, pass, land, reload };
}
const handIds = (r: Run): string[] => r.hand.map((c) => c.cardId);

describe('passing back and forth survives a reload (A->B->A->B)', () => {
  it('pass back: the card a teammate just passed you goes straight back, 1 Gold each time', () => {
    const t = table();
    t.pass('p1', 'a1'); t.land('p2');
    const back = t.runs.p2.hand[0]!;
    expect(back.passKey).toBe('p1:0');
    t.pass('p2', back.uid); t.land('p1');
    expect([t.runs.p1.hand.length, t.runs.p2.hand.length, t.runs.p1.embers, t.runs.p2.embers]).toEqual([1, 0, 4, 4]);
  });

  it('a reload of either side mid ping-pong lands every hop exactly once and pays every hop once', () => {
    const t = table();
    const start = { p1: t.runs.p1, p2: t.runs.p2 };
    t.pass('p1', 'a1'); t.land('p2');                      // A -> B
    t.pass('p2', t.runs.p2.hand[0]!.uid); t.land('p1');    // B -> A
    t.pass('p1', t.runs.p1.hand[0]!.uid); t.land('p2');    // A -> B
    t.pass('p2', t.runs.p2.hand[0]!.uid);                  // B -> A, not landed yet
    const live = { p1: t.runs.p1, p2: t.runs.p2 };
    expect([live.p1.hand.length, live.p2.hand.length, live.p1.embers, live.p2.embers]).toEqual([0, 0, 3, 3]);
    // Ann reloads: her run is the round's start again (the card in hand, 5 Gold, nothing sent or received).
    // The replay lands the hop still on its way too (p2:1), in the server's order, so she ends with the card.
    const ann = t.reload('p1', start.p1);
    expect([ann.hand.length, ann.embers]).toEqual([1, live.p1.embers]);
    expect(ann.duos!.outbox).toHaveLength(2);
    expect(ann.duos!.received).toEqual(['p2:0', 'p2:1']);
    // Bob reloads too: he received two hops and sent two.
    const bob = t.reload('p2', start.p2);
    expect([bob.hand.length, bob.embers]).toEqual([0, live.p2.embers]);
    expect(bob.duos!.received).toEqual(['p1:0', 'p1:1']);
    expect(bob.duos!.outbox.map((e) => e.card.passKey)).toEqual(['p1:0', 'p1:1']);
    // The last hop delivered again (the ordinary pull) changes nothing: the card exists exactly once, on her side.
    t.runs.p1 = ann; t.land('p1');
    expect(t.runs.p1).toBe(ann);
    expect(handIds(t.runs.p1)).toEqual([minion('x').cardId]);
    expect(t.runs.p1.hand[0]).toMatchObject({ attack: minion('x').attack, passKey: 'p2:1' });
    // A second reload of the same state changes nothing (idempotent): nothing doubles.
    const again = t.reload('p1', start.p1);
    expect([again.hand.length, again.embers, again.duos!.outbox.length]).toEqual([1, 3, 2]);
  });

  it('a pass the receiver refused, then the same card passed again: both replay (refund, then the pass)', () => {
    const t = table();
    const start = t.runs.p1;
    t.runs.p2 = { ...t.runs.p2, hand: Array.from({ length: 10 }, (_, i) => minion(`f${i}`)) };
    t.pass('p1', 'a1'); t.land('p2');
    expect(t.rows[0]!.status).toBe('refused');
    t.runs.p1 = reduce(t.runs.p1, { type: 'passRefunded', seq: 0 });
    t.runs.p2 = { ...t.runs.p2, hand: [] };
    t.pass('p1', 'a1'); t.land('p2');
    const ann = t.reload('p1', start);
    expect([ann.hand.length, ann.embers]).toEqual([t.runs.p1.hand.length, t.runs.p1.embers]);
    expect(ann.duos!.outbox.map((e) => !!e.refunded)).toEqual([true, false]);
  });

  it('reads Postgres timestamps to the microsecond (the replay order)', () => {
    expect(atMicros('2026-10-25T12:00:00.1+00:00')! < atMicros('2026-10-25T12:00:00.12+00:00')!).toBe(true);
    expect(atMicros('2026-10-25T12:00:01+00:00')! - atMicros('2026-10-25T12:00:00.999999+00:00')!).toBe(1);
    expect(atMicros(undefined)).toBeNull();
  });
});
