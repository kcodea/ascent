import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type QuestCombatMods } from '@game/core';
import { CARD_INDEX, EPIC_RUNES, EQUIPMENT_INDEX, RUNES, RUNE_INDEX, runeSynergies } from '@game/content';
import { CONFIG, createRun, reduce, equipmentState, equipmentChargesOf, type Action, type BoardCard, type RunState } from './index';
import { isStatGrantingSpell } from './recruit';
import { runeTally } from '../../ui/src/runeTally';

/**
 * OWNER BATCH 2026-10-07 — the Dragon runes + Rune of the Wise Armory, and the new RUNE-OWNED EQUIPMENT primitive.
 * Each block drives the real reducer (`buyRune` → `reduce`) so "the mechanism works" and "the forge delivers it"
 * are one test; the combat halves run the real `simulate()` and the real faceOmen → settle bridge.
 */

const bc = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
};
const act = (s: RunState, a: Action): RunState => reduce(s, a) as RunState;
/** Buy a rune through the REAL Runeforge path, in a Set 2 Dragon run. Epic runes open the Epic forge. */
function withRune(id: string, extra: Partial<RunState> = {}): RunState {
  const def = RUNE_INDEX[id]!;
  const s = {
    ...createRun(3, 'runesmith', 'ascent', CONFIG.defaultLine, 'set2'),
    tribes: ['kobold', 'dragon', 'beast', 'demon', 'dwarf'], wave: 7, tier: 6, phase: 'recruit', embers: 40, hand: [], board: [],
    runeforgeOffer: [id], runeforgeEpic: !!def.epic, ...extra,
  } as RunState;
  return act(s, { type: 'buyRune', index: 0 });
}
/** Play a Pennycat (`alley`, a plain Shout) from hand — one Shout fire. */
const shout = (s: RunState, uid: string): RunState => act({ ...s, hand: [...s.hand, bc(uid, 'alley')] }, { type: 'play', uid });
const buffsFrom = (c: BoardCard | undefined, source: string): number[][] => (c?.buffs ?? []).filter((b) => b.source === source).map((b) => [b.attack, b.health]);
/** The SUMMED [attack, health] a source gave (`addBuff` folds repeat grants from one source into one entry). */
const totalFrom = (c: BoardCard | undefined, source: string): number[] => buffsFrom(c, source).reduce((t, [a, h]) => [t[0]! + a!, t[1]! + h!], [0, 0]);
const nextTurn = (s: RunState): RunState => {
  const settled = act(act(s, { type: 'faceOmen' }), { type: 'settleCombat' });
  const next = act(settled, { type: 'resolveCombat' });
  expect(next.phase).toBe('recruit');
  return next;
};

/** A combat with ONE guaranteed player Shout fire: Rune of the Herald fires every friendly Echo at Start of Combat,
 *  Ryme's Echo re-fires its neighbour's Shout (Pennycat). `extra` joins the player's board. */
const shoutFight = (mods: QuestCombatMods, extra: BoardMinion[] = [], seed = 5) => {
  const player: BoardMinion[] = [{ cardId: 'alley', attack: 1, health: 30, sourceUid: 'p0', keywords: [] }, { cardId: 'ryme', attack: 1, health: 1, sourceUid: 'p1', keywords: ['T'] }, ...extra];
  const enemy: BoardMinion[] = [{ cardId: 'sandbag', attack: 1, health: 200, sourceUid: 'e0', keywords: [] }];
  return simulate(player, enemy, makeRng(seed), CARD_INDEX,
    combatSide({ tier: 6, tribes: ['kobold', 'dragon', 'beast', 'demon', 'dwarf'] as never, questMods: { runeHerald: true, ...mods } }),
    combatSide());
};

