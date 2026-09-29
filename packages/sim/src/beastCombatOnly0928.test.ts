import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type CardDef, type CombatEvent, type CombatResult, type QuestCombatMods } from '@game/core';
import { CARD_INDEX, EffectFactoryIdSchema, QUEST_DEFS, RUNE_INDEX, poolFor } from '@game/content';
import { createRun, type BoardCard, type RunState } from './state';
import { questCombatMods, reduce } from './reducer';
import { applyEndOfTurn, fireOnFriendDeath, fireRecruitDeathrattlesForTest } from './recruit';

/**
 * OWNER RULINGS 2026-09-28 (R-AURA-03). First: "pack mentality - aka beastial swarm buff: this is a combat buff only,
 * not a permanent buff to beast aura everywhere … these affect beasts everywhere in combat, but there is no carryback
 * (unless somethings engraved, etc)". Then, on PR #1813: "let's just make the effect say: "Echo: Give all your Beasts
 * +8/+8." … this SHOULD work in recruit and combat phase. in a recruit scenario, any beast in the warband would get
 * the stats from a destroyed or triggered grim."
 *
 *   Kennelmaster  — "Start of Combat: Give all your Beasts +1 Attack. Avenge (4): Improve this."
 *   Grim          — "Echo: Give all your Beasts +8/+8."  (golden +16/+16)
 *   Armadiyo, Trophy Stalker, Rune of Beastial Swarm, Pack Mentality, The Old Hunt — the same pattern.
 *
 * ONE rule, both phases, no run-wide Beast Aura: in the SHOP every warband Beast gains it permanently (a normal Shop
 * buff); in COMBAT every Beast in the fight gains it, later summons included, and nothing carries back (Engrave
 * excepted). Pinned on the real simulate / reducer paths, with golden values, Sylus doubling in both phases,
 * Kennelmaster's Avenge improvement and old-replay compatibility (the retired effect ids still resolve).
 */

const ALL_TRIBES = ['beast', 'dragon', 'undead', 'mech', 'demon', 'kobold', 'dwarf'];
const bm = (cardId: string, uid: string, attack = 2, health = 20, extra: Partial<BoardMinion> = {}): BoardMinion =>
  ({ cardId, attack, health, sourceUid: uid, keywords: [...(CARD_INDEX[cardId]?.keywords ?? [])], ...extra });
const bc = (uid: string, cardId: string, extra: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, ...(d.tribe2 ? { tribe2: d.tribe2 } : {}), attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...extra } as BoardCard;
};
const sim = (p: BoardMinion[], e: BoardMinion[], mods: QuestCombatMods = {}, seed = 3, cards: Record<string, CardDef> = CARD_INDEX) =>
  simulate(p, e, makeRng(seed), cards, combatSide({ tier: 6, tribes: ALL_TRIBES, questMods: mods }), combatSide({ tier: 6 }));
const wall: BoardMinion[] = [{ cardId: 'sandbag', attack: 1, health: 90000 }];
const buffs = (r: CombatResult) => r.events.filter((e): e is Extract<CombatEvent, { type: 'buff' }> => e.type === 'buff');
/** The combat uid of the player body built from the `i`-th BoardMinion (initial snapshots keep board order). */
const uidAt = (r: CombatResult, i: number) => r.initial.player[i]!.uid;
const shopRun = (board: BoardCard[], over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(5, 'warden', 'ascent', undefined, 'set2'), phase: 'recruit', embers: 30, board, hand: [], ...over } as RunState);
/** Settle a precomputed fight onto a run board (the reducer's real settle). */
const settleOnto = (board: BoardCard[], r: CombatResult, over: Partial<RunState> = {}): RunState =>
  reduce({ ...createRun(1), phase: 'combat', board, lastCombat: r, ...over } as RunState, { type: 'resolveCombat' }) as RunState;

