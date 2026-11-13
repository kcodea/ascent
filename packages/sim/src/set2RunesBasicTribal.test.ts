/**
 * SET 2 RUNE BATCH, BASIC TRIBAL (owner review 2026-11-12, R-SET2-TRIBAL-RUNES-01..05). Fourteen Basic runes, each
 * gated to its tribe and to Set 2. Every block drives the real engine: the Runeforge `buyRune`, the reducer's actions,
 * the Shop cast / sale / End of Turn chokepoints, and `simulate()` for the combat halves (both sides).
 */
import { describe, it, expect } from 'vitest';
import { RUBY_TYPE_IDS, combatSide, makeRng, simulate, type BoardMinion, type CombatEvent, type QuestCombatMods } from '@game/core';
import { CARD_INDEX, RUNES, EPIC_RUNES, RUNE_INDEX, SETS, poolFor } from '@game/content';
import { CONFIG, createRun, reduce, type Action, type BoardCard, type RunState } from './index';
import { questCombatMods, offerBuyPrice } from './reducer';
import { advanceRuneThresholds, applyRuneGrafts, castSpell, mintRubies } from './recruit';
import { runeTally, runeCombatTally } from '../../ui/src/runeTally';

const IDS = ['rune_deep_pockets', 'rune_rowdy_crowd', 'rune_bloodscent', 'rune_last_howl', 'rune_trophy_hunter', 'rune_pitchforks',
  'rune_imp_legion', 'rune_guels_apprentice', 'rune_collections', 'rune_flamekeeper', 'rune_hatchling_roost', 'rune_dragon_hoard',
  'rune_ruby_dust', 'rune_rough_cut'];

// ── Shop helpers ────────────────────────────────────────────────────────────────────────────────────────────────
const body = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
};
const act = (s: RunState, a: Action): RunState => reduce(s, a) as RunState;
function withRunes(ids: string[], extra: Partial<RunState> = {}, seed = 3): RunState {
  let s = {
    ...createRun(seed, 'runesmith', 'ascent', CONFIG.defaultLine, 'set2'),
    tribes: [...SETS.set2.tribes], wave: 7, tier: 6, phase: 'recruit', embers: 60, hand: [], board: [], recruitBuffFx: [],
    pool: Object.fromEntries(poolFor('set2').buyable.map((c) => [c.id, 5])),
  } as RunState;
  for (const id of ids) s = act({ ...s, runeforgeOffer: [id], runeforgeEpic: !!RUNE_INDEX[id]!.epic }, { type: 'buyRune', index: 0 });
  return { ...s, ...extra };
}
const sumFrom = (c: BoardCard | undefined, source: string): [number, number] =>
  (c?.buffs ?? []).filter((b) => b.source === source).reduce<[number, number]>((t, b) => [t[0] + b.attack, t[1] + b.health], [0, 0]);
const nextTurn = (s: RunState): RunState => act(act(act(s, { type: 'faceOmen' }), { type: 'settleCombat' }), { type: 'resolveCombat' });
const SHOP_SPELL = poolFor('set2').all.find((c) => c.spell && !c.token && !c.gift && !c.ruby && !c.target && c.id !== 'sp_dragonflame' && c.effects.length > 0)!;

// ── Combat helpers ──────────────────────────────────────────────────────────────────────────────────────────────
const bm = (uid: string, cardId: string, over: Partial<BoardMinion> = {}): BoardMinion => {
  const d = CARD_INDEX[cardId]!;
  return { sourceUid: uid, cardId, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over } as BoardMinion;
};
const wall = (uid: string, attack = 0, health = 5000): BoardMinion => bm(uid, 'sandbag', { attack, health, keywords: [] });
const fight = (p: BoardMinion[], e: BoardMinion[], pm: QuestCombatMods, em: QuestCombatMods = {}, seed = 4) =>
  simulate(p, e, makeRng(seed), CARD_INDEX, combatSide({ tier: 6, tribes: [...SETS.set2.tribes], questMods: pm }), combatSide({ tier: 6, tribes: [...SETS.set2.tribes], questMods: em }));
