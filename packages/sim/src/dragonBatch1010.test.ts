import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type QuestCombatMods, type SourceTriggerEvent } from '@game/core';
import { ARCHIVED_CARDS, ARCHIVED_RUNES, CARD_INDEX, EPIC_RUNES, RUNES, RUNE_INDEX, poolFor } from '@game/content';
import { CONFIG, createRun, reduce, reduceWithPresentation, type Action, type BoardCard, type RunState } from './index';
import { applyEndOfTurn, castSpell } from './recruit';

/**
 * OWNER BALANCE BATCH 2026-10-10 (Dragons + three neutrals). Every block drives the real reducer / the real
 * `simulate()`, so "the card says it" and "the engine does it" are one assertion. The oracle rules R-VAULT-01,
 * R-HUMPHRY-01 and R-ROOMWORKS-01 point here.
 */

const bc = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
};
const act = (s: RunState, a: Action): RunState => reduce(s, a) as RunState;
const set2 = (extra: Partial<RunState> = {}): RunState => ({
  ...createRun(3, 'runesmith', 'ascent', CONFIG.defaultLine, 'set2'),
  tribes: ['kobold', 'dragon', 'beast', 'demon', 'dwarf'], wave: 7, tier: 6, phase: 'recruit', embers: 40, hand: [], board: [],
  ...extra,
} as RunState);
/** The SUMMED [attack, health] one source gave (`addBuff` folds repeat grants from one source into one entry). */
const totalFrom = (c: BoardCard | undefined, source: string): number[] =>
  (c?.buffs ?? []).filter((b) => b.source === source).reduce((t, b) => [t[0]! + b.attack, t[1]! + b.health], [0, 0]);
const on = (s: RunState, uid: string): BoardCard | undefined => s.board.find((c) => c.uid === uid);
/** Play a Pennycat (`alley`, a plain Shout) from hand: one Shout fire. */
const shout = (s: RunState, uid: string): RunState => act({ ...s, hand: [...s.hand, bc(uid, 'alley')] }, { type: 'play', uid });

describe('2026-10-10 roster: stats, tiers, archive, pool order', () => {
  it('the changed cards carry the owner numbers', () => {
    const t = (id: string) => { const d = CARD_INDEX[id]!; return [d.tier, d.attack, d.health]; };
    expect(t('karwind')).toEqual([5, 2, 8]);
    expect(t('stewardofspells')).toEqual([4, 4, 6]);
    expect(t('n2_conductor')[0]).toBe(3);
    expect(t('n2_fatecarver')).toEqual([6, 8, 9]);
    expect(CARD_INDEX['n2_fatecarver']!.chooseOne, 'the Choose One is gone').toBeUndefined();
    expect(t('d2_roomworks')).toEqual([3, 4, 3]);
    expect(t('d2_shrieker')).toEqual([5, 5, 4]);
  });
  it('Skald + Fel Conjurer are archived (resolvable, in no set); Living Growth is an archived rune', () => {
    for (const id of ['d2_skald', 'd2_felconjurer']) {
      expect(ARCHIVED_CARDS.some((c) => c.id === id), id).toBe(true);
      expect(poolFor('set2').all.some((c) => c.id === id), `${id} left set 2`).toBe(false);
      expect(CARD_INDEX[id], `${id} still resolves for saves`).toBeDefined();
    }
    expect(ARCHIVED_RUNES.some((r) => r.id === 'rune_living_growth')).toBe(true);
    expect([...RUNES, ...EPIC_RUNES].some((r) => r.id === 'rune_living_growth')).toBe(false);
    expect(RUNE_INDEX['rune_living_growth']).toBeDefined();
  });
  it('Roomworks and Shrieker are drawable set-2 Dragons, appended after every other set-2 Dragon', () => {
    const dragons = poolFor('set2').all.filter((c) => c.tribe === 'dragon' && !c.token && c.id.startsWith('d2_'));
    expect(dragons.slice(-2).map((c) => c.id)).toEqual(['d2_roomworks', 'd2_shrieker']);
  });
  it('no player text carries an em dash', () => {
    for (const id of ['d2_scalefeather', 'd2_herzog', 'd2_broodfire', 'd2_riverdrake', 'karwind', 'd2_humphry', 'n2_fatecarver', 'n2_conductor', 'd2_roomworks', 'd2_shrieker']) {
      const d = CARD_INDEX[id]!;
      expect(`${d.text} ${d.goldenText ?? ''}`, id).not.toMatch(/—|--/);
    }
    expect(RUNE_INDEX['rune_herzog']!.text).not.toMatch(/—|--/);
  });
});