// ── the new texts ────────────────────────────────────────────────────────────────────────────────────────
describe('R-AURA-03 texts: "Give all your Beasts +X/+Y" replaces the Beast Aura', () => {
  const TEXT: Record<string, [string, string | undefined]> = {
    kennel: ['**Start of Combat:** Give all your Beasts **+1 Attack**. **Avenge (4):** Improve this.',
      '**Start of Combat:** Give all your Beasts **+2 Attack**. **Avenge (4):** Improve this (twice as much).'],
    grim: ['**Echo:** Give all your Beasts **+8/+8**.', '**Echo:** Give all your Beasts **+16/+16**.'],
    b2_armadiyo: ['**Taunt. Echo:** Give all your Beasts **+2/+4**.', '**Taunt. Echo:** Give all your Beasts **+4/+8**.'],
    trophystalker: ['**Rally:** Give all your Beasts **+5/+5**. Improve this by **+5/+5** whenever Trophy Stalker attacks.', undefined],
  };
  it.each(Object.entries(TEXT))('%s prints the owner template', (id, [text, golden]) => {
    expect(CARD_INDEX[id]!.text).toBe(text);
    if (golden) expect(CARD_INDEX[id]!.goldenText).toBe(golden);
  });

  it('the rune reads the same way', () => {
    expect(RUNE_INDEX['rune_beastial_swarm']!.text).toBe('When a friendly **Beast** dies, give all your Beasts **+2/+2**. **Avenge (2):** Improve this.');
  });

  it('no live card, rune or golden text says "Beast Aura" any more', () => {
    for (const c of Object.values(CARD_INDEX)) {
      expect(`${c.text} ${c.goldenText ?? ''}`, c.id).not.toMatch(/Beast Aura/i);
    }
    for (const r of Object.values(RUNE_INDEX)) expect(r.text, r.id).not.toMatch(/Beast Aura/i);
  });

  it('none of the reworked Beast grants says "this combat" (owner: drop it everywhere)', () => {
    for (const id of ['kennel', 'grim', 'b2_armadiyo', 'trophystalker']) {
      expect(`${CARD_INDEX[id]!.text} ${CARD_INDEX[id]!.goldenText ?? ''}`, id).not.toMatch(/this combat/);
    }
    expect(RUNE_INDEX['rune_beastial_swarm']!.text).not.toMatch(/this combat/);
  });

  it('Grim keeps its tier and stats, is a flat +8/+8 Echo, and is still in both pools', () => {
    const g = CARD_INDEX['grim']!;
    expect([g.tier, g.attack, g.health]).toEqual([5, 7, 1]);
    expect(g.effects).toEqual([{ on: 'onDeath', do: 'deathrattleBuffTribe', params: { tribe: 'beast', attack: 8, health: 8 } }]);
    expect(poolFor('set1').buyable.some((c) => c.id === 'grim')).toBe(true);
    expect(poolFor('set2').buyable.some((c) => c.id === 'grim')).toBe(true);
  });
});

