import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { CONFIG, createRun, reduce, type Action, type BoardCard, type RunState } from './index';

/**
 * R-SHOUT-NOTARGET-01 (owner report 2026-11-19): "playing gastrid didnt trigger karwind, same with an appetite agent
 * without a target. these should still trigger as if a shout was played even if their effect isnt triggered".
 * An aimed Shout with no legal pick does nothing itself, but it is still a Shout that TRIGGERED: every watcher and
 * counter sees it once per fire, exactly like an untargeted Shout whose body no-ops.
 */

const bc = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
};
const act = (s: RunState, a: Action): RunState => reduce(s, a) as RunState;
const set2 = (extra: Partial<RunState> = {}): RunState => ({
  ...createRun(3, 'runesmith', 'ascent', CONFIG.defaultLine, 'set2'),
  tribes: ['kobold', 'dragon', 'beast', 'demon', 'dwarf'], wave: 7, tier: 6, phase: 'recruit', embers: 40, hand: [], board: [],
  ...extra,
} as RunState);
const totalFrom = (c: BoardCard | undefined, source: string): number[] =>
  (c?.buffs ?? []).filter((b) => b.source === source).reduce((t, b) => [t[0]! + b.attack, t[1]! + b.health], [0, 0]);
const on = (s: RunState, uid: string): BoardCard | undefined => s.board.find((c) => c.uid === uid);
const play = (s: RunState, uid: string, cardId: string, over: Partial<BoardCard> = {}): RunState =>
  act({ ...s, hand: [...s.hand, bc(uid, cardId, over)] }, { type: 'play', uid });

describe('R-SHOUT-NOTARGET-01: an aimed Shout with no legal target still triggers', () => {
  it('Baby Gastrid with no other Dwarf procs Karwind once (no prompt opens)', () => {
    const s = play(set2({ board: [bc('k', 'karwind'), bc('d', 'd2_cinderchef')] }), 'g', 'dw_dorrin');
    expect(s.pendingTarget).toBeUndefined();
    expect(on(s, 'g')).toBeDefined();
    expect(totalFrom(on(s, 'd'), 'Karwind')).toEqual([4, 4]);
    expect(totalFrom(on(s, 'k'), 'Karwind')).toEqual([4, 4]);
    expect(s.shoutFiresThisTurn ?? 0).toBe(1);
  });

  it('Appetite Agent with no other Demon procs Karwind once', () => {
    const s = play(set2({ board: [bc('k', 'karwind'), bc('d', 'd2_cinderchef')] }), 'a', 'dm_agent');
    expect(s.pendingTarget).toBeUndefined();
    expect(totalFrom(on(s, 'd'), 'Karwind')).toEqual([4, 4]);
  });

  it('Drakko repeats a no-target Shout: Karwind procs once per fire (2, gilded Drakko 3)', () => {
    const s = play(set2({ board: [bc('k', 'karwind'), bc('dr', 'drummer'), bc('d', 'd2_cinderchef')] }), 'g', 'dw_dorrin');
    expect(totalFrom(on(s, 'd'), 'Karwind')).toEqual([8, 8]);
    expect(s.shoutFiresThisTurn ?? 0).toBe(2);
    const g = play(set2({ board: [bc('k', 'karwind'), bc('dr', 'drummer', { golden: true }), bc('d', 'd2_cinderchef')] }), 'g', 'dw_dorrin');
    expect(totalFrom(on(g, 'd'), 'Karwind')).toEqual([12, 12]);
    expect(g.shoutFiresThisTurn ?? 0).toBe(3);
  });

  it('a gilded no-target Shout counts once per fire (gild doubles magnitude, not the trigger)', () => {
    const s = play(set2({ board: [bc('k', 'karwind'), bc('d', 'd2_cinderchef')] }), 'g', 'dw_dorrin', { golden: true });
    expect(s.shoutFiresThisTurn ?? 0).toBe(1);
    expect(totalFrom(on(s, 'd'), 'Karwind')).toEqual([4, 4]);
  });

  it('a Shout counter advances: Grimoire\'s shoutTick and Ember Whelp both see it', () => {
    const s = play(set2({ board: [bc('gr', 'd2_grimoire'), bc('ew', 'd2_embermouth')] }), 'g', 'dw_dorrin');
    expect(on(s, 'gr')!.shoutTick).toBe(1);
    expect(totalFrom(on(s, 'ew'), 'Ember Whelp')).toEqual([2, 2]);
  });

  it('a Shout that DOES resolve still counts exactly once (aimed and untargeted)', () => {
    // Aimed, with a legal Dwarf: the play holds for the aim, nothing fires until the pick, then one fire.
    const held = play(set2({ board: [bc('k', 'karwind'), bc('d', 'd2_cinderchef'), bc('dw', 'dw_dorrin')] }), 'g', 'dw_dorrin');
    expect(held.pendingTarget?.uid).toBe('g');
    expect(totalFrom(on(held, 'd'), 'Karwind')).toEqual([0, 0]);
    const done = act(held, { type: 'battlecryTarget', targetUid: 'dw' });
    expect(done.pendingTarget).toBeUndefined();
    expect(totalFrom(on(done, 'd'), 'Karwind')).toEqual([4, 4]);
    expect(done.shoutFiresThisTurn ?? 0).toBe(1);
    // Untargeted (Pennycat): one fire.
    const plain = play(set2({ board: [bc('k', 'karwind'), bc('d', 'd2_cinderchef')] }), 'p', 'alley');
    expect(totalFrom(on(plain, 'd'), 'Karwind')).toEqual([4, 4]);
    expect(plain.shoutFiresThisTurn ?? 0).toBe(1);
  });

  it('cancelling the aim plays nothing and triggers nothing', () => {
    const held = play(set2({ board: [bc('k', 'karwind'), bc('d', 'd2_cinderchef'), bc('dw', 'dw_dorrin')] }), 'g', 'dw_dorrin');
    const back = act(held, { type: 'cancelChoice' });
    expect(back.hand.some((c) => c.uid === 'g')).toBe(true);
    expect(totalFrom(on(back, 'd'), 'Karwind')).toEqual([0, 0]);
    expect(back.shoutFiresThisTurn ?? 0).toBe(0);
  });

  it('COMBAT: a re-fired aimed Shout with no target still procs Karwind (Ryme via Rune of the Herald)', () => {
    const fight = (first: string) => {
      const board: BoardMinion[] = [
        { cardId: first, attack: 1, health: 300, sourceUid: 'p0', keywords: [] },
        { cardId: 'ryme', attack: 1, health: 1, sourceUid: 'p1', keywords: [] },
        { cardId: 'karwind', attack: 2, health: 300, sourceUid: 'k', keywords: [] },
      ];
      const r = simulate(board, [{ cardId: 'sandbag', attack: 1, health: 900, sourceUid: 'e0', keywords: [] }], makeRng(5), CARD_INDEX,
        combatSide({ tier: 6, tribes: ['kobold', 'dragon', 'beast', 'demon', 'dwarf'] as never, questMods: { runeHerald: true } }), combatSide());
      const kUid = r.initial.player[2]!.uid;
      return r.events.filter((e) => e.type === 'buff' && (e as { source?: string }).source === kUid).length;
    };
    expect(fight('sandbag')).toBe(0); // a Shout-less neighbour: nothing to trigger
    expect(fight('dw_dorrin')).toBeGreaterThan(0);
    expect(fight('dm_agent')).toBeGreaterThan(0);
  });
});
