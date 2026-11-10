/**
 * A COUNTING HERO POWER IS ARMED (owner 2026-11-10: "perfect, add it to those too"). `heroPowerArmed` means exactly
 * "your next action, or the end of this turn, fires this power". Every case drives the real reducer and checks the
 * predicate against the fire it promises: armed at the right count, not before, cleared by the fire, reset across turns
 * where the power resets, and never again for a finished Drakko.
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { reduce } from './reducer';
import { createRun, type RunState, type ShopCard } from './state';
import { hasBattlecry } from './recruit';
import { heroPowerArmed } from './powerArmed';

const win = { events: [], result: 'win' as const, playerDamage: 0, playerDeathrattles: 0, enemyDeaths: 0, initial: { player: [], enemy: [] } };
const nextTurn = (s: RunState): RunState => reduce({ ...s, phase: 'combat', lastCombat: win } as RunState, { type: 'resolveCombat' });

const minions = Object.values(CARD_INDEX).filter((c) => !c.spell && !c.ruby && !c.token && !c.henchman && !c.duos && c.tier <= 2);
/** Distinct effect-free minions, so buys never triple and nothing else moves. */
const PLAIN = minions.filter((c) => c.effects.length === 0 && !hasBattlecry(c)).map((c) => c.id);
const SHOUT = minions.find((c) => hasBattlecry(c) && !c.effects.some((e) => e.on === 'endOfTurn'))!.id;
const SPELL = Object.values(CARD_INDEX).find((c) => c.spell && !c.ruby && !c.token && !c.duos && (c.cost ?? 0) <= 3)!.id;

function shop(heroId: string, over: Partial<RunState> = {}): RunState {
  return {
    ...createRun(5, heroId), phase: 'recruit', embers: 60, maxEmbers: 10, tier: 3, board: [], hand: [], shop: [],
    powerOffer: undefined, discover: undefined, questOffer: undefined, pendingPowerOffer: undefined, ...over,
  } as RunState;
}
let seq = 0;
/** Buy one `cardId` from the Shop (the hand is emptied first, so the hand cap never interferes). */
function buy(s: RunState, cardId: string, over: Partial<ShopCard> = {}): RunState {
  const uid = `t${seq++}`;
  return reduce({ ...s, embers: 60, hand: [], discover: undefined, shop: [{ uid, cardId, ...over } as ShopCard] } as RunState, { type: 'buy', uid });
}
const buyPlain = (s: RunState, n: number, from = 0): RunState => { for (let i = 0; i < n; i++) s = buy(s, PLAIN[(from + i) % PLAIN.length]!); return s; };
const roll = (s: RunState): RunState => reduce({ ...s, embers: 60 } as RunState, { type: 'roll' });
const card = (uid: string, cardId = PLAIN[0]!) => ({ uid, cardId, tribe: CARD_INDEX[cardId]!.tribe, attack: 1, health: 1, keywords: [], golden: false });

describe('Gorr (Four Peat): armed with 2 minions bought this turn', () => {
  it('is not armed at 0 or 1, is armed at 2, and the 3rd buy fires and clears it', () => {
    let s = shop('gorr');
    expect(heroPowerArmed(s)).toBe(false);
    s = buyPlain(s, 1);
    expect(heroPowerArmed(s)).toBe(false);
    s = buyPlain(s, 1, 1);
    expect(heroPowerArmed(s)).toBe(true);
    const fired = buyPlain(s, 1, 2);
    expect(fired.hand.length, 'the bought minion and its Four Peat copy').toBe(2);
    expect(heroPowerArmed(fired)).toBe(false);
    expect(heroPowerArmed(buyPlain(fired, 2, 3)), 'once per turn: buys 4 and 5 never arm it again').toBe(false);
  });

  it('a spell does not count, and the tally resets with the turn', () => {
    const one = buyPlain(shop('gorr'), 1);
    expect(heroPowerArmed(buy(one, SPELL))).toBe(false);
    const two = buyPlain(one, 1, 1);
    expect(heroPowerArmed(two)).toBe(true);
    expect(heroPowerArmed(nextTurn(two))).toBe(false);
  });
});