// ── combat-only application ──────────────────────────────────────────────────────────────────────────────
describe('Grim in COMBAT: all your Beasts +8/+8 for the fight, later summons included', () => {
  it('buffs every living Beast (not the non-Beasts), gilded +16/+16', () => {
    for (const golden of [false, true]) {
      const r = sim([bm('grim', 'G', 1, 1, { golden }), bm('alley', 'A', 1, 900), bm('sandbag', 'N', 0, 900)], wall);
      const want = golden ? 16 : 8;
      expect(buffs(r).some((b) => b.target === uidAt(r, 1) && b.attack === want && b.health === want), `Beast +${want}`).toBe(true);
      expect(buffs(r).some((b) => b.target === uidAt(r, 2) && b.source === uidAt(r, 0)), 'the non-Beast is untouched by Grim').toBe(false);
    }
  });

  it('a Beast summoned AFTER Grim died still gets it (the rest-of-combat aura)', () => {
    // Grim dies first; Mama Pup dies later and summons two Pups — both enter with +8/+8.
    const r = sim([bm('grim', 'G', 1, 1), bm('pack', 'P', 1, 3)], [{ cardId: 'sandbag', attack: 5, health: 90000 }]);
    const grimDeath = r.events.findIndex((e) => e.type === 'death' && e.target === uidAt(r, 0));
    const pups = r.events.map((e, i) => ({ e, i })).filter(({ e, i }) => i > grimDeath && e.type === 'summon' && e.minion.cardId === 'pup');
    expect(pups.length).toBeGreaterThan(0);
    for (const { e } of pups) {
      const uid = e.type === 'summon' ? e.minion.uid : '';
      expect(buffs(r).some((b) => b.target === uid && b.attack === 8 && b.health === 8)).toBe(true);
    }
  });

  it('carries NOTHING back: no run-wide Beast gain, no permanent buff on a non-Engraved Beast', () => {
    const r = sim([bm('grim', 'G', 1, 1), bm('alley', 'A', 1, 900)], wall);
    expect(r.playerBeastBuyAtkGain).toBeUndefined();
    expect(r.playerBeastBuyHpGain).toBeUndefined();
    expect((r.playerPermaBuffs ?? []).filter((p) => p.sourceUid === 'A')).toEqual([]);
    const s = settleOnto([bc('G', 'grim'), bc('A', 'alley')], r);
    const a = s.board.find((c) => c.uid === 'A')!;
    expect([a.attack, a.health], 'the run-board Beast is exactly as it was').toEqual([CARD_INDEX['alley']!.attack, CARD_INDEX['alley']!.health]);
    expect(s.beastBuyAtk ?? 0).toBe(0);
    expect(s.beastBuyHp ?? 0).toBe(0);
  });

  it('THE ENGRAVE EXCEPTION: an Engraved Beast keeps the fight\'s +8/+8', () => {
    const r = sim([bm('grim', 'G', 1, 1), bm('alley', 'A', 1, 900, { keywords: ['EG'] })], wall);
    const perma = (r.playerPermaBuffs ?? []).filter((p) => p.sourceUid === 'A');
    expect(perma.reduce((n, p) => n + p.attack, 0)).toBeGreaterThanOrEqual(8);
    const s = settleOnto([bc('G', 'grim'), bc('A', 'alley', { keywords: ['EG'] })], r);
    const a = s.board.find((c) => c.uid === 'A')!;
    expect(a.attack).toBeGreaterThanOrEqual(CARD_INDEX['alley']!.attack + 8);
    expect(s.beastBuyAtk ?? 0, 'still no run-wide channel').toBe(0);
  });
});

// ── Grim in the SHOP ─────────────────────────────────────────────────────────────────────────────────────
describe('Grim in the SHOP: every warband Beast gains it permanently (owner: "any beast in the warband would get the stats")', () => {
  it('a Shop-fired Echo (Ossuary-class proc) buffs every warband Beast, Grim included, +8/+8 (gilded +16/+16), and no non-Beast', () => {
    for (const golden of [false, true]) {
      const s = shopRun([bc('g', 'grim', { golden }), bc('t', 'b2_trex'), bc('n', 'sandbag')], { hand: [bc('h', 'alley')] });
      fireRecruitDeathrattlesForTest(s, s.board.find((c) => c.uid === 'g')!);
      const want = golden ? 16 : 8;
      expect(s.deathrattlesTriggered, 'tallied').toBe(1);
      const t = s.board.find((c) => c.uid === 't')!;
      expect([t.attack, t.health]).toEqual([CARD_INDEX['b2_trex']!.attack + want, CARD_INDEX['b2_trex']!.health + want]);
      expect(s.board.find((c) => c.uid === 'g')!.attack, 'the living Grim too').toBe(CARD_INDEX['grim']!.attack + want);
      expect(s.board.find((c) => c.uid === 'n')!.attack, 'non-Beast untouched').toBe(CARD_INDEX['sandbag']!.attack);
      // "your Beasts" in the Shop means the warband (the board) — the convention every Shop tribe grant uses.
      expect(s.hand.find((c) => c.uid === 'h')!.attack, 'a Beast in hand is not in the warband').toBe(CARD_INDEX['alley']!.attack);
      expect(s.beastBuyAtk ?? 0, 'still no run-wide Beast Aura').toBe(0);
    }
  });

  it('the Shop buff is permanent: it survives the next fight and settle', () => {
    const s = shopRun([bc('g', 'grim'), bc('t', 'b2_trex')]);
    fireRecruitDeathrattlesForTest(s, s.board.find((c) => c.uid === 'g')!);
    const r = sim([bm('b2_trex', 't', CARD_INDEX['b2_trex']!.attack + 8, CARD_INDEX['b2_trex']!.health + 8)], wall);
    const settled = settleOnto(s.board, r);
    expect(settled.board.find((c) => c.uid === 't')!.attack).toBe(CARD_INDEX['b2_trex']!.attack + 8);
  });

  it('SYLUS doubles it in BOTH phases', () => {
    // Shop: Sylus re-fires the Echo → +8/+8 twice on the warband Beast.
    const s = shopRun([bc('sy', 'sylus'), bc('g', 'grim'), bc('t', 'b2_trex')]);
    fireRecruitDeathrattlesForTest(s, s.board.find((c) => c.uid === 'g')!);
    expect(s.board.find((c) => c.uid === 't')!.attack).toBe(CARD_INDEX['b2_trex']!.attack + 16);
    // Combat: two +8/+8 buff events from Grim on the surviving Beast.
    const r = sim([bm('grim', 'G', 1, 1), bm('alley', 'A', 1, 900), bm('sylus', 'S', 1, 900)], wall);
    const fromGrim = buffs(r).filter((b) => b.target === uidAt(r, 1) && b.source === uidAt(r, 0) && b.attack === 8 && b.health === 8);
    expect(fromGrim).toHaveLength(2);
  });
});

