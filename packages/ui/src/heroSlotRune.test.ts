import { describe, expect, it } from 'vitest';
import { RUNE_INDEX } from '@game/content';
import { createRun, reduce, type RunState } from '@game/sim';
import { heroSlotRuneId, rackRunes } from './heroSlotRune';
import { arrivalClasses } from './runeArrival';

/**
 * R-RUNESLOT-01 (owner report 2026-10-06): "the hero power runeforge selection should sit in the hero power slot.
 * this is currently broken - there is a floating copy of the rune that was selected on turn 9's runeforge … remove
 * the extra ui element floating without a rune slot."
 *
 * The rack (`QuestBadges`) has exactly three sockets (`.questbadge:nth-child(1..3)` in styles.css). It drew every
 * owned rune, so Guardian with Rune of Duplication (basic + turn-8 pick + its copy + turn-9 pick) put a 4th badge
 * in the row with no socket transform, floating beside the 3rd, while the power slot ALSO wore a rune. The rack
 * now leaves out the power-slot rune; these pin that, on a run built through the real reducer.
 */
const RACK_SOCKETS = 3;

function buyEpic(s: RunState, wave: number, offer: string[]): RunState {
  return reduce({
    ...s, phase: 'recruit', wave, embers: 50, runeforgeEpic: true, runeforgeNoCharge: true,
    runeforgeOffer: offer, runeforgeDiscounts: offer.map(() => 0),
  } as RunState, { type: 'buyRune', index: 0 } as never);
}

const rackOf = (run: RunState): string[] => rackRunes(run.ownedRunes ?? [], heroSlotRuneId(run)).filter((id) => RUNE_INDEX[id]);

describe('R-RUNESLOT-01: the rack leaves the hero-power rune to the power slot', () => {
  it("the owner's Guardian run fits the three sockets, with the turn-8 rune in the power slot", () => {
    const start = { ...createRun(41, 'runeguard'), ownedRunes: ['rune_duplication'], runeDuplication: true } as RunState;
    const t9 = buyEpic(buyEpic(start, 8, ['rune_dawnclaw']), 9, ['rune_copies']);
    expect(t9.ownedRunes, 'four owned runes').toHaveLength(4);
    expect(heroSlotRuneId(t9), 'the power slot wears the turn-8 pick').toBe('rune_dawnclaw');
    const rack = rackOf(t9);
    expect(rack, 'Duplication, the COPY of the turn-8 rune, the turn-9 rune').toEqual(['rune_duplication', 'rune_dawnclaw', 'rune_copies']);
    expect(rack.length).toBeLessThanOrEqual(RACK_SOCKETS);
  });

  it('removes exactly ONE copy — a duplicated hero rune keeps its second badge', () => {
    expect(rackRunes(['a', 'x', 'x', 'b'], 'x')).toEqual(['a', 'x', 'b']);
    expect(rackRunes(['x'], 'x')).toEqual([]);
  });

  it('is the identity with no rune in the power slot (every other hero, or a quest grant)', () => {
    expect(rackRunes(['a', 'b'], null)).toEqual(['a', 'b']);
    expect(heroSlotRuneId({ heroGrantArt: { kind: 'quest', id: 'q' } })).toBeNull();
    expect(heroSlotRuneId({ heroGrantArt: undefined })).toBeNull();
  });

  it("the arrival ceremony holds the rack COPY back when Duplication copies the hero's pick, and nothing when it has none", () => {
    // Bought with Duplication: one copy goes to the power slot, the other is the rack badge that arrives.
    const withCopy = rackRunes(['rune_duplication', 'x', 'x'], 'x');
    const occ = withCopy.filter((r) => r === 'x').length - 1;
    expect(arrivalClasses(withCopy, { runeId: 'x', occurrence: occ, phase: 'pending', seq: 1 })).toEqual(['', ' rune-arriving']);
    // Bought plain: no rack badge — nothing in the rack is held back (the implosion lands on the power slot).
    const plain = rackRunes(['b', 'x'], 'x');
    expect(arrivalClasses(plain, { runeId: 'x', occurrence: 0, phase: 'pending', seq: 1 })).toEqual(['']);
  });
});
