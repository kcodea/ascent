/**
 * ANCIENTS × AYSE (hero id `cia`; owner pairings 2026-10-06). Lucky Seat (passive): "Buy 3 Enchanted cards for a reward."
 * Every pairing in the phase it fires in (all six are Shop / End-of-Turn: nothing is bought in combat), plus the
 * spell-slot fix the buy-keyed pairings stand on (R-LUCKYSEAT-01).
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import {
  ANCIENT_IDS, ancientOfferText, createRun, enableAncients, heroPowerText, offerBuyPrice, reduce,
  type AncientId, type BoardCard, type BoardSnapshot, type RunState, type ShopCard,
} from './index';

const plain = (c: (typeof CARD_INDEX)[string]) => !!c && !c.spell && !c.ruby && !c.token && c.effects.length === 0 && c.keywords.length === 0 && !c.universalTribe;
// Vanilla bodies only: a text-only rule card (Chronos doubles End of Turn, Drakko doubles Shouts) would skew the counts.
// The game has no vanilla minion: these effect-less rule cards stay inert here (none repeats End of Turn the way
// Chronos / Uron do, which would double Time's grant).
const NEUTRALS = ['drummer', 'sylus', 'yazzus', 'zyff', 'attachmentconductor', 'mauron'].filter((id) => plain(CARD_INDEX[id]!));
const N = (i: number) => NEUTRALS[i % NEUTRALS.length]!;
const spellPool = Object.values(CARD_INDEX).filter((c) => !!c && c.spell && !c.token && !c.gift && !c.ruby && !(c.chooseOne?.length));
/** A cheap spell (≤ 2 Gold) and a dear one (≥ 4 Gold), for the price tests. */
const CHEAP = spellPool.find((c) => (c.cost ?? 0) >= 1 && (c.cost ?? 0) <= 2)!.id;
const DEAR = spellPool.find((c) => (c.cost ?? 0) >= 4)!.id;
/** An Echo minion by its Deathrattle factory, an Echo minion whose factory is named otherwise (printed "Echo:"), and a
 *  friend-death WATCHER that sits on `onDeath` but prints no Echo. */
const ECHO = Object.values(CARD_INDEX).find((c) => !!c && !c.spell && !c.token && c.effects.some((e) => e.on === 'onDeath' && e.do.startsWith('deathrattle')))!.id;
const TEXT_ECHO = 'dw_brewer';
const WATCHER = 'brood';
const BASE_HEAD = 'Buy **3** Enchanted cards for a reward. **Clubs:** gain **3 Gold**.';

const card = (uid: string, cardId: string, extra: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...extra };
};
/** Clubs is the one suit that opens no modal, so a test can keep buying. */
const base = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(7, 'cia'), phase: 'recruit', embers: 99, hand: [], ciaSuit: 'clubs', ciaEnchantedBought: 0, ...over } as RunState);
const picked = (id: AncientId, over: Partial<RunState> = {}): RunState => {
  let s = enableAncients(base(over));
  s = { ...s, ancients: { ...s.ancients!, points: s.ancients!.cost, offer: [id, ...ANCIENT_IDS.filter((a) => a !== id).slice(0, 2)] } };
  s = reduce(s, { type: 'pickAncient', id });
  expect(s.ancients!.picked).toBe(id);
  return s;
};
const foes = (wave: number): BoardSnapshot => ({
  v: 1, wave, heroId: 'indy', resolve: 30, tier: 7, triples: 0, tribes: [], threat: 'glass', power: 400,
  minions: [{ cardId: 'sandbag', attack: 0, health: 400, keywords: [] }], seed: 1, origin: 'self',
});
const fightNow = (s: RunState): RunState => reduce({ ...s, servedBoards: { [s.wave]: foes(s.wave) } }, { type: 'faceOmen' });
const offer = (uid: string, cardId: string, enchanted = true): ShopCard => ({ uid, cardId, ...(enchanted ? { enchanted: true } : {}) } as ShopCard);
/** Buy `id` from the minion row (a spell offer in the row buys at its own cost), suit pinned to Clubs. */
const buy = (s: RunState, id: string, enchanted = true, u = 'o'): RunState => {
  const next = reduce({ ...s, shop: [offer(u, id, enchanted)], ciaSuit: 'clubs' }, { type: 'buy', uid: u });
  expect(next, `bought ${id}`).not.toBe(s);
  return next;
};
/** Buy `id` from the right-hand SPELL SLOT. */
const buySlot = (s: RunState, id: string, enchanted = true): RunState => {
  const next = reduce({ ...s, spell: offer('sp', id, enchanted), ciaSuit: 'clubs' }, { type: 'buy', uid: 'sp' });
  expect(next, `bought ${id} from the slot`).not.toBe(s);
  return next;
};
const at = (s: RunState, uid: string): BoardCard => s.board.find((c) => c.uid === uid)!;
const inHand = (s: RunState, id: string) => s.hand.filter((c) => c.cardId === id);

