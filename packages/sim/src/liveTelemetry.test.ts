import { describe, it, expect } from 'vitest';
import { createRun, type RunState, type BoardCard, type Action } from './state';
import { reduce } from './reducer';
import { applyEndOfTurn } from './recruit';
import { emptyTelemetryLog, recordTelemetryAction, withLiveTelemetry, reconstructRunTelemetry } from './runTelemetry';

/**
 * The live acquisition log must record what the PLAYER did, independent of whether a replay of the run
 * reproduces it. Owner report 2026-08-03: the Balance Report showed every card as seen-never-bought.
 */
describe('live telemetry capture', () => {
  it('records a shop buy the moment it happens', () => {
    let s: RunState = { ...createRun(4242), embers: 20 };
    const log = emptyTelemetryLog();
    const offer = s.shop[0]!;
    const act: Action = { type: 'buy', uid: offer.uid };
    const next = reduce(s, act);
    recordTelemetryAction(log, s, act, next);
    s = next;
    expect(log.boughtCards).toEqual([offer.cardId]);
    expect(log.offeredCards).toContain(offer.cardId);
    expect(log.buyEvents[0]).toMatchObject({ id: offer.cardId, src: 'shop' });
  });

  it('a REJECTED buy records the sighting but not the purchase', () => {
    const s: RunState = { ...createRun(4242), embers: 0 }; // can't afford anything
    const log = emptyTelemetryLog();
    const offer = s.shop[0]!;
    const act: Action = { type: 'buy', uid: offer.uid };
    const next = reduce(s, act);
    expect(next).toBe(s); // the reducer refused it
    recordTelemetryAction(log, s, act, next);
    expect(log.offeredCards).toContain(offer.cardId);
    expect(log.boughtCards).toEqual([]);
  });

  it('a lingering offer counts as ONE sighting across turns', () => {
    const s: RunState = { ...createRun(4242), embers: 0 };
    const log = emptyTelemetryLog();
    const noop: Action = { type: 'buy', uid: 'nope' };
    for (let i = 0; i < 5; i++) recordTelemetryAction(log, s, noop, s);
    const first = s.shop[0]!.cardId;
    expect(log.offeredCards.filter((id) => id === first).length).toBe(1);
  });

  it('the live log OVERRIDES a replay that lost the buys', () => {
    const log = emptyTelemetryLog();
    log.boughtCards.push('sandbag');
    log.offeredCards.push('sandbag');
    // A reconstruction that saw nothing — exactly the divergence symptom.
    const empty = reconstructRunTelemetry({ seed: 1, heroId: 'sellsword', actions: [] });
    expect(empty.boughtCards).toEqual([]);
    expect(withLiveTelemetry(empty, log).boughtCards).toEqual(['sandbag']);
  });
});

describe('Alchemist Brisbane hits EVERY friendly Kobold', () => {
  const kobold = (uid: string, cardId = 'sandbag'): BoardCard =>
    ({ uid, cardId, tribe: 'kobold', attack: 4, health: 4, keywords: [], golden: false });

  it('all three Kobolds gain the Ruby, not one at random', () => {
    const s: RunState = {
      ...createRun(1),
      board: [kobold('a'), kobold('b'), kobold('c'), { uid: 'ab', cardId: 'k_alchemist', tribe: 'kobold', attack: 9, health: 6, keywords: [], golden: false }],
      hand: [],
    };
    const before = s.board.map((c) => c.attack + c.health);
    applyEndOfTurn(s);
    const after = s.board.map((c) => c.attack + c.health);
    expect(after.map((n, i) => n - before[i]!), 'every Kobold should gain a 1/1 Ruby').toEqual([2, 2, 2, 2]);
  });

  it('a non-Kobold on the board is skipped', () => {
    const s: RunState = {
      ...createRun(1),
      board: [{ uid: 'beast', cardId: 'sandbag', tribe: 'beast', attack: 4, health: 4, keywords: [], golden: false },
        { uid: 'ab', cardId: 'k_alchemist', tribe: 'kobold', attack: 9, health: 6, keywords: [], golden: false }],
      hand: [],
    };
    applyEndOfTurn(s);
    expect(s.board.find((c) => c.uid === 'beast')!.attack).toBe(4);
    expect(s.board.find((c) => c.uid === 'ab')!.attack).toBe(10);
  });
});
