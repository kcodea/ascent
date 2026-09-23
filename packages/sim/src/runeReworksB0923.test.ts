import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatEvent, type CombatResult, type QuestCombatMods } from '@game/core';
import { CARD_INDEX, EPIC_RUNES, RUNE_INDEX, RUNES } from '@game/content';
import { createRun, PACKCRAFT_STEP, REINVESTMENT_PER_SUMMON, SLAYING_KILLS, type BoardCard, type RunState } from './state';
import { questCombatMods, reduce } from './reducer';
import { applyEndOfTurn, castSpell, recurringEotEffects } from './recruit';

/**
 * BALANCE 9/23, TRANCHE 5 — RUNE REWORKS, GROUP B (summon / board / token runes). One block per rune the owner
 * listed, each proving the new contract through the REAL path: the Runeforge buy reducer for shop runes, the
 * combat-mods builder + `simulate` for combat runes, and the carry-back → reducer settle for the ones that
 * "improve permanently". The existing per-batch tests that these reworks moved were updated in place.
 */
const ALL_TRIBES = ['beast', 'dragon', 'undead', 'mech', 'demon', 'kobold', 'dwarf'];
const rune = (id: string) => [...RUNES, ...EPIC_RUNES].find((r) => r.id === id)!;
const bc = (uid: string, cardId: string, a = 2, h = 2, extra: Partial<BoardCard> = {}): BoardCard =>
  ({ uid, cardId, tribe: CARD_INDEX[cardId]?.tribe ?? 'neutral', attack: a, health: h, keywords: [], golden: false, ...extra });
const bm = (cardId: string, uid: string, attack = 2, health = 20, extra: Partial<BoardMinion> = {}): BoardMinion =>
  ({ cardId, attack, health, sourceUid: uid, keywords: [], ...extra });
const sim = (p: BoardMinion[], e: BoardMinion[], mods: QuestCombatMods = {}, seed = 5) =>
  simulate(p, e, makeRng(seed), CARD_INDEX, combatSide({ tier: 6, tribes: ALL_TRIBES, questMods: mods }), combatSide({ tier: 6 }));
const killer: BoardMinion[] = [{ cardId: 'sandbag', attack: 9, health: 400 }];
const wall: BoardMinion[] = [{ cardId: 'sandbag', attack: 0, health: 400 }];
/** Buy `id` from a one-rune forge on a rich turn-7 shop. */
const withRune = (id: string, extra: Partial<RunState> = {}): RunState =>
  reduce({ ...createRun(3, 'runesmith'), wave: 7, tier: 6, phase: 'recruit', embers: 40, runeforgeOffer: [id], ...extra } as RunState, { type: 'buyRune', index: 0 }) as RunState;
const summonsOf = (r: CombatResult) => r.events.filter((e): e is Extract<CombatEvent, { type: 'summon' }> => e.type === 'summon' && e.side === 'player');
const held = (s: RunState, cardId: string) => [...s.hand, ...s.board].filter((c) => c.cardId === cardId).length;
/** Face the next opponent and settle it — one full turn — on a run that cannot lose. */
const turn = (s: RunState): RunState => {
  const safe = { ...s, resolve: 999, maxResolve: 999, armor: 999 } as RunState;
  return reduce(reduce(safe, { type: 'faceOmen' }) as RunState, { type: 'resolveCombat' }) as RunState;
};