const triggers = (evs: readonly CombatEvent[], flag: string, side: 'player' | 'enemy' = 'player') => evs.filter((e) => e.type === 'questTrigger' && e.flag === flag && e.side === side);
type Summon = Extract<CombatEvent, { type: 'summon' }>;

describe('the fourteen runes as content', () => {
  it('Basic, Set 2 only, tribe gate, doc texts verbatim, owner costs', () => {
    const rows: [string, string, number, string, string][] = [
      ['rune_deep_pockets', 'Deep Pockets', 3, 'dwarf', 'The first time you spend **8 Gold** each turn, get a random **Dwarf**.'],
      ['rune_rowdy_crowd', 'Rowdy Crowd', 2, 'dwarf', 'After you play **4** cards in a turn, give your **Dwarves +2/+2**.'],
      ['rune_bloodscent', 'Bloodscent', 1, 'beast', 'When a **Beast** kills a minion, it gains **+4/+4** permanently.'],
      ['rune_last_howl', 'Last Howl', 3, 'beast', 'Resummon the first **Beast** with an **Echo** that dies each combat.'],
      ['rune_trophy_hunter', 'Trophy Hunter', 2, 'beast', 'When a **Beast** kills a minion, gain **1 Gold** next turn. (3 per combat.)'],
      ['rune_pitchforks', 'Pitchforks', 4, 'demon', '**Imps** deal **3** damage to **2** enemies when summoned.'],
      ['rune_imp_legion', 'Imp Legion', 3, 'demon', 'Your **Imps** gain "**Echo:** deal **3** damage to the lowest-Health enemy."'],
      ['rune_guels_apprentice', "Guel's Apprentice", 2, 'demon', 'Get a **Staff of Guel**. Repeat every turn.'],
      ['rune_collections', 'Collections', 3, 'demon', 'When you **Sell** a **Demon**, give minions in the Shop **+2/+2** permanently.'],
      ['rune_flamekeeper', 'Flamekeeper', 1, 'dragon', 'After you cast a **Dragonflame**, give your **Dragons +2/+2** permanently.'],
      ['rune_hatchling_roost', 'Hatchling Roost', 2, 'dragon', '**Dragons** with a **Shout** cost **1 Gold**.'],
      ['rune_dragon_hoard', 'Dragon Hoard', 1, 'dragon', 'When you spend **3** Gold, get a **Dragonflame**.'],
      ['rune_ruby_dust', 'Ruby Dust', 2, 'kobold', 'When a minion with **Rubies** dies, cast a permanent **Ruby** on a random friendly **Kobold**.'],
      ['rune_rough_cut', 'Rough Cut', 2, 'kobold', 'When you cast a **Ruby** on a **Kobold**, also cast one on a non-**Kobold**.'],
    ];
    for (const [id, name, cost, tribe, text] of rows) {
      const r = RUNE_INDEX[id]!;
      expect([r.name, r.cost, r.text, r.sets, r.tribes, !!r.epic], id).toEqual([name, cost, text, ['set2'], [tribe], false]);
      expect(RUNES.includes(r) && !EPIC_RUNES.includes(r), `${id} is Basic`).toBe(true);
      expect(/—|--|Oath|climb/.test(r.text), `${id} player text style`).toBe(false);
    }
  });
});

