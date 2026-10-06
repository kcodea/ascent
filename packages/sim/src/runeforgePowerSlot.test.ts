import { describe, it, expect } from 'vitest';
import { RUNE_INDEX } from '@game/content';
import { createRun, reduce, type RunState } from './index';

/**
 * R-RUNESLOT-01 / R-RUNESLOT-02 (owner report 2026-10-06): "the hero power runeforge selection should sit in the
 * hero power slot … there is a floating copy of the rune that was selected on turn 9's runeforge … change the text
 * to say copy the first epic rune you select".
 *
 * The sim half of the fix: the power slot (`heroGrantArt`) is stamped by the HERO's forge only. Guardian's forge is
 * an Epic forge, and so is the universal turn-9 one, so "stamp on any Epic forge" let the turn-9 pick overwrite
 * the turn-8 rune in his power slot. The UI half (the rack leaves the power-slot rune out) is pinned in
 * `packages/ui/src/heroSlotRune.test.ts`.
 */
const EPIC_A = 'rune_dawnclaw';
const EPIC_B = 'rune_copies';

/** Open an Epic forge on `wave` offering `offer`, the way `openEpicRuneforge` flags one, and buy slot 0. */
function buyEpic(s: RunState, wave: number, offer: string[]): RunState {
  const open = {
    ...s, phase: 'recruit', wave, embers: 50, runeforgeEpic: true, runeforgeNoCharge: true,
    runeforgeOffer: offer, runeforgeDiscounts: offer.map(() => 0),
  } as RunState;
  return reduce(open, { type: 'buyRune', index: 0 } as never);
}

function guardianWithDuplication(): RunState {
  return { ...createRun(41, 'runeguard'), ownedRunes: ['rune_duplication'], runeDuplication: true } as RunState;
}

describe('R-RUNESLOT-01: the hero-power forge rune owns the power slot', () => {
  it('the fixture runes are Epic (a non-Epic pick would not exercise the Epic-forge path)', () => {
    expect([RUNE_INDEX[EPIC_A]?.epic, RUNE_INDEX[EPIC_B]?.epic]).toEqual([true, true]);
  });

  it("Guardian's turn-9 Epic pick does NOT overwrite his turn-8 rune in the power slot", () => {
    const t8 = buyEpic(guardianWithDuplication(), 8, [EPIC_A]);
    expect(t8.heroGrantArt, 'turn 8 is his forge').toEqual({ kind: 'rune', id: EPIC_A });
    const t9 = buyEpic(t8, 9, [EPIC_B]);
    expect(t9.heroGrantArt, 'the universal turn-9 forge is not his').toEqual({ kind: 'rune', id: EPIC_A });
    // The owner's run: Duplication (turn 6) copied the turn-8 rune, then turn 9 added its own — 4 owned runes,
    // one of which (the turn-8 pick) lives in the power slot, leaving exactly 3 for the 3-socket rack.
    expect(t9.ownedRunes).toEqual(['rune_duplication', EPIC_A, EPIC_A, EPIC_B]);
  });

  it('an Epic forge BEFORE turn 8 (Rune of the Ornate Clock) is not his, and leaves the slot for turn 8', () => {
    const early = buyEpic({ ...createRun(41, 'runeguard') } as RunState, 7, [EPIC_B]);
    expect(early.heroGrantArt, 'turn 7 is not his forge').toBeUndefined();
    const t8 = buyEpic(early, 8, [EPIC_A]);
    expect(t8.heroGrantArt).toEqual({ kind: 'rune', id: EPIC_A });
  });

  it("Runesmith's slot keeps his turn-5 rune through the universal turn-6 and turn-9 forges", () => {
    const s = { ...createRun(41, 'runesmith'), phase: 'recruit', wave: 5, embers: 50, runeforgeOffer: ['rune_action'], runeforgeDiscounts: [0] } as RunState;
    const t5 = reduce(s, { type: 'buyRune', index: 0 } as never);
    expect(t5.heroGrantArt).toEqual({ kind: 'rune', id: 'rune_action' });
    const t6 = reduce({ ...t5, wave: 6, embers: 50, runeforgeNoCharge: true, runeforgeOffer: ['rune_duplication'], runeforgeDiscounts: [0] } as RunState, { type: 'buyRune', index: 0 } as never);
    const t9 = buyEpic(t6, 9, [EPIC_B]);
    expect(t9.heroGrantArt).toEqual({ kind: 'rune', id: 'rune_action' });
  });
});

describe('R-RUNESLOT-02: Rune of Duplication copies the first Epic rune you select', () => {
  it('prints the owner wording', () => {
    expect(RUNE_INDEX['rune_duplication']!.text).toBe('Copy the **first Epic Rune** you select.');
  });

  it('the copy is the FIRST Epic bought after it, and only that one', () => {
    const t8 = buyEpic(guardianWithDuplication(), 8, [EPIC_A]);
    expect(t8.runeDuplication, 'spent on the first Epic').toBeUndefined();
    expect(t8.ownedRunes!.filter((id) => id === EPIC_A)).toHaveLength(2);
    const t9 = buyEpic(t8, 9, [EPIC_B]);
    expect(t9.ownedRunes!.filter((id) => id === EPIC_B), 'the second Epic is not copied').toHaveLength(1);
  });

  it('a BASIC buy does not spend it', () => {
    const basic = reduce({
      ...guardianWithDuplication(), phase: 'recruit', wave: 6, embers: 50, runeforgeNoCharge: true,
      runeforgeOffer: ['rune_action'], runeforgeDiscounts: [0],
    } as RunState, { type: 'buyRune', index: 0 } as never);
    expect(basic.runeDuplication).toBe(true);
    expect(basic.ownedRunes!.filter((id) => id === 'rune_action')).toHaveLength(1);
  });
});