// ── the "Get X. Repeat at Start of Turn" grant runes ─────────────────────────────────────────────────────
describe('the every-turn grant runes: one copy on purchase, one more at every Start of Turn', () => {
  it.each([
    ['rune_full_measure', 'dw_dorrin', 'runeFullMeasure'],
    ['rune_open_appetite', 'dm_agent', 'runeOpenAppetite'],
    ['rune_unbroken_vein', 'k_veinbreaker', 'runeUnbrokenVein'],
    ['rune_display_case', 'dm_tormentor', 'runeDisplayCase'],
  ])('%s hands over %s now and arms the every-turn list, and still arms its flag', (id, cardId, flag) => {
    const s = withRune(id, { hand: [], board: [bc('t', 'sandbag', 0, 50)], setId: 'set2' });
    expect(held(s, cardId), 'the purchase itself pays the first copy').toBe(1);
    expect(s.questRecurringGrants, 'the Start-of-Turn repeat is the every-turn list').toContain(cardId);
    expect((s as unknown as Record<string, unknown>)[flag], 'the second half of the multi reward still arms').toBe(true);
    expect(rune(id).text).toContain('Repeat at **Start of Turn**');
    const next = turn(s);
    expect(held(next, cardId), 'the next turn setup pays another').toBe(2);
  });

  it('the Deep pays a Tier 7 minion on purchase AND at the next Start of Turn (owner 2026-09-23)', () => {
    const s = withRune('rune_deep', { hand: [], board: [bc('t', 'sandbag', 0, 50)] });
    const t7 = (st: RunState) => st.hand.filter((c) => CARD_INDEX[c.cardId]?.tier === 7).length;
    expect(s.runeDeep).toBe(7);
    expect(t7(s), 'one Tier 7 minion the moment the rune is bought').toBe(1);
    expect(t7(turn(s)), 'and one more at the next turn setup').toBe(2);
  });

  it('the Muckbroker pays a Muckslinger on purchase and keeps its every-2-turns cadence', () => {
    const s = withRune('rune_muckbroker', { hand: [], board: [bc('t', 'sandbag', 0, 50)] });
    expect(held(s, 'n2_muckslinger')).toBe(1);
    expect(s.runeCadenceGrants?.find((g) => g.sourceId === 'rune_muckbroker')).toMatchObject({ cardId: 'n2_muckslinger', everyTurns: 2, tick: 0 });
    expect(s.questRecurringGrants ?? []).not.toContain('n2_muckslinger');
  });

  it('Copies is a Start-of-Turn copy (text only — the mechanic was already the turn setup)', () => {
    expect(rune('rune_copies').text.startsWith('**Start of Turn:**')).toBe(true);
    expect(withRune('rune_copies', { board: [bc('a', 'alley')] }).runeCopies).toBe(true);
  });
});

// ── Rune of Slaying — 5 kills ────────────────────────────────────────────────────────────────────────────
describe('Rune of Slaying — every 5 kills (owner balance 2026-09-23, was 6)', () => {
  it('the text, the settle and the constant agree on 5', () => {
    expect(SLAYING_KILLS).toBe(5);
    expect(rune('rune_slaying').text).toContain('**5 enemies**');
  });

  it('5 kills pay one minion of the most common type; the 6th kill is banked for next time', () => {
    const win = { events: [], result: 'win' as const, playerDamage: 0, playerDeathrattles: 0, enemyDeaths: 6, initial: { player: [], enemy: [] },
      playerQuestTally: { slaughter: 6 } } as unknown as CombatResult;
    const armed: RunState = { ...withRune('rune_slaying', { hand: [] }), board: [bc('b1', 'alley'), bc('b2', 'pack')], hand: [], phase: 'combat', lastCombat: win };
    const settled = reduce(armed, { type: 'settleCombat' }) as RunState;
    const beasts = settled.hand.filter((c) => { const d = CARD_INDEX[c.cardId]; return d && (d.tribe === 'beast' || d.tribe2 === 'beast' || d.universalTribe); });
    expect(beasts.length, 'one Beast (the board\'s only type) at 5 kills').toBe(1);
    expect(settled.runeSlayingKills, '6 - 5 banked').toBe(1);
  });
});

