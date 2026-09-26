import { describe, it, expect } from 'vitest';
import { CARD_INDEX, EPIC_RUNES, RUNES, RUNE_INDEX, SETS, poolFor } from '@game/content';
import { BODY_COUNTING_DEATHS, COMBATATIVE_RUBIES_ATTACKS, type Tribe } from '@game/core';
import { createRun, reduce, type Action, type BoardCard, type RunState } from './index';
import { questCombatMods, runeforgePool } from './reducer';
import { castSpell, destroyMinionInShop, fireShopRally, makeContext, spellCasts, instanceEffects } from './recruit';
import { runeTally } from '../../ui/src/runeTally';

/**
 * SET 3 RUNE BATCH 3 (owner 2026-09-25), the RUN half: the roster and Runeforge gates, every Shop hook driven through
 * the real `reduce` (a rune bought through the forge, cards played / sold / cast for real), and the settle of the two
 * running meters. The combat behaviour is `packages/core/src/combat/set3RunesBatch3.test.ts`.
 */
const body = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
};
const run = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(1), setId: 'set3', phase: 'recruit', wave: 7, embers: 40, tier: 6, tribes: ['kobold', 'undead', 'dwarf', 'spirit', 'celestial'],
    pool: Object.fromEntries(poolFor('set3').buyable.map((c) => [c.id, 5])), shop: [], board: [], hand: [], ...over } as RunState);
const act = (s: RunState, a: Action): RunState => reduce(s, a) as RunState;
/** Buy `id` through the real Runeforge path. */
const buyRune = (s: RunState, id: string): RunState => act({ ...s, runeforgeOffer: [id], embers: 40 }, { type: 'buyRune', index: 0 } as Action);
const armed = (id: string, over: Partial<RunState> = {}): RunState => buyRune(run(over), id);
const play = (s: RunState, uid: string, targetUid?: string): RunState => act(s, { type: 'play', uid, toIndex: s.board.length, targetUid } as Action);
const choose = (s: RunState, index: number): RunState => act(s, { type: 'chooseOne', index } as Action);
const sell = (s: RunState, uid: string): RunState => act(s, { type: 'sell', uid } as Action);
const at = (s: RunState, uid: string): BoardCard => s.board.find((c) => c.uid === uid)!;
const count = (s: RunState, cardId: string): number => s.hand.filter((c) => c.cardId === cardId).length;
const rubyOn = (c: BoardCard): number => (c.buffs ?? []).filter((b) => b.source === 'Ruby').reduce((n, b) => n + b.attack, 0); // a merged Ruby entry already sums its attack (`count` is how many merged)
const rubiesOnBoard = (s: RunState): number => s.board.reduce((n, c) => n + rubyOn(c), 0);
/** `n` friendly Kobolds with no Ruby watchers, never three of one card (three copies would combine into a Gilded one). */
const KOBOLD_IDS = ['gemheart-shard', 'k3_korn', 'k3_veinchant', 'k3_jeweler'];
const kobolds = (n: number): BoardCard[] => Array.from({ length: n }, (_, i) => body(`k${i}`, KOBOLD_IDS[i % KOBOLD_IDS.length]!, { attack: 1, health: 20 }));
const nextTurn = (s: RunState): RunState => {
  const next = act(act(act(s, { type: 'faceOmen' } as Action), { type: 'settleCombat' } as Action), { type: 'resolveCombat' } as Action);
  expect(next.phase, 'the run came back to a shop').toBe('recruit');
  return next;
};

// ── roster ─────────────────────────────────────────────────────────────────────────────────────────────────────
const BASIC: [string, number, Tribe][] = [
  ['rune_gemmed_decisions', 3, 'kobold'], ['rune_echoing_kobolds', 3, 'kobold'], ['rune_red_storm', 4, 'kobold'], ['rune_rubywire', 4, 'kobold'],
  ['rune_choices', 3, 'kobold'], ['rune_combatative_rubies', 3, 'kobold'], ['rune_body_counting', 3, 'undead'],
];
const EPIC: [string, number, Tribe][] = [
  ['rune_storming_veins', 4, 'kobold'], ['rune_sold_choices', 5, 'kobold'], ['rune_aggressive_golems', 5, 'kobold'], ['rune_ruptured_rubies', 6, 'kobold'],
];

