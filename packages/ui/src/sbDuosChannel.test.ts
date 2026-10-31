/**
 * THE SCENE BUILDER'S LOCAL TEAM CHANNEL (DEV, owner ask 2026-10-31, R-SB-DUOS-01): parity with the Worker path.
 *
 * The real path is: the sender's outbox entry travels as `duosWireOf(e)`, the Worker (`groupMatch.pass`) records or
 * refuses it, the receiver's run lands it through `receivePass`, and a refusal comes home as `passRefunded`. The
 * local channel must leave BOTH runs exactly where that path leaves them, for card passes, effect passes and gifts.
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { createLobbyRun, duosWireOf, reduce, type Action, type BoardCard, type RunState } from '@game/sim';
import { deliverSbTeam, newSbLedger, releaseSbCombatFx, sbWorkerRefusal, type SbSeat } from './sbDuosChannel';
import { makeSbMateRun, sbMateHero, sbMateSeed } from './sbDuos';
import { cardRowsFor, duosCardRowsFor, runeRowsFor } from './cardSearch';

function card(id: string, uid: string, golden = false): BoardCard {
  const d = CARD_INDEX[id]!;
  return { uid, cardId: id, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden };
}
const filler = (n: number, prefix = 'f'): BoardCard[] => {
  const id = Object.values(CARD_INDEX).find((c) => c && !c.spell && !c.token && c.tier === 1 && !c.duos && c.effects.length === 0)!.id;
  return Array.from({ length: n }, (_, i) => card(id, `${prefix}${i}`));
};

/** A Scene Builder Duos run (the rig's own door: a practice-bots lobby run with `duos`). */
function sbRun(seed: number, over: Partial<RunState> = {}): RunState {
  const run = createLobbyRun(seed, 'warden', {}, 'practice', { opponents: 'bots', botDifficulty: 1, health: 'unlimited', timeMult: 1, tribes: [] }, 'set2', undefined, { duos: true });
  return { ...run, sandbox: true, hand: [], board: [], embers: 10, ...over };
}

/** The Worker path, as `duosCards.test.ts` models it: ship each new entry's wire form to the receiver. */
function ship(from: RunState, fromSeat: string, to: RunState, since = 0): RunState {
  let out = to;
  for (const e of from.duos!.outbox.slice(since)) out = reduce(out, { type: 'receivePass', from: fromSeat, seq: e.seq, card: duosWireOf(e) });
  return out;
}

/** The local channel on two plain runs (no store). */
function local(p1: RunState, p2: RunState): { runs: Record<SbSeat, RunState>; events: ReturnType<typeof deliverSbTeam> } {
  const runs: Record<SbSeat, RunState> = { p1, p2 };
  const act = (seat: SbSeat, a: Action): void => { runs[seat] = reduce(runs[seat], a); };
  const events = deliverSbTeam((seat) => runs[seat], act, newSbLedger());
  return { runs, events };
}

