import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { createRun, poolOf, reduce, type BoardCard, type RunState, type ShopCard } from './index';
import { elevateShop, refillShopFiltered, rollShop, stampNewShopOffers, topUpTavern } from './shop';
import { addCardToShop, applyShopRefreshed, offerBuyStats } from './recruit';

/**
 * THE ONE NEW-OFFER STAMP (owner bug 2026-10-14: "sigil of kinship refreshes dont have minions with shop buffs -
 * this must be fixed as well").
 *
 * The per-offer shop stamps (Veinstorm's Rubies, Attachment Issues' price) used to live inline in the ordinary
 * roll, and the right-most / left-most SLOT enchants (Market Tormentor, Picnic, Display Case) only re-landed on the
 * reducer's refresh paths. Sigil of Kinship, Elevation Ritual, a frozen top-up, Indy's Golden Monkey and the
 * single-offer replacers (Pete, Open Enrollment) all served BARE offers. Every path now runs its new offers through
 * `stampNewShopOffers`, and this file pins that each path lands the same buffs.
 */

const VEIN = { atk: 2, hp: 1 };
const RIGHT = { attack: 3, health: 3 };
const LEFT = { attack: 1, health: 2 };

const mkSpell = (uid: string, cardId: string): BoardCard =>
  ({ uid, cardId, tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false });

/** A run with every per-offer shop buff source armed, at tier 6 so a tribe-filtered refresh has stock. */
function buffed(seed = 3, over: Partial<RunState> = {}): RunState {
  const base = createRun(seed);
  // A real minion of the run's first tribe: Sigil reads its type, Open Enrollment its board dominance.
  const kin = poolOf(base).buyable.find((c) => !c.spell && !c.ruby && c.tribe === base.tribes[0])!;
  return {
    ...base, tier: 6, embers: 30,
    veinstormRubies: { ...VEIN },
    rightmostSlotBuff: { ...RIGHT },
    leftmostSlotBuff: { ...LEFT },
    tavernBuyBonus: { atk: 5, hp: 5 },
    board: [{ uid: 'm1', cardId: kin.id, tribe: kin.tribe, attack: kin.attack, health: kin.health, keywords: [], golden: false }],
    ...over,
  };
}

const isMinion = (o: ShopCard): boolean => { const d = CARD_INDEX[o.cardId]; return !!d && !d.spell && !d.ruby && !d.keywords.includes('FD'); };
const buffOf = (o: ShopCard, source: string) => o.buffs?.filter((b) => b.source === source) ?? [];
const sum = (bs: { attack: number; health: number }[]) => bs.reduce((a, b) => [a[0]! + b.attack, a[1]! + b.health], [0, 0]);

/** The shape of the buffs a fresh minion row carries, position by position — card ids deliberately ignored. */
function rowSignature(s: RunState): string[] {
  const mins = s.shop.filter(isMinion);
  return mins.map((o, i) => {
    const ruby = sum(buffOf(o, 'Ruby'));
    const slot = sum(buffOf(o, 'Market Tormentor'));
    const pos = i === 0 && i === mins.length - 1 ? 'only' : i === 0 ? 'left' : i === mins.length - 1 ? 'right' : 'mid';
    return `${pos} ruby=${ruby.join('/')} slot=${slot.join('/')}`;
  });
}

/** Every NEW minion offer wears Veinstorm's Rubies exactly once, and the live run-wide channel reads through. */
function expectNewOffersStamped(before: RunState, after: RunState): ShopCard[] {
  const old = new Set(before.shop.map((o) => o.uid));
  const fresh = after.shop.filter((o) => !old.has(o.uid) && isMinion(o));
  expect(fresh.length).toBeGreaterThan(0);
  for (const o of fresh) {
    expect(sum(buffOf(o, 'Ruby'))).toEqual([VEIN.atk, VEIN.hp]);
    const d = CARD_INDEX[o.cardId]!;
    // the run-wide Staff channel is read live by every offer, whatever served it (+5/+5 here)
    expect(offerBuyStats(after, o).attack).toBeGreaterThanOrEqual(d.attack + VEIN.atk + 5);
  }
  return fresh;
}

const rightmost = (s: RunState): ShopCard => { const m = s.shop.filter(isMinion); return m[m.length - 1]!; };
const leftmost = (s: RunState): ShopCard => s.shop.filter(isMinion)[0]!;

describe('Sigil of Kinship serves the same shop buffs as an ordinary refresh', () => {
  it('Veinstorm Rubies, the right-most and left-most slot enchants and the run-wide Staff bonus all land', () => {
    let s = buffed(3, { hand: [mkSpell('sp', 'sigilkinship')] });
    const before = s;
    s = reduce(reduce(s, { type: 'play', uid: 'sp', targetUid: 'm1' }), { type: 'resolveShopDeath' });
    expect(s.shop.filter(isMinion).length).toBeGreaterThan(1);
    expectNewOffersStamped(before, s);
    expect(sum(buffOf(rightmost(s), 'Market Tormentor'))).toEqual([RIGHT.attack, RIGHT.health]);
    expect(sum(buffOf(leftmost(s), 'Market Tormentor'))).toEqual([LEFT.attack, LEFT.health]);
  });

  it('its row has the identical buff shape to an ordinary paid refresh of the same run', () => {
    const tribe = createRun(3).tribes[0]!;
    // Ordinary refresh.
    const rolled = reduce(buffed(3), { type: 'roll' });
    // Sigil refresh — same run, same row size.
    const sigil = reduce(reduce(buffed(3, { hand: [mkSpell('sp', 'sigilkinship')] }), { type: 'play', uid: 'sp', targetUid: 'm1' }), { type: 'resolveShopDeath' });
    expect(sigil.shop.filter(isMinion).some((o) => { const d = CARD_INDEX[o.cardId]!; return d.tribe === tribe || d.tribe2 === tribe; })).toBe(true); // it did refresh to the type
    expect(rowSignature(sigil)).toEqual(rowSignature(rolled));
  });

  it('keeps a Layaway-kept offer through the refresh, like any refresh', () => {
    const s0 = buffed(3, { hand: [mkSpell('sp', 'sigilkinship')] });
    const keptUid = s0.shop[0]!.uid;
    s0.shop[0] = { ...s0.shop[0]!, kept: true };
    const s = reduce(reduce(s0, { type: 'play', uid: 'sp', targetUid: 'm1' }), { type: 'resolveShopDeath' });
    expect(s.shop[0]!.uid).toBe(keptUid);
  });
});

