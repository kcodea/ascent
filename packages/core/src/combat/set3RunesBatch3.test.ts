import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type CardDef, type CombatEvent, type EffectDef } from '../index';
import { CARD_INDEX } from '@game/content';

/**
 * SET 3 RUNE BATCH 3 (owner 2026-09-25), the COMBAT half. Every fight is a real `simulate()`; the run half (the
 * forge, the Shop hooks, the settle of the running meters) is `packages/sim/src/set3RunesBatch3.test.ts`.
 *
 *   · Rune of Echoing Kobolds: the "Echo: get a Ruby" graft fires in combat (a board body carries it from the Shop,
 *     a combat SUMMON is grafted on arrival), one Ruby per copy, a Gilded Kobold still ONE.
 *   · Rune of Rubywire: a Shop-pool spell cast in combat casts a Ruby on 2 friendly Kobolds.
 *   · Rune of Combatative Rubies: every 3rd friendly attack, counted from the carried tick, casts a PERMANENT Ruby on
 *     2 friendly Kobolds.
 *   · Rune of Body Counting: every 8th friendly death, counted from the carried tick, gets a random Undead.
 *   · Rune of Aggressive Golems: a Gemheart Golem's Rally gives its Attack to the minion to its right.
 *   · Rune of Ruptured Rubies: every combat Ruby bounces twice after landing.
 */
const CASTER: CardDef = {
  id: 'b3_caster', name: 'Growth Caster', tribe: 'neutral', tier: 1, attack: 1, health: 300, keywords: ['RL'],
  effects: [{ on: 'onAttack', do: 'rallyCastNamedSpell', params: { spellId: 'growth' } }],
  text: '**Rally:** cast **Growth**.',
};
const CARDS: Record<string, CardDef> = { ...CARD_INDEX, [CASTER.id]: CASTER };
const ECHO_GRAFT: EffectDef = { on: 'onDeath', do: 'deathrattleGetRubies', params: { count: 1, fixed: true } };
const RALLY_GRAFT: EffectDef = { on: 'onAttack', do: 'rallyGiveAttackToRight', params: {} };

const bm = (uid: string, cardId: string, attack: number, health: number, over: Partial<BoardMinion> & { grantedEffects?: EffectDef[] } = {}): BoardMinion =>
  ({ uid, sourceUid: uid, cardId, attack, health, keywords: [...(CARDS[cardId]!.keywords)], ...over } as unknown as BoardMinion);
const foe = (uid: string, attack: number, health: number): BoardMinion => bm(uid, 'sandbag', attack, health);
const fight = (mine: BoardMinion[], theirs: BoardMinion[], mods: object = {}, extra: object = {}, seed = 11) =>
  simulate(mine, theirs, makeRng(seed), CARDS,
    combatSide({ tier: 6, tribes: ['kobold', 'undead', 'dwarf', 'spirit', 'celestial'], questMods: mods, ...extra }),
    combatSide({ tier: 6 }));

type Buff = Extract<CombatEvent, { type: 'buff' }>;
const buffs = (evs: readonly CombatEvent[]): Buff[] => evs.filter((e): e is Buff => e.type === 'buff');
const rubyBuffs = (evs: readonly CombatEvent[]): Buff[] => buffs(evs).filter((e) => e.ruby);
const triggers = (evs: readonly CombatEvent[], flag: string) => evs.filter((e) => e.type === 'questTrigger' && e.flag === flag);
const attacksBy = (evs: readonly CombatEvent[], uids: readonly string[]) => evs.filter((e) => e.type === 'attack' && uids.includes(e.attacker));
/** The combat uid of the player's board body at `index` (the fight re-uids every body; board order is kept). */
const combatUid = (r: ReturnType<typeof fight>, index: number): string => r.initial.player[index]!.uid;
/** The events BEFORE the player's first death — a long fight's escalating damage eventually kills the durable
 *  bodies, after which a hop / a right neighbour genuinely has nowhere to go. */