describe('the Scene Builder Duos run (R-SB-DUOS-01)', () => {
  it('createLobbyRun with duos stamps the Duos state and stocks the Duos pool; without it nothing changes', () => {
    const duos = sbRun(7);
    expect(duos.duos).toEqual({ outbox: [], received: [], refused: [] });
    expect(duos.pool['duo_hitchhiker']).toBeGreaterThan(0);
    expect(duos.lobby?.seats).toHaveLength(8);
    const plain = createLobbyRun(7, 'warden', {}, 'practice', { opponents: 'bots', botDifficulty: 1, health: 'unlimited', timeMult: 1, tribes: [] }, 'set2');
    expect(plain.duos).toBeUndefined();
    expect(Object.keys(plain.pool).some((id) => CARD_INDEX[id]?.duos)).toBe(false);
  });

  it('the placeholder teammate: seeded off my run, another hero, my tribes and set, a sandboxed Duos run', () => {
    const mine = sbRun(42);
    const mate = makeSbMateRun(mine, true);
    expect(mate.seed).toBe(sbMateSeed(42));
    expect(mate.heroId).toBe(sbMateHero(42, 'warden'));
    expect(mate.heroId).not.toBe('warden');
    expect(mate.setId).toBe(mine.setId);
    expect([...mate.tribes].sort()).toEqual([...mine.tribes].sort());
    expect(mate.duos).toBeDefined();
    expect(mate.sandbox).toBe(true);
    expect(mate.embers).toBe(999);
    expect(makeSbMateRun(mine, true).seed).toBe(mate.seed); // deterministic
  });

  it('with Duos on the library adds the Duos-only cards (tagged) and the Duos runes are flagged', () => {
    const base = cardRowsFor('set2');
    const duos = duosCardRowsFor('set2');
    expect(base.some((r) => r.id === 'duo_hitchhiker')).toBe(false);
    expect(duos.find((r) => r.id === 'duo_hitchhiker')).toMatchObject({ duos: true });
    expect(duos.find((r) => r.id === 'duo_handout')).toMatchObject({ duos: true, spell: true });
    expect(duos.filter((r) => !r.duos).map((r) => r.id)).toEqual(base.map((r) => r.id));
    expect(runeRowsFor('set2').some((r) => r.duos)).toBe(true);
  });
});

