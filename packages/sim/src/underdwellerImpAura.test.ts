import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { createRun, reduce, conjuredStats, offerBuyStats, type RunState } from './index';
import { bakedAuraOf, buffImpsRunWide, makeContext } from './recruit';

/**
 * R-IMP-AURA-01 — every Imp is BORN carrying the run's Imp Aura (`impBuff`), whatever made it.
 *
 * Owner report 2026-10-28: "i discovered an imp from the underdweller hero power but it didnt have my imp's buffs on
 * it. this is a bug". The aura is BAKED into a held Imp's stored stats (combat re-adds it only to a from-base body),
 * so every creation site has to bake it once. Only the shop summon did; the Discover pick (and the buy, and the combat
 * hand-grants) used the shared creation-aura helpers, which did not know about Imps.
 */
const AURA = { attack: 3, health: 2 };
const IMP = CARD_INDEX.impscrap!;

const at = (over: Partial<RunState>): RunState =>
  ({ ...createRun(7), phase: 'recruit', impBuff: { ...AURA }, ...over }) as RunState;

/** A last combat where an ENEMY Imp, summoned mid-fight, died (the shape Underdweller reads). */
const impDiedLastCombat = {
  result: 'win', playerDamage: 0, playerDeathrattles: 0,
  initial: { player: [], enemy: [{ uid: 'e1', cardId: 'dm_knocked', name: 'k', tribe: 'demon', attack: 2, health: 1, keywords: [] }] },
  events: [
    { type: 'summon', side: 'enemy', minion: { uid: 'e2', cardId: 'impscrap', attack: 1, health: 1 } },
    { type: 'death', target: 'e2', side: 'enemy' },
  ],
};

const discoverImp = (s: RunState): RunState => {
  const opened = reduce(s, { type: 'heroPower' } as never);
  expect(opened.discover, 'the dead Imp is offered').toEqual(['impscrap']);
  return reduce(opened, { type: 'discover', index: 0 } as never);
};

describe('R-IMP-AURA-01 — an Imp from any source carries the Imp Aura, exactly once', () => {
  it("owner case: Underdweller's Discovered Imp lands in hand with the aura", () => {
    const s = at({ heroId: 'underdweller', embers: 10, heroReady: true, hand: [], lastCombat: impDiedLastCombat as never });
    const after = discoverImp(s);
    const imp = after.hand.find((c) => c.cardId === 'impscrap')!;
    expect([imp.attack, imp.health]).toEqual([IMP.attack + AURA.attack, IMP.health + AURA.health]);
  });

  it('playing the Discovered Imp keeps its stats (the aura is not paid again on the board)', () => {
    const s = at({ heroId: 'underdweller', embers: 10, heroReady: true, hand: [], board: [], lastCombat: impDiedLastCombat as never });
    const inHand = discoverImp(s);
    const uid = inHand.hand.find((c) => c.cardId === 'impscrap')!.uid;
    const played = reduce(inHand, { type: 'play', uid } as never);
    const imp = played.board.find((c) => c.uid === uid)!;
    expect([imp.attack, imp.health]).toEqual([IMP.attack + AURA.attack, IMP.health + AURA.health]);
  });

  it('a later aura bump reaches the Discovered Imp once (no double count)', () => {
    const s = at({ heroId: 'underdweller', embers: 10, heroReady: true, hand: [], lastCombat: impDiedLastCombat as never });
    const after = discoverImp(s);
    buffImpsRunWide(after, 1, 1, 'Test');
    const imp = after.hand.find((c) => c.cardId === 'impscrap')!;
    expect([imp.attack, imp.health]).toEqual([IMP.attack + AURA.attack + 1, IMP.health + AURA.health + 1]);
  });

  it('with no aura the Discovered Imp is the printed 1/1', () => {
    const s = at({ heroId: 'underdweller', embers: 10, heroReady: true, hand: [], impBuff: undefined, lastCombat: impDiedLastCombat as never });
    const imp = discoverImp(s).hand.find((c) => c.cardId === 'impscrap')!;
    expect([imp.attack, imp.health]).toEqual([IMP.attack, IMP.health]);
  });

  it('the shared conjure stats (combat hand-grants, Trophy copies, every Discover) carry it', () => {
    expect(conjuredStats(at({}), IMP)).toEqual({ attack: IMP.attack + AURA.attack, health: IMP.health + AURA.health });
    // Non-Imps are untouched by the Imp Aura.
    const stray = CARD_INDEX.stray!;
    expect(conjuredStats(at({ cardBuffs: {} }), stray)).toEqual({ attack: stray.attack, health: stray.health });
  });

  it('a BOUGHT Imp offer (Membrance restocking a foe Imp) buys in with it, once', () => {
    const s = at({ embers: 10, board: [], shop: [{ uid: 'sImp', cardId: 'impscrap' }] });
    expect(offerBuyStats(s, s.shop[0]!)).toEqual({ attack: IMP.attack + AURA.attack, health: IMP.health + AURA.health });
    const after = reduce(s, { type: 'buy', uid: 'sImp' } as never);
    const imp = [...after.hand, ...after.board].find((c) => c.cardId === 'impscrap')!;
    expect([imp.attack, imp.health]).toEqual([IMP.attack + AURA.attack, IMP.health + AURA.health]);
  });

  it('the shop summon still pays it exactly once (it used to add it by hand)', () => {
    const s = at({ board: [] });
    const imp = makeContext(s).summon(IMP, '')!;
    expect([imp.attack, imp.health]).toEqual([IMP.attack + AURA.attack, IMP.health + AURA.health]);
  });

  it("an Imp's baked aura counts the Imp Aura once (stat-writing spells re-apply it, not twice)", () => {
    const s = at({});
    const card = { uid: 'x', cardId: 'impscrap', tribe: IMP.tribe, attack: 4, health: 3, keywords: [], golden: false };
    expect(bakedAuraOf(s, card)).toEqual(AURA);
  });
});

