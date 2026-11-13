import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatEvent, type QuestCombatMods } from '@game/core';
import { CARD_INDEX, EPIC_RUNES, RUNES, RUNE_INDEX, RUNE_DUP_SWEETENER } from '@game/content';
import { createRun, reduce, type Action, type BoardCard, type BoardSnapshot, type RunState } from './index';
import { offerBuyPrice, questCombatMods } from './reducer';
import { queueDiscover, socRuneReplaysOf } from './recruit';

/**
 * SET 2 RUNE BATCH, EPIC NEUTRAL (owner 2026-11-12, docs/design/2026-11-12-set2-rune-batch.md):
 *
 *  - Top Shelf:    "Every Refresh offers 1 minion from the Tier above your Shop."                     (R-SET2RUNE-EN-01)
 *  - Double Bill:  "Start of Combat: trigger your left-most and right-most Shouts." (was "Opening Act") (R-SET2RUNE-EN-02)
 *  - Bulwark Line: "Start of Combat: give your Taunt minions Ward."                                    (R-SET2RUNE-EN-02)
 *  - Wholesale:    "Minions in the Shop cost 1 less."                                                  (R-SET2RUNE-EN-01)
 *  - Grudge:       "After you lose a combat, Discover a minion from the Tier above your Shop. (Up to Tier 7.)" (R-SET2RUNE-EN-01)
 *  - Bastion:      "The first minion of yours to lose Ward each combat gains Ward."                    (R-SET2RUNE-EN-03)
 *  - Mirror Sheen: "When a minion of yours loses Ward, it deals damage equal to its Attack to a random enemy." (R-SET2RUNE-EN-03)
 */

const IDS = ['rune_top_shelf', 'rune_double_bill', 'rune_bulwark_line', 'rune_wholesale', 'rune_grudge', 'rune_bastion', 'rune_mirror_sheen'];
const FLAGS = {
  rune_top_shelf: 'runeTopShelf', rune_double_bill: 'runeDoubleBill', rune_bulwark_line: 'runeBulwarkLine', rune_wholesale: 'runeWholesale',
  rune_grudge: 'runeGrudge', rune_bastion: 'runeBastion', rune_mirror_sheen: 'runeMirrorSheen',
} as const;

const act = (s: RunState, a: Action): RunState => reduce(s, a) as RunState;
const bc = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
};
/** A Set 2 recruit run, holding the rune through the REAL Runeforge buy path. */
function withRune(id: string | null, extra: Partial<RunState> = {}, copies = 1): RunState {
  let s = {
    ...createRun(7, 'warden', 'ascent', undefined, 'set2'),
    wave: 5, tier: 3, phase: 'recruit', embers: 40, hand: [], board: [], ...extra,
  } as RunState;
  if (!id) return s;
  for (let k = 0; k < copies; k++) s = act({ ...s, embers: 40, runeforgeOffer: [id], runeforgeEpic: true } as RunState, { type: 'buyRune', index: 0 });
  return { ...s, embers: 40, discover: undefined, discoverQueue: undefined };
}

const m = (cardId: string, over: Partial<BoardMinion> = {}): BoardMinion =>
  ({ cardId, attack: CARD_INDEX[cardId]!.attack, health: CARD_INDEX[cardId]!.health, keywords: [...CARD_INDEX[cardId]!.keywords], ...over } as unknown as BoardMinion);
const wall = (attack = 1, health = 5000): BoardMinion[] => [{ cardId: 'sandbag', attack, health, keywords: [] } as unknown as BoardMinion];
/** `mods` on the player side; `mirror` puts them on the ENEMY side instead (symmetry). */
const fight = (p: BoardMinion[], mods: QuestCombatMods, foe: BoardMinion[] = wall(), seed = 5, mirror = false) =>
  mirror
    ? simulate(foe, p, makeRng(seed), CARD_INDEX, combatSide({ tier: 6 }), combatSide({ tier: 6, questMods: mods }))
    : simulate(p, foe, makeRng(seed), CARD_INDEX, combatSide({ tier: 6, questMods: mods }), combatSide({ tier: 6 }));
type Ev<T extends CombatEvent['type']> = Extract<CombatEvent, { type: T }>;
const of = <T extends CombatEvent['type']>(events: readonly CombatEvent[], t: T): Ev<T>[] => events.filter((e): e is Ev<T> => e.type === t);
const triggers = (events: readonly CombatEvent[], flag: string) => of(events, 'questTrigger').filter((e) => e.flag === flag);