const beforeFirstDeath = (evs: readonly CombatEvent[]): readonly CombatEvent[] => {
  const i = evs.findIndex((e) => e.type === 'death' && e.side === 'player');
  return i < 0 ? evs : evs.slice(0, i);
};

describe('Rune of Echoing Kobolds — combat', () => {
  it('a board Kobold carrying the Shop graft gets a Ruby when it dies; a Gilded one still gets ONE (the rune-granted Echo does not double)', () => {
    const plain = fight([bm('k', 'gemheart-shard', 1, 1, { grantedEffects: [ECHO_GRAFT] })], [foe('f', 10, 100)], { runeEchoingKobolds: true });
    expect(plain.playerRubyGrants).toBe(1);
    const gilded = fight([bm('k', 'gemheart-shard', 2, 2, { golden: true, grantedEffects: [ECHO_GRAFT] })], [foe('f', 10, 100)], { runeEchoingKobolds: true });
    expect(gilded.playerRubyGrants, 'Gilded: the same single Ruby').toBe(1);
  });

  it('a Kobold SUMMONED mid-fight is grafted on arrival (Rune of the Gem Golem\'s Golem), so its death pays too', () => {
    const board = [bm('k', 'gemheart-shard', 1, 1, { grantedEffects: [ECHO_GRAFT] }), bm('x', 'k3_korn', 1, 1)];
    const without = fight(board, [foe('f', 20, 200)], { runeGemGolem: true });
    const withRune = fight(board, [foe('f', 20, 200)], { runeGemGolem: true, runeEchoingKobolds: true });
    const golems = withRune.events.filter((e) => e.type === 'summon' && e.side === 'player' && e.minion.cardId === 'gemheart-shard').length;
    expect(golems, 'the Gem Golem rune summoned Golems').toBeGreaterThan(0);
    // Without the rune flag only the pre-grafted board body pays; with it every summoned Golem (and the un-grafted
    // board Kobold's own summon) is a Kobold carrying the Echo too.
    expect(without.playerRubyGrants).toBe(1);
    expect(withRune.playerRubyGrants).toBe(1 + golems);
  });

  it('the count follows the copies held (the graft\'s `count`, and flagCopies for a combat summon)', () => {
    const r = fight([bm('k', 'gemheart-shard', 1, 1, { grantedEffects: [{ ...ECHO_GRAFT, params: { count: 2, fixed: true } }] })], [foe('f', 10, 100)], { runeEchoingKobolds: true, flagCopies: { runeEchoingKobolds: 2 } });
    expect(r.playerRubyGrants).toBe(2);
  });
});

describe('Rune of Rubywire — combat', () => {
  const board = () => [bm('c', 'b3_caster', 1, 300), bm('k1', 'gemheart-shard', 1, 300), bm('k2', 'gemheart-shard', 1, 300), bm('k3', 'gemheart-shard', 1, 300), bm('n', 'sandbag', 0, 300)];
  it('each Shop-pool spell cast in combat casts a Ruby on 2 random friendly Kobolds, never a non-Kobold', () => {
    const r = fight(board(), [foe('f', 1, 400)], { runeRubywire: true }, { poolIds: ['growth'] });
    const casts = r.events.filter((e) => e.type === 'spellcast' && e.side === 'player').length;
    expect(casts, 'the probe cast Growth').toBeGreaterThan(0);
    const kobolds = [1, 2, 3].map((i) => combatUid(r, i));
    const rubies = rubyBuffs(r.events).filter((e) => !e.bounce);
    expect(rubies.length, 'two Rubies per Shop spell').toBe(2 * casts);
    for (const e of rubies) expect(kobolds, 'only Kobolds receive them').toContain(e.target);
    expect(triggers(r.events, 'runeRubywire')).toHaveLength(casts);
  });
  it('a spell outside the Shop pool (not in the side\'s pool) does not trigger it', () => {
    const r = fight(board(), [foe('f', 1, 400)], { runeRubywire: true }, { poolIds: ['sandbag'] });
    expect(rubyBuffs(r.events)).toHaveLength(0);
    expect(triggers(r.events, 'runeRubywire')).toHaveLength(0);
  });
});