describe('Mushy + Riverback hand out Dragonflames', () => {
  it('Mushy Shout gets a Dragonflame (gilded 2)', () => {
    const s = act(set2({ hand: [bc('m', 'd2_scalefeather')] }), { type: 'play', uid: 'm' });
    expect(s.hand.filter((c) => c.cardId === 'sp_dragonflame')).toHaveLength(1);
    const g = act(set2({ hand: [bc('m', 'd2_scalefeather', { golden: true })] }), { type: 'play', uid: 'm' });
    expect(g.hand.filter((c) => c.cardId === 'sp_dragonflame')).toHaveLength(2);
  });
  it('Riverback Sell gets a Dragonflame', () => {
    const s = act(set2({ board: [bc('r', 'd2_riverdrake')] }), { type: 'sell', uid: 'r' });
    expect(s.hand.map((c) => c.cardId)).toEqual(['sp_dragonflame']);
  });
  it('Mushy Echo in combat grants a Dragonflame', () => {
    const r = simulate([{ cardId: 'd2_scalefeather', attack: 1, health: 1, sourceUid: 'm' }], [{ cardId: 'sandbag', attack: 5, health: 200, sourceUid: 'e' }],
      makeRng(3), CARD_INDEX, combatSide({ tier: 6 }), combatSide());
    const grants = r.events.filter((e) => e.type === 'toHand' && (e as { cardId?: string }).cardId === 'sp_dragonflame');
    expect(grants.length).toBeGreaterThan(0);
  });
});

describe('Broodfire / Karwind / Conductor numbers', () => {
  it('Broodfire Shout gives your Dragons +3/+2', () => {
    const s = act(set2({ board: [bc('d', 'd2_cinderchef')], hand: [bc('b', 'd2_broodfire')] }), { type: 'play', uid: 'b' });
    expect(totalFrom(on(s, 'd'), 'Broodfire')).toEqual([3, 2]);
  });
  it('Karwind gives +4/+4 per Shout; gilded gives +4/+4 TWICE (two separate grants)', () => {
    const s = shout(set2({ board: [bc('k', 'karwind'), bc('d', 'd2_cinderchef')] }), 'p');
    expect(totalFrom(on(s, 'd'), 'Karwind')).toEqual([4, 4]);
    const g = shout(set2({ board: [bc('k', 'karwind', { golden: true }), bc('d', 'd2_cinderchef')] }), 'p');
    expect(totalFrom(on(g, 'd'), 'Karwind')).toEqual([8, 8]);
    expect(on(g, 'd')!.buffs!.find((b) => b.source === 'Karwind')!.count, 'two pulses, not one doubled grant').toBe(2);
  });
  it('Conductor gives adjacent minions +3/+3', () => {
    const s = act(set2({ board: [bc('a', 'stray'), bc('b', 'stray')], hand: [bc('c', 'n2_conductor')] }), { type: 'play', uid: 'c', toIndex: 1 });
    expect(totalFrom(on(s, 'a'), 'Conductor')).toEqual([3, 3]);
    expect(totalFrom(on(s, 'b'), 'Conductor')).toEqual([3, 3]);
  });
});