// ── Kennelmaster ─────────────────────────────────────────────────────────────────────────────────────────
describe('Kennelmaster: Start of Combat all your Beasts +N Attack; Avenge (4) improves N permanently', () => {
  it('buffs the living Beasts at Start of Combat and a Beast summoned later that fight', () => {
    const r = sim([bm('kennel', 'K', 0, 900), bm('pack', 'P', 1, 1), bm('sandbag', 'N', 0, 900)], [{ cardId: 'sandbag', attack: 5, health: 90000 }]);
    const k = uidAt(r, 0);
    expect(buffs(r).some((b) => b.target === uidAt(r, 1) && b.source === k && b.attack === 1 && b.health === 0)).toBe(true);
    expect(buffs(r).some((b) => b.target === uidAt(r, 2) && b.source === k), 'non-Beast untouched').toBe(false);
    const pup = r.events.find((e) => e.type === 'summon' && e.minion.cardId === 'pup');
    expect(pup).toBeDefined();
    const pupUid = pup!.type === 'summon' ? pup!.minion.uid : '';
    expect(buffs(r).some((b) => b.target === pupUid && b.attack === 1)).toBe(true);
  });

  it('the grant uses the CURRENT improved value (summonBonus) and golden doubles it', () => {
    const r = sim([bm('kennel', 'K', 0, 900, { summonBonus: 3 }), bm('alley', 'A', 1, 900)], wall);
    expect(buffs(r).some((b) => b.target === uidAt(r, 1) && b.attack === 4)).toBe(true); // 1 + 3
    const g = sim([bm('kennel', 'K', 0, 900, { summonBonus: 3, golden: true }), bm('alley', 'A', 1, 900)], wall);
    expect(buffs(g).some((b) => b.target === uidAt(g, 1) && b.attack === 8)).toBe(true); // (1 + 3) x 2
  });

  it('Avenge (4) improves it PERMANENTLY per instance (summonBonus carries back); the stats do not', () => {
    // Four friendly non-Beast deaths → one Avenge (4) fire → summonBonus +1, carried back to the run card.
    const fodder = (i: number) => bm('sandbag', `F${i}`, 0, 1);
    const r = sim([bm('kennel', 'K', 0, 900), fodder(1), fodder(2), fodder(3), fodder(4)], [{ cardId: 'sandbag', attack: 5, health: 90000 }]);
    const sb = (r.playerSummonBonus ?? []).find((x) => x.sourceUid === 'K');
    expect(sb?.bonus, 'the improvement carries back').toBe(1);
    const s = settleOnto([bc('K', 'kennel'), bc('F1', 'sandbag'), bc('F2', 'sandbag'), bc('F3', 'sandbag'), bc('F4', 'sandbag')], r);
    const k = s.board.find((c) => c.uid === 'K')!;
    expect(k.summonBonus).toBe(1);
    expect([k.attack, k.health], 'its own stats are untouched').toEqual([CARD_INDEX['kennel']!.attack, CARD_INDEX['kennel']!.health]);
  });

  it('an End-of-Turn replay (Rune of Combat Prowess) is a permanent Shop buff on the warband Beasts', () => {
    const s = shopRun([bc('k', 'kennel'), bc('a', 'alley'), bc('n', 'sandbag')], { runeCombatProwess: true } as Partial<RunState>);
    applyEndOfTurn(s);
    expect(s.board.find((c) => c.uid === 'a')!.attack).toBe(CARD_INDEX['alley']!.attack + 1);
    expect(s.board.find((c) => c.uid === 'n')!.attack, 'non-Beast untouched').toBe(CARD_INDEX['sandbag']!.attack);
  });
});

