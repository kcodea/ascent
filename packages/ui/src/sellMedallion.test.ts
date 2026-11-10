/**
 * R-FX-SELL-01 (owner 2026-11-09): every minion wearing the Sell medallion plays its On Sell effect (`sell`) as it is
 * sold, and a sale that cashes Quick Sale's bonus Gold plays it on the unit sold, whatever that unit is.
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { bindingFor } from './choreo/bindings';
import { CARD_EVENT_SLOTS } from './fx/ui/cardEventSlots';
import { boostsNextSell, hasSellMedallion, QUICK_SALE_ID } from './sellMedallion';

const sellSlot = CARD_EVENT_SLOTS.find((s) => s.id === 'sell')!;
const row = (cardId: string) => ({ cardId, spell: !!CARD_INDEX[cardId]?.spell }) as never;

describe('On Sell (R-FX-SELL-01)', () => {
  const medallioned = Object.keys(CARD_INDEX).filter(hasSellMedallion);

  it('finds the Sell-medallion cards (River Drake wears it; an Epic card never does)', () => {
    expect(medallioned).toContain('d2_riverdrake');
    expect(medallioned).toContain('n2_salesman');
    expect(medallioned).not.toContain('drummer');
  });

  it('every Sell-medallion card plays the sell effect as it is sold, and offers the On Sell slot', () => {
    for (const id of medallioned) {
      expect(bindingFor(id, 'sell')?.def, id).toBe('sell');
      expect(sellSlot.kindFor(row(id)), id).toBe('sell');
    }
  });

  it('Quick Sale binds the sell effect for the unit whose sale cashes its bonus Gold', () => {
    expect(boostsNextSell(QUICK_SALE_ID)).toBe(true);
    expect(bindingFor(QUICK_SALE_ID, 'sell')?.def).toBe('sell');
    expect(sellSlot.kindFor(row(QUICK_SALE_ID))).toBe('sell');
  });

  it('a card with no Sell mechanic offers no On Sell slot', () => {
    expect(sellSlot.kindFor(row('drummer'))).toBeNull();
  });
});