// ── R-VAULT-01 ──────────────────────────────────────────────────────────────────────────────────────────────
describe('Vaultkeeper: when this gains Attack, give adjacent Dragons +3/+4 (R-VAULT-01)', () => {
  it('SHOP: one Attack gain = one pulse onto the ADJACENT Dragons only (not far Dragons, not non-Dragons)', () => {
    let s = set2({ board: [bc('l', 'd2_cinderchef'), bc('v', 'd2_herzog'), bc('b', 'stray'), bc('far', 'd2_cinderchef')] });
    // One Attack gain on the Vaultkeeper: a Broodfire Shout (all Dragons +3/+2) played at the far right.
    s = act({ ...s, hand: [bc('bf', 'd2_broodfire')] }, { type: 'play', uid: 'bf' });
    expect(totalFrom(on(s, 'l'), 'Vaultkeeper')).toEqual([3, 4]);
    expect(totalFrom(on(s, 'b'), 'Vaultkeeper'), 'a Beast neighbour is not a Dragon').toEqual([0, 0]);
    expect(totalFrom(on(s, 'far'), 'Vaultkeeper'), 'a far Dragon is not adjacent').toEqual([0, 0]);
    expect(totalFrom(on(s, 'v'), 'Vaultkeeper'), 'never itself').toEqual([0, 0]);
  });
  it('SHOP: a gilded Karwind\'s two pulses are TWO gains, so Vaultkeeper pulses twice (the per-action fold is gone)', () => {
    const s = shout(set2({ board: [bc('k', 'karwind', { golden: true }), bc('v', 'd2_herzog'), bc('d', 'd2_cinderchef')] }), 'p');
    expect(totalFrom(on(s, 'd'), 'Vaultkeeper')).toEqual([6, 8]);
    expect(on(s, 'd')!.buffs!.find((b) => b.source === 'Vaultkeeper')!.count).toBe(2);
  });
  it('SHOP: a gilded Vaultkeeper gives +6/+8', () => {
    const s = shout(set2({ board: [bc('k', 'karwind'), bc('v', 'd2_herzog', { golden: true }), bc('d', 'd2_cinderchef')] }), 'p');
    expect(totalFrom(on(s, 'd'), 'Vaultkeeper')).toEqual([6, 8]);
  });
  it('SHOP LOOP GUARD: two adjacent Vaultkeepers pay each other ONCE per outside gain, then stop', () => {
    const s = shout(set2({ board: [bc('k', 'karwind'), bc('v1', 'd2_herzog'), bc('v2', 'd2_herzog')] }), 'p');
    // Karwind buffs v1 then v2 (one gain each). v1's pulse lands on its Dragon neighbours (Karwind + v2); v2's on
    // v1. Neither pulse's +3 re-triggers the other Vaultkeeper.
    expect(totalFrom(on(s, 'v1'), 'Vaultkeeper')).toEqual([3, 4]);
    expect(totalFrom(on(s, 'v2'), 'Vaultkeeper')).toEqual([3, 4]);
    expect(totalFrom(on(s, 'k'), 'Vaultkeeper')).toEqual([3, 4]);
  });
  it('SHOP: Rune of the Vaultkeeper widens the pulse to every other Dragon', () => {
    const s = shout(set2({ runeVaultkeeper: true, board: [bc('k', 'karwind'), bc('v', 'd2_herzog'), bc('b', 'stray'), bc('far', 'd2_cinderchef')] }), 'p');
    expect(totalFrom(on(s, 'far'), 'Vaultkeeper')).toEqual([3, 4]);
    expect(totalFrom(on(s, 'b'), 'Vaultkeeper')).toEqual([0, 0]);
  });
  it('SHOP: a Vaultkeeper in HAND never pulses', () => {
    const s = act(set2({ board: [bc('d', 'd2_cinderchef')], hand: [bc('v', 'd2_herzog'), bc('bf', 'd2_broodfire')] }), { type: 'play', uid: 'bf' });
    expect(totalFrom(on(s, 'd'), 'Vaultkeeper')).toEqual([0, 0]);
  });

  /** One guaranteed player Shout fire at Start of Combat: Rune of the Herald fires Ryme's Echo, which re-fires its
   *  neighbour Pennycat's Shout; Karwind reacts. */
  const vaultFight = (board: BoardMinion[], mods: QuestCombatMods = {}) => (slots = board.map((m) => m.sourceUid!), simulate(
    [{ cardId: 'alley', attack: 1, health: 300, sourceUid: 'p0', keywords: [] }, { cardId: 'ryme', attack: 1, health: 1, sourceUid: 'p1', keywords: [] }, ...board],
    [{ cardId: 'sandbag', attack: 1, health: 900, sourceUid: 'e0', keywords: [] }],
    makeRng(5), CARD_INDEX,
    combatSide({ tier: 6, tribes: ['kobold', 'dragon', 'beast', 'demon', 'dwarf'] as never, questMods: { runeHerald: true, ...mods } }),
    combatSide()));
  /** Combat uids by board slot: the two fixed bodies (Pennycat, Ryme) then `board` in order. */
  let slots: string[] = [];
  const uidOf = (r: ReturnType<typeof simulate>, src: string) => r.initial.player[2 + slots.indexOf(src)]!.uid;
  const vaultBuffs = (r: ReturnType<typeof simulate>, vk: string, target: string) =>
    r.events.filter((e) => e.type === 'buff' && (e as { source?: string }).source === uidOf(r, vk) && (e as { target?: string }).target === uidOf(r, target));

  it('COMBAT: a gilded Karwind\'s two pulses make the Vaultkeeper pulse twice', () => {
    const r = vaultFight([
      { cardId: 'karwind', attack: 2, health: 300, sourceUid: 'k', golden: true },
      { cardId: 'd2_herzog', attack: 6, health: 300, sourceUid: 'v' },
      { cardId: 'd2_cinderchef', attack: 1, health: 300, sourceUid: 'd' },
    ]);
    const hits = vaultBuffs(r, 'v', 'd');
    expect(hits.length).toBeGreaterThanOrEqual(2);
    expect(hits.length % 2, 'Karwind fires in pairs, so Vaultkeeper does too').toBe(0);
    for (const h of hits) expect([(h as { attack: number }).attack, (h as { health: number }).health]).toEqual([3, 4]);
  });
  it('COMBAT LOOP GUARD: two adjacent Vaultkeepers settle (each pays the other once per Karwind pulse)', () => {
    const r = vaultFight([
      { cardId: 'karwind', attack: 2, health: 300, sourceUid: 'k' },
      { cardId: 'd2_herzog', attack: 6, health: 300, sourceUid: 'v1' },
      { cardId: 'd2_herzog', attack: 6, health: 300, sourceUid: 'v2' },
    ]);
    const karwindPulses = r.events.filter((e) => e.type === 'buff' && (e as { source?: string }).source === uidOf(r, 'k') && (e as { target?: string }).target === uidOf(r, 'v1')).length;
    expect(karwindPulses).toBeGreaterThan(0);
    expect(vaultBuffs(r, 'v1', 'v2').length).toBe(karwindPulses);
    expect(vaultBuffs(r, 'v2', 'v1').length).toBe(karwindPulses);
  });
  it('COMBAT: Rune of the Vaultkeeper reaches a far Dragon', () => {
    const board: BoardMinion[] = [
      { cardId: 'karwind', attack: 2, health: 300, sourceUid: 'k' },
      { cardId: 'd2_herzog', attack: 6, health: 300, sourceUid: 'v' },
      { cardId: 'stray', attack: 1, health: 300, sourceUid: 'b' },
      { cardId: 'd2_cinderchef', attack: 1, health: 300, sourceUid: 'far' },
    ];
    expect(vaultBuffs(vaultFight(board), 'v', 'far').length).toBe(0);
    expect(vaultBuffs(vaultFight(board, { runeVaultkeeper: true }), 'v', 'far').length).toBeGreaterThan(0);
  });
  it('COMBAT: the rune flag rides the faceOmen bridge', () => {
    let s = set2({ runeVaultkeeper: true, board: [bc('v', 'd2_herzog')] });
    s = act(s, { type: 'faceOmen' });
    expect(s.lastCombat, 'a fight resolved').toBeDefined();
  });
});