describe('Rune of Combatative Rubies — combat', () => {
  const board = () => [bm('k1', 'gemheart-shard', 1, 300), bm('k2', 'gemheart-shard', 1, 300), bm('n', 'sandbag', 1, 300)];
  it('every 3rd friendly attack (from the carried tick) casts a PERMANENT Ruby on 2 friendly Kobolds', () => {
    const r = fight(board(), [foe('f', 1, 2000)], { runeCombatativeRubies: true, runeCombatativeTick: 2 });
    const mine = r.initial.player.map((m) => m.uid);
    const attacks = attacksBy(r.events, mine).length;
    expect(attacks).toBeGreaterThan(3);
    const trips = Math.floor((2 + attacks) / 3);
    expect(triggers(r.events, 'runeCombatativeRubies'), 'one trip per 3 attacks, the first on the FIRST attack (tick 2 carried in)').toHaveLength(trips);
    expect(rubyBuffs(r.events).length).toBe(2 * trips);
    const perma = (r.playerPermaBuffs ?? []).filter((p) => p.ruby);
    expect(perma.reduce((n, p) => n + p.attack, 0), 'the Rubies carry back').toBe(2 * trips);
    expect(r.playerQuestTally?.attack, 'settle advances the run meter by this same count').toBe(attacks);
  });
  it('a fresh meter (tick 0) waits for the 3rd attack', () => {
    const r = fight(board(), [foe('f', 1, 2000)], { runeCombatativeRubies: true, runeCombatativeTick: 0 });
    const first = r.events.findIndex((e) => e.type === 'questTrigger' && e.flag === 'runeCombatativeRubies');
    const attacksBefore = attacksBy(r.events.slice(0, first), r.initial.player.map((m) => m.uid)).length;
    expect(attacksBefore).toBe(3);
  });
});

describe('Rune of Body Counting — combat', () => {
  it('the 8th friendly death (counting the carried tick) gets a random Undead at or below the tier', () => {
    const r = fight([bm('a', 'sandbag', 1, 1), bm('b', 'sandbag', 1, 1)], [foe('f', 50, 500)], { runeBodyCounting: true, runeBodyCountTick: 7 }, { tier: 3 });
    expect(triggers(r.events, 'runeBodyCounting')).toHaveLength(1);
    const grants = r.playerHandGrants ?? [];
    expect(grants).toHaveLength(1);
    const d = CARD_INDEX[grants[0]!]!;
    expect(d.tribe === 'undead' || d.tribe2 === 'undead' || !!d.universalTribe, `${d.id} is Undead`).toBe(true);
    expect(d.tier).toBeLessThanOrEqual(3);
    expect(r.playerDeaths).toBe(2);
  });
  it('below the threshold nothing is paid; the rune is not an Avenge (Rune of Fury does not double it)', () => {
    const r = fight([bm('a', 'sandbag', 1, 1), bm('b', 'sandbag', 1, 1)], [foe('f', 50, 500)], { runeBodyCounting: true, runeBodyCountTick: 5 });
    expect(r.playerHandGrants ?? []).toHaveLength(0);
    const fury = fight([bm('a', 'sandbag', 1, 1), bm('b', 'sandbag', 1, 1)], [foe('f', 50, 500)], { runeBodyCounting: true, runeBodyCountTick: 7, runeFury: true });
    expect(fury.playerHandGrants ?? []).toHaveLength(1);
  });
});