// ── Rune of the Hatchery — +5/+5 ─────────────────────────────────────────────────────────────────────────
describe('Rune of the Hatchery — +5/+5 and Taunt (owner balance 2026-09-23, was +3/+3)', () => {
  it('the combat mod carries +5/+5 per copy and a combat summon actually enters +5/+5 Taunted', () => {
    const s = withRune('rune_hatchery');
    expect(questCombatMods(s).runeHatchery).toEqual({ attack: 5, health: 5 });
    const summoner = Object.values(CARD_INDEX).find((c) => c.effects.some((e) => e.on === 'onDeath' && e.do === 'deathrattleSummon'))!;
    const base = summonsOf(sim([bm(summoner.id, 'p', 0, 1)], killer))[0]!.minion;
    const hatched = summonsOf(sim([bm(summoner.id, 'p', 0, 1)], killer, questCombatMods(s)))[0]!.minion;
    expect([hatched.attack - base.attack, hatched.health - base.health]).toEqual([5, 5]);
    expect(hatched.keywords).toContain('T');
  });
});

// ── Rune of Packcraft — escalating, permanent ────────────────────────────────────────────────────────────
describe('Rune of Packcraft — each combat summon gets the current level, which then grows (owner rework 2026-09-23)', () => {
  const summoner = Object.values(CARD_INDEX).find((c) => c.effects.some((e) => e.on === 'onDeath' && e.do === 'deathrattleSummon'))!;
  // Three dying summoners, so the fight produces several friendly summons in a known order.
  const board = [bm(summoner.id, 'a', 0, 1), bm(summoner.id, 'b', 0, 1), bm(summoner.id, 'c', 0, 1)];

  it('the 1st summon gets +2/+1, the 2nd +4/+2, the 3rd +6/+3 — and the grown level carries back', () => {
    const base = summonsOf(sim(board, killer)).map((e) => e.minion);
    const r = sim(board, killer, { runePackcraft: true });
    const got = summonsOf(r).map((e) => e.minion);
    expect(got.length, 'the fixture must summon at least three bodies').toBeGreaterThanOrEqual(3);
    for (let i = 0; i < 3; i++) {
      expect([got[i]!.attack - base[i]!.attack, got[i]!.health - base[i]!.health], `summon #${i + 1}`).toEqual([2 * (i + 1), 1 * (i + 1)]);
    }
    const n = got.length;
    expect(r.playerPackcraftLevel, 'the level after N summons is the base step × (N + 1)').toEqual({ attack: 2 * (n + 1), health: 1 * (n + 1) });
  });

  it('an unchanged level carries nothing (no summons → no carry-back)', () => {
    expect(sim([bm('sandbag', 'a', 0, 50)], wall, { runePackcraft: true }).playerPackcraftLevel).toBeUndefined();
  });

  it('the run persists the grown level and the next fight starts from it', () => {
    const s = withRune('rune_packcraft');
    expect(questCombatMods(s).packcraftLevel, 'an ungrown run seeds the printed base').toEqual(PACKCRAFT_STEP);
    const grown: RunState = { ...s, phase: 'combat', lastCombat: { events: [], result: 'win', playerDamage: 0, playerDeathrattles: 0, enemyDeaths: 0, initial: { player: [], enemy: [] }, playerPackcraftLevel: { attack: 8, health: 4 } } as CombatResult };
    const settled = reduce(grown, { type: 'settleCombat' }) as RunState;
    expect(settled.packcraftLevel).toEqual({ attack: 8, health: 4 });
    expect(questCombatMods(settled).packcraftLevel).toEqual({ attack: 8, health: 4 });
    // …and that seeded level is what the next fight's first summon receives.
    const base = summonsOf(sim(board, killer))[0]!.minion;
    const first = summonsOf(sim(board, killer, questCombatMods(settled)))[0]!.minion;
    expect([first.attack - base.attack, first.health - base.health]).toEqual([8, 4]);
  });
});