describe('Deep Pockets (the gold meter, a per-turn window, once a turn)', () => {
  it('the first 8 Gold spent each turn gets a random Dwarf; the next 8 that turn get nothing; the tally reads 8/8g', () => {
    let s = withRunes(['rune_deep_pockets']);
    advanceRuneThresholds(s, 'gold', 7);
    expect(s.hand.length).toBe(0);
    expect(runeTally(s, 'rune_deep_pockets')).toBe('7/8g');
    advanceRuneThresholds(s, 'gold', 1);
    expect(s.hand.map((c) => CARD_INDEX[c.cardId]!.tribe)).toEqual(['dwarf']);
    advanceRuneThresholds(s, 'gold', 8);
    expect(s.hand.length, 'once per turn').toBe(1);
    expect(runeTally(s, 'rune_deep_pockets')).toBe('8/8g');
    s = nextTurn({ ...s, hand: [] });
    expect(runeTally(s, 'rune_deep_pockets'), 'a new turn starts the window empty').toBe('0/8g');
    advanceRuneThresholds(s, 'gold', 5);
    s = nextTurn(s);
    advanceRuneThresholds(s, 'gold', 3);
    expect(s.hand.length, 'no remainder carries across the rollover').toBe(0);
  });
});

describe('Rowdy Crowd', () => {
  it('the 4th card played in a turn gives the board Dwarves +2/+2 (permanent), once a turn; not hand Dwarves, not others', () => {
    const s = withRunes(['rune_rowdy_crowd'], { board: [body('a', 'dw_orin'), body('b', 'b2_trex')], hand: [body('h', 'dw_brakka')] });
    advanceRuneThresholds(s, 'cardsPlayed', 3);
    expect(sumFrom(s.board[0], 'Rowdy Crowd')).toEqual([0, 0]);
    advanceRuneThresholds(s, 'cardsPlayed', 1);
    expect(sumFrom(s.board[0], 'Rowdy Crowd')).toEqual([2, 2]);
    expect(sumFrom(s.board[1], 'Rowdy Crowd')).toEqual([0, 0]);
    expect(sumFrom(s.hand[0], 'Rowdy Crowd')).toEqual([0, 0]);
    advanceRuneThresholds(s, 'cardsPlayed', 4);
    expect(sumFrom(s.board[0], 'Rowdy Crowd'), 'once per turn').toEqual([2, 2]);
  });
});

describe("Guel's Apprentice", () => {
  it('a Staff of Guel on purchase and another every turn', () => {
    let s = withRunes(['rune_guels_apprentice']);
    expect(s.hand.map((c) => c.cardId)).toEqual(['staffofguel']);
    s = nextTurn({ ...s, hand: [] });
    expect(s.hand.filter((c) => c.cardId === 'staffofguel').length).toBe(1);
  });
});

describe('Collections', () => {
  it('selling a Demon raises the permanent Shop buff +2/+2 (per copy); a non-Demon sale does nothing', () => {
    const s0 = withRunes(['rune_collections'], { board: [body('d', 'dm_knocked'), body('b', 'b2_trex')] });
    const before = { ...s0.tavernBuyBonus };
    const s1 = act(s0, { type: 'sell', uid: 'b' } as Action);
    expect(s1.tavernBuyBonus).toEqual(before);
    const s2 = act(s1, { type: 'sell', uid: 'd' } as Action);
    expect(s2.tavernBuyBonus).toEqual({ atk: before.atk + 2, hp: before.hp + 2 });
    const two = withRunes(['rune_collections', 'rune_collections'], { board: [body('d', 'dm_knocked')] });
    const b2 = { ...two.tavernBuyBonus };
    expect(act(two, { type: 'sell', uid: 'd' } as Action).tavernBuyBonus).toEqual({ atk: b2.atk + 4, hp: b2.hp + 4 });
  });
});