describe('R-AURA-01 audit — plain copies still receive the run creation auras', () => {
  it("Gorr's Four Peat copy carries the Beast buy aura like the bought originals", () => {
    let s = { ...createRun(11, 'gorr'), phase: 'recruit', embers: 30, hand: [], board: [], beastBuyAtk: 2, beastBuyHp: 1,
      shop: [{ uid: 'o1', cardId: 'alley' }, { uid: 'o2', cardId: 'kennel' }, { uid: 'o3', cardId: 'stray' }] } as unknown as RunState;
    for (const uid of ['o1', 'o2', 'o3']) s = reduce(s, { type: 'buy', uid } as never);
    expect(s.hand.length, 'three buys + the Four Peat copy').toBe(4);
    for (const c of s.hand) {
      const d = CARD_INDEX[c.cardId]!;
      expect([c.attack, c.health], `${c.cardId} (${c.uid})`).toEqual([d.attack + 2, d.health + 1]);
    }
  });

  it('a Four Peat copy of an Imp carries the Imp Aura', () => {
    // Three Imps bought (a Membrance restock): the copy is an Imp too. Every Imp held (the triple's leftover
    // included) wears the Aura; the golden is the top-two sum like any triple.
    let s = { ...createRun(11, 'gorr'), phase: 'recruit', embers: 30, hand: [], board: [], impBuff: { ...AURA },
      shop: [{ uid: 'o1', cardId: 'impscrap' }, { uid: 'o2', cardId: 'impscrap' }, { uid: 'o3', cardId: 'impscrap' }] } as unknown as RunState;
    for (const uid of ['o1', 'o2', 'o3']) s = reduce(s, { type: 'buy', uid } as never);
    const plain = s.hand.filter((c) => c.cardId === 'impscrap' && !c.golden);
    expect(plain.length).toBeGreaterThan(0);
    for (const c of plain) expect([c.attack, c.health]).toEqual([IMP.attack + AURA.attack, IMP.health + AURA.health]);
  });
});