// ── Pack Mentality (quest) ───────────────────────────────────────────────────────────────────────────────
describe('Pack Mentality: a Start of Combat grant (for the fight) whose LEVEL improves', () => {
  const pack = QUEST_DEFS.find((q) => q.id === 'q_pack_mentality')!;

  it('completing it banks the level and grants NOTHING to the board / hand / Shop', () => {
    const before = shopRun([bc('a', 'alley')], { tier: 6 });
    const after = reduce(before, { type: 'devGrant', kind: 'quest', id: pack.id }) as RunState;
    const entry = (after.questScalingAuras ?? []).find((a) => a.tribe === 'beast');
    expect(entry).toMatchObject({ attack: 4, health: 4, per: 5, stepAttack: 4, stepHealth: 4, progress: 0 });
    expect(after.board.find((c) => c.uid === 'a')!.attack).toBe(CARD_INDEX['alley']!.attack);
    expect(after.beastBuyAtk ?? 0).toBe(0);
    expect(after.beastBuyHp ?? 0).toBe(0);
    expect(questCombatMods(after).beastSummonScale).toMatchObject({ attack: 4, health: 4 });
  });

  it('Start of Combat gives all Beasts the level; later Beast summons inherit it; only the grown LEVEL carries back', () => {
    const mods: QuestCombatMods = { beastSummonScale: { per: 2, stepAttack: 4, stepHealth: 4, progress: 0, attack: 4, health: 4 } };
    const r = sim([bm('pack', 'P', 1, 1), bm('alley', 'A', 1, 900), bm('sandbag', 'N', 0, 900)], [{ cardId: 'sandbag', attack: 5, health: 90000 }], mods);
    expect(buffs(r).some((b) => b.target === uidAt(r, 1) && b.source === 'Pack Mentality' && b.attack === 4 && b.health === 4)).toBe(true);
    expect(buffs(r).some((b) => b.target === uidAt(r, 2) && b.source === 'Pack Mentality'), 'non-Beast untouched').toBe(false);
    // Two Pups summoned = one step (per 2): the level grows +4/+4 and that growth — not any stats — carries back.
    expect(r.playerBeastBuyAtkGain).toBe(4);
    expect(r.playerBeastBuyHpGain).toBe(4);
    const s = settleOnto([bc('P', 'pack'), bc('A', 'alley'), bc('N', 'sandbag')], r, {
      questScalingAuras: [{ tribe: 'beast', per: 2, event: 'summonCombat', stepAttack: 4, stepHealth: 4, progress: 0, attack: 4, health: 4 }],
    });
    expect((s.questScalingAuras ?? [])[0]).toMatchObject({ attack: 8, health: 8 });
    const a = s.board.find((c) => c.uid === 'A')!;
    expect([a.attack, a.health], 'no carry-back onto the Beast').toEqual([CARD_INDEX['alley']!.attack, CARD_INDEX['alley']!.health]);
    expect(s.beastBuyAtk ?? 0).toBe(0);
  });
});

// ── The Old Hunt + Beastial Swarm ────────────────────────────────────────────────────────────────────────
describe('The Old Hunt and Rune of Beastial Swarm: the same rule', () => {
  it('The Old Hunt: each Beast attack gives all your Beasts +N/+N for the fight; nothing carries back', () => {
    const r = sim([bm('alley', 'A', 3, 900), bm('alley', 'B', 3, 900)], [{ cardId: 'sandbag', attack: 1, health: 90000 }], { oldHuntStep: 3 });
    expect(buffs(r).some((b) => b.source === 'The Old Hunt' && b.attack === 3 && b.health === 3)).toBe(true);
    expect(r.playerBeastBuyAtkGain).toBeUndefined();
    const s = settleOnto([bc('A', 'alley'), bc('B', 'alley')], r);
    expect(s.board.map((c) => c.attack)).toEqual([CARD_INDEX['alley']!.attack, CARD_INDEX['alley']!.attack]);
  });

  it('Beastial Swarm IN COMBAT: buffs for the fight, keeps only the Avenge level', () => {
    const r = sim([bm('alley', 'x', 0, 1), bm('alley', 'y', 0, 1), bm('pack', 'S', 0, 9999999)],
      [{ cardId: 'sandbag', attack: 60, health: 40000 }], { runeBeastialSwarm: true, beastialSwarmLevel: 2 });
    expect(buffs(r).some((b) => b.target === uidAt(r, 2) && b.source === 'Rune of Beastial Swarm')).toBe(true);
    expect(r.playerBeastBuyAtkGain).toBeUndefined();
    expect(r.playerBeastialSwarmLevel).toBe(4);
  });
});

