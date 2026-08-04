import { describe, it, expect } from 'vitest';
import { ALL_CARDS, CARD_INDEX } from '@game/content';
import { createRun, type BoardCard, type RunState } from './state';
import { reduce } from './reducer';

/**
 * A tribe-restricted Battlecry may only resolve onto that tribe.
 *
 * The aim UI filtered the pick, but the REDUCER accepted whatever uid it was handed — so an off-tribe target
 * resolved in full (an Appetite Agent could feed a Beast). The reducer is what actually decides; the UI is a
 * mirror of it. Same hole Cupcakes had on the spell path (owner report 2026-08-03) — this is the Battlecry
 * twin, and it covers all five `targetTribe` cards.
 */

const body = (uid: string, cardId: string): BoardCard =>
  ({ uid, cardId, tribe: CARD_INDEX[cardId]!.tribe, attack: 3, health: 3, keywords: [], golden: false });

describe('Appetite Agent — Demons only', () => {
  const agent = (uid: string): BoardCard =>
    ({ uid, cardId: 'dm_agent', tribe: 'demon', attack: 3, health: 2, keywords: [], golden: false });

  it('is declared Demon-only and says so', () => {
    const def = CARD_INDEX['dm_agent']!;
    expect(def.targetTribe).toBe('demon');
    expect(def.text).toContain('Demon');
    expect(def.text, 'the generic wording is gone').not.toContain('target a minion.');
  });

  it('resolves on a friendly Demon — it eats from the Shop', () => {
    let s: RunState = { ...createRun(3), board: [body('d', 'impoverseer')], hand: [agent('a')], embers: 20 };
    s = reduce(s, { type: 'play', uid: 'a' });
    expect(s.pendingTarget, 'a legal target exists, so it must prompt').toBeTruthy();
    const shopBefore = s.shop.length;
    const after = reduce(s, { type: 'battlecryTarget', targetUid: 'd' });
    expect(after.shop.length, 'the Demon consumed a Shop minion').toBe(shopBefore - 1);
  });

  it('REFUSES an off-tribe target handed straight to the reducer', () => {
    let s: RunState = { ...createRun(3), board: [body('d', 'impoverseer'), body('b', 'venom')], hand: [agent('a')], embers: 20 };
    s = reduce(s, { type: 'play', uid: 'a' });
    const bad = reduce(s, { type: 'battlecryTarget', targetUid: 'b' }); // a Beast
    expect(bad, 'an off-tribe target must be refused outright').toBe(s);
    expect(bad.shop.length, 'nothing was eaten').toBe(s.shop.length);
  });

  it('does not prompt at all when no friendly Demon is available', () => {
    const s: RunState = { ...createRun(3), board: [body('b', 'venom')], hand: [agent('a')], embers: 20 };
    const after = reduce(s, { type: 'play', uid: 'a' });
    expect(after.pendingTarget).toBeUndefined(); // plays as a plain body rather than offering an illegal pick
  });
});

describe('the guard covers every targetTribe card, not just the reported one', () => {
  it('each one refuses a target of the wrong tribe', () => {
    const restricted = ALL_CARDS.filter((c) => c.targetTribe && !c.spell);
    expect(restricted.length, 'the fixture should find the tribe-restricted Battlecries').toBeGreaterThan(0);
    for (const def of restricted) {
      // A legal body (so the Battlecry prompts) plus an off-tribe body to aim at.
      const legal = ALL_CARDS.find((c) => !c.spell && !c.token && c.id !== def.id
        && (c.tribe === def.targetTribe || c.tribe2 === def.targetTribe));
      const illegal = ALL_CARDS.find((c) => !c.spell && !c.token && c.tribe !== def.targetTribe && c.tribe2 !== def.targetTribe);
      if (!legal || !illegal) continue;
      let s: RunState = {
        ...createRun(3), embers: 20,
        board: [body('ok', legal.id), body('no', illegal.id)],
        hand: [{ uid: 'c', cardId: def.id, tribe: def.tribe, attack: 3, health: 3, keywords: [], golden: false }],
      };
      s = reduce(s, { type: 'play', uid: 'c' });
      if (!s.pendingTarget) continue; // this card resolved without a prompt — nothing to guard
      expect(reduce(s, { type: 'battlecryTarget', targetUid: 'no' }), `${def.id} accepted an off-tribe target`).toBe(s);
    }
  });
});
