/**
 * ANCIENTS × HUNCH (owner pairings 2026-09-30). Rounded Spellbook: "Get a copy of the last spell you cast. Costs
 * 3 Gold, reduced by 1 each turn." (untargeted, once per turn; the shrinking price is `roundedSpellbookCostOf`).
 * Each pairing in the phase(s) it fires in, with the live power text.
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatEvent, type CombatResult, type QuestCombatMods } from '@game/core';
import {
  ANCIENT_IDS, ancientCombatMods, ancientSpellbookAvengeLeft, ancientOfferText, createRun, enableAncients, heroPowerText, reduce, roundedSpellbookCostOf, spellCasts,
  type AncientId, type BoardCard, type BoardSnapshot, type RunState,
} from './index';
import { destroyMinionInShop, makeContext, noteSpellForCountRunes } from './recruit';
// RE-PIN 2026-10-10: Fatecarver's Growth branch was retired (owner balance batch), so this Growth-on-ally-attack
// fixture is Taragosa, the other live `onAllyAttackCastGrowth` caster (+3/+4 Growth instead of +1/+1).

const card = (uid: string, cardId: string, extra: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...extra };
};
/** Gold Pouch: an untargeted Shop spell whose only effect is +1 Gold, so a cast is countable in the purse. */
const POUCH = 'emberpouch';
const pouch = (uid: string): BoardCard => card(uid, POUCH, { tribe: 'neutral', attack: 0, health: 1 });
const T1 = 'hm_test_squire';
const base = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(7, 'hunch'), phase: 'recruit', embers: 60, hand: [], ...over } as RunState);
const picked = (id: AncientId, over: Partial<RunState> = {}): RunState => {
  let s = enableAncients(base(over));
  s = { ...s, ancients: { ...s.ancients!, points: s.ancients!.cost, offer: [id, ...ANCIENT_IDS.filter((a) => a !== id).slice(0, 2)] } };
  s = reduce(s, { type: 'pickAncient', id });
  expect(s.ancients!.picked).toBe(id);
  return s;
};
const BASE = heroPowerText(base());
const book = (s: RunState): RunState => reduce(s, { type: 'heroPower' });
const foes = (wave: number, attack: number, health: number, n = 1): BoardSnapshot => ({
  v: 1, wave, heroId: 'indy', resolve: 30, tier: 7, triples: 0, tribes: [], threat: 'glass', power: health * n,
  minions: Array.from({ length: n }, () => ({ cardId: 'sandbag', attack, health, keywords: [] })), seed: 1, origin: 'self',
});
const fightNow = (s: RunState, attack = 0, health = 400): RunState => reduce({ ...s, servedBoards: { [s.wave]: foes(s.wave, attack, health) } }, { type: 'faceOmen' });
const at = (s: RunState, uid: string): BoardCard => s.board.find((c) => c.uid === uid)!;

/** Combat fixtures (the castInCombat suite's): Fatecarver branch B casts a Growth on every friendly attack. */
const wall: BoardMinion[] = [{ cardId: 'sandbag', attack: 0, health: 90000 }];
const fatecarver: BoardMinion = { cardId: 'taragosa', attack: 4, health: 900, sourceUid: 'FC' };
const filler = (uid: string): BoardMinion => ({ cardId: 'sandbag', attack: 1, health: 900, sourceUid: uid });
const fight = (board: BoardMinion[], mods?: Partial<QuestCombatMods>): CombatResult => simulate(
  board, wall, makeRng(3), CARD_INDEX,
  combatSide({ tier: 6, tribes: ['beast', 'dragon'], ...(mods ? { questMods: mods as QuestCombatMods } : {}) }),
  combatSide({ tier: 1 }),
);
const playerAttacks = (r: CombatResult): number => {
  const own = new Set(r.initial.player.map((m) => m.uid));
  return r.events.filter((e: CombatEvent) => e.type === 'attack' && own.has(e.attacker)).length;
};