// ── R-HUMPHRY-01 ────────────────────────────────────────────────────────────────────────────────────────────
describe('Humphry: +2/+2 for every Dragon played this turn, its own play included (R-HUMPHRY-01)', () => {
  const playHumphry = (s: RunState, golden = false): RunState => {
    s = act({ ...s, hand: [...s.hand, bc('h', 'd2_humphry', { golden })] }, { type: 'play', uid: 'h' });
    expect(s.pendingTarget?.uid).toBe('h');
    return act(s, { type: 'battlecryTarget', targetUid: 't' });
  };
  it('first Dragon of the turn: +2/+2', () => {
    const s = playHumphry(set2({ board: [bc('t', 'd2_cinderchef')] }));
    expect(totalFrom(on(s, 't'), 'Humphry')).toEqual([2, 2]);
  });
  it('second Dragon of the turn: +4/+4', () => {
    let s = act(set2({ board: [bc('t', 'd2_cinderchef')], hand: [bc('e', 'd2_embermouth')] }), { type: 'play', uid: 'e' });
    s = playHumphry(s);
    expect(totalFrom(on(s, 't'), 'Humphry')).toEqual([4, 4]);
  });
  it('a non-Dragon played earlier does not count; gilded is +4/+4 per Dragon', () => {
    let s = act(set2({ board: [bc('t', 'd2_cinderchef')], hand: [bc('x', 'stray')] }), { type: 'play', uid: 'x' });
    s = playHumphry(s, true);
    expect(totalFrom(on(s, 't'), 'Humphry')).toEqual([4, 4]);
  });
});