describe('the roster', () => {
  it('seven Epic neutral runes, Set 2 only, the doc costs and texts, Opening Act renamed Double Bill', () => {
    const want: Record<string, [string, number]> = {
      rune_top_shelf: ['Top Shelf', 3], rune_double_bill: ['Double Bill', 4], rune_bulwark_line: ['Bulwark Line', 3],
      rune_wholesale: ['Wholesale', 4], rune_grudge: ['Grudge', 3], rune_bastion: ['Bastion', 4], rune_mirror_sheen: ['Mirror Sheen', 3],
    };
    for (const id of IDS) {
      const r = RUNE_INDEX[id]!;
      expect(EPIC_RUNES.includes(r), id).toBe(true);
      expect(RUNES.includes(r)).toBe(false);
      expect(r.epic).toBe(true);
      expect([r.name, r.cost]).toEqual(want[id]);
      expect(r.sets).toEqual(['set2']);
      expect(r.tribes).toBeUndefined();
      expect(/—|--|Oath|climb/i.test(r.text), r.text).toBe(false);
    }
    expect([...RUNES, ...EPIC_RUNES].some((r) => r.name === 'Opening Act')).toBe(false);
    expect(RUNE_INDEX['rune_double_bill']!.text).toBe('**Start of Combat:** trigger your left-most and right-most **Shouts**.');
    expect(RUNE_DUP_SWEETENER.has('rune_bulwark_line')).toBe(true);
  });

  it('buying each rune arms its run flag; the four combat runes reach the combat mods (snapshots build from the same mods)', () => {
    for (const id of IDS) {
      const flag = FLAGS[id as keyof typeof FLAGS];
      const s = withRune(id);
      expect(s.questFlags?.[flag], id).toBe(true);
    }
    for (const id of ['rune_double_bill', 'rune_bulwark_line', 'rune_bastion', 'rune_mirror_sheen'] as const) {
      expect(questCombatMods(withRune(id))[FLAGS[id]], id).toBe(true);
    }
  });
});

describe('R-SET2RUNE-EN-01: Top Shelf', () => {
  const above = (s: RunState) => s.shop.filter((o) => !CARD_INDEX[o.cardId]!.spell && CARD_INDEX[o.cardId]!.tier === s.tier + 1);
  it('every Refresh offers one minion from the Tier above, and the Shop never grows', () => {
    let s = withRune('rune_top_shelf');
    for (let i = 0; i < 4; i++) {
      const before = s.shop.length;
      s = act({ ...s, embers: 40 }, { type: 'roll' });
      expect(above(s), `refresh ${i}`).toHaveLength(1);
      expect(above(s)[0]!.contraband).toBe(true);
      expect(s.shop.length).toBeLessThanOrEqual(Math.max(before, s.shop.length));
    }
    expect(s.runeProcs?.['rune_top_shelf']).toBe(4);
  });

  it('without the rune a Refresh never offers the Tier above', () => {
    let s = withRune(null);
    for (let i = 0; i < 4; i++) { s = act({ ...s, embers: 40 }, { type: 'roll' }); expect(above(s)).toHaveLength(0); }
  });

  it('two copies: two offers from the Tier above', () => {
    const s = act(withRune('rune_top_shelf', {}, 2), { type: 'roll' });
    expect(above(s)).toHaveLength(2);
  });

  it('at the top Tier it does nothing (owner ruling 2026-11-12)', () => {
    const s0 = withRune('rune_top_shelf', { tier: 6 });
    const s = act(s0, { type: 'roll' });
    expect(s.shop.some((o) => CARD_INDEX[o.cardId]!.tier > 6)).toBe(false);
    expect(s.runeProcs?.['rune_top_shelf'] ?? 0).toBe(0);
  });

  it('deterministic: the same seed draws the same offer', () => {
    const a = act(withRune('rune_top_shelf'), { type: 'roll' });
    const b = act(withRune('rune_top_shelf'), { type: 'roll' });
    expect(a.shop.map((o) => o.cardId)).toEqual(b.shop.map((o) => o.cardId));
  });
});