describe('the 2026-10-07 roster', () => {
  it('Basic vs Epic by array membership, owner costs, Set 2, tribe gates', () => {
    const want: [string, number, boolean, string[] | undefined][] = [
      ['rune_echoing_shouts', 3, false, ['dragon']],
      ['rune_whelps', 3, true, ['dragon']],
      ['rune_voicekeeper', 2, true, ['dragon']],
      ['rune_flaming_dragon', 4, true, ['dragon']],
      ['rune_dragons_egg', 2, true, ['dragon']],
      ['rune_wise_armory', 3, true, undefined],
    ];
    for (const [id, cost, epic, tribes] of want) {
      const r = RUNE_INDEX[id]!;
      expect((epic ? EPIC_RUNES : RUNES).some((x) => x.id === id), `${id} lives in the right forge`).toBe(true);
      expect([r.cost, !!r.epic, r.tribes, r.sets], id).toEqual([cost, epic, tribes, ['set2']]);
      expect(r.text, `${id}: no em dash in player text`).not.toMatch(/—|--/);
    }
    expect(runeSynergies(RUNE_INDEX['rune_flaming_dragon']!)).toEqual(['dragon', 'shout', 'spells']);
    expect(runeSynergies(RUNE_INDEX['rune_dragons_egg']!)).toContain('dragon');
  });
  it('Firebird is a forge-only T6 6/9 Dragon that resolves globally', () => {
    const f = CARD_INDEX['d2_firebird']!;
    expect([f.tier, f.attack, f.health, f.tribe, f.token]).toEqual([6, 6, 9, 'dragon', true]);
  });
});

// ── 1. Rune of the Echoing Shouts ─────────────────────────────────────────────────────────────────────────
describe('Rune of the Echoing Shouts — every Shout gives your Dragons +3/+2', () => {
  it('SHOP: each Shout buffs every Dragon on the board AND in hand, permanently; non-Dragons untouched', () => {
    let s = withRune('rune_echoing_shouts', { board: [bc('d1', 'd2_embermouth'), bc('b1', 'stray')], hand: [bc('d2', 'd2_spellkeeper')] });
    s = shout(s, 'sh1');
    expect(buffsFrom(s.board.find((c) => c.uid === 'd1'), 'Rune')).toEqual([[3, 2]]);
    expect(buffsFrom(s.hand.find((c) => c.uid === 'd2'), 'Rune')).toEqual([[3, 2]]);
    expect(buffsFrom(s.board.find((c) => c.uid === 'b1'), 'Rune')).toEqual([]);
    s = shout(s, 'sh2');
    expect(totalFrom(s.board.find((c) => c.uid === 'd1'), 'Rune'), 'a second Shout pays again').toEqual([6, 4]);
  });
  it('a TRIGGERED Shout counts: a doubled Shout (two fires) pays twice', () => {
    // Drakko (`drummer`) makes your Shouts trigger an additional time.
    let s = withRune('rune_echoing_shouts', { board: [bc('d1', 'd2_embermouth'), bc('dr', 'drummer')] });
    s = shout(s, 'sh1');
    const fires = s.lastShoutFires ?? 0;
    expect(fires).toBeGreaterThanOrEqual(2);
    expect(totalFrom(s.board.find((c) => c.uid === 'd1'), 'Rune'), 'one +3/+2 per Shout FIRE').toEqual([3 * fires, 2 * fires]);
  });
  it('COMBAT: a real-time Shout fire buffs the living Dragons +3/+2 the moment it fires (for this fight)', () => {
    const r = shoutFight({ shoutMeters: [{ sourceId: 'rune_echoing_shouts', per: 1, tick: 0, buff: { tribe: 'dragon', attack: 3, health: 2, label: 'Rune of the Echoing Shouts' } }] },
      [{ cardId: 'd2_embermouth', attack: 2, health: 2, sourceUid: 'p2', keywords: [] }]);
    const buffs = r.events.filter((e) => e.type === 'buff' && e.source === 'Rune of the Echoing Shouts');
    expect(buffs.length, 'one buff per living Dragon per Shout fire').toBe(r.playerShoutFires);
    const dragonUid = r.initial.player.find((m) => m.cardId === 'd2_embermouth')!.uid;
    for (const b of buffs) expect([(b as { target: string }).target, (b as { attack: number }).attack, (b as { health: number }).health]).toEqual([dragonUid, 3, 2]);
    expect(r.playerShoutMeters).toEqual([{ sourceId: 'rune_echoing_shouts', tick: 0 }]);
  });
  it('the reducer arms the combat meter (faceOmen → settle) and the run board is NOT permanently buffed by a combat fire', () => {
    const before = withRune('rune_echoing_shouts', {
      board: [bc('p0', 'alley', { attack: 1, health: 30 }), bc('p1', 'ryme', { attack: 1, health: 1, keywords: ['T'] }), bc('p2', 'd2_embermouth')],
      resolve: 999, maxResolve: 999, armor: 999, questFlags: { runeHerald: true },
    });
    const fought = act(before, { type: 'faceOmen' });
    expect(JSON.stringify(fought.lastCombat!.events)).toContain('Rune of the Echoing Shouts');
    const settled = act(fought, { type: 'resolveCombat' });
    expect(buffsFrom(settled.board.find((c) => c.uid === 'p2'), 'Rune'), 'the combat payout is for that fight only (Drake Skull rule)').toEqual([]);
  });
});