describe('Flamekeeper', () => {
  it('Shop: every Dragonflame cast gives the board Dragons +2/+2; another spell does nothing', () => {
    const s = withRunes(['rune_flamekeeper'], { board: [body('d', 'd2_broodfire'), body('k', 'k_chipwick')] });
    castSpell(s, SHOP_SPELL);
    expect(sumFrom(s.board[0], 'Flamekeeper')).toEqual([0, 0]);
    castSpell(s, CARD_INDEX['sp_dragonflame']!);
    castSpell(s, CARD_INDEX['sp_dragonflame']!);
    expect(sumFrom(s.board[0], 'Flamekeeper')).toEqual([4, 4]);
    expect(sumFrom(s.board[1], 'Flamekeeper')).toEqual([0, 0]);
  });
  it('Combat: a Dragonflame cast mid-fight (Flamebeat Drake) gives the living Dragons +2/+2 PERMANENTLY, either side', () => {
    const p = [bm('fb', 'd2_flamebeat', { health: 500 }), bm('d', 'd2_broodfire', { health: 500 })];
    const on = fight(p, [wall('w', 0, 60)], { runeFlamekeeper: true });
    expect(triggers(on.events, 'runeFlamekeeper').length).toBeGreaterThan(0);
    const fires = triggers(on.events, 'runeFlamekeeper').length;
    const kept = (on.playerPermaBuffs ?? []).filter((b) => b.sourceUid === 'd').reduce((t, b) => t + b.attack, 0);
    expect(kept).toBe(2 * fires);
    const off = fight(p, [wall('w', 0, 60)], {});
    expect((off.playerPermaBuffs ?? []).filter((b) => b.sourceUid === 'd').length).toBe(0);
    const mirrored = fight([wall('w', 0, 60)], p, {}, { runeFlamekeeper: true });
    expect(triggers(mirrored.events, 'runeFlamekeeper', 'enemy').length).toBe(fires);
  });
});

describe('Hatchling Roost', () => {
  it('Shout Dragons cost 1 Gold in the Shop, any Tier; non-Shout Dragons and non-Dragon Shouts keep their price', () => {
    const s = withRunes(['rune_hatchling_roost']);
    expect(offerBuyPrice(s, { cardId: 'd2_broodfire' }).cost).toBe(1);
    expect(offerBuyPrice(s, { cardId: 'd2_blazingkeeper' }).cost).toBe(1);
    expect(offerBuyPrice(s, { cardId: 'd2_orivax' }).cost).toBe(3);
    expect(offerBuyPrice(s, { cardId: 'dw_orin' }).cost).toBe(3);
    const plain = withRunes([]);
    expect(offerBuyPrice(plain, { cardId: 'd2_broodfire' }).cost).toBe(3);
  });
});

describe('Dragon Hoard (owner rework 2026-11-13: a repeating spend-Gold meter)', () => {
  const flames = (s: RunState) => s.hand.filter((c) => c.cardId === 'sp_dragonflame').length;
  it('every 3 Gold spent gets a Dragonflame, repeating: 10 Gold = 3, the 1 left over carries into next turn; badge x/3', () => {
    let s = withRunes(['rune_dragon_hoard']);
    s.runeThresholds = (s.runeThresholds ?? []).map((t) => ({ ...t, tick: 0 })); // the rune purchase itself spent Gold
    advanceRuneThresholds(s, 'gold', 2);
    expect(flames(s)).toBe(0);
    expect(runeTally(s, 'rune_dragon_hoard')).toMatch(/^2\/3/);
    advanceRuneThresholds(s, 'gold', 8);
    expect(flames(s)).toBe(3);
    expect(runeTally(s, 'rune_dragon_hoard')).toMatch(/^1\/3/);
    s = nextTurn({ ...s, hand: [] });
    expect(runeTally(s, 'rune_dragon_hoard'), 'the remainder carries across the turn').toMatch(/^1\/3/);
    advanceRuneThresholds(s, 'gold', 2);
    expect(flames(s)).toBe(1);
  });
  it('real Gold spent through the Shop ticks it (3 paid Refreshes = 3 Gold = a Dragonflame)', () => {
    let s = withRunes(['rune_dragon_hoard']);
    s.runeThresholds = (s.runeThresholds ?? []).map((t) => ({ ...t, tick: 0 }));
    const before = s.embers;
    for (let i = 0; i < 3; i++) s = act(s, { type: 'roll' });
    expect(before - s.embers).toBe(3);
    expect(flames(s)).toBe(1);
  });
  it('with Big Spender each Gold counts twice: 3 Gold of Refreshes = 6 counted = 2 Dragonflames', () => {
    let s = withRunes(['rune_dragon_hoard', 'rune_big_spender']);
    s = { ...s, hand: [], runeThresholds: (s.runeThresholds ?? []).map((t) => ({ ...t, tick: 0 })) };
    for (let i = 0; i < 3; i++) s = act(s, { type: 'roll' });
    expect(flames(s)).toBe(2);
  });
  it('two copies: one meter each, so 3 Gold gets two Dragonflames', () => {
    const s = withRunes(['rune_dragon_hoard', 'rune_dragon_hoard']);
    s.runeThresholds = (s.runeThresholds ?? []).map((t) => ({ ...t, tick: 0 }));
    s.hand = [];
    advanceRuneThresholds(s, 'gold', 3);
    expect(flames(s)).toBe(2);
  });
});