describe('Rune of Aggressive Golems — combat', () => {
  it('a Golem carrying the Rally gives its CURRENT Attack to the minion on its right when it attacks', () => {
    const r = fight([bm('g', 'gemheart-shard', 5, 300, { keywords: ['RL'], grantedEffects: [RALLY_GRAFT] }), bm('n', 'sandbag', 0, 300)], [foe('f', 1, 900)], { runeAggressiveGolems: true });
    const g = combatUid(r, 0), n = combatUid(r, 1);
    const early = beforeFirstDeath(r.events);
    const swings = attacksBy(early, [g]).length;
    expect(swings).toBeGreaterThan(0);
    const gifts = buffs(early).filter((e) => e.target === n && e.source === g);
    expect(gifts.length, 'one gift per Golem attack').toBe(swings);
    for (const e of gifts) expect([e.attack, e.health]).toEqual([5, 0]);
  });
  it('the right-most Golem has no one to its right: nothing happens', () => {
    const r = fight([bm('n', 'sandbag', 0, 300), bm('g', 'gemheart-shard', 5, 300, { keywords: ['RL'], grantedEffects: [RALLY_GRAFT] })], [foe('f', 1, 900)], { runeAggressiveGolems: true });
    expect(buffs(r.events).filter((e) => e.source === combatUid(r, 1))).toHaveLength(0);
  });
  it('a Golem SUMMONED mid-fight is grafted with the Rally on arrival', () => {
    // Rune of the Gem Golem: the dying Kobold summons a Golem, which (with the rune) can Rally.
    const r = fight([bm('k', 'k3_korn', 1, 1), bm('n', 'sandbag', 0, 400)], [foe('f', 1, 900)], { runeGemGolem: true, runeAggressiveGolems: true });
    const golem = r.events.find((e) => e.type === 'summon' && e.side === 'player' && e.minion.cardId === 'gemheart-shard');
    expect(golem, 'the Gem Golem rune summoned one').toBeDefined();
    const m = (golem as Extract<CombatEvent, { type: 'summon' }>).minion;
    expect(m.keywords).toContain('RL');
  });
});

describe('Rune of Ruptured Rubies — combat', () => {
  it('every combat Ruby bounces twice to OTHER friendly minions after it lands, carrying its stats', () => {
    // Korn: "Rally: cast a permanent Ruby on this" — one Ruby per swing.
    const board = () => [bm('k', 'k3_korn', 2, 300), bm('a', 'sandbag', 0, 300), bm('b', 'sandbag', 0, 300)];
    const base = fight(board(), [foe('f', 1, 900)], {});
    const r = fight(board(), [foe('f', 1, 900)], { runeRupturedRubies: true });
    const k = combatUid(r, 0);
    const early = beforeFirstDeath(r.events);
    const swings = attacksBy(early, [k]).length;
    expect(swings).toBeGreaterThan(0);
    const landings = rubyBuffs(early).filter((e) => !e.bounce);
    const hops = rubyBuffs(early).filter((e) => e.bounce);
    expect(landings.length).toBe(swings);
    expect(hops.length, 'two hops per Ruby').toBe(2 * swings);
    for (const h of hops) { expect(h.target).not.toBe(k); expect(h.bounce!.from).toBe(k); }
    expect(rubyBuffs(base.events).filter((e) => e.bounce), 'no rune, no hop').toHaveLength(0);
    expect(triggers(early, 'runeRupturedRubies').length).toBe(swings);
  });
  it('two copies hop four times; a lone minion has nowhere to hop', () => {
    const two = fight([bm('k', 'k3_korn', 2, 300), bm('a', 'sandbag', 0, 300)], [foe('f', 1, 900)], { runeRupturedRubies: true, flagCopies: { runeRupturedRubies: 2 } });
    const k = combatUid(two, 0);
    const early = beforeFirstDeath(two.events);
    expect(rubyBuffs(early).filter((e) => e.bounce).length).toBe(4 * attacksBy(early, [k]).length);
    const alone = fight([bm('k', 'k3_korn', 2, 300)], [foe('f', 1, 900)], { runeRupturedRubies: true });
    expect(rubyBuffs(alone.events).filter((e) => e.bounce)).toHaveLength(0);
  });
  it('is deterministic', () => {
    const board = () => [bm('k', 'k3_korn', 2, 300), bm('a', 'sandbag', 0, 300), bm('b', 'sandbag', 0, 300)];
    expect(JSON.stringify(fight(board(), [foe('f', 1, 900)], { runeRupturedRubies: true }).events))
      .toBe(JSON.stringify(fight(board(), [foe('f', 1, 900)], { runeRupturedRubies: true }).events));
  });
});