describe('Hunch × every Ancient has a written pairing', () => {
  it('all six are written (no "Not written yet."), and none uses an em dash', () => {
    for (const id of ANCIENT_IDS) {
      expect(ancientOfferText('hunch', id)).not.toBe('Not written yet.');
      expect(ancientOfferText('hunch', id)).not.toMatch(/—|--/);
    }
  });
  it('the base power is Rounded Spellbook', () => {
    expect(BASE).toBe('Get a copy of the last spell you cast. Costs **3 Gold**, reduced by 1 each turn.');
  });
});

describe('Hunch × DEATH — Avenge (4): improve your spells by +1/+1', () => {
  it('threads the Avenge into the fight only while Death is picked', () => {
    expect(ancientCombatMods(picked('death')).ancientAvengeSpells).toMatchObject({ every: 4, attack: 1, health: 1 });
    expect(ancientCombatMods(picked('war')).ancientAvengeSpells).toBeUndefined();
  });
  it('every 4th friendly death in combat improves your spells +1/+1, mid-fight, and it is banked at settle', () => {
    const board = Array.from({ length: 4 }, (_, i) => card(`m${i}`, T1, { attack: 1, health: 1 }));
    let s = picked('death', { board });
    const before = { ...s.spellBonus };
    s = fightNow(s, 50, 1000);
    const ev = s.lastCombat!.events as CombatEvent[];
    const deaths = ev.map((e, i) => ({ e, i })).filter(({ e }) => e.type === 'death' && e.side === 'player');
    expect(deaths.length).toBe(4);
    const grant = ev.findIndex((e) => e.type === 'sc' && e.text === '+1/+1 Spell Power');
    expect(grant, 'the improvement is narrated live').toBeGreaterThan(deaths[3]!.i);
    const sc = ev[grant] as Extract<CombatEvent, { type: 'sc' }>;
    expect(sc.heroPower, 'owner 2026-09-30: it plays at the hero power, not on the board').toBe(true);
    expect(ev.filter((e) => e.type === 'sc' && /Spell Power/.test(e.text)).length, 'no second, board-anchored narration').toBe(1);
    expect(s.lastCombat!.playerAncientSpellImproved).toEqual({ attack: 1, health: 1 });
    s = reduce(s, { type: 'resolveCombat' });
    expect(s.spellBonus).toEqual({ attack: before.attack + 1, health: before.health + 1 });
    expect(s.ancients!.spellImproved).toEqual({ attack: 1, health: 1 });
  });
  it('the centre tally counts down the deaths still needed, live, and resets after each trigger', () => {
    const s = picked('death');
    const left = (d: number | undefined): number | null => ancientSpellbookAvengeLeft({ ...s, fxFriendlyDeathPreview: d });
    expect([left(undefined), left(1), left(2), left(3), left(4), left(5), left(8)]).toEqual([4, 3, 2, 1, 4, 3, 4]);
    expect(ancientSpellbookAvengeLeft(picked('war')), 'only with Death').toBeNull();
  });
  it('three deaths are not enough', () => {
    const board = Array.from({ length: 3 }, (_, i) => card(`m${i}`, T1, { attack: 1, health: 1 }));
    const s = fightNow(picked('death', { board }), 50, 1000);
    expect(s.lastCombat!.playerAncientSpellImproved).toEqual({ attack: 0, health: 0 });
  });
  it('prints the live Avenge progress and the improvement so far (folding the fight on screen)', () => {
    let s = picked('death');
    s = { ...s, ancients: { ...s.ancients!, spellImproved: { attack: 2, health: 2 } } };
    expect(heroPowerText(s)).toBe(`${BASE} **Avenge (4):** improve your spells by **+1/+1** (**0/4**). Improved so far: **+2/+2**.`);
    expect(heroPowerText({ ...s, fxFriendlyDeathPreview: 5 })).toContain('(**1/4**). Improved so far: **+3/+3**.');
  });
});

