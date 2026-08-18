import { describe, it, expect } from 'vitest';
import { createRun, type BoardCard, type RunState, type ShopCard } from './state';
import { projectEndOfTurnSteps } from './recruit';
import { reduce } from './reducer';

/**
 * The RUN-WIDE SHOP BUFF signal — "minions in the Shop get +A/+H" landing on the whole row, which the UI
 * plays as the camera-anchored `shop-buff-aura`.
 *
 * The load-bearing claim these tests exist to pin is the SOURCE of truth: the signal is diffed off
 * `tavernBuyBonus`, the run-wide channel, and NOT off the per-offer stats. That single choice is what makes
 * the moment mean "every shop unit", and it is also what keeps the gem effects out of it for free —
 * `spellBuffShopByRuby` (Veinstorm) was deliberately moved OFF this channel so Ruby readers could see its
 * stats, and Market Tormentor's single-offer Shout never used it. Both are asserted below, because both are
 * "it happens to work today" unless something holds them still.
 */

const card = (uid: string, cardId: string, tribe: BoardCard['tribe'], attack = 1, health = 1): BoardCard =>
  ({ uid, cardId, tribe, attack, health, keywords: [], golden: false });
const spellInHand = (uid: string, cardId: string): BoardCard =>
  ({ uid, cardId, tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false });
const offer = (uid: string, cardId: string): ShopCard => ({ uid, cardId });

describe('shopBuffAllFx (the shop-wide buff signal)', () => {
  it('Staff of Guel raises the run-wide channel → stamps the shop-wide buff with every offer', () => {
    const s: RunState = {
      ...createRun(1), phase: 'recruit', embers: 20,
      board: [], shop: [offer('s1', 'spore'), offer('s2', 'stray')],
      hand: [spellInHand('g1', 'staffofguel')],
    };
    const next = reduce(s, { type: 'play', uid: 'g1' });
    expect(next.tavernBuyBonus.atk).toBeGreaterThan(s.tavernBuyBonus.atk); // the channel actually rose
    expect(next.shopBuffAllFxSeq).toBe(1);
    const fx = next.shopBuffAllFx!;
    expect(fx.attack).toBe(2);
    expect(fx.health).toBe(2);
    expect(fx.uids).toEqual(['s1', 's2']); // the whole row, in shop order
  });

  it('does NOT stamp for Veinstorm — the gem path never touches the run-wide channel', () => {
    // The exclusion the owner asked for, and the reason it is free: `spellBuffShopByRuby` applies REAL
    // per-offer Rubies (so Ruby Transfer / Gemheart Carver can see them) rather than a generic tavern buff.
    // If someone ever "simplifies" it back onto `tavernBuyBonus`, Veinstorm would start firing the shop-wide
    // aura on top of its own gem span, and this goes red.
    const s: RunState = {
      ...createRun(1), phase: 'recruit', embers: 20,
      board: [], shop: [offer('s1', 'spore'), offer('s2', 'stray')],
      hand: [spellInHand('v1', 'veinstorm')],
    };
    const next = reduce(s, { type: 'play', uid: 'v1' });
    expect(next.veinstormFxSeq).toBe(1);          // the gem span DID fire
    expect(next.tavernBuyBonus.atk).toBe(s.tavernBuyBonus.atk); // …without moving the run-wide channel
    expect(next.tavernBuyBonus.hp).toBe(s.tavernBuyBonus.hp);
    expect(next.shopBuffAllFxSeq).toBeUndefined(); // …so no shop-wide aura
    expect(next.shopBuffAllFx).toBeUndefined();
  });

  it('does not stamp on an action that buffs nothing in the shop', () => {
    const s: RunState = {
      ...createRun(1), phase: 'recruit', embers: 20,
      board: [], shop: [offer('s1', 'spore')], hand: [],
    };
    const next = reduce(s, { type: 'roll' });
    expect(next.shopBuffAllFxSeq).toBeUndefined();
  });

  it('surfaces an End-of-Turn shop buff as `shopBuffAll` on the beat that produced it', () => {
    // Soul Defiler buffs the shop at End of Turn, where the phase flips to combat — the action-level stamp
    // lands after the shop is gone, so the BEAT path is what plays it while the row is still on screen.
    const s: RunState = {
      ...createRun(1), phase: 'recruit', embers: 20,
      board: [card('d1', 'dm_curator', 'demon', 3, 3)],
      shop: [offer('s1', 'spore'), offer('s2', 'stray')],
      hand: [],
    };
    const { fx } = projectEndOfTurnSteps(s);
    const all = fx.map((f) => f.shopBuffAll).filter((x): x is { attack: number; health: number } => !!x);
    expect(all.length).toBeGreaterThan(0);
    expect(all[0]!.attack + all[0]!.health).toBeGreaterThan(0);
  });
});