// ── R-ROOMWORKS-01 ──────────────────────────────────────────────────────────────────────────────────────────
describe('Roomworks: Shout, trigger a friendly minion\'s End of Turn (targeted; R-ROOMWORKS-01)', () => {
  const steward = (uid = 'st') => bc(uid, 'stewardofspells');
  const copies = (s: RunState) => s.hand.filter((c) => c.cardId === 'growth').length;
  it('aims only at an End of Turn minion; firing it replays that End of Turn (Steward copies the last spell)', () => {
    let s = set2({ board: [bc('x', 'stray'), steward()], lastSpellCastId: 'growth', hand: [bc('r', 'd2_roomworks')] });
    s = act(s, { type: 'play', uid: 'r' });
    expect(s.pendingTarget?.uid).toBe('r');
    expect(act(s, { type: 'battlecryTarget', targetUid: 'x' }), 'a minion with no End of Turn is refused').toBe(s);
    s = act(s, { type: 'battlecryTarget', targetUid: 'st' });
    expect(copies(s)).toBe(1);
  });
  it('gilded triggers it twice', () => {
    let s = act(set2({ board: [steward()], lastSpellCastId: 'growth', hand: [bc('r', 'd2_roomworks', { golden: true })] }), { type: 'play', uid: 'r' });
    s = act(s, { type: 'battlecryTarget', targetUid: 'st' });
    // A gilded Steward is not in play: the Steward copies once per End of Turn, so two triggers = two copies (the
    // golden-play Discover reward is not a Growth).
    expect(copies(s)).toBe(2);
  });
  it('with no End of Turn minion on board there is no prompt and nothing fires', () => {
    const s = act(set2({ board: [bc('x', 'stray')], hand: [bc('r', 'd2_roomworks')] }), { type: 'play', uid: 'r' });
    expect(s.pendingTarget).toBeUndefined();
    expect(on(s, 'r')).toBeDefined();
  });
  it('LOOP GUARD: Roomworks into Moira (trigger ALL Shouts, no exclusion) does not loop back into a board Roomworks', () => {
    // Moira's End of Turn (archived card, live factory) has no Roomworks exclusion, so without the guard the board
    // Roomworks' Shout would auto-pick Moira again, forever (a stack overflow). With it, the nested Shout is a no-op.
    let s = set2({ board: [bc('r0', 'd2_roomworks'), bc('mo', 'b2_moira'), bc('d', 'd2_cinderchef')], hand: [bc('r1', 'd2_roomworks'), bc('k', 'karwind')] });
    s = act(s, { type: 'play', uid: 'k' }); // a Shout watcher, so each Shout fire is visible as a Karwind grant
    const before = totalFrom(on(s, 'd'), 'Karwind')[0]!;
    s = act(s, { type: 'play', uid: 'r1' });
    s = act(s, { type: 'battlecryTarget', targetUid: 'mo' });
    // r1's own Shout (1) + Moira re-firing r0 (its Shout is blocked by the guard, but it still counts as a Shout fire
    // for Karwind) + Moira re-firing r1 (same): the chain is FINITE.
    const fires = (totalFrom(on(s, 'd'), 'Karwind')[0]! - before) / 4;
    expect(fires).toBeGreaterThan(0);
    expect(fires).toBeLessThan(10);
  });
});