describe('Hunch × FORTUNE — Rounded Spellbook also increases max Gold by 1', () => {
  it('each use gives +1 max Gold, permanently, and prints the running total', () => {
    let s = picked('fortune', { lastSpellCastId: POUCH });
    const max0 = s.maxGoldBonus ?? 0;
    s = book(s);
    expect(s.hand.some((c) => c.cardId === POUCH), 'the copy landed').toBe(true);
    expect(s.maxGoldBonus).toBe(max0 + 1);
    expect(s.ancients!.bookGoldFxSeq, 'the Gold pill beat').toBe(1);
    expect(heroPowerText(s)).toBe(`${BASE} It also gives you **+1 max Gold**. **+1** so far.`);
  });
  it('a refused use (no spell cast yet) gives nothing', () => {
    const s = book(picked('fortune'));
    expect(s.maxGoldBonus ?? 0).toBe(0);
  });
  it('without Fortune the use gives no max Gold', () => {
    const s = book(picked('time', { lastSpellCastId: POUCH }));
    expect(s.maxGoldBonus ?? 0).toBe(0);
  });
});

describe('Hunch × WAR — Shop Spells cast an additional time in combat', () => {
  it('threads one extra combat cast only while War is picked', () => {
    expect(ancientCombatMods(picked('war')).ancientSpellCastExtra).toBe(1);
    expect(ancientCombatMods(picked('death')).ancientSpellCastExtra).toBeUndefined();
  });
  it('every combat Shop Spell resolves twice (genuine casts, Runebloom Matriarch\'s channel)', () => {
    const board = [fatecarver, filler('F1')];
    const plain = fight(board);
    const war = fight(board, { ancientSpellCastExtra: 1 });
    const per = (r: CombatResult): number => Math.round((r.playerSpellsCast ?? 0) / playerAttacks(r));
    expect(plain.playerSpellsCast ?? 0).toBeGreaterThan(0);
    expect(per(plain)).toBe(1);
    expect(per(war)).toBe(2);
  });
  it('prints the power', () => {
    expect(heroPowerText(picked('war'))).toBe(`${BASE} Your **Shop Spells** cast an extra time in combat.`);
  });
});

describe('Hunch × GENESIS — casting 5 spells recharges Rounded Spellbook at 1 Gold', () => {
  it('the 5th spell after the pick recharges a used Spellbook and prices it at 1 Gold', () => {
    let s = picked('genesis', { lastSpellCastId: POUCH, hand: [pouch('p1'), pouch('p2'), pouch('p3'), pouch('p4')] });
    s = book(s); // 3 Gold, the copy lands
    expect(s.heroReady).toBe(false);
    for (const uid of ['p1', 'p2', 'p3', 'p4']) s = reduce(s, { type: 'play', uid });
    expect(s.heroReady, '4 casts: not yet').toBe(false);
    expect(heroPowerText(s)).toContain('(**1** more to go)');
    const copy = s.hand.find((c) => c.cardId === POUCH)!;
    s = reduce(s, { type: 'play', uid: copy.uid });
    expect(s.heroReady, 'the 5th cast recharges it').toBe(true);
    expect(s.ancients!.rechargeFxSeq, 'the hero-power pulse').toBe(1);
    expect(roundedSpellbookCostOf(s)).toBe(1);
    const gold = s.embers;
    s = book(s);
    expect(s.embers, 'the recharged use costs 1 Gold').toBe(gold - 1);
    expect(heroPowerText(s)).toContain('(**5** more to go)');
  });
  it('never raises the price: a Spellbook already at 0 stays at 0', () => {
    let s = picked('genesis', { wave: 6, hunchResetWave: 1, hand: [pouch('p1')] });
    s = { ...s, ancients: { ...s.ancients!, genesisSpells: 4 } };
    expect(roundedSpellbookCostOf(s)).toBe(0);
    s = reduce(s, { type: 'play', uid: 'p1' });
    expect(roundedSpellbookCostOf(s)).toBe(0);
  });
  it('a Ruby counts as a spell cast (every spell counts)', () => {
    const s = picked('genesis');
    noteSpellForCountRunes(s, 'ruby');
    expect(s.ancients!.genesisSpells).toBe(1);
  });
  it('combat casts count too; a recharge earned in combat prices the next Shop at 1 Gold', () => {
    const board = [card('fc', 'taragosa', { attack: 4, health: 900 })];
    const run = (genesis: boolean): RunState => {
      let s = genesis ? picked('genesis', { lastSpellCastId: POUCH, board }) : picked('time', { lastSpellCastId: POUCH, board });
      s = book(s); // used on this turn: the native price next turn would be 2
      if (genesis) s = { ...s, ancients: { ...s.ancients!, genesisSpells: 4 } };
      s = fightNow(s, 0, 20);
      expect(s.lastCombat!.playerSpellsCast ?? 0, 'the fixture casts in combat').toBeGreaterThan(0);
      return reduce(s, { type: 'resolveCombat' });
    };
    expect(roundedSpellbookCostOf(run(false))).toBe(2);
    expect(roundedSpellbookCostOf(run(true))).toBe(1);
  });
});