describe('batch 3 roster — pool, cost, Set 3 only, tribe gate', () => {
  it.each(BASIC)('%s is a BASIC rune costing %i, Set 3 only, gated %s', (id, cost, tribe) => {
    const r = RUNE_INDEX[id]!;
    expect(RUNES.some((x) => x.id === id)).toBe(true);
    expect(EPIC_RUNES.some((x) => x.id === id)).toBe(false);
    expect(r.cost).toBe(cost);
    expect(r.sets).toEqual(['set3']);
    expect(r.tribes).toEqual([tribe]);
    expect(r.text).not.toMatch(/—|--/);
  });
  it.each(EPIC)('%s is an EPIC rune costing %i, Set 3 only, gated %s', (id, cost, tribe) => {
    const r = RUNE_INDEX[id]!;
    expect(EPIC_RUNES.some((x) => x.id === id)).toBe(true);
    expect(RUNES.some((x) => x.id === id)).toBe(false);
    expect(r.epic).toBe(true);
    expect(r.cost).toBe(cost);
    expect(r.sets).toEqual(['set3']);
    expect(r.tribes).toEqual([tribe]);
    expect(r.text).not.toMatch(/—|--/);
  });
  it('the Runeforge offers each only in a Set 3 run that rolled its tribe', () => {
    const forge = (setId: 'set2' | 'set3', tribes: Tribe[], epic: boolean): string[] =>
      runeforgePool({ ...createRun(5, 'warden', 'ascent', undefined, setId), tribes, ownedRunes: [], runeforgeEpic: epic || undefined } as RunState);
    const all = [...SETS.set3.tribes] as Tribe[];
    for (const [id, , tribe] of [...BASIC, ...EPIC]) {
      const epic = EPIC.some(([x]) => x === id);
      expect(forge('set3', all, epic), `${id} offered with every Set 3 tribe`).toContain(id);
      expect(forge('set3', all.filter((t) => t !== tribe), epic), `${id} not offered without ${tribe}`).not.toContain(id);
      expect(forge('set2', ['kobold', 'dwarf', 'beast', 'dragon', 'demon'] as Tribe[], epic), `${id} is not a Set 2 rune`).not.toContain(id);
    }
  });
  it('Rune of Resonance reads Start of Turn first (owner 2026-09-25); its behaviour is unchanged', () => {
    expect(RUNE_INDEX['rune_resonance']!.text).toBe('**Start of Turn:** get a random **Ruby**. Your **Rubies** cast twice from hand.');
    const s = armed('rune_resonance');
    expect(s.runeRubyDrip).toBe(true);
    expect(s.rubyExtraCasts).toBe(1);
  });
});

// ── Gemmed Decisions ───────────────────────────────────────────────────────────────────────────────────────────
describe('Rune of Gemmed Decisions — after you play a Choose One card, get a Ruby', () => {
  it('a Choose One MINION pays one Ruby after its branch resolves', () => {
    let s = armed('rune_gemmed_decisions', { hand: [body('h', 'k3_splitpick')] });
    s = choose(play(s, 'h'), 1); // "Get a Facetwright"
    expect(count(s, 'facetwright')).toBe(1);
    expect(count(s, 'ruby')).toBe(1);
  });
  it('a Choose One SPELL pays too; a plain card does not', () => {
    let s = armed('rune_gemmed_decisions', { hand: [body('sp', 'rushorder'), body('p', 'gemheart-shard')] });
    s = choose(play(s, 'sp'), 1);
    expect(count(s, 'ruby')).toBe(1);
    s = play(s, 'p');
    expect(count(s, 'ruby'), 'a plain minion pays nothing').toBe(1);
  });
  it('two copies pay two Rubies', () => {
    let s = buyRune(armed('rune_gemmed_decisions', { hand: [body('h', 'k3_splitpick')] }), 'rune_gemmed_decisions');
    s = choose(play(s, 'h'), 1);
    expect(count(s, 'ruby')).toBe(2);
  });
});

