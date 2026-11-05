/**
 * R-FX-EPIC-FIRE-01 (owner 2026-11-04): every EPIC-medallion multiplier (Drakko, Sylus, Chronos, Uron, …) is told
 * when it ACTUALLY adds fires, in the Shop (`RunState.epicFireFx`) and in combat (an `epicFire` event), so the UI can
 * play its On Watcher effect on it. A count merely computed, or a trigger with no multiplier on the board, is silent.
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatEvent } from '@game/core';
import { createRun, reduce, type BoardCard, type RunState } from './index';

const card = (uid: string, cardId: string, extra: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...extra };
};
const bm = (uid: string, cardId: string, attack: number, health: number): BoardMinion =>
  ({ uid, sourceUid: uid, cardId, attack, health, keywords: [...(CARD_INDEX[cardId]?.keywords ?? [])], golden: false } as unknown as BoardMinion);
const epicSources = (events: readonly CombatEvent[]): string[] =>
  events.filter((e): e is Extract<CombatEvent, { type: 'epicFire' }> => e.type === 'epicFire').map((e) => e.source);

/** An Auctioneer run (its hero power re-fires a friendly Shout). */
const auctioneer = (board: BoardCard[]): RunState =>
  ({ ...createRun(11, 'myra'), wave: 7, phase: 'recruit', embers: 60, hand: [], board } as RunState);

describe('R-FX-EPIC-FIRE-01 — the Shop stamps an epic multiplier as it adds fires', () => {
  it('Drakko doubling a re-triggered Shout is stamped; no Drakko, no stamp', () => {
    const withDrakko = auctioneer([card('w', 'whelpling', { health: 50 }), card('c', 'cleric', { health: 50 }), card('d', 'drummer')]);
    expect(reduce(withDrakko, { type: 'heroPower', uid: 'c' }).epicFireFx).toEqual(['d']);
    const without = auctioneer([card('w', 'whelpling', { health: 50 }), card('c', 'cleric', { health: 50 })]);
    expect(reduce(without, { type: 'heroPower', uid: 'c' }).epicFireFx ?? []).toEqual([]);
  });

  it('the stamp is per action: the next action starts empty', () => {
    const s = auctioneer([card('w', 'whelpling', { health: 50 }), card('c', 'cleric', { health: 50 }), card('d', 'drummer')]);
    const fired = reduce(s, { type: 'heroPower', uid: 'c' });
    expect(reduce(fired, { type: 'freeze' }).epicFireFx ?? []).toEqual([]);
  });
});

describe('R-FX-EPIC-FIRE-01 — combat logs an epicFire for the multiplier that added fires', () => {
  it('Sylus adds a Lastlight Echo fire: one epicFire naming Sylus, before the Wards it doubled', () => {
    const r = simulate([bm('ll', 'n2_lastlight', 3, 1), bm('a', 'sandbag', 1, 50), bm('b', 'sandbag', 1, 50), bm('c', 'sandbag', 1, 50),
      bm('d', 'sandbag', 1, 50), bm('sy', 'sylus', 1, 70)], [bm('w', 'sandbag', 10, 500)], makeRng(3), CARD_INDEX, combatSide({ tier: 6 }), combatSide({ tier: 6 }));
    const sylus = r.initial.player.find((m) => m.cardId === 'sylus')!.uid;
    expect(epicSources(r.events)).toContain(sylus);
    const at = r.events.findIndex((e) => e.type === 'epicFire');
    expect(r.events.slice(at).some((e) => e.type === 'shieldUp')).toBe(true);
  });

  it('the same fight without Sylus logs none', () => {
    const r = simulate([bm('ll', 'n2_lastlight', 3, 1), bm('a', 'sandbag', 1, 50), bm('b', 'sandbag', 1, 50)],
      [bm('w', 'sandbag', 10, 500)], makeRng(3), CARD_INDEX, combatSide({ tier: 6 }), combatSide({ tier: 6 }));
    expect(epicSources(r.events)).toEqual([]);
  });
});