describe('Ayse × every Ancient has a written pairing', () => {
  it('all six are written (no "Not written yet."), and none uses an em dash', () => {
    for (const id of ANCIENT_IDS) {
      expect(ancientOfferText('cia', id)).not.toBe('Not written yet.');
      expect(ancientOfferText('cia', id)).not.toMatch(/—|--/);
    }
  });
  it('without Ancients, an Enchanted minion costs the normal 3 and nothing else happens', () => {
    const s = base();
    expect(offerBuyPrice(s, offer('o', N(0))).cost).toBe(3);
    const t = buy(s, N(0));
    expect(t.ciaEnchantedBought).toBe(1);
    expect(t.hand[0]!.attack).toBe(CARD_INDEX[N(0)]!.attack);
    expect(t.ancients).toBeUndefined();
  });
});

describe('Lucky Seat counts an Enchanted SPELL-SLOT buy (R-LUCKYSEAT-01)', () => {
  it('buying an Enchanted spell from the right-hand slot advances the counter, and the 3rd pays the prize', () => {
    let s = buySlot(base(), CHEAP);
    expect(s.ciaEnchantedBought).toBe(1);
    s = buySlot(s, CHEAP, false);
    expect(s.ciaEnchantedBought, 'a plain slot spell does not count').toBe(1);
    s = buySlot({ ...s, ciaEnchantedBought: 2 }, CHEAP);
    expect(s.ciaEnchantedBought, 'the 3rd resets').toBe(0);
  });
});

describe('Ayse × DEATH: "Echo cards are always enchanted."', () => {
  it('every Echo offer in the Shop wears the mark (both Echo shapes); a plain minion and a friend-death watcher do not', () => {
    const s = picked('death', { shop: [offer('e1', ECHO, false), offer('e2', TEXT_ECHO, false), offer('w', WATCHER, false), offer('p', N(0), false)] });
    const mark = (u: string) => !!s.shop.find((o) => o.uid === u)!.enchanted;
    expect([mark('e1'), mark('e2'), mark('w'), mark('p')]).toEqual([true, true, false, false]);
    expect(heroPowerText(s)).toBe(`${BASE_HEAD} **Echo** cards in your Shop are always **Enchanted**.`);
  });
  it('a refresh marks every Echo it serves, and buying one counts toward Lucky Seat', () => {
    let s = picked('death', { tier: 6 });
    let echoUid: string | undefined;
    for (let i = 0; i < 25; i++) {
      s = reduce({ ...s, embers: 99 }, { type: 'roll' });
      for (const o of s.shop) {
        const d = CARD_INDEX[o.cardId]!;
        const echo = !d.spell && (d.effects.some((e) => e.on === 'onDeath' && e.do.startsWith('deathrattle')) || /\*\*Echo:\*\*/.test(d.text ?? ''));
        if (echo) { echoUid ??= o.uid; expect(o.enchanted, `${o.cardId} is an Echo card`).toBe(true); }
      }
      if (echoUid) break;
    }
    expect(echoUid, 'the rolls served an Echo minion').toBeTruthy();
    const u = reduce({ ...s, ciaSuit: 'clubs', ciaEnchantedBought: 0 }, { type: 'buy', uid: echoUid! });
    expect(u.ciaEnchantedBought).toBe(1);
  });
  it('without the pairing an Echo offer is not marked', () => {
    const s = picked('fortune', { shop: [offer('e1', ECHO, false)] });
    expect(s.shop[0]!.enchanted).toBeFalsy();
  });
});

