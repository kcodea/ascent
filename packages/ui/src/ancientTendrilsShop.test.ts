/**
 * R-FX-ANCIENT-TENDRIL-01 (owner 2026-11-16): every Ancient pairing that gives a board minion stats in the SHOP (per
 * action), at START OF TURN or at END OF TURN plays the hero-power tendril. Each case drives the real reducer with the
 * fixture its per-hero test uses (packages/sim/src/ancients<Hero>.test.ts) and asserts every Ancient grant it made
 * streams from the power button. Combat grants live in ancientTendrilsCombat.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import {
  DRAKKO_CARD_ID, createRun, defIsTribe, poolOf, reduce,
  type Action, type BoardCard, type RunState, type ShopCard,
} from '@game/sim';
import { body, endOfTurnVerdict, foes, pickedRun, shopRun, shopStep, type ShopVerdict } from './ancientTendrils.testkit';

const plain = (c: (typeof CARD_INDEX)[string]) => !!c && !c.spell && !c.ruby && !c.token && c.effects.length === 0 && c.keywords.length === 0 && !c.universalTribe;
const NEUTRALS = Object.values(CARD_INDEX).filter((c) => plain(c) && c.tribe === 'neutral' && !c.tribe2 && !c.henchman && c.id !== 'sandbag').map((c) => c.id);
const N = (i: number) => NEUTRALS[i % NEUTRALS.length]!;
const TYPED = Object.values(CARD_INDEX).filter((c) => plain(c) && c.tribe !== 'neutral' && !c.tribe2);
const TA = TYPED[0]!;
const TB = TYPED.find((c) => c.tribe !== TA.tribe)!;
const gilded = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return body(uid, cardId, { golden: true, attack: d.attack * 2, health: d.health * 2, ...over });
};
const pup = (uid: string, cardId: string, attack: number, health: number, keywords: BoardCard['keywords'] = []): BoardCard =>
  body(uid, cardId, { attack, health, keywords });
const offer = (uid: string, cardId: string, over: Partial<ShopCard> = {}): ShopCard => ({ uid, cardId, ...over } as ShopCard);
/** Put `cardId` in the row and buy it. */
const buy = (cardId: string, uid = `o_${cardId}`, over: Partial<ShopCard> = {}) => (s: RunState): Action => {
  s.shop = [...s.shop.filter((o) => o.uid !== uid), offer(uid, cardId, over)];
  return { type: 'buy', uid };
};
const play = (uid: string, targetUid?: string): Action => ({ type: 'play', uid, ...(targetUid ? { targetUid } : {}) });
const fight = (s: RunState, attack = 0, health = 400): RunState =>
  reduce({ ...s, servedBoards: { ...s.servedBoards, [s.wave]: foes(s.wave, attack, health) } }, { type: 'faceOmen' });

const FLINT = createRun(7, 'flint');
const DWARF = poolOf(FLINT).buyable.filter((c) => !c.spell && !c.ruby && !c.token && c.tier <= 2 && defIsTribe(c, 'dwarf', FLINT)).map((c) => c.id);
const NON_DWARF = poolOf(FLINT).buyable.find((c) => !c.spell && !c.ruby && !c.token && c.tier <= 2 && !defIsTribe(c, 'dwarf', FLINT) && c.effects.length === 0)!.id;

interface ShopCase { pairing: string; phase: 'shop' | 'sot'; run: () => ShopVerdict }
interface EotCase { pairing: string; run: () => ReturnType<typeof endOfTurnVerdict> }

