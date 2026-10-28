/**
 * ANCIENTS × DISCO DAN (owner pairings 2026-10-27). Setlist (passive): "On turn 1, Discover Tier 6, Tier 4, and Tier 2
 * minions. Each unlocks when you reach its Shop tier." The Setlist cards are those three picks. Every pairing in the
 * phase(s) it fires in.
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import {
  ANCIENT_IDS, ancientOfferText, createRun, enableAncients, gildCopiesNeeded, heroPowerText, offerBuyPrice, reduce,
  type AncientId, type BoardCard, type BoardSnapshot, type RunState,
} from './index';
import { hasDeathrattle } from './recruit';

const BASE = 'On turn 1, Discover Tier 6, Tier 4, and Tier 2 minions. Each unlocks when you reach its Shop tier.';
const N = (i: number) => ['beatboxer', 'dw_edward', 'attachmentconductor', 'sandbag'][i % 4]!;
const S6 = 'beatboxer'; // a stand-in Setlist card (Tier 6), locked until Tier 6
const S5 = 'dw_edward';

const card = (uid: string, cardId: string, extra: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...extra };
};
/** A Disco Dan run on turn 2 (turn 1 is a pure Setlist: no Shop actions), its Setlist Discovers cleared, the Setlist held as tier-locked hand cards. */
const base = (over: Partial<RunState> = {}): RunState => ({
  ...createRun(7, 'discodan'), phase: 'recruit', wave: 2, embers: 20, heroReady: true, discover: undefined, discoverQueue: [],
  discoverLockTier: undefined, board: [], shop: [], hand: [card('s6', S6, { lockedUntilTier: 6 }), card('s5', S5, { lockedUntilTier: 5 })], ...over,
} as RunState);
const picked = (id: AncientId, over: Partial<RunState> = {}): RunState => {
  let s = enableAncients(base(over));
  s = { ...s, ancients: { ...s.ancients!, points: s.ancients!.cost, offer: [id, ...ANCIENT_IDS.filter((a) => a !== id).slice(0, 2)] } };
  s = reduce(s, { type: 'pickAncient', id });
  expect(s.ancients!.picked).toBe(id);
  return s;
};
const foes = (wave: number, attack: number, health: number): BoardSnapshot => ({
  v: 1, wave, heroId: 'indy', resolve: 30, tier: 7, triples: 0, tribes: [], threat: 'glass', power: health,
  minions: [{ cardId: 'sandbag', attack, health, keywords: [] }], seed: 1, origin: 'self',
});
const fightNow = (s: RunState, attack = 0, health = 400): RunState => reduce({ ...s, servedBoards: { [s.wave]: foes(s.wave, attack, health) } }, { type: 'faceOmen' });
const inHand = (s: RunState, uid: string) => s.hand.find((c) => c.uid === uid)!;

describe('Disco Dan × every Ancient has a written pairing', () => {
  it('all six are written (no "Not written yet."), and none uses an em dash', () => {
    for (const id of ANCIENT_IDS) {
      expect(ancientOfferText('discodan', id)).not.toBe('Not written yet.');
      expect(ancientOfferText('discodan', id)).not.toMatch(/—|--/);
    }
  });
  it('the real turn-1 Setlist picks are recorded by card while Ancients are on', () => {
    let s = enableAncients({ ...createRun(7, 'discodan'), phase: 'recruit' } as RunState);
    const ids: string[] = [];
    for (let k = 0; k < 3 && s.discover?.length; k++) { ids.push(s.discover[0]!); s = reduce(s, { type: 'discover', index: 0 }); }
    expect(ids.length).toBe(3);
    expect(s.ancients!.discoSetlist).toEqual(ids);
  });
});

describe('Disco Dan × DEATH: "Discover an Echo card. It gains Rise and unlocks when you upgrade your shop."', () => {
  it('the pick opens an Echo Discover; the card gains Rise and is locked until the next Shop tier', () => {
    let s = picked('death', { tier: 3 });
    expect(s.discover?.length).toBeGreaterThan(0);
    for (const id of s.discover!) expect(hasDeathrattle(CARD_INDEX[id]!)).toBe(true);
    const id = s.discover![0]!;
    s = reduce(s, { type: 'discover', index: 0 });
    const got = s.hand.find((c) => c.cardId === id && !c.uid.startsWith('s'))!;
    expect(got.keywords).toContain('R');
    expect(got.lockedUntilTier).toBe(4);
    expect(s.ancients!.discoSetlist ?? []).not.toContain(id); // an Ancient's Discover, not a Setlist pick
  });
  it('at Shop tier 6 it is unlocked right away', () => {
    let s = picked('death', { tier: 6 });
    const id = s.discover![0]!;
    s = reduce(s, { type: 'discover', index: 0 });
    expect(s.hand.find((c) => c.cardId === id && !c.uid.startsWith('s'))!.lockedUntilTier).toBeUndefined();
  });
});