describe('R-SET2RUNE-EN-01: Wholesale', () => {
  it('Shop minions cost 1 less (2 copies: 2 less), spells are untouched, and the buy charges the shown price', () => {
    const plain = withRune(null);
    const s = withRune('rune_wholesale');
    const minion = s.shop.find((o) => !CARD_INDEX[o.cardId]!.spell)!;
    const base = offerBuyPrice(plain, minion).cost;
    expect(offerBuyPrice(s, minion).cost).toBe(base - 1);
    expect(offerBuyPrice(withRune('rune_wholesale', {}, 2), minion).cost).toBe(base - 2);
    const spell = Object.values(CARD_INDEX).find((c) => c.spell && !c.ruby && c.tier === 1)!;
    expect(offerBuyPrice(s, { cardId: spell.id }).cost).toBe(offerBuyPrice(plain, { cardId: spell.id }).cost);
    const after = act({ ...s, embers: 10 }, { type: 'buy', uid: minion.uid } as Action);
    expect(after.embers).toBe(10 - (base - 1));
  });

  it('floors at 0', () => {
    const s = withRune('rune_wholesale', {}, 2);
    expect(offerBuyPrice(s, { cardId: s.shop.find((o) => !CARD_INDEX[o.cardId]!.spell)!.cardId, cost: 1 }).cost).toBe(0);
  });
});

describe('R-SET2RUNE-EN-01: Grudge', () => {
  /** Fight a served board and settle into the next Shop. `lose`: an empty-ish board against a wall that hits back. */
  function settle(runes: string[], lose: boolean, tier = 3): RunState {
    let s = withRune(null, { tier, embers: 0, board: lose ? [bc('a', 'sandbag', { attack: 0, health: 1 })] : [bc('a', 'sandbag', { attack: 50, health: 50 })] });
    for (const id of runes) s = act(s, { type: 'devGrant', kind: 'rune', id } as Action);
    s = { ...s, discover: undefined, discoverQueue: undefined, hand: [] };
    const foes: BoardSnapshot = { v: 1, wave: s.wave, heroId: 'indy', resolve: 30, tier: 1, triples: 0, tribes: [], threat: 'glass', power: 1,
      minions: [{ cardId: 'sandbag', attack: lose ? 5 : 0, health: lose ? 500 : 1, keywords: [] }], seed: 1, origin: 'self' };
    s = act({ ...s, servedBoards: { [s.wave]: foes } }, { type: 'faceOmen' });
    expect(s.lastCombat?.result).toBe(lose ? 'lose' : 'win');
    return act(s, { type: 'resolveCombat' });
  }

  /** The Grudge Discover: open, or queued behind a higher Start-of-Turn modal (the Runeforge), as minion specs. */
  const grudgeTiers = (s: RunState): number[] => {
    if (s.discover) return s.discover.map((id) => CARD_INDEX[id]!.tier);
    return (s.discoverQueue ?? []).map((q) => (q.kind === 'minion' ? q.exactTier ?? -1 : -1));
  };

  it('after a LOST combat the next Shop opens a Discover from the Tier above, on its own Start of Turn beat', () => {
    const s = settle(['rune_grudge'], true);
    expect(s.phase).toBe('recruit');
    const tiers = grudgeTiers(s);
    expect(tiers.length).toBeGreaterThan(0);
    for (const t of tiers) expect(t).toBe(s.tier + 1);
    expect((s.sotBeatFx ?? []).some((b) => b.source.kind === 'rune' && 'id' in b.source && b.source.id === 'rune_grudge')).toBe(true);
    expect(s.runeProcs?.['rune_grudge'] ?? s.sotRuneProcs?.['rune_grudge']).toBe(1);
  });

  it('a win opens nothing; no rune opens nothing', () => {
    expect(grudgeTiers(settle(['rune_grudge'], false))).toEqual([]);
    expect(grudgeTiers(settle([], true))).toEqual([]);
  });

  it('capped at Tier 7: a Tier 6 Shop Discovers Tier 7, and that offer really opens (Set 2 has Tier 7 minions)', () => {
    const s = settle(['rune_grudge'], true, 6);
    const tiers = grudgeTiers(s);
    expect(tiers.length).toBeGreaterThan(0);
    for (const t of tiers) expect(t).toBe(7);
    // The spec it queues really opens in a Set 2 run with no Tier 7 access (Set 2 has Tier 7 minions).
    const probe = withRune(null, { tier: 6, discover: undefined, discoverQueue: undefined });
    queueDiscover(probe, (s.discoverQueue ?? [])[0] ?? { kind: 'minion', tier: 7, exactTier: 7 });
    expect(probe.discover?.length).toBeGreaterThan(0);
    for (const id of probe.discover!) expect(CARD_INDEX[id]!.tier).toBe(7);
  });
});