describe('Rough Cut', () => {
  const castRuby = (s: RunState, targetUid: string): RunState => {
    mintRubies(s, 1, 'ruby');
    const ruby = s.hand.filter((c) => c.cardId === 'ruby').pop()!;
    return act(s, { type: 'play', uid: ruby.uid, targetUid });
  };
  it('Shop: a Ruby cast on a Kobold also lands on a random non-Kobold; a Ruby on a non-Kobold does not chain', () => {
    const s0 = withRunes(['rune_rough_cut'], { board: [body('k', 'k_veinbreaker'), body('n', 'dw_brakka'), body('k2', 'k3_jeweler')] });
    const s1 = castRuby(s0, 'k');
    expect(sumFrom(s1.board[1], 'Ruby')).toEqual([1, 1]);
    expect(sumFrom(s1.board[2], 'Ruby'), 'never another Kobold').toEqual([0, 0]);
    const s2 = castRuby(s1, 'n');
    expect(sumFrom(s2.board[1], 'Ruby')).toEqual([2, 2]);
    expect(sumFrom(s2.board[0], 'Ruby')).toEqual([1, 1]);
    const off = castRuby(withRunes([], { board: [body('k', 'k_veinbreaker'), body('n', 'dw_brakka')] }), 'k');
    expect(sumFrom(off.board[1], 'Ruby')).toEqual([0, 0]);
  });
  it('Combat: a Kobold casting a Ruby on itself (Boulderdash) also casts one on a non-Kobold, either side', () => {
    const p = [bm('k', 'k_boulderdash', { health: 500 }), bm('n', 'sandbag', { attack: 0, health: 500, keywords: [] })];
    const hits = (r: ReturnType<typeof fight>, side: 'player' | 'enemy') => {
      const n = r.initial[side].find((m) => m.cardId === 'sandbag' && m.attack === 0)!.uid;
      return r.events.filter((e) => e.type === 'buff' && e.ruby === true && e.target === n).length;
    };
    const on = fight(p, [wall('w')], { runeRoughCut: true });
    expect(hits(on, 'player')).toBeGreaterThan(0);
    expect(triggers(on.events, 'runeRoughCut').length).toBe(hits(on, 'player'));
    expect(hits(fight(p, [wall('w')], {}), 'player')).toBe(0);
    const mirrored = fight([wall('w')], p, {}, { runeRoughCut: true });
    expect(hits(mirrored, 'enemy')).toBe(hits(on, 'player'));
  });
});

