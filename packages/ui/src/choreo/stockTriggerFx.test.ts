import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { bindingFor } from './bindings';
import { STOCK_TRIGGER_DEFS, cardHasEcho, triggerFxFor } from './stockTriggerFx';
import { CARD_EVENT_SLOTS } from '../fx/ui/cardEventSlots';
import type { FxCardRow } from '../fx/ui/catalogView';

const saved = (...ids: string[]) => (id: string): boolean => ids.includes(id);
const nothingSaved = saved();
const everythingSaved = (): boolean => true;

/** A Rally card and a non-Rally card with NO binding of their own at `rally`, found from the live data. */
const cards = Object.values(CARD_INDEX).filter((c) => !c.spell);
const rallier = cards.find((c) => (c.keywords as readonly string[]).includes('RL') && bindingFor(c.id, 'rally') === null)!;
const nonRallier = cards.find((c) => !(c.keywords as readonly string[]).includes('RL'))!;
const echoCard = cards.find((c) => c.effects.some((e) => e.on === 'onDeath'))!;

describe('triggerFxFor (R-FX-TRIGGER-STOCK-01)', () => {
  it('names one stock def per trigger that used to show only the medallion pulse', () => {
    expect(STOCK_TRIGGER_DEFS).toEqual({
      startOfCombat: 'medallion',
      avenge: 'medallion',
      endOfTurn: 'medallion',
      rally: 'medallion',
      echo: 'echo-stock',
      watcher: 'watcher-stock',
    });
  });

  it('every stock def that is meant to be live exists in the registry', async () => {
    await import('../fx/primitives');
    const { getDef } = await import('../fx/fxDefs');
    for (const kind of ['startOfCombat', 'avenge', 'endOfTurn', 'rally'] as const) {
      expect(getDef(STOCK_TRIGGER_DEFS[kind]), kind).toBeDefined();
    }
  });

  it('resolves nothing until the stock def is saved, so the pulse stays as the fallback', () => {
    for (const kind of ['startOfCombat', 'avenge', 'echo', 'endOfTurn', 'watcher'] as const) {
      expect(triggerFxFor(nonRallier.id, kind, nothingSaved), kind).toBe(bindingFor(nonRallier.id, kind));
    }
  });

  it('resolves the stock def by name once it exists', () => {
    expect(triggerFxFor(echoCard.id, 'echo', saved('echo-stock'))).toEqual({ def: 'echo-stock' });
    expect(triggerFxFor(echoCard.id, 'echo', saved('avenge-stock'))).toBeNull();
  });

  it('a card\'s own binding outranks the stock effect', () => {
    expect(bindingFor('d2_chorus', 'rally')?.def).toBe('chorusdrake-rally');
    expect(triggerFxFor('d2_chorus', 'rally', everythingSaved)?.def).toBe('chorusdrake-rally');
  });

  it('the stock Rally reaches Rally cards only: every attacker is asked, most do not rally', () => {
    expect(triggerFxFor(rallier.id, 'rally', everythingSaved)).toEqual({ def: 'medallion' });
    expect(triggerFxFor(nonRallier.id, 'rally', everythingSaved)).toBeNull();
  });

  it('a kind with no stock effect is exactly bindingFor', () => {
    expect(triggerFxFor(nonRallier.id, 'death', everythingSaved)).toBe(bindingFor(nonRallier.id, 'death'));
    expect(triggerFxFor(null, 'echo', everythingSaved)).toBeNull();
  });

  it('cardHasEcho reads the card\'s own onDeath effect', () => {
    expect(cardHasEcho(echoCard.id)).toBe(true);
    expect(cardHasEcho(null)).toBe(false);
    expect(cardHasEcho('no-such-card')).toBe(false);
  });

  it('the workbench offers an On Echo slot on Echo cards, bound at the `echo` kind', () => {
    const slot = CARD_EVENT_SLOTS.find((s) => s.id === 'echo')!;
    const row = (cardId: string): FxCardRow => ({ cardId, spell: false } as FxCardRow);
    expect(slot.kindFor(row(echoCard.id))).toBe('echo');
    const noEcho = cards.find((c) => !c.effects.some((e) => e.on === 'onDeath'))!;
    expect(slot.kindFor(row(noEcho.id))).toBeNull();
  });
});