// ── 2. Rune of the Whelps ─────────────────────────────────────────────────────────────────────────────────
describe('Rune of the Whelps — 3 Shouts → a Brood Whelp', () => {
  it('SHOP: the third Shout pays a Brood Whelp; the tally counts down', () => {
    let s = withRune('rune_whelps');
    s = shout(shout(s, 'a'), 'b');
    expect(runeTally(s, 'rune_whelps')).toBe('2/3');
    expect(s.hand.some((c) => c.cardId === 'd2_broodwhelp')).toBe(false);
    s = shout(s, 'c');
    expect(s.hand.filter((c) => c.cardId === 'd2_broodwhelp')).toHaveLength(1);
    expect(runeTally(s, 'rune_whelps')).toBe('0/3');
  });
  it('COMBAT: a shop-banked meter finishes on a combat Shout and the Whelp comes home', () => {
    const r = shoutFight({ shoutMeters: [{ sourceId: 'rune_whelps', per: 3, tick: 2, grantCards: ['d2_broodwhelp'] }] });
    expect(r.playerHandGrants).toEqual(['d2_broodwhelp']);
    expect(r.events.some((e) => e.type === 'toHand' && (e as { cardId: string }).cardId === 'd2_broodwhelp')).toBe(true);
    expect(r.playerShoutMeters).toEqual([{ sourceId: 'rune_whelps', tick: 0 }]);
  });
  it('through the real bridge, ONE counter: the combat tick is written home', () => {
    const before = withRune('rune_whelps', {
      board: [bc('p0', 'alley', { attack: 1, health: 30 }), bc('p1', 'ryme', { attack: 1, health: 1, keywords: ['T'] })],
      resolve: 999, maxResolve: 999, armor: 999, questFlags: { runeHerald: true },
    });
    before.runeThresholds!.find((t) => t.sourceId === 'rune_whelps')!.tick = 2;
    const fought = act(before, { type: 'faceOmen' });
    const fires = fought.lastCombat!.playerShoutFires ?? 0;
    expect(fires).toBeGreaterThanOrEqual(1);
    const settled = act(fought, { type: 'resolveCombat' });
    expect(settled.runeThresholds!.find((t) => t.sourceId === 'rune_whelps')!.tick).toBe((2 + fires) % 3);
    expect(settled.hand.some((c) => c.cardId === 'd2_broodwhelp'), 'the mid-fight Whelp reached the hand').toBe(true);
  });
});

// ── 3. Rune of the Voicekeeper ────────────────────────────────────────────────────────────────────────────
describe('Rune of the Voicekeeper — sell 3 Dragons → a copy of one', () => {
  const sellAll = (s: RunState, uids: string[]): RunState => uids.reduce((acc, uid) => act(acc, { type: 'sell', uid }), s);
  it('every third Dragon sold hands over a PLAIN copy of one of those three; non-Dragons do not count', () => {
    let s = withRune('rune_voicekeeper', {
      board: [
        bc('a', 'd2_embermouth', { attack: 20, health: 20, golden: true }),
        bc('x', 'stray'),
        bc('b', 'd2_spellkeeper'),
        bc('c', 'd2_chorus'),
      ],
    });
    s = sellAll(s, ['a', 'x', 'b']);
    expect(runeTally(s, 'rune_voicekeeper'), 'the Beast sale does not count').toBe('2/3');
    const handBefore = s.hand.length;
    s = sellAll(s, ['c']);
    expect(runeTally(s, 'rune_voicekeeper')).toBe('0/3');
    const got = s.hand.slice(handBefore);
    expect(got).toHaveLength(1);
    expect(['d2_embermouth', 'd2_spellkeeper', 'd2_chorus']).toContain(got[0]!.cardId);
    const def = CARD_INDEX[got[0]!.cardId]!;
    expect(got[0]!.golden, 'a plain copy: never gilded').toBe(false);
    expect([got[0]!.attack, got[0]!.health], 'a plain copy: base stats, not the sold body\'s buffs').toEqual([def.attack, def.health]);
  });
  it('the pick is seeded: the same run sells into the same copy', () => {
    const run = () => {
      const s = withRune('rune_voicekeeper', { board: [bc('a', 'd2_embermouth'), bc('b', 'd2_spellkeeper'), bc('c', 'd2_chorus')] });
      return sellAll(s, ['a', 'b', 'c']).hand.map((c) => c.cardId);
    };
    expect(run()).toEqual(run());
  });
});