describe('Bloodscent', () => {
  it('a Beast that kills gains +4/+4 permanently per kill (per copy); a non-Beast does not', () => {
    const foes = [bm('f1', 'sandbag', { attack: 0, health: 1, keywords: [] }), bm('f2', 'sandbag', { attack: 0, health: 1, keywords: [] })];
    const r = fight([bm('b', 'beetle', { health: 50 })], foes, { runeBloodscent: true });
    const kept = (r.playerPermaBuffs ?? []).filter((x) => x.sourceUid === 'b').reduce((t, x) => [t[0] + x.attack, t[1] + x.health], [0, 0]);
    expect(kept).toEqual([8, 8]);
    const two = fight([bm('b', 'beetle', { health: 50 })], foes, { runeBloodscent: true, flagCopies: { runeBloodscent: 2 } });
    expect((two.playerPermaBuffs ?? []).filter((x) => x.sourceUid === 'b').reduce((t, x) => t + x.attack, 0)).toBe(16);
    const nb = fight([bm('n', 'dw_brakka', { health: 50 })], foes, { runeBloodscent: true });
    expect((nb.playerPermaBuffs ?? []).filter((x) => x.sourceUid === 'n').length).toBe(0);
  });
});

describe('Trophy Hunter', () => {
  const foes = () => [1, 2, 3, 4, 5].map((i) => bm(`f${i}`, 'sandbag', { attack: 0, health: 1, keywords: [] }));
  it('a Beast kill banks 1 Gold next turn, capped at 3 per combat (per copy); the enemy side the same', () => {
    expect(fight([bm('b', 'beetle', { health: 50 })], foes(), { runeTrophyHunter: true }).playerBonusGold).toBe(3);
    expect(fight([bm('b', 'beetle', { health: 50 })], foes(), { runeTrophyHunter: true, flagCopies: { runeTrophyHunter: 2 } }).playerBonusGold).toBe(6);
    expect(fight([bm('b', 'beetle', { health: 50 })], foes(), {}).playerBonusGold ?? 0).toBe(0);
    const mirrored = fight(foes(), [bm('b', 'beetle', { health: 50 })], {}, { runeTrophyHunter: true });
    expect(mirrored.enemyCarry?.bonusGold).toBe(3);
  });
  it('the combat badge counts its paid kills toward the 3', () => {
    expect(runeCombatTally('rune_trophy_hunter', 0, 0, 1, 0)).toBe('0/3');
    expect(runeCombatTally('rune_trophy_hunter', 0, 0, 1, 2)).toBe('2/3');
    expect(runeCombatTally('rune_trophy_hunter', 0, 0, 1, 3)).toBe('3/3');
  });
});

describe('Last Howl', () => {
  it('the first friendly Echo Beast to die is resummoned at base stats (once per combat); a second one is not', () => {
    const p = [bm('t1', 'b2_trex', { attack: 9, health: 1 }), bm('t2', 'b2_trex', { attack: 9, health: 1 })];
    const e = [wall('w', 50)];
    const summons = (r: ReturnType<typeof fight>) => r.events.filter((x): x is Summon => x.type === 'summon' && x.side === 'player' && x.minion.cardId === 'b2_trex');
    const on = fight(p, e, { runeLastHowl: true });
    const off = fight(p, e, {});
    expect(summons(on).length).toBe(summons(off).length + 1);
    expect(summons(on).some((x) => x.minion.attack === CARD_INDEX['b2_trex']!.attack && x.minion.health === CARD_INDEX['b2_trex']!.health)).toBe(true);
    expect(triggers(on.events, 'runeLastHowl').length).toBe(1);
  });
  it('a Beast with no Echo is not resummoned', () => {
    const r = fight([bm('b', 'beetle', { health: 1 })], [wall('w', 50)], { runeLastHowl: true });
    expect(triggers(r.events, 'runeLastHowl').length).toBe(0);
  });
});