describe('Hunch × TIME — spells from Rounded Spellbook cast twice', () => {
  it('the copy is stamped to cast twice and resolves two genuine casts', () => {
    let s = picked('time', { lastSpellCastId: POUCH });
    s = book(s);
    const copy = s.hand.find((c) => c.cardId === POUCH)!;
    expect(copy.castMult).toBe(2);
    expect(spellCasts(s, CARD_INDEX[POUCH]!, copy), 'the x2 badge and the per-cast burst count').toBe(2);
    const gold = s.embers, casts = s.spellsCast;
    s = reduce(s, { type: 'play', uid: copy.uid });
    expect(s.embers, 'two Gold Pouches').toBe(gold + 2);
    expect(s.spellsCast, 'each is its own cast').toBe(casts + 2);
  });
  it('an ordinary copy of the same spell casts once', () => {
    let s = picked('time', { hand: [pouch('p1')] });
    const gold = s.embers;
    s = reduce(s, { type: 'play', uid: 'p1' });
    expect(s.embers).toBe(gold + 1);
  });
  it('without Time the Spellbook copy casts once', () => {
    let s = book(picked('war', { lastSpellCastId: POUCH }));
    const copy = s.hand.find((c) => c.cardId === POUCH)!;
    expect(copy.castMult).toBeUndefined();
    const gold = s.embers;
    s = reduce(s, { type: 'play', uid: copy.uid });
    expect(s.embers).toBe(gold + 1);
  });
  it('prints the power', () => {
    expect(heroPowerText(picked('time'))).toBe(`${BASE} The copy casts **twice**.`);
  });
});