// ── 4. Rune of the Flaming Dragon / Firebird ──────────────────────────────────────────────────────────────
describe('Rune of the Flaming Dragon — Get a Firebird; Firebird casts Dragonflame on every Shout', () => {
  it('buying the rune hands over a Firebird', () => {
    const s = withRune('rune_flaming_dragon');
    expect(s.hand.some((c) => c.cardId === 'd2_firebird') || s.board.some((c) => c.cardId === 'd2_firebird')).toBe(true);
  });
  it('SHOP: a Shout with Firebird on the board casts Dragonflame for real (a counted spell cast)', () => {
    let s = withRune('rune_echoing_shouts', { board: [bc('fb', 'd2_firebird'), bc('d1', 'd2_embermouth')] });
    const before = s.spellsThisTurn ?? 0;
    s = shout(s, 'sh');
    expect((s.spellsThisTurn ?? 0) - before, 'one Dragonflame cast per Shout fire').toBe(1);
    expect(s.lastSpellCastId).toBe('sp_dragonflame');
  });
  it('SHOP: a gilded Firebird casts twice', () => {
    let s = withRune('rune_echoing_shouts', { board: [bc('fb', 'd2_firebird', { golden: true }), bc('d1', 'd2_embermouth')] });
    const before = s.spellsThisTurn ?? 0;
    s = shout(s, 'sh');
    expect((s.spellsThisTurn ?? 0) - before).toBe(2);
  });
  it('COMBAT: a real-time Shout fire makes Firebird cast Dragonflame', () => {
    const r = shoutFight({}, [{ cardId: 'd2_firebird', attack: 6, health: 9, sourceUid: 'p2', keywords: [] }]);
    const casts = r.events.filter((e) => e.type === 'sc' && (e as { spellId?: string }).spellId === 'sp_dragonflame');
    expect(r.playerShoutFires).toBeGreaterThanOrEqual(1);
    expect(casts.length, 'one Dragonflame per Shout fire').toBe(r.playerShoutFires);
  });
  it('COMBAT: no Shout → no cast; and the fight is deterministic', () => {
    const quiet = simulate([{ cardId: 'd2_firebird', attack: 6, health: 9, sourceUid: 'p0', keywords: [] }], [{ cardId: 'sandbag', attack: 1, health: 60, sourceUid: 'e0', keywords: [] }], makeRng(3), CARD_INDEX, combatSide({ tier: 6 }), combatSide());
    expect(quiet.events.some((e) => e.type === 'sc' && (e as { spellId?: string }).spellId === 'sp_dragonflame')).toBe(false);
    const a = shoutFight({}, [{ cardId: 'd2_firebird', attack: 6, health: 9, sourceUid: 'p2', keywords: [] }], 9);
    const b = shoutFight({}, [{ cardId: 'd2_firebird', attack: 6, health: 9, sourceUid: 'p2', keywords: [] }], 9);
    expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));
  });
});