// ── Echoing Kobolds ────────────────────────────────────────────────────────────────────────────────────────────
describe('Rune of Echoing Kobolds — your Kobolds have "Echo: get a Ruby"', () => {
  it('grafts every Kobold on the board and in hand, never a non-Kobold, and later Kobolds at the next action', () => {
    let s = armed('rune_echoing_kobolds', { board: [body('k', 'gemheart-shard'), body('n', 'sandbag')], hand: [body('hk', 'k3_korn')] });
    const echoOf = (c: BoardCard | undefined) => !!c && instanceEffects(c).some((e) => e.on === 'onDeath' && e.do === 'deathrattleGetRubies');
    expect(echoOf(at(s, 'k'))).toBe(true);
    expect(echoOf(s.hand.find((c) => c.uid === 'hk'))).toBe(true);
    expect(echoOf(at(s, 'n'))).toBe(false);
    s = { ...s, hand: [...s.hand, body('late', 'k3_splitpick')] };
    s = act(s, { type: 'roll' } as Action); // any action: the boundary sweep stamps the newcomer
    expect(echoOf(s.hand.find((c) => c.uid === 'late'))).toBe(true);
    expect(questCombatMods(s).runeEchoingKobolds, 'combat summons are grafted too').toBe(true);
  });
  it('a Kobold dying in the SHOP gets a Ruby; a Gilded Kobold still gets ONE', () => {
    const s = armed('rune_echoing_kobolds', { board: [body('k', 'gemheart-shard'), body('g', 'gemheart-shard', { golden: true, attack: 2, health: 2 })] });
    destroyMinionInShop(makeContext(s), at(s, 'k'));
    expect(count(s, 'ruby')).toBe(1);
    destroyMinionInShop(makeContext(s), at(s, 'g'));
    expect(count(s, 'ruby'), 'Gilded: one more, not two').toBe(2);
  });
  it('a duplicate raises the graft to two Rubies', () => {
    const s = buyRune(armed('rune_echoing_kobolds', { board: [body('k', 'gemheart-shard')] }), 'rune_echoing_kobolds');
    destroyMinionInShop(makeContext(s), at(s, 'k'));
    expect(count(s, 'ruby')).toBe(2);
  });
});

// ── Red Storm + Storming Veins ─────────────────────────────────────────────────────────────────────────────────
describe('Rune of the Red Storm — Veinstorms also cast a Ruby on 2 friendly Kobolds', () => {
  it('gets a Veinstorm on pickup', () => {
    expect(count(armed('rune_red_storm'), 'veinstorm')).toBe(1);
  });
  it('a Veinstorm cast from hand casts a Ruby on 2 random friendly Kobolds, never a non-Kobold', () => {
    let s = armed('rune_red_storm', { board: [...kobolds(3), body('n', 'sandbag')] });
    const vs = s.hand.find((c) => c.cardId === 'veinstorm')!;
    s = play(s, vs.uid);
    expect(rubiesOnBoard(s)).toBe(2);
    expect(rubyOn(at(s, 'n'))).toBe(0);
    expect(s.board.filter((c) => rubyOn(c) > 0)).toHaveLength(2);
  });
  it('any caster counts: a Veinstorm cast by a card or rune (not from hand) pays once', () => {
    const s = armed('rune_red_storm', { board: kobolds(3) });
    castSpell(s, CARD_INDEX['veinstorm']!);
    expect(rubiesOnBoard(s)).toBe(2);
  });
  it('with one Kobold it gets the single Ruby; with none nothing happens', () => {
    let s = armed('rune_red_storm', { board: kobolds(1) });
    castSpell(s, CARD_INDEX['veinstorm']!);
    expect(rubiesOnBoard(s)).toBe(1);
    s = armed('rune_red_storm', { board: [body('n', 'sandbag')] });
    castSpell(s, CARD_INDEX['veinstorm']!);
    expect(rubiesOnBoard(s)).toBe(0);
  });
});