describe('Juggler (Carnival Coin): armed at 2 of 3', () => {
  it('arms at 2, the 3rd buy pays the coin and clears it, and it carries across turns', () => {
    let s = buyPlain(shop('juggler'), 1);
    expect(heroPowerArmed(s)).toBe(false);
    s = buyPlain(s, 1, 1);
    expect(heroPowerArmed(s)).toBe(true);
    expect(heroPowerArmed(nextTurn(s)), 'the count carries, so it is still one buy away next turn').toBe(true);
    const fired = buyPlain(s, 1, 2);
    expect(fired.hand.some((c) => c.cardId === 'carnivalcoin')).toBe(true);
    expect(heroPowerArmed(fired)).toBe(false);
  });
});

describe('Pete (Contrabanana): armed when the next refresh is the third', () => {
  it('arms after 2 refreshes, the 3rd upgrades the right-most offer and clears it', () => {
    let s = shop('pete');
    expect(heroPowerArmed(s)).toBe(false);
    s = roll(s);
    expect(heroPowerArmed(s)).toBe(false);
    s = roll(s);
    expect(heroPowerArmed(s)).toBe(true);
    const fired = roll(s);
    expect(fired.shop.some((o) => o.contraband)).toBe(true);
    expect(heroPowerArmed(fired)).toBe(false);
    expect(heroPowerArmed(roll(roll(fired))), 'and again two refreshes later').toBe(true);
  });
});

describe('Ayse (Lucky Seat): armed at 2 of 3 Enchanted buys', () => {
  it('arms at 2 Enchanted buys, a plain buy changes nothing, the 3rd pays and clears it', () => {
    let s = shop('cia', { ciaSuit: 'clubs', ciaEnchantedBought: 0 });
    s = buy(s, PLAIN[0]!, { enchanted: true });
    expect(heroPowerArmed(s)).toBe(false);
    s = buy(s, PLAIN[1]!);
    expect(heroPowerArmed(s), 'a buy that is not Enchanted does not count').toBe(false);
    s = buy(s, PLAIN[2]!, { enchanted: true });
    expect(heroPowerArmed(s)).toBe(true);
    const fired = buy({ ...s, ciaSuit: 'clubs' }, PLAIN[3]!, { enchanted: true });
    expect(fired.ciaEnchantedBought).toBe(0);
    expect(heroPowerArmed(fired)).toBe(false);
  });
});

describe('Drakko (Drumline): armed at 4 of 5 Shout buys, never after it completes', () => {
  it('arms at 4, the 5th gives Drakko, and a finished quest is never armed again', () => {
    let s = shop('drakko');
    for (let i = 0; i < 3; i++) s = buy(s, SHOUT);
    expect(heroPowerArmed(s)).toBe(false);
    s = buy(s, PLAIN[0]!);
    expect(heroPowerArmed(s), 'a minion without a Shout does not count').toBe(false);
    s = buy(s, SHOUT);
    expect(heroPowerArmed(s)).toBe(true);
    let done = buy(s, SHOUT);
    expect(done.hand.some((c) => c.cardId === 'drummer')).toBe(true);
    expect(done.heroPowerSpent).toBe(true);
    expect(heroPowerArmed(done)).toBe(false);
    for (let i = 0; i < 6; i++) { done = buy(done, SHOUT); expect(heroPowerArmed(done)).toBe(false); }
    // Even a stale count that reads "one short" cannot re-arm a spent quest.
    expect(heroPowerArmed({ ...done, drakkoBuys: 4 } as RunState)).toBe(false);
  });
});