describe('R-SET2RUNE-EN-02: Double Bill', () => {
  const board = () => [m('d2_broodfire', { health: 100 }), m('sandbag', { attack: 0, health: 100 }), m('d2_broodfire', { health: 100 }), m('d2_broodfire', { health: 100 })];
  it('Start of Combat: the left-most and right-most Shouts fire (the middle one does not), each a counted shout', () => {
    const r = fight(board(), { runeDoubleBill: true }, wall(0));
    const uids = r.initial.player.map((x) => x.uid);
    const firstAttack = r.events.findIndex((e) => e.type === 'attack');
    const shouts = of(r.events.slice(0, firstAttack < 0 ? undefined : firstAttack), 'shout');
    expect(shouts.map((e) => e.target)).toEqual([uids[0], uids[3]]);
    expect(triggers(r.events, 'runeDoubleBill')).toHaveLength(1);
    // Each Broodfire Shout gave the Dragons +3/+2: two fires.
    expect(of(r.events, 'buff').filter((b) => b.target === uids[2]).length).toBe(2);
  });

  it('without the rune nothing fires; one Shout minion fires once; two copies fire each end twice', () => {
    expect(of(fight(board(), {}, wall(0)).events, 'shout')).toHaveLength(0);
    expect(of(fight([m('d2_broodfire', { health: 100 })], { runeDoubleBill: true }, wall(0)).events, 'shout')).toHaveLength(1);
    expect(of(fight(board(), { runeDoubleBill: true, flagCopies: { runeDoubleBill: 2 } }, wall(0)).events, 'shout')).toHaveLength(4);
  });

  it('symmetric: an enemy snapshot carrying the rune fires its own ends', () => {
    const r = fight(board(), { runeDoubleBill: true }, wall(0), 5, true);
    const enemyUids = r.initial.enemy.map((x) => x.uid);
    expect(of(r.events, 'shout').map((e) => e.target)).toEqual([enemyUids[0], enemyUids[3]]);
  });

  it('its Combat Prowess Shop replay fires both ends through the real Shout path', () => {
    // Two Broodfires at the ends, a Shout-less Dragon (Galas) in the middle (no third copy, so no Gild on the buy).
    const s = withRune('rune_double_bill', { board: [bc('a', 'd2_broodfire'), bc('b', 'd4_galas', { attack: 1, health: 1 }), bc('c', 'd2_broodfire')] });
    const replay = socRuneReplaysOf(s).find((r) => r.id === 'rune_double_bill')!;
    expect(replay).toBeDefined();
    replay.fire(s);
    // Two Broodfire Shouts: each one gives the Dragons +3/+2, so the middle Dragon gets +6/+4.
    expect(`${s.board[1]!.attack}/${s.board[1]!.health}`).toBe('7/5');
  });
});

describe('R-SET2RUNE-EN-02: Bulwark Line', () => {
  it('Start of Combat: every Taunt minion gains Ward; a non-Taunt does not', () => {
    const r = fight([m('dm_knocked', { health: 50 }), m('buddy', { attack: 0, health: 50 }), m('b2_wolvie', { health: 50 })], { runeBulwarkLine: true }, wall(0));
    const uids = r.initial.player.map((x) => x.uid);
    expect(of(r.events, 'shieldUp').map((e) => e.target)).toEqual([uids[0], uids[2]]);
    expect(triggers(r.events, 'runeBulwarkLine')).toHaveLength(1);
    expect(of(fight([m('dm_knocked', { health: 50 })], {}, wall(0)).events, 'shieldUp')).toHaveLength(0);
  });

  it('no Taunt: no beat; symmetric on the enemy side', () => {
    expect(triggers(fight([m('buddy', { attack: 0, health: 50 })], { runeBulwarkLine: true }, wall(0)).events, 'runeBulwarkLine')).toHaveLength(0);
    const r = fight([m('dm_knocked', { health: 50 })], { runeBulwarkLine: true }, wall(0), 5, true);
    expect(of(r.events, 'shieldUp').map((e) => e.target)).toEqual([r.initial.enemy[0]!.uid]);
  });

  it('its Combat Prowess Shop replay gives the Taunt minions Ward', () => {
    const s = withRune('rune_bulwark_line', { board: [bc('a', 'dm_knocked'), bc('b', 'buddy')] });
    socRuneReplaysOf(s).find((r) => r.id === 'rune_bulwark_line')!.fire(s);
    expect(s.board[0]!.keywords).toContain('DS');
    expect(s.board[1]!.keywords).not.toContain('DS');
  });
});