describe('Shrieker: End of Turn, trigger your minions\' Shouts (except Roomworks)', () => {
  it('re-fires every other Shout minion but never Roomworks; gilded twice', () => {
    const run = (golden: boolean) => {
      const s = set2({ board: [bc('bf', 'd2_broodfire'), bc('r', 'd2_roomworks'), bc('st', 'stewardofspells'), bc('sh', 'd2_shrieker', { golden })], lastSpellCastId: 'growth' });
      applyEndOfTurn(s);
      return s;
    };
    const plain = run(false);
    expect(totalFrom(on(plain, 'bf'), 'Broodfire')).toEqual([3, 2]);
    // Steward's own End of Turn copies the spell once; a Roomworks re-fire would have copied it again.
    expect(plain.hand.filter((c) => c.cardId === 'growth')).toHaveLength(1);
    expect(totalFrom(on(run(true), 'bf'), 'Broodfire')).toEqual([6, 4]);
  });
});

describe('Fatecarver: Tier 6, Shop Spell gives a minion of each type +6/+6, old saves still load', () => {
  it('a body from an old save that chose the retired Growth branch now does the new thing', () => {
    const s = set2({ board: [bc('fc', 'n2_fatecarver', { chosenOption: 1 }), bc('b', 'stray'), bc('d', 'd2_cinderchef')], hand: [] });
    castSpell(s, CARD_INDEX['growth']!, on(s, 'b'));
    expect(totalFrom(on(s, 'b'), 'Fatecarver')).toEqual([6, 6]);
    expect(totalFrom(on(s, 'd'), 'Fatecarver')).toEqual([6, 6]);
  });
});

describe('beats: every new effect is its own source-attributed beat (Shop)', () => {
  const beats = (s: RunState, a: Action): SourceTriggerEvent[] =>
    (reduceWithPresentation(s, a, true).batch?.events ?? []).filter((e): e is SourceTriggerEvent => e.type === 'sourceTrigger');
  it("a gilded Karwind's two pulses give the Vaultkeeper TWO pulse beats, each sourced on the Vaultkeeper", () => {
    const s = set2({ board: [bc('k', 'karwind', { golden: true }), bc('v', 'd2_herzog'), bc('d', 'd2_cinderchef')], hand: [bc('p', 'alley')] });
    const vk = beats(s, { type: 'play', uid: 'p' }).filter((t) => t.policyKey === 'factory:onGainAttackBuffAdjacentTribe:onGainAttack');
    expect(vk).toHaveLength(2);
    expect(vk.every((t) => t.source.uid === 'v')).toBe(true);
  });
  it("Roomworks' End of Turn replay is a beat sourced on the TARGET", () => {
    let s = act(set2({ board: [bc('st', 'stewardofspells')], lastSpellCastId: 'growth', hand: [bc('r', 'd2_roomworks')] }), { type: 'play', uid: 'r' });

    const t = beats(s, { type: 'battlecryTarget', targetUid: 'st' }).filter((b) => b.trigger === 'endOfTurn');
    expect(t.length).toBe(1);
    expect(t[0]!.source.uid).toBe('st');
  });
});