const SHOP: ShopCase[] = [
  { pairing: 'albus.bonds', phase: 'shop', run: () => shopRun(pickedRun('albus', 'bonds', {
    board: [body('a', 'hm_test_squire'), body('b', 'n2_spellsword'), body('c', 'tara'), body('d', 'dw_brakka')], hand: [body('h', 'c3_binary')],
  }), [play('h')]).verdict },
  { pairing: 'baggerben.war', phase: 'shop', run: () => shopRun(pickedRun('baggerben', 'war', {
    wave: 3, embers: 40, heroReady: true, board: [body('a', 'beatboxer'), body('b', 'dw_edward')], shop: [], spell: null,
  }), [{ type: 'heroPower' }]).verdict },
  { pairing: 'darah.bonds', phase: 'shop', run: () => shopRun(pickedRun('darah', 'bonds', {
    wave: 3, embers: 99, board: [body('a', N(0), { attack: 7, health: 11 })], shop: [offer('o', N(1))],
  }), [{ type: 'heroPower', uid: 'a' }]).verdict },
  { pairing: 'drakko.bonds', phase: 'shop', run: () => shopRun(pickedRun('drakko', 'bonds', {
    embers: 99, board: [body('d', DRAKKO_CARD_ID)], hand: [body('h', 'hoarder')],
  }), [play('h')]).verdict },
  { pairing: 'flint.bonds', phase: 'shop', run: () => shopRun(pickedRun('flint', 'bonds', {
    embers: 40, tier: 2, board: [body('x', DWARF[0]!), body('y', DWARF[1 % DWARF.length]!), body('n', NON_DWARF)], shop: [], spell: null,
  }), [buy(DWARF[0]!)]).verdict },
  { pairing: 'frank.bonds', phase: 'shop', run: () => {
    let s = pickedRun('frank', 'bonds', { board: [body('x', 'hm_test_squire', { attack: 1, health: 1 })] });
    s = reduce(s, { type: 'heroPower' }); // Clearance
    const o = s.shop.find((x) => { const d = CARD_INDEX[x.cardId]; return !!d && !d.spell && !d.ruby && !x.starform; })!;
    s = reduce(s, { type: 'buy', uid: o.uid });
    const bought = s.hand[s.hand.length - 1]!.uid;
    s = reduce(s, play(bought));
    return shopStep(s, { type: 'sell', uid: bought }).verdict;
  } },
  { pairing: 'gambler.war', phase: 'shop', run: () => shopRun(pickedRun('gambler', 'war', {
    embers: 40, heroReady: true, board: [body('a', 'beatboxer'), body('b', 'dw_edward')], shop: [], spell: null,
  }), [{ type: 'heroPower' }]).verdict },
  { pairing: 'gildmaster.bonds', phase: 'shop', run: () => {
    const s = pickedRun('gildmaster', 'bonds', { embers: 20, heroReady: true, board: [gilded('b', N(1))], hand: [gilded('g', N(0))] });
    return shopRun({ ...s, ancients: { ...s.ancients!, gilds: 2 } }, [play('g')]).verdict;
  } },
  { pairing: 'gorr.bonds', phase: 'shop', run: () => {
    let s = pickedRun('gorr', 'bonds', { wave: 3, embers: 99 });
    s = reduce(s, buy(N(0), 'a')(s));
    s = reduce(s, play(s.hand[0]!.uid)); // on the board before the payout
    return shopRun(s, [buy(N(1), 'b'), buy(N(2), 'c')]).verdict;
  } },
  { pairing: 'indy.bonds', phase: 'shop', run: () => shopRun(pickedRun('indy', 'bonds', { board: [body('a', 'gnash')] }), [{ type: 'heroPower', uid: 'a' }]).verdict },
  { pairing: 'merrin.bonds', phase: 'shop', run: () => shopRun(pickedRun('merrin', 'bonds', {
    tier: 3, embers: 40, heroReady: true, shop: [], spell: null,
    board: [body('a', 'beatboxer'), body('b', 'dw_edward'), body('c', 'gnash')], hand: [body('g1', 'gift_arcane_clearance')],
  }), [play('g1')]).verdict },
  { pairing: 'midas.bonds', phase: 'shop', run: () => shopRun(pickedRun('midas', 'bonds', {
    embers: 20, heroReady: true, board: [gilded('a', 'beatboxer'), gilded('b', 'dw_edward'), body('p', 'sandbag')], hand: [body('sf', 'spiritfire')],
  }), [play('sf', 'a')]).verdict },
  { pairing: 'nadja.bonds', phase: 'shop', run: () => shopRun(pickedRun('nadja', 'bonds', {
    embers: 99, board: [body('a', N(0)), body('b', N(1)), body('c', N(2))],
  }), [buy(N(3)), { type: 'roll' }]).verdict },
  { pairing: 'repete.war', phase: 'shop', run: () => shopRun(pickedRun('repete', 'war', {
    embers: 99, board: [body('a', N(0)), body('b', N(1))], hand: [body('h', N(0))],
  }), [play('h')]).verdict },
  { pairing: 'robin.war', phase: 'shop', run: () => shopRun(pickedRun('robin', 'war', {
    board: [body('a', N(0)), body('b', N(1)), body('c', N(2))],
  }), [{ type: 'sell', uid: 'a' }, { type: 'sell', uid: 'c' }]).verdict },
  { pairing: 'underdweller.bonds', phase: 'shop', run: () => shopRun(pickedRun('underdweller', 'bonds', {
    board: [body('a', N(0)), body('b', N(1))],
  }), [buy(N(0))]).verdict },
  { pairing: 'warden.bonds', phase: 'shop', run: () => shopRun(pickedRun('warden', 'bonds', {
    board: [pup('a', 'hm_test_squire', 1, 5, ['DS']), pup('b', 'shaper', 1, 5, ['DS']), pup('c', 'beetle', 1, 5)],
  }), [{ type: 'heroPower', uid: 'c' }]).verdict },
  { pairing: 'warden.death', phase: 'shop', run: () => shopRun(pickedRun('warden', 'death', {
    board: [pup('v', 'n2_spellsword', 9, 4), pup('r', 'k3_forkvein', 2, 6), pup('w', 'k3_splitpick', 1, 1, ['DS'])],
  }), [{ type: 'heroPower', uid: 'v' }]).verdict },
  { pairing: 'warden.time', phase: 'shop', run: () => shopRun(pickedRun('warden', 'time', {
    board: [pup('a', 'hm_test_squire', 1, 10, ['DS']), pup('b', 'shaper', 1, 10)],
    hand: [body('p1', 'emberpouch', { tribe: 'neutral', attack: 0, health: 1 })],
  }), [play('p1')]).verdict },
  { pairing: 'xerox.bonds', phase: 'shop', run: () => {
    const s = reduce(pickedRun('xerox', 'bonds', { board: [body('a', 'hm_test_squire', { health: 40 })], hand: [body('sf', 'spiritfire')] }), { type: 'heroPower', uid: 'a' });
    return shopRun(s, [play('sf', 'a')]).verdict;
  } },
  { pairing: 'rayse.fortune', phase: 'shop', run: () => shopRun(pickedRun('rayse', 'fortune', {
    hand: [body('p', N(0))], shop: [offer('o', N(1))],
  }), [{ type: 'buy', uid: 'o' }, play('p')]).verdict },
  { pairing: 'risen.time', phase: 'sot', run: () => {
    const s = fight(pickedRun('risen', 'time', { board: [body('p', 'pack'), pup('b', 'hm_test_squire', 0, 500)] }), 3, 400);
    return shopStep(s, { type: 'resolveCombat' }).verdict;
  } },
  { pairing: 'cassen.war', phase: 'sot', run: () => {
    let s = pickedRun('cassen', 'war', { board: [body('a', N(0)), body('b', N(1))] });
    s = reduce(s, { type: 'heroPower', commission: 'spell' });
    return shopStep(fight(s), { type: 'resolveCombat' }).verdict;
  } },
];