// ── 5/6. RUNE-OWNED EQUIPMENT ─────────────────────────────────────────────────────────────────────────────
describe("rune-owned Equipment — Rune of the Dragon's Egg / Rune of the Wise Armory", () => {
  it('buying the rune grants the Equipment now, with no body, selected, with its own charge', () => {
    const s = withRune('rune_dragons_egg');
    const g = equipmentState(s).available.find((x) => x.equipmentId === 'dragons_egg');
    expect(g).toMatchObject({ sourceKind: 'rune', sourceRuneId: 'rune_dragons_egg', sourceUids: [], version: 'plain' });
    expect(equipmentState(s).selectedEquipmentId).toBe('dragons_egg');
    expect(equipmentChargesOf(s, 'dragons_egg')).toBe(1);
    expect(s.runeEquipment).toEqual([{ runeId: 'rune_dragons_egg', equipmentId: 'dragons_egg' }]);
  });
  it("Dragon's Egg: activation costs 2 Gold, spends the charge and opens a Dragon Discover", () => {
    let s = withRune('rune_dragons_egg');
    const gold = s.embers;
    s = act(s, { type: 'activateEquipment' });
    expect(s.embers).toBe(gold - EQUIPMENT_INDEX['dragons_egg']!.baseCost);
    expect(equipmentChargesOf(s, 'dragons_egg'), 'one activation a turn').toBe(0);
    const offered = [...(s.discover ?? []), ...(s.discoverQueue ?? []).flatMap(() => [] as string[])];
    expect(offered.length + (s.discoverQueue?.length ?? 0), 'a Discover is open or queued').toBeGreaterThan(0);
    for (const id of s.discover ?? []) expect(CARD_INDEX[id]!.tribe === 'dragon' || CARD_INDEX[id]!.tribe2 === 'dragon' || !!CARD_INDEX[id]!.universalTribe, id).toBe(true);
    const again = act(s, { type: 'activateEquipment' });
    expect(again.embers, 'no second activation on the spent charge').toBe(s.embers);
  });
  it('PERSISTS across turns: survives the Start-of-Turn rebuild with a fresh charge, with no Equip minion anywhere', () => {
    let s = withRune('rune_dragons_egg', { resolve: 999, maxResolve: 999, armor: 999 });
    s = act(s, { type: 'activateEquipment' });
    if (s.discover?.length) s = act(s, { type: 'discover', index: 0 } as Action);
    for (let i = 0; i < 2; i++) {
      s = nextTurn(s);
      const g = equipmentState(s).available.find((x) => x.equipmentId === 'dragons_egg');
      expect(g, `turn ${s.wave}: still held`).toBeDefined();
      expect(g!.sourceKind).toBe('rune');
      expect(equipmentChargesOf(s, 'dragons_egg'), `turn ${s.wave}: fresh charge`).toBe(1);
    }
  });
  it('a duplicate rune collapses into the one entry', () => {
    let s = withRune('rune_wise_armory');
    s = act({ ...s, runeforgeOffer: ['rune_wise_armory'], runeforgeEpic: true }, { type: 'buyRune', index: 0 });
    expect(equipmentState(s).available.filter((x) => x.equipmentId === 'spell_generator')).toHaveLength(1);
    expect(s.runeEquipment).toHaveLength(1);
  });
  it('Spell Generator: +1/+1 spell power and one random stat-granting spell from the run pool', () => {
    let s = withRune('rune_wise_armory', { tier: 6 });
    expect(equipmentState(s).selectedEquipmentId).toBe('spell_generator');
    const sp = { ...(s.spellBonus ?? { attack: 0, health: 0 }) };
    const hand = s.hand.length;
    const gold = s.embers;
    s = act(s, { type: 'activateEquipment' });
    expect(s.embers).toBe(gold - 3);
    expect(s.spellBonus).toEqual({ attack: sp.attack + 1, health: sp.health + 1 });
    const got = s.hand.slice(hand);
    expect(got).toHaveLength(1);
    const def = CARD_INDEX[got[0]!.cardId]!;
    expect(isStatGrantingSpell(def), `${def.id} gives stats`).toBe(true);
    expect(def.token, 'never a token').toBeFalsy();
    expect(def.tier).toBeLessThanOrEqual(s.tier);
  });
  it('Spell Generator is seeded (same state → same spell) and survives a turn', () => {
    const run = () => act(withRune('rune_wise_armory'), { type: 'activateEquipment' }).hand.map((c) => c.cardId);
    expect(run()).toEqual(run());
    const next = nextTurn(withRune('rune_wise_armory', { resolve: 999, maxResolve: 999, armor: 999 }));
    expect(equipmentChargesOf(next, 'spell_generator')).toBe(1);
  });
  it('the rune Equipment and a minion Equipment coexist: the board one does not evict the rune one at the rebuild', () => {
    let s = withRune('rune_dragons_egg', { resolve: 999, maxResolve: 999, armor: 999, board: [bc('f', 'e3_frank')] });
    s = nextTurn(s);
    const ids = equipmentState(s).available.map((g) => g.equipmentId);
    expect(ids).toContain('dragons_egg');
    if (s.board.some((c) => c.cardId === 'e3_frank')) expect(ids).toContain('bloodpot');
  });
  it('the run state round-trips through JSON (save / replay / snapshot) with the rune Equipment intact', () => {
    const s = withRune('rune_dragons_egg');
    const restored = JSON.parse(JSON.stringify(s)) as RunState;
    expect(equipmentState(restored).available).toEqual(equipmentState(s).available);
    expect(restored.runeEquipment).toEqual(s.runeEquipment);
    expect(equipmentChargesOf(restored, 'dragons_egg')).toBe(1);
  });
});