describe('local team channel parity with the Worker path (R-SB-DUOS-01)', () => {
  it('a drag pass lands on the teammate exactly as the Worker path lands it (pass key, Hitchhiker on both sides)', () => {
    const passed = filler(1, 'p')[0]!;
    let ann = sbRun(11, { hand: [passed], board: [card('duo_hitchhiker', 'hh1')] });
    const bob = sbRun(12, { board: [card('duo_hitchhiker', 'hh2')] });
    ann = reduce(ann, { type: 'passCard', uid: passed.uid });
    const viaWorker = ship(ann, 'p1', bob);
    const { runs, events } = local(ann, bob);
    expect(runs.p2).toEqual(viaWorker);
    expect(runs.p1).toEqual(ann); // nothing came back
    expect(runs.p2.hand.map((c) => c.passKey)).toEqual(['p1:0']);
    expect(runs.p2.board[0]).toMatchObject({ attack: 3, health: 5 });
    expect(events).toEqual([{ kind: 'landed', from: 'p1', to: 'p2', seq: 0, team: false, uids: [runs.p2.hand[0]!.uid], triple: false }]);
  });

  it('a team effect (Richmond) and a gift (Share the Wealth) resolve on the teammate run as via the Worker', () => {
    let ann = sbRun(11, { hand: [card('duo_richmond', 'r1'), card('duo_sharewealth', 's1')] });
    const bob = sbRun(12);
    ann = reduce(ann, { type: 'play', uid: 'r1' });
    ann = reduce(ann, { type: 'play', uid: 's1' });
    expect(ann.duos!.outbox.map((e) => e.team?.kind)).toEqual(['maxGold', 'gift']);
    const { runs } = local(ann, bob);
    expect(runs.p2).toEqual(ship(ann, 'p1', bob));
    expect(runs.p2.maxGoldBonus ?? 0).toBe((bob.maxGoldBonus ?? 0) + 1);
    expect(runs.p2.hand.map((c) => c.cardId)).toEqual(['emberpouch']);
  });

  it('a manual pass to a full hand is refused up front (the Worker\'s hand_full) and refunded: card and Gold back', () => {
    const passed = filler(1, 'p')[0]!;
    let ann = sbRun(11, { hand: [passed] });
    const bob = sbRun(12, { hand: filler(10, 'h') });
    const before = ann;
    ann = reduce(ann, { type: 'passCard', uid: passed.uid });
    expect(ann.embers).toBe(before.embers - 1);
    expect(sbWorkerRefusal(ann.duos!.outbox[0]!, bob, newSbLedger(), 'p1')).toBe('hand_full');
    const { runs, events } = local(ann, bob);
    expect(runs.p2).toBe(bob); // never reached the teammate
    expect(runs.p1).toEqual(reduce(ann, { type: 'passRefunded', seq: 0 })); // the client's answer to the refusal
    expect(runs.p1.hand.map((c) => c.uid)).toEqual([passed.uid]);
    expect(runs.p1.embers).toBe(before.embers);
    expect(events[0]).toMatchObject({ kind: 'refused', reason: 'hand_full', team: false });
  });

  it('an effect pass to a full hand is never refused: it waits on the teammate run (R-DUOS-EFFECT-PASS-QUEUE-01)', () => {
    let ann = sbRun(11, { board: [card(filler(1)[0]!.cardId, 'm1')], hand: [card('duo_handout', 'ho')] });
    const bob = sbRun(12, { hand: filler(10, 'h') });
    ann = reduce(ann, { type: 'play', uid: 'ho', targetUid: 'm1' });
    expect(ann.duos!.outbox[0]!.via).toBe('spell');
    const { runs } = local(ann, bob);
    expect(runs.p2).toEqual(ship(ann, 'p1', bob));
    expect(runs.p2.duos!.waiting).toHaveLength(1);
    expect(runs.p1.duos!.outbox[0]!.refunded).toBeUndefined();
  });

  it('a Golden card passes from hand and by a sale; a pass SPELL\'s Golden is refused (the Worker\'s golden guard, R-DUOS-PASS-GOLDEN-MANUAL-01)', () => {
    const ann = sbRun(11);
    const e = { seq: 0, wave: 1, card: card(filler(1)[0]!.cardId, 'g', true), from: 'hand' as const, index: 0, paid: 1 };
    expect(sbWorkerRefusal(e, sbRun(12), newSbLedger(), 'p1')).toBeNull();
    expect(sbWorkerRefusal({ ...e, via: 'sale' as const }, sbRun(12), newSbLedger(), 'p1')).toBeNull();
    expect(sbWorkerRefusal({ ...e, via: 'spell' as const }, sbRun(12), newSbLedger(), 'p1')).toBe('golden');
    void ann;
  });

  it('both ways: the teammate passes to me through the same channel (from p2), and a delivery happens once', () => {
    const passed = filler(1, 'q')[0]!;
    const me = sbRun(11);
    let mate = sbRun(12, { hand: [passed] });
    mate = reduce(mate, { type: 'passCard', uid: passed.uid });
    const runs: Record<SbSeat, RunState> = { p1: me, p2: mate };
    const ledger = newSbLedger();
    const act = (seat: SbSeat, a: Action): void => { runs[seat] = reduce(runs[seat], a); };
    deliverSbTeam((s) => runs[s], act, ledger);
    expect(runs.p1).toEqual(ship(mate, 'p2', me));
    const again = runs.p1;
    expect(deliverSbTeam((s) => runs[s], act, ledger)).toEqual([]);
    expect(runs.p1).toBe(again);
  });

  it('a combat team effect waits for its teamSend beat while its fight is on screen (R-DUOS-RUNES-02)', () => {
    const base = sbRun(11);
    const ann: RunState = { ...base, phase: 'combat', combatSettled: false, duos: { ...base.duos!, outbox: [{ seq: 0, wave: base.wave, card: { uid: 'team0', cardId: '__team', tribe: 'neutral', attack: 0, health: 0, keywords: [], golden: false }, from: 'hand', index: -1, paid: 0, team: { kind: 'gold', amount: 2 }, combatIdx: 0 }] } };
    const runs: Record<SbSeat, RunState> = { p1: ann, p2: sbRun(12) };
    const ledger = newSbLedger();
    const act = (seat: SbSeat, a: Action): void => { runs[seat] = reduce(runs[seat], a); };
    expect(deliverSbTeam((s) => runs[s], act, ledger)).toEqual([]);
    releaseSbCombatFx(ledger, 'p1', base.wave, [0]);
    const ev = deliverSbTeam((s) => runs[s], act, ledger);
    expect(ev).toHaveLength(1);
    expect(runs.p2.duos!.received).toEqual(['p1:0']);
  });
});