describe('Re-Pete (Second Hand): armed for the turn at whose end it fires', () => {
  it('is armed on every 3rd turn while a card is in hand, and not on the turns between', () => {
    const held = [card('h0')];
    expect(heroPowerArmed(shop('repete', { wave: 1, hand: held }))).toBe(false);
    expect(heroPowerArmed(shop('repete', { wave: 2, hand: held }))).toBe(false);
    expect(heroPowerArmed(shop('repete', { wave: 3, hand: held }))).toBe(true);
    expect(heroPowerArmed(shop('repete', { wave: 4, hand: held }))).toBe(false);
    expect(heroPowerArmed(shop('repete', { wave: 6, hand: held }))).toBe(true);
  });

  it('with nothing to copy the end of the turn fires nothing, so it is not armed', () => {
    expect(heroPowerArmed(shop('repete', { wave: 3, hand: [] }))).toBe(false);
  });

  it('the end of that turn fires it, and the next turn is not armed', () => {
    const s = shop('repete', { wave: 3, hand: [card('h0')] });
    expect(heroPowerArmed(s)).toBe(true);
    const fought = reduce(s, { type: 'faceOmen' });
    expect(fought.hand.length, 'the copy of the left-most hand card').toBe(2);
    const after = nextTurn(fought);
    expect(after.wave).toBe(4);
    expect(heroPowerArmed(after)).toBe(false);
  });
});

describe('Quillen (Archive, an ACTIVE power): armed when the next Archive fills it', () => {
  /** Archive a Shop minion (the once-per-turn press is handed back, as a new turn would). */
  const archive = (s: RunState, i: number): RunState => {
    const uid = `a${seq++}`;
    return reduce({ ...s, heroReady: true, discover: undefined, shop: [{ uid, cardId: PLAIN[i % PLAIN.length]! } as ShopCard] } as RunState, { type: 'heroPower', uid });
  };

  it('is not armed at 0 or 1 of 3, is armed at 2, and the 3rd Archive opens the Discover and clears it', () => {
    let s = shop('quillen');
    expect(heroPowerArmed(s)).toBe(false);
    s = archive(s, 0);
    expect(s.archivedTribes?.length).toBe(1);
    expect(heroPowerArmed(s)).toBe(false);
    s = archive(s, 1);
    expect(s.archivedTribes?.length).toBe(2);
    expect(heroPowerArmed(s)).toBe(true);
    const fired = archive(s, 2);
    expect(fired.discover?.length, 'the payout Discover').toBeGreaterThan(0);
    expect(fired.archivedTribes?.length ?? 0).toBe(0);
    expect(heroPowerArmed(fired)).toBe(false);
  });

  it('arms again on the next cycle, and the count carries across turns', () => {
    let s = shop('quillen');
    for (let i = 0; i < 4; i++) s = archive(s, i);
    expect(heroPowerArmed(s), '1 of 3 on the second cycle').toBe(false);
    s = archive(s, 4);
    expect(heroPowerArmed(s)).toBe(true);
    expect(heroPowerArmed(nextTurn(s))).toBe(true);
  });

  it('Rune of Wishbone banks two types a press, so 1 of 3 is already one press from full', () => {
    const one = archive(shop('quillen'), 0);
    const wish = { ...one, runeWishbone: true } as RunState;
    expect(heroPowerArmed(wish)).toBe(true);
    expect(archive(wish, 1).discover?.length, 'and that press does fire it').toBeGreaterThan(0);
  });
});

describe('it follows the held power', () => {
  it('Mimic wearing Carnival Coin arms on the adopted power, and stops when the disguise changes', () => {
    const mimic = shop('mimic', { adoptedPowerId: 'juggler' });
    const two = buyPlain(mimic, 2);
    expect(heroPowerArmed(two)).toBe(true);
    expect(heroPowerArmed({ ...two, adoptedPowerId: 'pete' } as RunState)).toBe(false);
    expect(heroPowerArmed({ ...two, adoptedPowerId: undefined } as RunState), 'the bare Mimic power is never armed').toBe(false);
  });

  it('Void: each slot answers for its own power', () => {
    const v = shop('voidhero', { voidPowerIds: ['pete', 'gorr'] });
    const two = buyPlain(v, 2);
    expect(heroPowerArmed(two, 0)).toBe(false);
    expect(heroPowerArmed(two, 1)).toBe(true);
    const rolled = roll(roll(two));
    expect(heroPowerArmed(rolled, 0)).toBe(true);
    expect(heroPowerArmed(rolled, 1)).toBe(true);
  });

  it('a hero with an active power, or a passive that counts nothing, is never armed', () => {
    expect(heroPowerArmed(buyPlain(shop('warden'), 2))).toBe(false);
    expect(heroPowerArmed(shop('juggler'), 1), 'no second power').toBe(false);
  });
});