// ── Rune of Reinvestment — +3/+4 per summon, pulse per summon, paid at settle ────────────────────────────
describe('Rune of Reinvestment — +3/+4 per combat summon into the Shop (owner balance 2026-09-23)', () => {
  it('the combat mod is the per-summon object × copies held', () => {
    expect(REINVESTMENT_PER_SUMMON).toEqual({ attack: 3, health: 4 });
    const one = withRune('rune_reinvestment');
    expect(questCombatMods(one).runeReinvestment).toEqual({ attack: 3, health: 4 });
    const two = reduce({ ...one, runeforgeOffer: ['rune_reinvestment'], runeforgeDiscounts: undefined, embers: 40 } as RunState, { type: 'buyRune', index: 0 }) as RunState;
    expect(questCombatMods(two).runeReinvestment, 'two copies double the per-summon amount').toEqual({ attack: 6, health: 8 });
  });

  it('settle lands the combined buff on the permanent Shop channel', () => {
    const summoner = Object.values(CARD_INDEX).find((c) => c.effects.some((e) => e.on === 'onDeath' && e.do === 'deathrattleSummon'))!;
    const r = sim([bm(summoner.id, 'a', 0, 1), bm(summoner.id, 'b', 0, 1)], killer, { runeReinvestment: { attack: 3, health: 4 } });
    const n = summonsOf(r).length;
    expect(n).toBeGreaterThan(0);
    const s = withRune('rune_reinvestment');
    const settled = reduce({ ...s, phase: 'combat', lastCombat: r } as RunState, { type: 'settleCombat' }) as RunState;
    expect(settled.tavernBuyBonusSources?.['Rune of Reinvestment']).toEqual({ atk: 3 * n, hp: 4 * n });
  });
});

// ── Rune of the Five Banners — End of Turn ───────────────────────────────────────────────────────────────
describe('Rune of the Five Banners — End of Turn: one minion of each type +5/+4 (owner rework 2026-09-23)', () => {
  it('is an End-of-Turn recurrence now, not a combat flag', () => {
    const s = withRune('rune_five_banners');
    expect(s.runeFiveBanners).toBe(true);
    expect(s.questFlags?.runeFiveBanners, 'the old Start-of-Combat flag is no longer armed').toBeUndefined();
    expect(recurringEotEffects(s)).toContain('runeFiveBanners');
    expect(rune('rune_five_banners').text.startsWith('**End of Turn:**')).toBe(true);
  });

  it('at End of Turn exactly one body per type collects +5/+4 — three Beasts and a Dragon = two banners', () => {
    // Three DIFFERENT Beasts (three copies of one would triple into a Gilded body at the forge).
    const s = withRune('rune_five_banners', { setId: 'set2', board: [bc('b1', 'alley', 1, 1), bc('b2', 'pack', 1, 1), bc('b3', 'stray', 1, 1), bc('d', 'emissary', 1, 1)] });
    expect(s.board, 'the fixture board survived the forge').toHaveLength(4);
    const before = s.board.reduce((n, c) => n + c.attack + c.health, 0);
    applyEndOfTurn(s);
    expect(s.board.reduce((n, c) => n + c.attack + c.health, 0) - before, '2 banners × (5 + 4)').toBe(18);
    expect(s.board[0]!.attack, 'the left-most Beast took the Beast banner').toBe(6);
    expect(s.board[1]!.attack, 'the second Beast did not').toBe(1);
    expect([s.board[3]!.attack, s.board[3]!.health], 'the Dragon took its own').toEqual([6, 5]);
  });
});

// ── Rune of Finality — 3 Imps ────────────────────────────────────────────────────────────────────────────
describe('Rune of Finality — 3 Warded Imps (owner balance 2026-09-23, was 7)', () => {
  it('the def says 3 and the fight summons 3 Warded Imps when the last minion dies', () => {
    expect(rune('rune_finality').reward).toEqual({ kind: 'combatFlag', flag: 'runeFinality', amount: 3 });
    const s = withRune('rune_finality');
    expect(s.questFlags?.runeFinality).toBe(3);
    const imps = summonsOf(sim([bm('sandbag', 'a', 0, 1)], killer, questCombatMods(s))).filter((e) => e.minion.cardId === 'impscrap');
    expect(imps).toHaveLength(3);
    expect(imps.every((e) => e.minion.keywords.includes('DS')), 'all Warded').toBe(true);
  });
});