describe('Rune of Storming Veins — Veinstorms cast 2 additional times from hand', () => {
  it('gets a Veinstorm; a Veinstorm from hand casts 3 times in total (the x N badge reads it)', () => {
    const s = armed('rune_storming_veins');
    expect(count(s, 'veinstorm')).toBe(1);
    expect(spellCasts(s, CARD_INDEX['veinstorm']!)).toBe(3);
    expect(spellCasts(s, CARD_INDEX['growth']!), 'other spells are untouched').toBe(1);
  });
  it('stacks with the Red Storm: three casts from hand = six Rubies; a non-hand cast still resolves once (R-MULT-06)', () => {
    let s = buyRune(armed('rune_storming_veins', { board: kobolds(7) }), 'rune_red_storm');
    const vs = s.hand.find((c) => c.cardId === 'veinstorm')!;
    s = play(s, vs.uid);
    expect(rubiesOnBoard(s)).toBe(6);
    const t = buyRune(armed('rune_storming_veins', { board: kobolds(7) }), 'rune_red_storm');
    castSpell(t, CARD_INDEX['veinstorm']!);
    expect(rubiesOnBoard(t), 'a rune / card cast is never multiplied').toBe(2);
  });
  it('two copies: 5 casts from hand', () => {
    const s = buyRune(armed('rune_storming_veins'), 'rune_storming_veins');
    expect(spellCasts(s, CARD_INDEX['veinstorm']!)).toBe(5);
  });
});

// ── Rubywire ───────────────────────────────────────────────────────────────────────────────────────────────────
describe('Rune of Rubywire — when you cast a Shop Spell, cast a Ruby on 2 friendly Kobolds (the Shop half)', () => {
  it('a Shop-pool spell from hand pays 2 Rubies on Kobolds', () => {
    let s = armed('rune_rubywire', { board: [...kobolds(3), body('n', 'sandbag')], hand: [body('sp', 'growth')] });
    s = play(s, 'sp');
    expect(rubiesOnBoard(s)).toBe(2);
    expect(rubyOn(at(s, 'n'))).toBe(0);
  });
  it('a Ruby is not a Shop spell: casting one pays only the Ruby itself', () => {
    let s = armed('rune_rubywire', { board: kobolds(3), hand: [body('r', 'ruby')] });
    s = play(s, 'r', 'k0');
    expect(rubiesOnBoard(s)).toBe(1);
  });
  it('a non-hand Shop-spell cast counts too (any source)', () => {
    const s = armed('rune_rubywire', { board: kobolds(3) });
    castSpell(s, CARD_INDEX['growth']!);
    expect(rubiesOnBoard(s)).toBe(2);
  });
});

// ── Choices ────────────────────────────────────────────────────────────────────────────────────────────────────
describe('Rune of Choices — your first Choose One card each turn gains both effects', () => {
  it('the first Choose One this turn resolves both branches with no prompt; the second prompts', () => {
    let s = armed('rune_choices', { hand: [body('a', 'k3_splitpick'), body('b', 'k3_splitpick')] });
    expect(s.chooseBothCharges).toBe(1);
    s = play(s, 'a');
    expect(s.chooseOne, 'no prompt').toBeUndefined();
    expect(count(s, 'ruby')).toBe(3);
    expect(count(s, 'facetwright')).toBe(1);
    expect(at(s, 'a').chosenBoth).toBe(true);
    s = play(s, 'b');
    expect(s.chooseOne?.uid, 'the second one asks').toBe('b');
  });
  it('re-arms every turn, one charge per copy held', () => {
    let s = armed('rune_choices', { board: [body('k', 'sandbag', { attack: 50, health: 50 })] });
    s = { ...s, chooseBothCharges: 0 };
    s = nextTurn(s);
    expect(s.chooseBothCharges).toBe(1);
    s = nextTurn(buyRune(s, 'rune_choices'));
    expect(s.chooseBothCharges).toBe(2);
  });
});