describe('Ayse × FORTUNE: "Enchanted cards cost 2g"', () => {
  it('an Enchanted minion costs 2 on the coin and at the till; a plain one costs 3', () => {
    let s = picked('fortune');
    expect(heroPowerText(s)).toBe(`${BASE_HEAD} **Enchanted** cards cost **2 Gold**.`);
    expect(offerBuyPrice(s, offer('o', N(0))).cost).toBe(2);
    expect(offerBuyPrice(s, offer('o', N(0), false)).cost).toBe(3);
    const gold = s.embers;
    s = buy(s, N(0));
    expect(s.embers).toBe(gold - 2);
    const g2 = s.embers;
    s = buy(s, N(1), false);
    expect(s.embers).toBe(g2 - 3);
  });
  it('an Enchanted spell costs 2 from the slot and from the row; a cheaper one keeps its own price', () => {
    const dear = CARD_INDEX[DEAR]!.cost!;
    let s = picked('fortune');
    let g = s.embers;
    s = buySlot(s, DEAR);
    expect(s.embers).toBe(g - 2);
    g = s.embers;
    s = buy(s, DEAR);
    expect(s.embers).toBe(g - 2);
    g = s.embers;
    s = buySlot(s, DEAR, false);
    expect(s.embers, 'a plain spell pays its printed cost').toBe(g - dear);
    g = s.embers;
    s = buySlot({ ...s, ciaEnchantedBought: 0 }, CHEAP); // (not a 3rd Enchanted buy: the Clubs prize would add 3 Gold)
    expect(s.embers, 'never raised').toBe(g - CARD_INDEX[CHEAP]!.cost!);
  });
});

describe('Ayse × WAR: "When you buy an Enchanted minion, give it +3/+3 and improve this."', () => {
  it('the bought minion gains +X/+X (3, then 6, then 9); a plain buy and an Enchanted spell do nothing', () => {
    let s = picked('war');
    expect(heroPowerText(s)).toBe(`${BASE_HEAD} When you buy an **Enchanted** minion, give it **+3/+3** and improve this by **+3/+3**.`);
    s = buy(s, N(0));
    expect(inHand(s, N(0))[0]).toMatchObject({ attack: CARD_INDEX[N(0)]!.attack + 3, health: CARD_INDEX[N(0)]!.health + 3 });
    expect(heroPowerText(s)).toContain('give it **+6/+6**');
    s = buy(s, N(1), false);
    expect(inHand(s, N(1))[0]!.attack).toBe(CARD_INDEX[N(1)]!.attack);
    s = buySlot(s, CHEAP);
    expect(s.ancients!.ayseWarGain, 'a spell has no body: no improve').toBe(6);
    s = buy(s, N(2));
    expect(inHand(s, N(2))[0]!.attack).toBe(CARD_INDEX[N(2)]!.attack + 6);
    // It persists across turns.
    s = reduce(fightNow({ ...s, hand: [] }), { type: 'resolveCombat' });
    expect(heroPowerText(s)).toContain('give it **+9/+9**');
  });
});

describe('Ayse × GENESIS: "When you complete Lucky Seat, get a copy of one of the minions purchased."', () => {
  it('the 3rd Enchanted buy gets a plain copy of one of that cycle\'s Enchanted minions (spells never)', () => {
    let s = picked('genesis');
    expect(heroPowerText(s)).toBe(`${BASE_HEAD} When you complete it, get a plain copy of one of the **Enchanted** minions you bought for it.`);
    s = buy(s, N(0));
    s = buy(s, N(1), false); // plain: not part of the cycle
    s = buySlot(s, CHEAP);
    expect(s.hand.length).toBe(3);
    s = buy(s, N(2));
    expect(s.ciaEnchantedBought).toBe(0);
    expect(s.hand.length, 'the bought minion plus one copy').toBe(5);
    const copies = s.hand.slice(4);
    expect([N(0), N(2)]).toContain(copies[0]!.cardId);
    expect(copies[0]!.attack, 'plain').toBe(CARD_INDEX[copies[0]!.cardId]!.attack);
    expect(s.ancients!.ayseWindow).toEqual([]);
  });
  it('a cycle of spells only gets nothing; Rune of Wishbone gets a second copy', () => {
    let s = picked('genesis');
    s = buySlot(buySlot(buySlot(s, CHEAP), CHEAP), CHEAP);
    expect(s.hand.every((c) => CARD_INDEX[c.cardId]!.spell)).toBe(true);
    let w = picked('genesis', { runeWishbone: true });
    w = buy(buy(buy(w, N(0)), N(0)), N(0));
    // Three bought (a triple may form) + two copies: count copies of N(0) across hand and board, golden counts as 3.
    const n = [...w.hand, ...w.board].filter((c) => c.cardId === N(0)).reduce((t, c) => t + (c.golden ? 3 : 1), 0);
    expect(n).toBe(5);
  });
});