// ── Rune of the Banquet Hall — the first buy feeds 2 random friends ──────────────────────────────────────
describe('Rune of the Banquet Hall — the first minion bought each turn gives its stats to 2 random friendly minions (owner rework 2026-09-23)', () => {
  const buyOffer = (armed: boolean, offer: { uid: string; cardId: string; atk?: number; hp?: number }, board: BoardCard[]) => {
    const base: Partial<RunState> = { board, shop: [offer] as never, embers: 40, hand: [] };
    const s = armed ? withRune('rune_banquet_hall', base) : ({ ...createRun(3), phase: 'recruit', wave: 7, embers: 40, ...base } as RunState);
    return reduce(s, { type: 'buy', uid: offer.uid }) as RunState;
  };
  // A bought minion goes to HAND, so the three board bodies are the only candidates and the buyer never collects.
  const three = () => [bc('x', 'emissary', 1, 1), bc('y', 'alley', 1, 1), bc('z', 'sandbag', 1, 1)];

  it('an UNBUFFED buy counts now: exactly two of the three board minions gain the bought body\'s full stats', () => {
    const next = buyOffer(true, { uid: 'o', cardId: 'pack' }, three()); // Alleycat Pack prints 3/2
    expect(next.hand.some((c) => c.cardId === 'pack'), 'the buy landed in hand').toBe(true);
    const fed = next.board.filter((c) => c.attack > 1 || c.health > 1);
    expect(fed, 'two random recipients').toHaveLength(2);
    for (const c of fed) expect([c.attack, c.health], 'each gets the FULL stats, not a share').toEqual([1 + 3, 1 + 2]);
    expect(next.banquetUsedThisTurn).toBe(true);
  });

  it('a Shop-buffed buy gives its BUFFED stats, and the second buy of the turn gives nothing', () => {
    const first = buyOffer(true, { uid: 'o', cardId: 'pack', atk: 2, hp: 3 }, three());
    const fed = first.board.filter((c) => c.attack > 1 || c.health > 1);
    expect(fed).toHaveLength(2);
    for (const c of fed) expect([c.attack, c.health]).toEqual([1 + 5, 1 + 5]);
    const again = reduce({ ...first, shop: [{ uid: 'o2', cardId: 'pack' }] as never, embers: 40 } as RunState, { type: 'buy', uid: 'o2' }) as RunState;
    const total = (st: RunState) => st.board.reduce((n, c) => n + c.attack + c.health, 0);
    expect(total(again), 'once per turn').toBe(total(first));
  });

  it('unarmed, a buy feeds nobody', () => {
    const next = buyOffer(false, { uid: 'o', cardId: 'pack' }, three());
    expect(next.board.every((c) => c.attack === 1 && c.health === 1)).toBe(true);
  });
});

// ── Rune of the Gem Golem — a Gemheart Golem WITH its Rubies ─────────────────────────────────────────────
describe('Rune of the Gem Golem — a dying Kobold summons a Gemheart Golem carrying its Rubies (owner rework 2026-09-23)', () => {
  const golems = (r: CombatResult) => summonsOf(r).filter((e) => e.minion.cardId === 'gemheart-shard').map((e) => e.minion);

  it('with +2/+2 of Rubies the Golem is the printed 1/1 plus the Rubies: a 3/3', () => {
    const r = sim([bm('k_chipwick', 'k', 3, 1, { buffs: [{ source: 'Ruby', attack: 2, health: 2, count: 2 }] })], killer, { runeGemGolem: true });
    const g = golems(r);
    expect(g).toHaveLength(1);
    expect([g[0]!.attack, g[0]!.health]).toEqual([3, 3]);
  });

  it('with NO Rubies the Golem still lands, as a plain 1/1 (the text no longer gates on Rubies)', () => {
    const r = sim([bm('k_chipwick', 'k', 3, 1)], killer, { runeGemGolem: true });
    const g = golems(r);
    expect(g).toHaveLength(1);
    expect([g[0]!.attack, g[0]!.health]).toEqual([1, 1]);
    expect(golems(sim([bm('k_chipwick', 'k', 3, 1)], killer)), 'unarmed: nothing').toHaveLength(0);
  });

  it('a non-Kobold death summons nothing', () => {
    expect(golems(sim([bm('alley', 'a', 1, 1)], killer, { runeGemGolem: true }))).toHaveLength(0);
  });
});