describe('Disco Dan × FORTUNE: "All copies of your setlist cards cost 1 gold."', () => {
  it('a Shop copy of a Setlist card costs 1 Gold; other minions do not', () => {
    const s = picked('fortune');
    expect(offerBuyPrice(s, { cardId: S6 }).cost).toBe(1);
    expect(offerBuyPrice(s, { cardId: S5 }).cost).toBe(1);
    expect(offerBuyPrice(s, { cardId: N(2) }).cost).toBe(3);
    const names = [S6, S5].map((id) => `**${CARD_INDEX[id]!.name}**`).join(', ');
    expect(heroPowerText(s)).toBe(`${BASE} Every copy of your Setlist cards costs **1 Gold** (${names}).`);
  });
});

describe('Disco Dan × WAR: "Give your Setlist cards Ward and Flurry"', () => {
  it('the Setlist cards held gain Ward and Flurry; other cards do not', () => {
    const s = picked('war', { hand: [card('s6', S6, { lockedUntilTier: 6 }), card('o', N(2))] });
    expect(inHand(s, 's6').keywords).toEqual(expect.arrayContaining(['DS', 'W']));
    expect(inHand(s, 'o').keywords).not.toContain('DS');
  });
});

describe('Disco Dan × GENESIS: "Discover a T7 that unlocks at shop tier 6."', () => {
  it('the pick opens a Tier 7 Discover; the card is locked until Tier 6 and is not a Setlist card', () => {
    let s = picked('genesis', { tier: 3 });
    expect(s.discover?.length).toBeGreaterThan(0);
    for (const id of s.discover!) expect(CARD_INDEX[id]!.tier).toBe(7);
    const id = s.discover![0]!;
    s = reduce(s, { type: 'discover', index: 0 });
    expect(s.hand.find((c) => c.cardId === id)!.lockedUntilTier).toBe(6);
    expect(s.ancients!.discoSetlist ?? []).not.toContain(id);
  });
});

describe('Disco Dan × TIME: "End of Turn: Reduce the cost of upgrading your Shop by 3."', () => {
  it('End of Turn cuts the upgrade price by 3', () => {
    let s = picked('time', { tier: 2, upgradeCost: 8 });
    s = fightNow(s);
    expect(s.upgradeCost).toBe(5);
  });
});

describe('Disco Dan × BONDS: "Setlist cards only require 2 copies to be Gilded."', () => {
  it('two copies of a Setlist card Gild; two copies of another card do not', () => {
    const s = picked('bonds', { hand: [card('s6', S6, { lockedUntilTier: 6 }), card('o1', N(2))] });
    expect(gildCopiesNeeded(s, S6)).toBe(2);
    expect(gildCopiesNeeded(s, N(2))).toBe(3);
    const t = reduce({ ...s, shop: [{ uid: 'c6', cardId: S6 }, { uid: 'c2', cardId: N(2) }] }, { type: 'buy', uid: 'c6' });
    expect(t.hand.some((c) => c.cardId === S6 && c.golden)).toBe(true);
    const u = reduce(t, { type: 'buy', uid: 'c2' });
    expect(u.hand.some((c) => c.cardId === N(2) && c.golden)).toBe(false);
  });
});

describe('Disco Dan × determinism', () => {
  it('every pairing replays identically from the same state', () => {
    for (const id of ANCIENT_IDS) {
      const run = () => {
        let s = picked(id, { wave: 4, tier: 3, board: [card('a', N(0), { attack: 30, health: 3 })] });
        if (s.discover?.length) s = reduce(s, { type: 'discover', index: 0 });
        return reduce(fightNow(s, 60, 1000), { type: 'resolveCombat' });
      };
      const a = run();
      const b = run();
      expect(JSON.stringify(a.lastCombat?.events), id).toBe(JSON.stringify(b.lastCombat?.events));
      expect(JSON.stringify(a.board), id).toBe(JSON.stringify(b.board));
      expect(JSON.stringify(a.hand), id).toBe(JSON.stringify(b.hand));
      expect(JSON.stringify(a.ancients), id).toBe(JSON.stringify(b.ancients));
    }
  });
});