describe('Ayse × TIME: "End of Turn: Give your minions +3/+3 for every Enchanted card purchased this turn."', () => {
  it('counts every Enchanted card bought this turn (spells and the slot too) and pays it at End of Turn', () => {
    let s = picked('time', { board: [card('a', N(3)), card('b', N(4))] });
    expect(heroPowerText(s)).toBe(`${BASE_HEAD} **End of Turn:** give your minions **+3/+3** for each **Enchanted** card you bought this turn (**0** bought: **+0/+0**).`);
    s = buy(s, N(0));
    s = buy(s, N(1), false);
    s = buySlot(s, CHEAP);
    expect(heroPowerText(s)).toContain('(**2** bought: **+6/+6**)');
    s = fightNow({ ...s, hand: [] });
    expect(at(s, 'a')).toMatchObject({ attack: CARD_INDEX[N(3)]!.attack + 6, health: CARD_INDEX[N(3)]!.health + 6 });
    expect(at(s, 'b').attack).toBe(CARD_INDEX[N(4)]!.attack + 6);
    s = reduce(s, { type: 'resolveCombat' });
    expect(heroPowerText(s), 'a new turn starts at 0').toContain('(**0** bought: **+0/+0**)');
  });
  it('buys made before the pick count this turn', () => {
    let s = enableAncients(base());
    s = buy(s, N(0));
    s = { ...s, ancients: { ...s.ancients!, points: s.ancients!.cost, offer: ['time', 'war', 'death'] } };
    s = reduce(s, { type: 'pickAncient', id: 'time' });
    expect(heroPowerText(s)).toContain('(**1** bought: **+3/+3**)');
  });
});

describe('Ayse × BONDS: "Triggering Lucky Seat grants your left and right-most minions +5/+6."', () => {
  it('the 3rd Enchanted buy gives the left-most and right-most minions +5/+6; the middle gets nothing', () => {
    let s = picked('bonds', { board: [card('a', N(3)), card('b', N(4)), card('c', N(5))] });
    expect(heroPowerText(s)).toBe(`${BASE_HEAD} Whenever it triggers, give your left and right-most minions **+5/+6**.`);
    s = buy(buy(s, N(0)), N(1));
    expect(at(s, 'a').attack).toBe(CARD_INDEX[N(3)]!.attack);
    s = buySlot(s, CHEAP);
    expect(at(s, 'a')).toMatchObject({ attack: CARD_INDEX[N(3)]!.attack + 5, health: CARD_INDEX[N(3)]!.health + 6 });
    expect(at(s, 'b').attack).toBe(CARD_INDEX[N(4)]!.attack);
    expect(at(s, 'c')).toMatchObject({ attack: CARD_INDEX[N(5)]!.attack + 5, health: CARD_INDEX[N(5)]!.health + 6 });
  });
  it('one minion gets it once; Rune of Wishbone fires it twice; an empty board gets nothing', () => {
    let s = picked('bonds', { board: [card('a', N(3))], ciaEnchantedBought: 2 });
    s = buy(s, N(0));
    expect(at(s, 'a').attack).toBe(CARD_INDEX[N(3)]!.attack + 5);
    let w = picked('bonds', { board: [card('a', N(3))], ciaEnchantedBought: 2, runeWishbone: true });
    w = buy(w, N(0));
    expect(at(w, 'a').attack).toBe(CARD_INDEX[N(3)]!.attack + 10);
    const e = buy(picked('bonds', { board: [], ciaEnchantedBought: 2 }), N(0));
    expect(e.board).toEqual([]);
  });
});

describe('Ayse × save / restore and determinism', () => {
  it('the counters survive a JSON round trip', () => {
    let s = buy(buy(picked('genesis'), N(0)), N(1));
    s = JSON.parse(JSON.stringify(s)) as RunState;
    expect(s.ancients!.ayseWindow).toEqual([N(0), N(1)]);
    s = buy(s, N(2));
    expect(s.hand.length).toBe(4);
    let w = buy(picked('war'), N(0));
    w = JSON.parse(JSON.stringify(w)) as RunState;
    expect(heroPowerText(w)).toContain('**+6/+6**');
  });
  it('every pairing replays identically from the same state', () => {
    for (const id of ANCIENT_IDS) {
      const run = () => {
        let s = picked(id, { board: [card('a', N(5)), card('b', N(6))] });
        s = buy(buy(buySlot(buy(s, N(0)), DEAR), N(1)), N(2), false);
        return reduce(fightNow(s), { type: 'resolveCombat' });
      };
      const a = run();
      const b = run();
      expect(JSON.stringify(a.board), id).toBe(JSON.stringify(b.board));
      expect(JSON.stringify(a.hand), id).toBe(JSON.stringify(b.hand));
      expect(JSON.stringify(a.ancients), id).toBe(JSON.stringify(b.ancients));
    }
  });
});
