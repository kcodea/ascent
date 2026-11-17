/**
 * ANCIENTS × KESHI (owner pairings 2026-10-27). Keshi's Crown (passive): "Get a Triple Reward every 25 shop tiers worth of
 * cards you purchase." (`keshiTierPoints`, paid at `KESHI_CROWN_THRESHOLD`). Every pairing in the phase(s) it fires in.
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import {
  ANCIENT_CROWN_FLAG, ANCIENT_IDS, ancientAvengeCountdown, discoverOfferCard, ancientCombatMods, ancientCrownDueNow, ancientOfferText, createRun, enableAncients,
  heroPowerText, offerBuyPrice, reduce, type AncientId, type BoardCard, type BoardSnapshot, type RunState,
} from './index';
import { destroyMinionInShop, makeContext } from './recruit';

const BASE = 'Get a **Triple Reward** every 25 shop tiers worth of cards you purchase.';
const N = (i: number) => ['beatboxer', 'dw_edward', 'attachmentconductor', 'sandbag'][i % 4]!;
const KEYS = ['T', 'DS', 'R', 'W', 'CR', 'V', 'ST', 'EG'];

const card = (uid: string, cardId: string, extra: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...extra };
};
const reward = (uid: string, tier: number, crown = false): BoardCard => card(uid, 'discoverspell', { grantedTier: tier, ...(crown ? { crownReward: true } : {}) });
const base = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(7, 'keshi'), phase: 'recruit', embers: 40, heroReady: true, hand: [], board: [], shop: [], spell: null, ...over } as RunState);
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
const at = (s: RunState, uid: string): BoardCard => s.board.find((c) => c.uid === uid)!;
const rewards = (s: RunState) => s.hand.filter((c) => c.cardId === 'discoverspell').length;
const buyFromRow = (s: RunState, cardId: string): RunState => {
  const withOffer: RunState = { ...s, shop: [...s.shop, { uid: `o_${cardId}_${s.uidSeq}`, cardId }] };
  return reduce(withOffer, { type: 'buy', uid: withOffer.shop[withOffer.shop.length - 1]!.uid });
};
const minionOfTier = (tier: number): string => Object.values(CARD_INDEX).find((c) => !c.spell && !c.ruby && !c.token && c.tier === tier && c.effects.length === 0)!.id;

describe('Keshi × every Ancient has a written pairing', () => {
  it('all six are written (no "Not written yet."), and none uses an em dash', () => {
    for (const id of ANCIENT_IDS) {
      expect(ancientOfferText('keshi', id)).not.toBe('Not written yet.');
      expect(ancientOfferText('keshi', id)).not.toMatch(/—|--/);
    }
  });
});

describe('Keshi × DEATH: "Avenge (4): Advance Keshi\'s Crown by 4"', () => {
  it('Shop: the 4th friendly Shop death advances the Crown by 4; a Crown it fills pays at the action boundary', () => {
    let s = picked('death', { board: [card('d', N(0))] });
    expect(heroPowerText(s)).toBe(`${BASE} **Avenge (4):** advance it by **4** (**4** more to go).`);
    s = structuredClone({ ...s, keshiTierPoints: 22, ancients: { ...s.ancients!, keshiDeaths: 3 } });
    destroyMinionInShop(makeContext(s), at(s, 'd'));
    expect(s.keshiTierPoints).toBe(26);
    expect(s.ancients!.keshiDeaths).toBe(0);
    expect(ancientCrownDueNow(s)).toBe(true);
    s = reduce(s, { type: 'roll' });
    expect(rewards(s)).toBe(1);
    expect(s.keshiTierPoints).toBe(0);
  });
  it('combat: the carried count pulses mid-fight, and settle advances the Crown by 4 per pulse', () => {
    let s = picked('death', { board: [card('a', N(0), { attack: 1, health: 1 })], keshiTierPoints: 3 });
    s = { ...s, ancients: { ...s.ancients!, keshiDeaths: 3 } };
    expect(ancientCombatMods(s).ancientAvengePulse).toEqual({ every: 4, tick: 3, flag: ANCIENT_CROWN_FLAG, label: 'Ancient of Death' });
    expect(ancientAvengeCountdown(s)).toBe(1);
    s = fightNow(s, 100, 1000);
    const pulses = (s.lastCombat!.events ?? []).filter((e) => e.type === 'questTrigger' && e.flag === ANCIENT_CROWN_FLAG).length;
    expect(pulses).toBe(1);
    s = reduce(s, { type: 'resolveCombat' });
    expect(s.keshiTierPoints).toBe(7);
  });
});

describe('Keshi × FORTUNE (ancient pass 2, owner 2026-11-16): "opening a Triple Reward gives 3 extra Gold"', () => {
  it('playing a Triple Reward opens its Discover AND gains 3 Gold; the text keeps the running total', () => {
    let s = picked('fortune', { tier: 3, hand: [reward('r1', 3), reward('r2', 3, true)] });
    expect(heroPowerText(s)).toBe(`${BASE} Opening a **Triple Reward** gives you **3** extra Gold (**0 Gold** so far).`);
    const before = s.embers;
    s = reduce(s, { type: 'play', uid: 'r1' });
    expect(s.discover?.length).toBeGreaterThan(0);
    expect(s.embers).toBe(before + 3);
    s = reduce(s, { type: 'discover', index: 0 });
    s = reduce(s, { type: 'play', uid: 'r2' });
    expect(s.embers, "a Crown's reward counts too").toBe(before + 6);
    expect(heroPowerText(s)).toContain('(**6 Gold** so far)');
  });
  it('getting a Triple Reward pays nothing (only opening it does), and the old Tier discount is gone', () => {
    const s = picked('fortune', { tier: 3 });
    expect(offerBuyPrice(s, { cardId: minionOfTier(3) }).cost).toBe(3);
  });
  it('without Fortune opening pays nothing', () => {
    let s = picked('war', { tier: 3, hand: [reward('r1', 3)] });
    const before = s.embers;
    s = reduce(s, { type: 'play', uid: 'r1' });
    expect(s.embers).toBe(before);
  });
});

describe('Keshi × WAR (owner 2026-11-16): "minions discovered from Keshi’s Crown’s rewards have a random keyword", shown in the Discover', () => {
  it('prints the owner’s sentence', () => {
    const s = picked('war');
    expect(heroPowerText(s)).toContain('Minions discovered from Keshi’s Crown’s rewards have a random keyword');
    expect(ancientOfferText('keshi', 'war')).toMatch(/^Minions discovered from Keshi’s Crown’s rewards have a random keyword/);
  });
  it('the pick of a CROWN Triple Reward gains one keyword from the pool', () => {
    let s = picked('war', { tier: 3, hand: [reward('r', 3, true)] });
    s = reduce(s, { type: 'play', uid: 'r' });
    expect(s.discover?.length).toBeGreaterThan(0);
    expect(s.ancients!.discoverTag).toBe('crown');
    const id = s.discover![0]!;
    s = reduce(s, { type: 'discover', index: 0 });
    const got = s.hand.find((c) => c.cardId === id)!;
    const added = got.keywords.filter((k) => !CARD_INDEX[id]!.keywords.includes(k));
    expect(added.length).toBe(1);
    expect(KEYS).toContain(added[0]);
    expect(s.ancients!.discoverTag).toBeUndefined();
  });
  it('a plain Triple Reward (a triple’s, not the Crown’s) gains nothing', () => {
    for (let seed = 1; seed <= 8; seed++) {
      let s = picked('war', { tier: 3, hand: [reward('r', 3)] });
      s = reduce({ ...s, rngCursor: seed * 7919 }, { type: 'play', uid: 'r' });
      expect(s.ancients!.discoverTag).toBe('triple');
      for (let i = 0; i < s.discover!.length; i++) {
        const id = s.discover![i]!;
        expect(discoverOfferCard(s, i)!.keywords, 'the offer shows nothing').toEqual(CARD_INDEX[id]!.keywords);
      }
      const id = s.discover![0]!;
      s = reduce(s, { type: 'discover', index: 0 });
      expect(s.hand.find((c) => c.cardId === id)!.keywords, 'the pick gets nothing').toEqual(CARD_INDEX[id]!.keywords);
    }
  });
  it('the keyword is rolled as the offer opens: every option SHOWS its keyword, and the pick gets exactly that one', () => {
    for (let seed = 1; seed <= 12; seed++) {
      let s = picked('war', { tier: 3, hand: [reward('r', 3, true)] });
      s = reduce({ ...s, rngCursor: seed * 7919 }, { type: 'play', uid: 'r' });
      const n = s.discover!.length;
      const shown = Array.from({ length: n }, (_, i) => discoverOfferCard(s, i)!);
      shown.forEach((c, i) => {
        const added = c.keywords.filter((k) => !CARD_INDEX[s.discover![i]!]!.keywords.includes(k));
        expect(added.length, `option ${i} shows one keyword`).toBe(1);
        expect(KEYS).toContain(added[0]);
      });
      // Reading the preview twice changes nothing (a preview never rolls).
      expect(discoverOfferCard(s, 0)!.keywords).toEqual(shown[0]!.keywords);
      const index = seed % n;
      const id = s.discover![index]!;
      const after = reduce(s, { type: 'discover', index });
      const got = after.hand.find((c) => c.cardId === id && !s.hand.some((h) => h.uid === c.uid))!;
      expect(got.keywords, 'what you see is what you get').toEqual(shown[index]!.keywords);
    }
  });
  it('a non-Triple-Reward Discover gains nothing', () => {
    let s = picked('war', { tier: 3, hand: [card('b', 'beyondsummit')] });
    s = reduce(s, { type: 'play', uid: 'b' });
    const id = s.discover![0]!;
    s = reduce(s, { type: 'discover', index: 0 });
    expect(s.hand.find((c) => c.cardId === id)!.keywords).toEqual(CARD_INDEX[id]!.keywords);
  });
  it('a Critical Strike gained this way rolls in combat (the 50% convention)', async () => {
    const { instantiate } = await import('@game/core');
    const m = instantiate({ cardId: N(0), attack: 1, health: 1, keywords: ['CR'] }, 'player', CARD_INDEX, () => 'u');
    expect(m.critChance).toBe(0.5);
  });
});

describe('Keshi × GENESIS: "Keshi\'s Crown may grant T7 units randomly. (At Tier 6) (25% chance per slot)"', () => {
  const offers = (crown: boolean, tier: number): string[][] => {
    const out: string[][] = [];
    for (let seed = 1; seed <= 24; seed++) {
      let s = picked('genesis', { tier, hand: [reward('r', tier, crown)] });
      s = { ...s, rngCursor: seed * 7919 };
      s = reduce(s, { type: 'play', uid: 'r' });
      out.push([...(s.discover ?? [])]);
    }
    return out;
  };
  it('at Tier 6 a Crown Triple Reward sometimes offers Tier 7 minions; a plain Triple Reward never does', () => {
    const crown = offers(true, 6).flat();
    expect(crown.some((id) => CARD_INDEX[id]!.tier === 7)).toBe(true);
    expect(crown.some((id) => CARD_INDEX[id]!.tier !== 7)).toBe(true); // a chance, not every slot
    expect(offers(false, 6).flat().some((id) => CARD_INDEX[id]!.tier === 7)).toBe(false);
  });
  it('below Tier 6 the Crown offers no Tier 7', () => {
    expect(offers(true, 5).flat().some((id) => CARD_INDEX[id]!.tier === 7)).toBe(false);
  });
  it('the Crown itself stamps its Triple Reward', () => {
    let s = picked('genesis', { keshiTierPoints: 24 });
    s = buyFromRow(s, minionOfTier(1));
    expect(s.hand.find((c) => c.cardId === 'discoverspell')?.crownReward).toBe(true);
    expect(heroPowerText({ ...s, tier: 6 })).toContain('**Active now.**');
  });
});

describe('Keshi × TIME: "Start of Turn: Get a Beyond the Summit."', () => {
  it('each Start of Turn gets a Beyond the Summit (its own beat)', () => {
    let s = picked('time', { board: [card('a', N(0), { health: 50 })] });
    expect(heroPowerText(s)).toBe(`${BASE} **Start of Turn:** get a **Beyond the Summit**.`);
    s = reduce(fightNow(s), { type: 'resolveCombat' });
    expect(s.hand.filter((c) => c.cardId === 'beyondsummit').length).toBe(1);
    expect((s.sotBeatFx ?? []).some((b) => b.source.label === 'Ancient of Time')).toBe(true);
  });
});

describe('Keshi × BONDS: "Buying a minion of your shop tier counts twice."', () => {
  it('a minion of your Shop tier banks its tier twice; another tier and spells bank once', () => {
    let s = picked('bonds', { tier: 3 });
    s = buyFromRow(s, minionOfTier(3));
    expect(s.keshiTierPoints).toBe(6);
    s = buyFromRow(s, minionOfTier(2));
    expect(s.keshiTierPoints).toBe(8);
    expect(heroPowerText(s)).toBe(`${BASE} Buying a minion of your Shop tier (Tier **3**) counts **twice**.`);
  });
});

describe('Keshi × determinism', () => {
  it('every pairing replays identically from the same state', () => {
    for (const id of ANCIENT_IDS) {
      const run = () => {
        let s = picked(id, { wave: 4, tier: 3, board: [card('a', N(0), { attack: 30, health: 3 }), card('b', N(1), { attack: 3, health: 2 })], keshiTierPoints: 20 });
        s = { ...s, ancients: { ...s.ancients!, keshiDeaths: 3 } };
        s = buyFromRow(s, minionOfTier(3));
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