// ── Sold Choices ───────────────────────────────────────────────────────────────────────────────────────────────
describe('Rune of Sold Choices — selling repeats the option chosen when played', () => {
  it('repeats the CHOSEN branch only', () => {
    let s = armed('rune_sold_choices', { hand: [body('a', 'k3_splitpick'), body('b', 'k3_splitpick')] });
    s = choose(play(s, 'a'), 0); // 3 Rubies
    expect(count(s, 'ruby')).toBe(3);
    s = sell(s, 'a');
    expect(count(s, 'ruby'), 'the sale repeated "Get 3 Rubies"').toBe(6);
    expect(count(s, 'facetwright')).toBe(0);
    s = choose(play(s, 'b'), 1); // a Facetwright
    s = sell(s, 'b');
    expect(count(s, 'facetwright'), 'played + sold').toBe(2);
    expect(count(s, 'ruby')).toBe(6);
  });
  it('a Gilded body repeats its gilded branch; a body that resolved BOTH repeats both', () => {
    let s = armed('rune_sold_choices', { board: [body('g', 'k3_splitpick', { golden: true, attack: 6, health: 6, chosenOption: 0 })] });
    s = sell(s, 'g');
    expect(count(s, 'ruby'), 'Gilded "Get 6 Rubies"').toBe(6);
    let t = buyRune(armed('rune_sold_choices', { hand: [body('a', 'k3_splitpick')] }), 'rune_choices');
    t = play(t, 'a');
    t = sell(t, 'a');
    expect(count(t, 'ruby')).toBe(6);
    expect(count(t, 'facetwright')).toBe(2);
  });
  it('a Choose One body that never chose (summoned or Discovered onto the board) does nothing when sold', () => {
    let s = armed('rune_sold_choices', { board: [body('x', 'k3_splitpick')] });
    s = sell(s, 'x');
    expect(count(s, 'ruby')).toBe(0);
    expect(count(s, 'facetwright')).toBe(0);
  });
  it('without the rune a sale repeats nothing', () => {
    let s = run({ board: [body('g', 'k3_splitpick', { chosenOption: 0 })] });
    s = sell(s, 'g');
    expect(count(s, 'ruby')).toBe(0);
  });
});

// ── Aggressive Golems ──────────────────────────────────────────────────────────────────────────────────────────
describe('Rune of Aggressive Golems — Gemheart Golems gain the Rally', () => {
  it('grafts every Golem (Rally keyword + the effect) and the combat mods carry the flag', () => {
    const s = armed('rune_aggressive_golems', { board: [body('g', 'gemheart-shard'), body('k', 'k3_korn')] });
    expect(at(s, 'g').keywords).toContain('RL');
    expect(instanceEffects(at(s, 'g')).some((e) => e.do === 'rallyGiveAttackToRight')).toBe(true);
    expect(instanceEffects(at(s, 'k')).some((e) => e.do === 'rallyGiveAttackToRight'), 'only Golems').toBe(false);
    expect(questCombatMods(s).runeAggressiveGolems).toBe(true);
  });
  it('a Shop Rally replay gives the Golem\'s Attack to the minion on its right, permanently', () => {
    const s = armed('rune_aggressive_golems', { board: [body('g', 'gemheart-shard', { attack: 4, health: 4 }), body('n', 'sandbag', { attack: 1, health: 5 })] });
    fireShopRally(s, at(s, 'g'));
    expect(at(s, 'n').attack).toBe(5);
  });
});