// ── Rune of Lassoing — a Rope Wrangler + Lasso pays the board ────────────────────────────────────────────
describe('Rune of Lassoing — get a Rope Wrangler; when Lasso is cast, your minions gain +2/+2 (owner rework 2026-09-23)', () => {
  it('the purchase hands over a Rope Wrangler and arms the Lasso watcher', () => {
    const s = withRune('rune_lassoing', { hand: [] });
    expect(held(s, 'ropewrangler')).toBe(1);
    expect(s.runeLassoing).toBe(true);
    expect(s.questRecurringEndOfTurn ?? [], 'the old End-of-Turn Lasso ritual is gone').not.toContain('lassoing');
  });

  it('casting Lasso buffs every board minion +2/+2; another spell does not', () => {
    const s = withRune('rune_lassoing', { board: [bc('a', 'alley', 1, 1), bc('b', 'pack', 3, 2)], shop: [{ uid: 'o', cardId: 'sandbag' }] as never });
    castSpell(s, CARD_INDEX['lasso']!);
    expect(s.board.filter((c) => c.uid === 'a' || c.uid === 'b').map((c) => [c.attack, c.health])).toEqual([[3, 3], [5, 4]]);
    expect(s.runeProcs?.rune_lassoing ?? 0).toBe(1);
    const other = withRune('rune_lassoing', { board: [bc('a', 'alley', 1, 1)] });
    castSpell(other, CARD_INDEX['growth']!);
    expect(other.runeProcs?.rune_lassoing ?? 0, 'Growth is not Lasso').toBe(0);
  });
});

// ── Rune of Beastial Swarm — the Beast AURA grows per Beast death ───────────────────────────────────────
describe('Rune of Beastial Swarm — a friendly Beast death grows your Beast Aura +N/+N; Avenge (2) improves N (owner rework 2026-09-23)', () => {
  const beasts = [bm('alley', 'x', 0, 1), bm('alley', 'y', 0, 1), bm('pack', 'S', 0, 9999999)];
  const swarm = (level?: number) => sim(beasts, [{ cardId: 'sandbag', attack: 60, health: 40000 }], { runeBeastialSwarm: true, beastialSwarmLevel: level }, 3);

  it('two Beast deaths at level 2 pump the aura carry-back by +4/+4 and raise the level to 4', () => {
    const r = swarm(2);
    expect(r.playerBeastBuyAtkGain, 'the permanent Beast Attack aura gain').toBe(4);
    expect(r.playerBeastBuyHpGain, 'and its Health half').toBe(4);
    expect(r.playerBeastialSwarmLevel, 'Avenge (2) improved the per-death amount').toBe(4);
    const survivor = r.initial.player.find((m) => m.cardId === 'pack')!.uid;
    const live = r.events.filter((e) => e.type === 'buff' && e.target === survivor && (e as { source?: string }).source === 'Rune of Beastial Swarm');
    expect(live.reduce((n, e) => n + (e as { attack: number }).attack, 0), 'the living Beast gained it on the spot').toBe(4);
  });

  it('settle folds the gain into the run\'s Beast Aura and every run-board Beast', () => {
    const s = withRune('rune_beastial_swarm', { board: [bc('p', 'pack', 3, 2)], setId: 'set2' });
    const before = { a: s.beastBuyAtk ?? 0, h: s.beastBuyHp ?? 0 };
    const settled = reduce({ ...s, phase: 'combat', lastCombat: swarm(2) } as RunState, { type: 'settleCombat' }) as RunState;
    expect((settled.beastBuyAtk ?? 0) - before.a).toBe(4);
    expect((settled.beastBuyHp ?? 0) - before.h).toBe(4);
    expect([settled.board[0]!.attack, settled.board[0]!.health], 'the run-board Beast carries the grown aura').toEqual([3 + 4, 2 + 4]);
    expect(settled.beastialSwarmLevel).toBe(4);
  });

  it('a non-Beast death grows nothing', () => {
    const r = sim([bm('sandbag', 'n', 0, 1), bm('pack', 'S', 0, 9999999)], [{ cardId: 'sandbag', attack: 60, health: 40000 }], { runeBeastialSwarm: true }, 3);
    expect(r.playerBeastBuyAtkGain ?? 0).toBe(0);
  });
});

