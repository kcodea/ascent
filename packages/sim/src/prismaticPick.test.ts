import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { createRun, reduce, equipmentUsesLeft, type Action, type BoardCard, type RunState } from './index';

/**
 * PRISMATIC PICK — the first Equipment to open the CHOOSE ONE window (owner ask 2026-08-31):
 *
 *   *"We need to build Prismpick the way it's stated. When it's used it should open the Choose One window."*
 *
 * The load-bearing claim is not that the window opens — it is that opening it **commits nothing**, exactly as
 * a Choose One CARD does. No Gold, no allowance, no trigger, and a cancel that leaves the run untouched. The
 * activation is replayed from the top once a branch is picked, so the Gold, the allowance, the FX cue and the
 * triple check all fire once at their single site.
 */
const body = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
};
const run = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(1), setId: 'set3', phase: 'recruit', embers: 20, ...over } as RunState);
const act = (s: RunState, a: Action): RunState => reduce(s, a);

/** An Artificer on the board with its Pick equipped. */
const armed = (over: Partial<RunState> = {}, golden = false): RunState =>
  act(run({ hand: [body('art', 'k3_prismpick', { golden })], ...over }), { type: 'play', uid: 'art', toIndex: 0 });

describe('Prismatic Pick', () => {
  it('using it opens the Choose One window — and commits NOTHING', () => {
    const s = armed();
    const before = { embers: s.embers, uses: equipmentUsesLeft(s), hand: s.hand.length, rng: s.rngCursor };
    const asked = act(s, { type: 'activateEquipment' });
    expect(asked.chooseOne?.equipmentId, 'the window belongs to the Equipment').toBe('prismatic_pick');
    expect(asked.embers, 'no Gold spent to ask').toBe(before.embers);
    expect(equipmentUsesLeft(asked), 'no allowance spent to ask').toBe(before.uses);
    expect(asked.hand.length, 'nothing granted yet').toBe(before.hand);
    expect(asked.rngCursor, 'and no RNG drawn').toBe(before.rng);
  });

  it('cancelling is a pure no-op', () => {
    const s = armed();
    const cancelled = act(act(s, { type: 'activateEquipment' }), { type: 'cancelChoice' });
    expect(cancelled.chooseOne, 'the window closed').toBeUndefined();
    expect(cancelled.embers).toBe(s.embers);
    expect(equipmentUsesLeft(cancelled), 'still usable').toBe(equipmentUsesLeft(s));
    expect(cancelled.chooseOnePick, 'no pick left behind to poison the next activation').toBeUndefined();
  });

  it('branch 1 hands you a Choose One card, paying Gold and the allowance exactly once', () => {
    const s = armed();
    const asked = act(s, { type: 'activateEquipment' });
    const done = act(asked, { type: 'chooseOne', index: 0 });
    expect(done.hand.length, 'a card arrived').toBe(1);
    const granted = CARD_INDEX[done.hand[0]!.cardId];
    expect(granted?.chooseOne?.length, 'and it is a Choose One card').toBeGreaterThan(0);
    expect(s.embers - done.embers, 'the Pick costs 2, charged once').toBe(2);
    expect(equipmentUsesLeft(done), 'one allowance, not two').toBe(equipmentUsesLeft(s) - 1);
    expect(done.chooseOnePick, 'the pick was consumed').toBeUndefined();
  });

  it('branch 2 arms the next Choose One to take BOTH halves', () => {
    const s = armed();
    const done = act(act(s, { type: 'activateEquipment' }), { type: 'chooseOne', index: 1 });
    expect(done.chooseBothCharges, 'one charge armed').toBe(1);
    expect(s.embers - done.embers, 'still charged once').toBe(2);
  });

  it('a GILDED Artificer doubles the branch — through the Equipment, not twice over', () => {
    // The trap this asserts against: the branches reuse shared recruit factories that read the source's
    // golden flag, while Equipment expresses gilding through `gildedParams`. Both channels firing would arm
    // FOUR charges for a card that promises two.
    const s = armed({}, true);
    const done = act(act(s, { type: 'activateEquipment' }), { type: 'chooseOne', index: 1 });
    expect(done.chooseBothCharges, 'two charges, not four').toBe(2);
  });

  it('an unaffordable Pick never even asks', () => {
    const s = { ...armed(), embers: 1 };
    const asked = act(s, { type: 'activateEquipment' });
    expect(asked.chooseOne, 'no question it cannot answer').toBeUndefined();
  });
});