describe('Hunch × BONDS (ancient pass 2, owner 2026-11-16): "Your first 3 targeted spells each turn cast twice."', () => {
  const FIRE = 'spiritfire'; // "Give a minion +6/+6." (targeted)
  const fire = (uid: string): BoardCard => card(uid, FIRE, { tribe: 'neutral', attack: 0, health: 1 });
  const aim = (s: RunState, uid: string, target = 'a'): RunState => reduce(s, { type: 'play', uid, targetUid: target });
  it('the first 3 targeted casts from hand each turn cast twice, the 4th once; the text counts down; a new turn resets', () => {
    let s = picked('bonds', { board: [card('a', T1)], hand: ['f1', 'f2', 'f3', 'f4'].map(fire) });
    const a0 = at(s, 'a').attack;
    expect(heroPowerText(s)).toBe(`${BASE} Your first **3** targeted spells each turn cast **twice** (**3** left this turn).`);
    expect(spellCasts(s, CARD_INDEX[FIRE]!), 'the hand badge previews x2').toBe(2);
    s = aim(s, 'f1');
    expect(at(s, 'a').attack).toBe(a0 + 12);
    expect(heroPowerText(s)).toContain('(**2** left this turn)');
    s = aim(aim(s, 'f2'), 'f3');
    expect(at(s, 'a').attack).toBe(a0 + 36);
    expect(heroPowerText(s)).toContain('(**0** left this turn)');
    expect(spellCasts(s, CARD_INDEX[FIRE]!)).toBe(1);
    s = aim(s, 'f4');
    expect(at(s, 'a').attack, 'the 4th casts once').toBe(a0 + 42);
    const next = { ...s, wave: s.wave + 1 };
    expect(spellCasts(next, CARD_INDEX[FIRE]!), 'a new turn: the budget is back').toBe(2);
  });
  it('an untargeted spell casts once and does not spend the budget', () => {
    let s = picked('bonds', { board: [card('a', T1)], hand: [pouch('p1')] });
    const gold = s.embers;
    s = reduce(s, { type: 'play', uid: 'p1' });
    expect(s.embers).toBe(gold + 1);
    expect(heroPowerText(s)).toContain('(**3** left this turn)');
  });
  it('a Ruby and an aimed Tower Shield are targeted spells too: they cast twice and spend the budget (R-ANCFIX-04)', () => {
    const ruby = card('r1', 'ruby', { tribe: 'neutral', attack: 1, health: 1 });
    const shield = card('t1', 'tower_shield', { tribe: 'neutral', attack: 0, health: 1 });
    let s = picked('bonds', { board: [card('a', T1)], hand: [ruby, shield] });
    const a0 = at(s, 'a');
    s = aim(s, 'r1');
    expect(at(s, 'a').attack, 'the Ruby lands twice').toBe(a0.attack + 2);
    expect(heroPowerText(s)).toContain('(**2** left this turn)');
    s = aim(s, 't1');
    expect(at(s, 'a').attack, 'Tower Shield lands twice').toBe(a0.attack + 2 + 4);
    expect(heroPowerText(s)).toContain('(**1** left this turn)');
  });
  it('picked after a targeted spell was cast that turn: it is one of the first 3 (the look-back, R-ANCFIX-03)', () => {
    let s = enableAncients(base({ board: [card('a', T1)], hand: [fire('f0')] }));
    s = aim(s, 'f0');
    s = { ...s, ancients: { ...s.ancients!, points: s.ancients!.cost, offer: ['bonds', ...ANCIENT_IDS.filter((a) => a !== 'bonds').slice(0, 2)] } };
    s = reduce(s, { type: 'pickAncient', id: 'bonds' });
    expect(heroPowerText(s)).toContain('(**2** left this turn)');
  });
  it('without Bonds a targeted spell casts once', () => {
    let s = picked('death', { board: [card('a', T1)], hand: [fire('f1')] });
    const a0 = at(s, 'a').attack;
    s = aim(s, 'f1');
    expect(at(s, 'a').attack).toBe(a0 + 6);
  });
  it('the old edge buff is gone from the fight', () => {
    expect(ancientCombatMods(picked('bonds')).ancientSpellEdges).toBeUndefined();
  });
});

describe('Hunch × DEATH counts Shop deaths too: one running Avenge (4) across Shop and combat (R-ANCFIX-10)', () => {
  it('4 Shop destroys improve your spells once, right then; the countdown runs in the Shop', () => {
    const s = structuredClone({ ...picked('death'), board: ['d1', 'd2', 'd3', 'd4'].map((u) => card(u, T1)) });
    const sb = s.spellBonus ?? { attack: 0, health: 0 };
    for (const u of ['d1', 'd2', 'd3']) destroyMinionInShop(makeContext(s), at(s, u));
    expect(s.ancients!.hunchDeaths).toBe(3);
    expect(heroPowerText(s)).toContain('(**3/4**)');
    expect(s.spellBonus ?? { attack: 0, health: 0 }).toEqual(sb);
    destroyMinionInShop(makeContext(s), at(s, 'd4'));
    expect(s.ancients!.hunchDeaths).toBe(0);
    expect(s.spellBonus).toEqual({ attack: sb.attack + 1, health: sb.health + 1 });
    expect(heroPowerText(s)).toContain('Improved so far: **+1/+1**');
  });
  it('the Shop half carries into the fight: 3 Shop deaths + 1 combat death is an Avenge', () => {
    const s = picked('death');
    const mods = ancientCombatMods({ ...s, ancients: { ...s.ancients!, hunchDeaths: 3 } });
    expect(mods.ancientAvengeSpells?.tick).toBe(3);
  });
});