/**
 * Every shop-populating path, one row each: run it on a fully-buffed run and assert the new offers carry the same
 * per-offer stamps (Veinstorm Rubies) and that the enchanted right-most slot is never left bare.
 */
type Path = { name: string; run: (s: RunState) => RunState; rightmostIsNew: boolean };
const PATHS: Path[] = [
  { name: 'ordinary paid refresh (roll action)', rightmostIsNew: true, run: (s) => reduce(s, { type: 'roll' }) },
  { name: 'rollShop + refresh tail (turn-start roll shape)', rightmostIsNew: true, run: (s) => { rollShop(s); applyShopRefreshed(s); return s; } },
  {
    name: 'Sigil of Kinship cast', rightmostIsNew: true,
    run: (s) => reduce(reduce({ ...s, hand: [mkSpell('sp', 'sigilkinship')] }, { type: 'play', uid: 'sp', targetUid: 'm1' }), { type: 'resolveShopDeath' }),
  },
  { name: 'refillShopFiltered (any filtered refresh)', rightmostIsNew: true, run: (s) => { refillShopFiltered(s, (c) => c.tier <= s.tier); applyShopRefreshed(s); return s; } },
  {
    name: 'Elevation Ritual cast', rightmostIsNew: true,
    run: (s) => reduce(reduce({ ...s, tier: 3, hand: [mkSpell('sp', 'elevationritual')] }, { type: 'play', uid: 'sp' }), { type: 'resolveShopDeath' }),
  },
  { name: 'elevateShop (in-place upgrade)', rightmostIsNew: true, run: (s) => { s.tier = 3; elevateShop(s); return s; } },
  // A frozen top-up is not a refresh: the slot enchants are not re-landed (the frozen right-most already wore it).
  { name: 'frozen top-up (topUpTavern)', rightmostIsNew: false, run: (s) => { s.shop = s.shop.slice(0, 1); topUpTavern(s); return s; } },
  {
    name: "addCardToShop on a full row (Indy's Golden Monkey)", rightmostIsNew: true,
    run: (s) => { s.tier = 1; applyShopRefreshed(s); addCardToShop(s, 'alley'); return s; }, // 3 offers = a full T1 row
  },
  { name: 'addCardToShop into a free slot', rightmostIsNew: false, run: (s) => { s.shop = s.shop.slice(0, 2); addCardToShop(s, 'alley'); return s; } },
  {
    name: "Pete's contraband (3rd refresh replaces the right-most)", rightmostIsNew: true,
    run: (s) => {
      const after = reduce({ ...s, heroId: 'pete', refreshCount: 2 }, { type: 'roll' });
      expect(after.shop.some((o) => o.contraband)).toBe(true); // the contraband path actually ran
      return after;
    },
  },
  {
    name: 'Open Enrollment (replaces the right-most)', rightmostIsNew: true,
    run: (s) => {
      const after = reduce({ ...s, runeOpenEnrollment: true }, { type: 'roll' });
      expect(after.shop.length).toBe(6); // a full T6 row: the right-most was replaced, not appended
      return after;
    },
  },
];

describe('every shop-populating path runs THE ONE new-offer stamp', () => {
  it.each(PATHS)('$name', ({ run, rightmostIsNew }) => {
    const before = buffed(3);
    const snapshot = structuredClone(before);
    const after = run(before);
    expectNewOffersStamped(snapshot, after);
    // The enchanted right-most slot is never bare after any path, and never paid twice.
    const r = rightmost(after);
    if (rightmostIsNew) expect(sum(buffOf(r, 'Market Tormentor'))[0]).toBeGreaterThanOrEqual(RIGHT.attack);
    for (const o of after.shop) expect(buffOf(o, 'Ruby').length).toBeLessThanOrEqual(1);
  });

  it('Attachment Issues prices a Magnetic offer from any path (the stamp itself)', () => {
    const s = buffed(3, { attachmentCost: 1 });
    const magnetic = Object.values(CARD_INDEX).find((d) => !d.spell && !d.ruby && d.keywords.includes('M'))!;
    const offer: ShopCard = { uid: 'x1', cardId: magnetic.id };
    const priced: ShopCard = { uid: 'x2', cardId: magnetic.id, cost: 2 };
    stampNewShopOffers(s, [offer, priced]);
    expect(offer.cost).toBe(1);
    expect(priced.cost).toBe(2); // an offer with its own price keeps it
    expect(sum(buffOf(offer, 'Ruby'))).toEqual([VEIN.atk, VEIN.hp]);
  });
});