const EOT: EotCase[] = [
  { pairing: 'cia.time', run: () => {
    let s = pickedRun('cia', 'time', { embers: 99, ciaSuit: 'clubs', ciaEnchantedBought: 0, board: [body('a', N(3)), body('b', N(4))] } as Partial<RunState>);
    s = reduce(s, buy(N(0), 'o', { enchanted: true })(s));
    return endOfTurnVerdict({ ...s, hand: [] });
  } },
  { pairing: 'flint.time', run: () => {
    let s = pickedRun('flint', 'time', { embers: 40, tier: 2, board: [body('a', NON_DWARF), body('b', DWARF[0]!)], shop: [], spell: null });
    s = reduce(s, buy(DWARF[0]!)(s));
    return endOfTurnVerdict({ ...s, hand: [] });
  } },
  { pairing: 'vale.time', run: () => endOfTurnVerdict(pickedRun('vale', 'time', {
    tier: 3, embers: 40, heroReady: true, shop: [], spell: null, spellsCast: 5,
    board: [body('m1', 'beatboxer', { attack: 1, health: 5000 }), body('dw', 'dw_brakka', { attack: 1, health: 5000 })],
  } as Partial<RunState>)) },
  { pairing: 'mimic.war', run: () => {
    const s = pickedRun('mimic', 'war', {
      powerOffer: undefined, pendingPowerOffer: undefined, heroReady: true, adoptedPowerId: 'nadja', spellsCast: 9,
      board: [body('a', TA.id, { attack: 1, health: 900 }), body('b', TB.id, { attack: 1, health: 900 })],
    } as Partial<RunState>);
    return endOfTurnVerdict({ ...s, ancients: { ...s.ancients!, shopSpellsCast: 7 } });
  } },
];

describe('R-FX-ANCIENT-TENDRIL-01: Shop and Start-of-Turn Ancient grants leave the hero-power button', () => {
  it.each(SHOP.map((c) => [c.pairing, c.phase, c] as const))('%s (%s)', (_p, _ph, c) => {
    const v = c.run();
    if (process.env.ANC_TENDRIL_LOG) console.log(`${c.pairing} grants=${v.grants.length} tendril=${v.tendril.length}`);
    expect(v.grants.length, 'the fixture makes an Ancient grant on a board minion').toBeGreaterThan(0);
    expect(v.missing, 'every grant has a hero-power tendril').toEqual([]);
  });
});

describe('R-FX-ANCIENT-TENDRIL-01: End-of-Turn Ancient grants play heroPowerGain', () => {
  it.each(EOT.map((c) => [c.pairing, c] as const))('%s', (_p, c) => {
    const v = c.run();
    if (process.env.ANC_TENDRIL_LOG) console.log(`${c.pairing} heroGains=${v.heroGains} tendril=${v.tendril}`);
    expect(v.heroGains, 'the Ancient paid on a hero beat').toBeGreaterThan(0);
    expect(v.tendril).toBe(v.heroGains);
  });
});