describe('Rune of Beastial Swarm IN THE SHOP (owner: "this SHOULD work in recruit and combat phase")', () => {
  it('a friendly Beast destroyed in the Shop gives every other warband Beast the current level, permanently, per copy', () => {
    const s = shopRun([bc('x', 'alley'), bc('a', 'alley'), bc('n', 'sandbag')], {
      questFlags: { runeBeastialSwarm: true }, beastialSwarmLevel: 4,
    } as Partial<RunState>);
    const dead = s.board.find((c) => c.uid === 'x')!;
    s.board = s.board.filter((c) => c.uid !== 'x'); // every Shop death path splices first
    fireOnFriendDeath(s, dead);
    expect(s.board.find((c) => c.uid === 'a')!.attack).toBe(CARD_INDEX['alley']!.attack + 4);
    expect(s.board.find((c) => c.uid === 'n')!.attack, 'non-Beast untouched').toBe(CARD_INDEX['sandbag']!.attack);
  });

  it('a non-Beast Shop death does nothing', () => {
    const s = shopRun([bc('x', 'sandbag'), bc('a', 'alley')], { questFlags: { runeBeastialSwarm: true } } as Partial<RunState>);
    const dead = s.board.find((c) => c.uid === 'x')!;
    s.board = s.board.filter((c) => c.uid !== 'x');
    fireOnFriendDeath(s, dead);
    expect(s.board.find((c) => c.uid === 'a')!.attack).toBe(CARD_INDEX['alley']!.attack);
  });
});

// ── old replays ──────────────────────────────────────────────────────────────────────────────────────────
describe('old-replay compatibility: the retired Beast effect ids still resolve', () => {
  it('the legacy Grim tally effect is still a registered factory, and a fight that references it runs', () => {
    for (const id of ['deathrattleBuffTribeByTally', 'deathrattleBuffTribe', 'scBeastAura', 'rallyTribeAuraGrowing', 'battlecryBuffBeastAttack']) {
      expect(EffectFactoryIdSchema.safeParse(id).success, id).toBe(true);
    }
    // A recorded game whose Grim still carried the 2026-09-24 tally effect: rebuild that def and re-run it.
    const legacy: Record<string, CardDef> = {
      ...CARD_INDEX,
      grim: { ...CARD_INDEX['grim']!, effects: [{ on: 'onDeath', do: 'deathrattleBuffTribeByTally', params: { tribe: 'beast', attack: 3, health: 2 } }] },
    };
    const a = sim([bm('grim', 'G', 1, 1), bm('alley', 'A', 1, 900)], wall, {}, 3, legacy);
    const b = sim([bm('grim', 'G', 1, 1), bm('alley', 'A', 1, 900)], wall, {}, 3, legacy);
    expect(a.events).toEqual(b.events); // deterministic
    expect(buffs(a).some((x) => x.target === uidAt(a, 1) && x.attack === 3 && x.health === 2)).toBe(true);
    expect(a.playerBeastBuyAtkGain).toBeUndefined();
  });

  it('a pre-change run that banked the legacy Beast channel still serves it (no double-dip with the new level)', () => {
    // A restored run with beastBuyAtk 6 and a Pack Mentality entry with NO level (its level was baked in).
    const s = shopRun([bc('a', 'alley')], {
      beastBuyAtk: 6,
      questScalingAuras: [{ tribe: 'beast', per: 5, event: 'summonCombat', stepAttack: 4, stepHealth: 4, progress: 0 }],
    });
    const m = questCombatMods(s);
    expect(m.beastSummonScale?.attack, 'no level → no Start of Combat grant on top').toBeUndefined();
  });
});