describe('Pitchforks', () => {
  it('an Imp summoned in combat deals 3 damage to 2 different enemies; the enemy side the same', () => {
    const p = [bm('k', 'dm_knocked', { attack: 0, health: 1 })];
    const e = [wall('w1', 5), wall('w2', 0), wall('w3', 0)];
    const r = fight(p, e, { runePitchforks: true });
    expect(triggers(r.events, 'runePitchforks').length).toBe(1);
    const imp = r.events.find((x): x is Summon => x.type === 'summon' && x.minion.cardId === 'impscrap')!;
    const hits = r.events.filter((x) => x.type === 'dmg' && (x as { source?: string }).source === imp.minion.uid && (x as { amount: number }).amount === 3);
    expect(new Set(hits.slice(0, 2).map((x) => (x as { target: string }).target)).size).toBe(2);
    expect(triggers(fight(p, e, {}).events, 'runePitchforks').length).toBe(0);
    const m = fight(e, p, {}, { runePitchforks: true });
    expect(triggers(m.events, 'runePitchforks', 'enemy').length).toBe(1);
  });
});

describe('Imp Legion', () => {
  it('Shop: every friendly Imp carries the Echo graft (one hit per copy); other Demons do not', () => {
    const s = withRunes(['rune_imp_legion', 'rune_imp_legion'], { board: [body('i', 'impscrap'), body('d', 'dm_knocked')] });
    for (const c of s.board) applyRuneGrafts(s, c);
    expect((s.board[0]!.grantedEffects ?? []).find((e) => e.do === 'deathrattleDamageLowestEnemy')?.params).toMatchObject({ amount: 3, hits: 2, fixed: true });
    expect((s.board[1]!.grantedEffects ?? []).some((e) => e.do === 'deathrattleDamageLowestEnemy')).toBe(false);
    expect(questCombatMods(s).runeImpLegion).toBe(true);
  });
  it('Combat: a summoned Imp dying deals 3 to the lowest-Health enemy', () => {
    const p = [bm('k', 'dm_knocked', { attack: 0, health: 1 })];
    const e = [wall('big', 5, 500), wall('low', 0, 40)];
    const r = fight(p, e, { runeImpLegion: true });
    const low = r.initial.enemy.find((m) => m.health === 40)!.uid;
    const imp = r.events.find((x): x is Summon => x.type === 'summon' && x.minion.cardId === 'impscrap')!;
    const hit = r.events.find((x) => x.type === 'dmg' && (x as { amount: number }).amount === 3 && (x as { target: string }).target === low);
    expect(imp).toBeTruthy();
    expect(hit).toBeTruthy();
    const off = fight(p, e, {});
    expect(off.events.some((x) => x.type === 'dmg' && (x as { target: string }).target === low)).toBe(false);
  });
});

describe('Ruby Dust', () => {
  it('a friendly minion with Rubies dying casts a PERMANENT Ruby on a random friendly Kobold; no Rubies, nothing', () => {
    const withRuby = bm('r', 'dw_brakka', { attack: 1, health: 1, buffs: [{ source: 'Ruby', attack: 1, health: 1 }] } as Partial<BoardMinion>);
    const kob = bm('k', 'k3_jeweler', { attack: 0, health: 500 });
    const e = [wall('w', 30)];
    const on = fight([withRuby, kob], e, { runeRubyDust: true });
    expect(triggers(on.events, 'runeRubyDust').length).toBe(1);
    expect((on.playerPermaBuffs ?? []).some((b) => b.sourceUid === 'k' && b.ruby)).toBe(true);
    const plain = fight([bm('r', 'dw_brakka', { attack: 1, health: 1 }), kob], e, { runeRubyDust: true });
    expect(triggers(plain.events, 'runeRubyDust').length).toBe(0);
  });
});

describe('the combat mods ride questCombatMods (so snapshots and opponents carry them)', () => {
  it('each combat flag is threaded; shop-only flags are not', () => {
    const s = withRunes(IDS.filter((id) => RUNE_INDEX[id]!.reward.kind === 'combatFlag'));
    const m = questCombatMods(s);
    for (const f of ['runeBloodscent', 'runeLastHowl', 'runeTrophyHunter', 'runePitchforks', 'runeImpLegion', 'runeFlamekeeper', 'runeRubyDust', 'runeRoughCut'] as const) expect(m[f], f).toBe(true);
    expect(RUBY_TYPE_IDS.length).toBeGreaterThan(0);
  });
});