describe('R-SET2RUNE-EN-03: Bastion and Mirror Sheen', () => {
  const warded = (attack = 0, health = 500) => m('sandbag', { attack, health, keywords: ['DS'] });
  const shieldsOn = (r: ReturnType<typeof fight>, uid: string) => of(r.events, 'shield').filter((e) => e.target === uid).length;

  it('Bastion: the first Ward loss each combat re-forms the Ward at once (a keyed shieldUp); the second loss does not', () => {
    const r = fight([warded()], { runeBastion: true }, wall(1));
    const uid = r.initial.player[0]!.uid;
    expect(of(r.events, 'shieldUp').filter((e) => e.target === uid && e.key === 'rune:runeBastion')).toHaveLength(1);
    expect(shieldsOn(r, uid)).toBe(2);
    expect(shieldsOn(fight([warded()], {}, wall(1)), uid)).toBe(1);
    // The re-form directly follows the break.
    const brk = r.events.findIndex((e) => e.type === 'shield' && e.target === uid);
    expect(r.events.slice(brk + 1).find((e) => e.type === 'shieldUp')).toMatchObject({ target: uid, key: 'rune:runeBastion' });
  });

  it('Bastion is side-wide: two Warded minions, only the first to lose Ward gets it back; two copies cover two losses', () => {
    const r = fight([warded(), warded()], { runeBastion: true }, wall(1));
    expect(of(r.events, 'shieldUp').filter((e) => e.key === 'rune:runeBastion')).toHaveLength(1);
    const r2 = fight([warded(), warded()], { runeBastion: true, flagCopies: { runeBastion: 2 } }, wall(1));
    expect(of(r2.events, 'shieldUp').filter((e) => e.key === 'rune:runeBastion')).toHaveLength(2);
  });

  it('Mirror Sheen: each Ward loss deals the minion\'s Attack to a random enemy, sourced on the minion', () => {
    const r = fight([warded(7)], { runeMirrorSheen: true }, [...wall(1), ...wall(1)]);
    const uid = r.initial.player[0]!.uid;
    const enemy = new Set(r.initial.enemy.map((x) => x.uid));
    const t = triggers(r.events, 'runeMirrorSheen');
    expect(t).toHaveLength(1);
    const at = r.events.indexOf(t[0]!);
    const hit = r.events.slice(at + 1).find((e) => e.type === 'dmg') as Ev<'dmg'>;
    expect(hit.amount).toBe(7);
    expect(enemy.has(hit.target)).toBe(true);
    expect(hit.source).toBe(uid);
    expect(triggers(fight([warded(7)], {}, wall(1)).events, 'runeMirrorSheen')).toHaveLength(0);
  });

  it('Mirror Sheen: 0 Attack deals nothing; two copies hit twice; symmetric on the enemy side', () => {
    expect(triggers(fight([warded(0)], { runeMirrorSheen: true }, wall(1)).events, 'runeMirrorSheen')).toHaveLength(0);
    const sevens = (r: ReturnType<typeof fight>) => of(r.events, 'dmg').filter((e) => e.amount === 7 && e.source === r.initial.player[0]!.uid).length;
    const one = fight([warded(7)], { runeMirrorSheen: true }, wall(1));
    const two = fight([warded(7)], { runeMirrorSheen: true, flagCopies: { runeMirrorSheen: 2 } }, wall(1));
    expect(sevens(two) - sevens(one)).toBe(1);
    const rm = fight([warded(7)], { runeMirrorSheen: true }, wall(1), 5, true);
    expect(triggers(rm.events, 'runeMirrorSheen').map((e) => e.side)).toEqual(['enemy']);
  });

  it('Bastion + Mirror Sheen (owner ruling 2026-11-12): the regained Ward retriggers Mirror Sheen when it is lost again', () => {
    const r = fight([warded(7)], { runeBastion: true, runeMirrorSheen: true }, wall(1));
    expect(triggers(r.events, 'runeMirrorSheen')).toHaveLength(2);
    expect(triggers(fight([warded(7)], { runeMirrorSheen: true }, wall(1)).events, 'runeMirrorSheen')).toHaveLength(1);
  });

  it('deterministic: same seed, same events', () => {
    const a = fight([warded(7), warded(3)], { runeBastion: true, runeMirrorSheen: true }, [...wall(2), ...wall(1)], 11);
    const b = fight([warded(7), warded(3)], { runeBastion: true, runeMirrorSheen: true }, [...wall(2), ...wall(1)], 11);
    expect(a.events).toEqual(b.events);
  });
});
