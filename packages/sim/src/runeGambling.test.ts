import { describe, it, expect } from 'vitest';
import { CARD_INDEX, RUNE_INDEX } from '@game/content';
import { createRun, reduce, type RunState } from './index';
import { spellDisplayText } from './recruit';

/**
 * Rune of Gambling (owner add 2026-09-17, every set): "Get a Gamble. Repeat every turn. Your Gambles grant both a
 * spell and minion." The Hoardflame shape — a recurring spell grant plus a rider on that spell (`runeGambleBoth`).
 */
describe('Rune of Gambling', () => {
  const armed = (): RunState => reduce(
    { ...createRun(1, 'runesmith'), wave: 7, phase: 'recruit', embers: 20, runeforgeOffer: ['rune_gambling'] } as RunState,
    { type: 'buyRune', index: 0 },
  );
  const gambleInHand = (over: Partial<RunState>): RunState => ({
    ...createRun(6), phase: 'recruit', embers: 10, rngCursor: 777, board: [], hand: [
      { uid: 'sp', cardId: 'sp_gamble', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false },
    ], ...over,
  } as RunState);

  it('is a Basic rune offered in EVERY set (no `sets` scope)', () => {
    const r = RUNE_INDEX['rune_gambling']!;
    expect(r).toBeTruthy();
    expect(r.sets).toBeUndefined();
    expect(r.epic).toBeFalsy();
    expect(CARD_INDEX['rune_gambling'], 'must not collide with a card id').toBeUndefined();
  });

  it('pays a Gamble at once, repeats it every turn, and arms the both-prizes rider', () => {
    const s = armed();
    expect(s.hand.map((c) => c.cardId)).toContain('sp_gamble');
    expect(s.questRecurringGrants ?? []).toContain('sp_gamble');
    expect(s.runeGambleBoth).toBe(true);
  });

  it('without the rune a Gamble pays ONE card; with it, a minion AND a spell of the rolled tier', () => {
    const plain = reduce(gambleInHand({}), { type: 'play', uid: 'sp' } as never);
    expect(plain.hand.filter((c) => c.cardId !== 'sp_gamble')).toHaveLength(1);
    expect(plain.gambleWonUids).toHaveLength(1);

    const both = reduce(gambleInHand({ runeGambleBoth: true }), { type: 'play', uid: 'sp' } as never);
    const got = both.hand.filter((c) => c.cardId !== 'sp_gamble').map((c) => CARD_INDEX[c.cardId]!);
    expect(got, 'one minion + one spell').toHaveLength(2);
    expect(got.filter((d) => !d.spell)).toHaveLength(1);
    expect(got.filter((d) => !!d.spell)).toHaveLength(1);
    const tier = both.gambleRoll!.tier;
    for (const d of got) expect(d.tier, `${d.id} matches the die`).toBe(tier);
    // …and the UI withholds BOTH prizes until the die lands.
    expect(both.gambleWonUids).toHaveLength(2);
    expect(both.gambleWonUids).toContain(both.gambleWonUid);
  });

  it("the Gamble's live text promises both prizes while the rune is armed", () => {
    expect(spellDisplayText('sp_gamble', 0)).toContain('minion or spell');
    expect(spellDisplayText('sp_gamble', 0, 0, 0, 0, 0, 0, { gambleBoth: true })).toContain('minion AND spell');
  });
});