// ── texts ────────────────────────────────────────────────────────────────────────────────────────────────
describe('the 19 reworked texts read as the owner wrote them', () => {
  const EXPECT: Record<string, string> = {
    rune_full_measure: 'Get a **Baby Gastrid**. Repeat at **Start of Turn**. Your **Baby Gastrids** also grant **Attack** this game.',
    rune_open_appetite: 'Get an **Appetite Agent**. Repeat at **Start of Turn**. They can target a minion of **any type**.',
    rune_packcraft: 'When you summon a minion in combat, give it **+2/+1** and improve this permanently.',
    rune_reinvestment: 'When you summon a minion in combat, give minions in the **Shop +3/+4** permanently.',
    rune_slaying: 'When you kill **5 enemies**, get a minion of your **most common type**.',
    rune_display_case: 'Get a **Market Tormentor**. Repeat at **Start of Turn**. They buff the **left-most** Shop slot, too.',
    rune_five_banners: '**End of Turn:** give a minion of **each type +5/+4**.',
    rune_hatchery: 'Minions summoned in **combat** have **+5/+5** and **Taunt**.',
    rune_muckbroker: 'Get a **Muckslinger**. Repeat every **2 turns**.',
    rune_unbroken_vein: 'Get a **Veinbreaker**. Repeat at **Start of Turn**. They grant **both** effects.',
    rune_beastial_swarm: 'Give your **Beast Aura +2/+2** when a friendly **Beast** dies. **Avenge (2):** improve this.',
    rune_copies: '**Start of Turn:** get a copy of a random minion on your board.',
    rune_finality: 'When your **last minion dies**, summon **3 Imps** with **Ward**.',
    rune_living_treasure: 'Your **Gemheart Golems** gain **Rebirth**.',
    rune_banquet_hall: 'The first minion you **buy** each turn gives its stats to **2 random** friendly minions.',
    rune_deep: 'Get a random **Tier 7** minion. Repeat at **Start of Turn**.',
    rune_food_chain: 'The **first minion you summon** in combat gains the stats of your **left-most Demon**.',
    rune_gem_golem: 'When a friendly **Kobold** dies, summon a **Gemheart Golem** with its **Rubies**.',
    rune_lassoing: 'Get a **Rope Wrangler**. When **Lasso** is cast, give your minions **+2/+2**.',
  };
  it.each(Object.entries(EXPECT))('%s', (id, text) => {
    expect(RUNE_INDEX[id]?.text).toBe(text);
    expect(text, 'no dashes in player text (owner rule 2026-09-21)').not.toMatch(/—|--/);
  });

  it('every named card resolves in the global index', () => {
    for (const id of ['dw_dorrin', 'dm_agent', 'dm_tormentor', 'k_veinbreaker', 'n2_muckslinger', 'ropewrangler', 'lasso', 'gemheart-shard', 'impscrap']) {
      expect(CARD_INDEX[id], id).toBeDefined();
    }
  });
});