// ── the running meters: Combatative Rubies + Body Counting ─────────────────────────────────────────────────────
describe('Rune of Combatative Rubies — the running attack meter', () => {
  it('rides into combat with its carried tick and settles by the fight\'s attacks; the badge prints the countdown', () => {
    let s = armed('rune_combatative_rubies', { board: [...kobolds(2), body('n', 'sandbag', { attack: 3, health: 30 })] });
    expect(runeTally(s, 'rune_combatative_rubies')).toBe(`0/${COMBATATIVE_RUBIES_ATTACKS}`);
    s = { ...s, runeCombatativeTick: 1 };
    expect(questCombatMods(s).runeCombatativeTick).toBe(1);
    s = nextTurn(s);
    const attacks = s.lastCombat?.playerQuestTally?.attack ?? 0;
    expect(s.runeCombatativeTick).toBe((1 + attacks) % COMBATATIVE_RUBIES_ATTACKS);
    expect(runeTally(s, 'rune_combatative_rubies')).toBe(`${s.runeCombatativeTick}/${COMBATATIVE_RUBIES_ATTACKS}`);
  });
});

describe('Rune of Body Counting — the running death meter (Shop + combat)', () => {
  it('every 8th Shop death gets a random Undead at or below the tier; a SALE is not a death', () => {
    let s = armed('rune_body_counting', { tier: 3, board: [body('x', 'sandbag')] });
    s = sell(s, 'x');
    expect(s.runeBodyCountTick ?? 0, 'a sale does not tick').toBe(0);
    for (let i = 0; i < BODY_COUNTING_DEATHS - 1; i++) {
      s.board.push(body(`d${i}`, 'sandbag'));
      destroyMinionInShop(makeContext(s), at(s, `d${i}`));
    }
    expect(s.runeBodyCountTick).toBe(BODY_COUNTING_DEATHS - 1);
    expect(runeTally(s, 'rune_body_counting')).toBe(`${BODY_COUNTING_DEATHS - 1}/${BODY_COUNTING_DEATHS}`);
    const before = s.hand.length;
    s.board.push(body('last', 'sandbag'));
    destroyMinionInShop(makeContext(s), at(s, 'last'));
    expect(s.hand.length).toBe(before + 1);
    const got = CARD_INDEX[s.hand[s.hand.length - 1]!.cardId]!;
    expect(got.tribe === 'undead' || got.tribe2 === 'undead' || !!got.universalTribe, `${got.id} is Undead`).toBe(true);
    expect(got.tier).toBeLessThanOrEqual(3);
    expect(s.runeBodyCountTick).toBe(0);
  });
  it('rides into combat with its carried tick and settles by the fight\'s friendly deaths', () => {
    let s = armed('rune_body_counting', { board: [body('a', 'sandbag', { attack: 1, health: 1 }), body('b', 'sandbag', { attack: 1, health: 1 })] });
    s = { ...s, runeBodyCountTick: 3 };
    expect(questCombatMods(s).runeBodyCountTick).toBe(3);
    s = nextTurn(s);
    expect(s.runeBodyCountTick).toBe((3 + (s.lastCombat?.playerDeaths ?? 0)) % BODY_COUNTING_DEATHS);
  });
});

// ── Ruptured Rubies: the Shop is unaffected ────────────────────────────────────────────────────────────────────
describe('Rune of Ruptured Rubies — Shop casts are unaffected', () => {
  it('a Ruby played in the Shop lands on its target only', () => {
    let s = armed('rune_ruptured_rubies', { board: kobolds(3), hand: [body('r', 'ruby')] });
    expect(questCombatMods(s).runeRupturedRubies).toBe(true);
    s = play(s, 'r', 'k1');
    expect(rubyOn(at(s, 'k1'))).toBe(1);
    expect(rubyOn(at(s, 'k0')) + rubyOn(at(s, 'k2'))).toBe(0);
  });
});
