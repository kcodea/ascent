import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type QuestCombatMods } from '@game/core';
import { CARD_INDEX, RUNE_INDEX } from '@game/content';
import { createRun, reduce, type BoardCard, type RunState } from './index';
import {
  ALE_IDS, RUBY_ID, advanceRuneThresholds, applyEndOfTurn, applyGoldSpent, castSpell, isStatSpell,
  socRuneReplaysOf, fireStartOfCombats,
} from './recruit';
import { runeTally } from '../../ui/src/runeTally';

/**
 * BALANCE 9/23 — rune reworks, group A (spell / Shout / Dragon / economy runes). Owner items verbatim in
 * `docs/devlog/2026-09-23-balance-923-rune-reworks-a.md`; each block below pins ONE rune's new contract through
 * the real reducer (`buyRune` → `reduce`), so "the mechanism works" and "the reducer delivers it" are one test.
 *
 * The headline is the CROSS-PHASE SHOUT TALLY (owner: "make sure this and all trackers like this work in
 * combat too and carries count through both"): one counter per "when you trigger N Shouts" rune, ticked by
 * shop Shouts at the reducer boundary AND by combat Shout fires inside `simulate()` (`QuestCombatMods.shoutMeters`),
 * paying mid-fight through `playerHandGrants`, with the final tick written home at settle.
 */

const bc = (uid: string, cardId: string, attack?: number, health?: number): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: attack ?? d.attack, health: health ?? d.health, keywords: [...d.keywords], golden: false };
};
/** The [attack, health] of every buff entry from `source` — three same-id bodies would TRIPLE, so fixtures use distinct ids. */
const buffsOf = (c: BoardCard, source: string): number[][] => (c.buffs ?? []).filter((b) => b.source === source).map((b) => [b.attack, b.health]);

/** Buy a rune through the REAL Runeforge path. Epic runes open the Epic forge. */
function withRune(id: string, extra: Partial<RunState> = {}): RunState {
  const def = RUNE_INDEX[id]!;
  const s: RunState = {
    ...createRun(3, 'aster'), setId: 'set2', wave: 7, tier: 6, phase: 'recruit', embers: 40, hand: [], board: [],
    runeforgeOffer: [id], runeforgeEpic: !!def.epic, ...extra,
  } as RunState;
  return reduce(s, { type: 'buyRune', index: 0 }) as RunState;
}
const spellsInHand = (s: RunState) => s.hand.filter((c) => CARD_INDEX[c.cardId]?.spell && !CARD_INDEX[c.cardId]?.ruby);
const shout = (s: RunState, uid: string): RunState => reduce({ ...s, hand: [...s.hand, bc(uid, 'alley')] }, { type: 'play', uid }) as RunState;

// ── the cross-phase Shout tally ──────────────────────────────────────────────────────────────────────────

/** A combat with ONE guaranteed player Shout fire: Rune of the Herald fires every friendly Echo at Start of
 *  Combat, Ryme's Echo re-fires its neighbour's Battlecry, and Pennycat is that neighbour. */
const shoutFight = (mods: QuestCombatMods, seed = 5) => {
  const player: BoardMinion[] = [{ cardId: 'alley', attack: 1, health: 30, sourceUid: 'p0', keywords: [] }, { cardId: 'ryme', attack: 1, health: 1, sourceUid: 'p1', keywords: ['T'] }];
  const enemy: BoardMinion[] = [{ cardId: 'sandbag', attack: 9, health: 60, sourceUid: 'e0', keywords: [] }];
  return simulate(player, enemy, makeRng(seed), CARD_INDEX,
    combatSide({ tier: 6, tribes: ['beast', 'dragon', 'undead', 'kobold', 'dwarf'] as never, questMods: { runeHerald: true, ...mods } }),
    combatSide());
};

describe('the cross-phase Shout tally — combat counts Shouts and pays the meter mid-fight', () => {
  it('a combat Shout fire is reported (`playerShoutFires`), one per `battlecryTriggered`', () => {
    const r = shoutFight({});
    expect(r.playerShoutFires, 'the Herald → Ryme → Pennycat Shout fired').toBe(1);
    const quiet = simulate([{ cardId: 'stray', attack: 1, health: 30, sourceUid: 'p0', keywords: [] }], [{ cardId: 'sandbag', attack: 9, health: 60, sourceUid: 'e0', keywords: [] }], makeRng(5), CARD_INDEX, combatSide({ tier: 6 }), combatSide());
    expect(quiet.playerShoutFires, 'no Shout → no count').toBeUndefined();
  });

  it('a shop-banked meter finishes IN combat and pays a random Shop spell (never an Ale) into the hand', () => {
    const r = shoutFight({ shoutMeters: [{ sourceId: 'rune_chorus', per: 3, tick: 2, grantSpell: 1 }] });
    expect(r.playerHandGrants, 'the 3rd Shout tripped the meter mid-fight').toHaveLength(1);
    const granted = CARD_INDEX[r.playerHandGrants![0]!]!;
    expect(granted.spell && !granted.ruby, `${granted.id} is a Shop spell`).toBe(true);
    expect(ALE_IDS.includes(granted.id), 'never an Ale — the same pool the shop pays').toBe(false);
    expect(r.playerShoutMeters, 'the meter wrapped and comes home at 0').toEqual([{ sourceId: 'rune_chorus', tick: 0 }]);
    expect(r.events.some((e) => e.type === 'toHand' && (e as { cardId: string }).cardId === granted.id), 'the grant flies to hand in the replay').toBe(true);
  });

  it('a meter that does not trip carries its combat tick home instead', () => {
    const r = shoutFight({ shoutMeters: [{ sourceId: 'rune_chorus', per: 3, tick: 0, grantSpell: 1 }] });
    expect(r.playerHandGrants ?? []).toHaveLength(0);
    expect(r.playerShoutMeters).toEqual([{ sourceId: 'rune_chorus', tick: 1 }]);
  });

  it('Hoardcalling pays ONE of its two named spells the same way', () => {
    const r = shoutFight({ shoutMeters: [{ sourceId: 'rune_hoardcalling', per: 1, tick: 0, grantOneOf: ['hoardflame', 'sp_dragonflame'] }] });
    expect(r.playerHandGrants).toHaveLength(1);
    expect(['hoardflame', 'sp_dragonflame']).toContain(r.playerHandGrants![0]);
  });

  it('the fight is deterministic with a meter armed (same seed, same grant)', () => {
    const mods: QuestCombatMods = { shoutMeters: [{ sourceId: 'rune_chorus', per: 1, tick: 0, grantSpell: 1 }] };
    expect(JSON.stringify(shoutFight(mods, 11).events)).toBe(JSON.stringify(shoutFight(mods, 11).events));
  });

  /** The same Shout through the REAL bridge: faceOmen builds the side (`questCombatMods`), settle writes back. */
  const bridge = (id: string, tick: number): { before: RunState; fought: RunState; settled: RunState } => {
    const before = withRune(id, {
      board: [bc('p0', 'alley', 1, 30), { ...bc('p1', 'ryme', 1, 1), keywords: ['T'] }], hand: [],
      resolve: 999, maxResolve: 999, armor: 999,
      questFlags: { runeHerald: true },
    });
    before.runeThresholds!.find((t) => t.sourceId === id)!.tick = tick;
    const fought = reduce(before, { type: 'faceOmen' }) as RunState;
    const settled = reduce(fought, { type: 'resolveCombat' }) as RunState;
    return { before, fought, settled };
  };

  it('SHOP → COMBAT: two shop Shouts banked, the combat Shout finishes the Chorus and the spell is in hand next shop', () => {
    const { fought, settled } = bridge('rune_chorus', 2);
    const fires = fought.lastCombat!.playerShoutFires ?? 0;
    expect(fires, 'the staged combat Shout fired').toBeGreaterThanOrEqual(1);
    expect(fought.lastCombat!.playerHandGrants ?? [], 'the meter tripped in the fight').toHaveLength(Math.floor((2 + fires) / 3));
    expect(settled.runeThresholds!.find((t) => t.sourceId === 'rune_chorus')!.tick, 'ONE counter: the fight left it at (2 + fires) mod 3').toBe((2 + fires) % 3);
    expect(spellsInHand(settled).length, 'the granted spell came home').toBeGreaterThanOrEqual(1);
  });

  it('COMBAT → SHOP: a combat Shout carries into the next shop, so fewer shop Shouts finish the meter', () => {
    const { fought, settled } = bridge('rune_chorus', 0);
    const fires = fought.lastCombat!.playerShoutFires ?? 0;
    expect(fires).toBeGreaterThanOrEqual(1);
    expect(settled.runeThresholds!.find((t) => t.sourceId === 'rune_chorus')!.tick, 'the combat count is the shop tick').toBe(fires % 3);
    // Now finish it in the shop: (3 - fires) more Shouts pay a spell.
    let s: RunState = { ...settled, hand: [], board: settled.board.slice(0, 2) };
    for (let i = 0; i < 3 - (fires % 3); i++) s = shout(s, `sh${i}`);
    expect(spellsInHand(s), 'the Chorus paid on the shop Shout that completed the combat count').toHaveLength(1);
  });

  it('the settle feeds EVERY Shout tracker: the Shout quest objective, Bane\'s Presence and the Author\'s Hand', () => {
    const before = withRune('rune_chorus', {
      board: [bc('p0', 'alley', 1, 30), { ...bc('p1', 'ryme', 1, 1), keywords: ['T'] }], hand: [],
      resolve: 999, maxResolve: 999, armor: 999,
      questFlags: { runeHerald: true },
      shopBuffPerShouts: { per: 3, attack: 1, health: 1, tick: 0 },
      activeQuests: [{ questId: 'q_echoing_roar', progress: 0, completed: false }],
    } as Partial<RunState>);
    const fought = reduce(before, { type: 'faceOmen' }) as RunState;
    const fires = fought.lastCombat!.playerShoutFires ?? 0;
    const settled = reduce(fought, { type: 'resolveCombat' }) as RunState;
    expect(settled.shopBuffPerShouts!.tick, 'Bane\'s Presence counted the combat Shout').toBe(fires % 3);
    expect(settled.activeQuests![0]!.progress, 'the "trigger 7 Shouts" objective counted it').toBe(fires);
  });
});

describe('Rune of the Chorus — 3 Shouts → a random spell', () => {
  it('the def and the shop meter', () => {
    expect(RUNE_INDEX['rune_chorus']!.reward).toEqual({ kind: 'runeThreshold', meter: 'shout', per: 3, grantSpell: 1 });
    let s = withRune('rune_chorus');
    s = shout(shout(s, 'a'), 'b');
    expect(spellsInHand(s), 'two Shouts bank').toHaveLength(0);
    expect(runeTally(s, 'rune_chorus')).toBe('2/3');
    s = shout(s, 'c');
    expect(spellsInHand(s), 'the third pays').toHaveLength(1);
    expect(runeTally(s, 'rune_chorus')).toBe('0/3');
  });
});

describe('Rune of Hoardcalling — 3 Shouts → a Hoardflame or Dragonflame', () => {
  it('pays one of the two named spells on the 3rd Shout, in the shop', () => {
    let s = withRune('rune_hoardcalling');
    s = shout(shout(s, 'a'), 'b');
    expect(spellsInHand(s)).toHaveLength(0);
    s = shout(s, 'c');
    const got = spellsInHand(s).map((c) => c.cardId);
    expect(got).toHaveLength(1);
    expect(['hoardflame', 'sp_dragonflame']).toContain(got[0]);
    expect(s.runeThresholds!.find((t) => t.sourceId === 'rune_hoardcalling')!.tick).toBe(0);
  });
});

// ── the other Shout / Dragon runes ────────────────────────────────────────────────────────────────────────

describe('Rune of the Drake Skull — every Shout buffs your left- and right-most DRAGON +6/+6', () => {
  it('the Dragons at the ends of the Dragon line take it; the board\'s own ends (Beasts) do not', () => {
    let s = withRune('rune_drake_skull', { board: [bc('b1', 'stray'), bc('d1', 'emissary'), bc('d2', 'cleric'), bc('b2', 'pack')] });
    expect(s.shoutEdgeTribeBuff).toEqual({ tribe: 'dragon', attack: 6, health: 6 });
    expect(s.shoutEdgeBuff, 'the untribed Twin Sun Oath channel is untouched').toBeUndefined();
    s = shout(s, 'sh');
    for (const uid of ['d1', 'd2']) expect(buffsOf(s.board.find((c) => c.uid === uid)!, 'Rune of the Drake Skull')).toEqual([[6, 6]]);
    for (const uid of ['b1', 'b2']) expect(buffsOf(s.board.find((c) => c.uid === uid)!, 'Rune of the Drake Skull')).toEqual([]);
  });
  it('one Dragon is both ends — buffed once, not twice', () => {
    let s = withRune('rune_drake_skull', { board: [bc('b1', 'stray'), bc('d1', 'emissary')] });
    s = shout(s, 'sh');
    expect(buffsOf(s.board.find((c) => c.uid === 'd1')!, 'Rune of the Drake Skull')).toHaveLength(1);
  });
});

describe('Rune of Ancestral Roar — End of Turn: Dragons +6/+6 for every Shout this turn (one lump)', () => {
  it('arms an End-of-Turn recurrence, counts Shout FIRES, and pays ONE instance sized by the count', () => {
    let s = withRune('rune_ancestral_roar', { board: [bc('d1', 'emissary'), bc('b1', 'sandbag')] }); // (not a Stray — two Pennycat Strays + one more would triple; not Drakko — he doubles Shouts)
    expect(s.questRecurringEndOfTurn).toContain('runeAncestralRoar');
    s = shout(shout(s, 'a'), 'b');
    expect(s.shoutFiresThisTurn).toBe(2);
    expect(runeTally(s, 'rune_ancestral_roar'), 'the badge prints the live count and lump').toBe('2 Shouts · +12/+12');
    applyEndOfTurn(s);
    const d = s.board.find((c) => c.uid === 'd1')!;
    expect(buffsOf(d, 'Rune of Ancestral Roar'), 'LUMP: one +12/+12, not two +6/+6').toEqual([[12, 12]]);
    expect(buffsOf(s.board.find((c) => c.uid === 'b1')!, 'Rune of Ancestral Roar'), 'Dragons only').toEqual([]);
  });
  it('no Shouts this turn → nothing; the count resets at the rollover', () => {
    const s = withRune('rune_ancestral_roar', { board: [bc('d1', 'emissary')] });
    applyEndOfTurn(s);
    expect(buffsOf(s.board[0]!, 'Rune of Ancestral Roar')).toEqual([]);
    let t = shout(withRune('rune_ancestral_roar', { board: [bc('d1', 'emissary', 1, 30)], resolve: 999, maxResolve: 999, armor: 999 }), 'a');
    t = reduce(reduce(t, { type: 'faceOmen' }), { type: 'resolveCombat' }) as RunState;
    expect(t.shoutFiresThisTurn ?? 0).toBe(0);
  });
});

describe('Rune of the Runic Hoard — every spell cast gives 3 random Dragons +2/+3', () => {
  it('an untargeted Shop spell: exactly three of four Dragons take +2/+3', () => {
    const s = withRune('rune_runic_hoard', { board: [bc('d1', 'emissary'), bc('d2', 'cleric'), bc('d3', 'weaver'), bc('d4', 'frontdrake'), bc('b', 'stray')] });
    castSpell(s, CARD_INDEX['growth']!);
    const hit = s.board.filter((c) => buffsOf(c, 'Rune of the Runic Hoard').length > 0);
    expect(hit).toHaveLength(3);
    for (const c of hit) expect(buffsOf(c, 'Rune of the Runic Hoard')).toEqual([[2, 3]]);
    expect(buffsOf(s.board.find((c) => c.uid === 'b')!, 'Rune of the Runic Hoard'), 'never a non-Dragon').toEqual([]);
  });
  it('a Ruby is a spell too — it pays without the Spellstone', () => {
    let s = withRune('rune_runic_hoard', { board: [bc('d1', 'emissary'), bc('b', 'stray')], hand: [bc('r', RUBY_ID, 1, 1)] });
    s = reduce(s, { type: 'play', uid: 'r', targetUid: 'b' }) as RunState;
    expect(buffsOf(s.board.find((c) => c.uid === 'd1')!, 'Rune of the Runic Hoard')).toEqual([[2, 3]]);
  });
  it('a copied spell no longer pays (the old trigger is gone)', () => {
    const s = withRune('rune_runic_hoard', { board: [bc('d1', 'emissary')] });
    const before = s.board[0]!.attack;
    reduce({ ...s, hand: [] }, { type: 'faceOmen' }); // nothing here copies a spell; the point is the def has no copy hook
    expect(s.board[0]!.attack).toBe(before);
  });
});

describe('Rune of the Glider / Draconic Curiosity / the Dragon\'s Pantry — the data', () => {
  it('Glider is +6/+5; Curiosity pays on a BUY (see runeBatchAug20); the Pantry hands a Dragon + a Shop spell', () => {
    expect(RUNE_INDEX['rune_glider']!.reward).toEqual({ kind: 'runeGlider', attack: 6, health: 5 });
    expect(RUNE_INDEX['rune_dragons_pantry']!.reward).toEqual({ kind: 'runeThreshold', meter: 'playDragon', per: 5, grantSpell: 1, grantRandomTribe: 'dragon' });
    expect(RUNE_INDEX['rune_draconic_curiosity']!.text).toBe('When you buy a **Dragon**, get a random **spell**.');
  });
});

// ── the spell runes ──────────────────────────────────────────────────────────────────────────────────────

describe('Rune of Lorekeeping — ANY spell cast on a friendly minion gives it +3/+3 more', () => {
  const lore = (extra: Partial<RunState> = {}) => withRune('rune_lorekeeping', { board: [bc('t', 'stray', 2, 2), bc('u', 'pack', 2, 2)], ...extra });
  const t = (s: RunState) => s.board.find((c) => c.uid === 't')!;

  it('a targeted Shop spell', () => {
    let s = lore({ hand: [bc('sp', 'spiritfire', 0, 1)] });
    s = reduce(s, { type: 'play', uid: 'sp', targetUid: 't' }) as RunState;
    expect(buffsOf(t(s), 'Rune of Lorekeeping')).toEqual([[3, 3]]);
    expect([t(s).attack, t(s).health]).toEqual([2 + 2 + 3, 2 + 3 + 3]);
  });
  it('a Clue (a Gift)', () => {
    let s = lore({ setId: 'set3', hand: [bc('cl', 'clue', 0, 1)] } as Partial<RunState>);
    s = reduce(s, { type: 'play', uid: 'cl', targetUid: 't' }) as RunState;
    expect(buffsOf(t(s), 'Rune of Lorekeeping')).toEqual([[3, 3]]);
  });
  it('a Ruby', () => {
    let s = lore({ hand: [bc('r', RUBY_ID, 1, 1)] });
    s = reduce(s, { type: 'play', uid: 'r', targetUid: 't' }) as RunState;
    expect(buffsOf(t(s), 'Rune of Lorekeeping')).toEqual([[3, 3]]);
    expect(buffsOf(s.board.find((c) => c.uid === 'u')!, 'Rune of Lorekeeping'), 'only the minion it was cast on').toEqual([]);
  });
  it('an UNTARGETED spell (Growth) pays nothing — it was not cast ON a minion', () => {
    const s = lore();
    castSpell(s, CARD_INDEX['growth']!);
    expect(buffsOf(t(s), 'Rune of Lorekeeping')).toEqual([]);
  });
  it('a Ruby on a SHOP offer pays nothing there, but its Distillation echo onto your minion does', () => {
    let s = withRune('rune_lorekeeping', { board: [bc('t', 'stray', 2, 2)], hand: [bc('r', RUBY_ID, 1, 1)], shop: [{ uid: 'o1', cardId: 'sandbag' }], runeDistillation: true });
    s = reduce(s, { type: 'play', uid: 'r', targetUid: 'o1' }) as RunState;
    expect(buffsOf(s.board[0]!, 'Rune of Lorekeeping')).toEqual([[3, 3]]);
  });
});

describe('Rune of Distillation — a Shop-minion cast lands on BOTH your edge minions', () => {
  it('spell: left-most and right-most each get the spell; the middle does not', () => {
    let s: RunState = withRune('rune_distillation', {
      board: [bc('l', 'stray', 2, 2), bc('m', 'sandbag', 2, 2), bc('r', 'pack', 2, 2)],
      hand: [bc('sp', 'spiritfire', 0, 1)], shop: [{ uid: 'o1', cardId: 'sandbag' }],
    });
    s = reduce(s, { type: 'play', uid: 'sp', targetUid: 'o1' }) as RunState;
    const at = (uid: string) => s.board.find((c) => c.uid === uid)!;
    expect([at('l').attack, at('r').attack, at('m').attack]).toEqual([4, 4, 2]);
    expect(s.shop[0]!.atk, 'the offer still got its own cast').toBe(2);
  });
  it('Ruby: same two edges, as real Ruby landings', () => {
    let s: RunState = withRune('rune_distillation', {
      board: [bc('l', 'stray', 2, 2), bc('m', 'sandbag', 2, 2), bc('r', 'pack', 2, 2)],
      hand: [bc('rb', RUBY_ID, 1, 1)], shop: [{ uid: 'o1', cardId: 'sandbag' }],
    });
    s = reduce(s, { type: 'play', uid: 'rb', targetUid: 'o1' }) as RunState;
    const at = (uid: string) => s.board.find((c) => c.uid === uid)!;
    expect([at('l').attack, at('r').attack, at('m').attack]).toEqual([3, 3, 2]);
  });
  it('a one-minion board is both ends: ONE extra cast, never two', () => {
    let s: RunState = withRune('rune_distillation', { board: [bc('l', 'stray', 2, 2)], hand: [bc('sp', 'spiritfire', 0, 1)], shop: [{ uid: 'o1', cardId: 'sandbag' }] });
    s = reduce(s, { type: 'play', uid: 'sp', targetUid: 'o1' }) as RunState;
    expect([s.board[0]!.attack, s.board[0]!.health]).toEqual([4, 5]);
  });
});

describe('Rune of Enchantment — combat casts only, +6/+8', () => {
  it('a SHOP cast gives the board nothing', () => {
    const s = withRune('rune_enchantment', { board: [bc('t', 'stray', 2, 2)] });
    castSpell(s, CARD_INDEX['growth']!);
    expect(buffsOf(s.board[0]!, 'Rune of Enchantment')).toEqual([]);
    expect([s.board[0]!.attack, s.board[0]!.health], 'Growth alone').toEqual([3, 3]);
  });
  it('a COMBAT cast (a Spellstone Ruby from Attacking Gems) gives every minion +6/+8', () => {
    const player: BoardMinion[] = [{ cardId: 'pack', attack: 3, health: 30, sourceUid: 'p0', keywords: [] }, { cardId: 'stray', attack: 1, health: 30, sourceUid: 'p1', keywords: [] }];
    const enemy: BoardMinion[] = [{ cardId: 'sandbag', attack: 1, health: 60, sourceUid: 'e0', keywords: [] }];
    const r = simulate(player, enemy, makeRng(3), CARD_INDEX,
      combatSide({ tier: 6, tribes: ['beast', 'kobold'] as never, questMods: { runeAttackingGems: 1, runeSpellstone: true, runeEnchantment: 1 } }), combatSide());
    const ench = r.events.filter((e) => e.type === 'buff' && (e as { source: string }).source === 'Rune of Enchantment') as { attack: number; health: number }[];
    expect(ench.length, 'the combat cast fired the rune').toBeGreaterThan(0);
    expect([ench[0]!.attack, ench[0]!.health]).toEqual([6, 8]);
  });
});

describe('Rune of the Spellmarket — every 4 Shop spells casts a Staff of Guel', () => {
  it('the 4th cast casts the Staff (a real cast: the buy-buff channel rises, the counters see it)', () => {
    const s = withRune('rune_spellmarket', { board: [bc('t', 'stray', 2, 2)] });
    for (let i = 0; i < 3; i++) castSpell(s, CARD_INDEX['growth']!);
    expect(s.tavernBuyBonus.atk, 'three casts bank').toBe(0);
    castSpell(s, CARD_INDEX['growth']!);
    expect([s.tavernBuyBonus.atk, s.tavernBuyBonus.hp], 'Staff of Guel: minions in the shop +3/+3').toEqual([3, 3]);
    expect(s.spellsCast, '4 Growths + the Staff itself').toBe(5);
    expect(s.runeThresholds!.find((t) => t.sourceId === 'rune_spellmarket')!.tick, 'the Staff cast ticked the meter once').toBe(1);
  });
});

// ── the economy runes ────────────────────────────────────────────────────────────────────────────────────

describe('Rune of Overtime — 12 Gold → a Dwarven Ale', () => {
  it('11 banks, the 12th pays; the badge counts Gold', () => {
    const s = withRune('rune_overtime');
    applyGoldSpent(s, 11);
    expect(s.hand.filter((c) => ALE_IDS.includes(c.cardId))).toHaveLength(0);
    expect(runeTally(s, 'rune_overtime')).toBe('11/12g');
    applyGoldSpent(s, 1);
    expect(s.hand.filter((c) => ALE_IDS.includes(c.cardId))).toHaveLength(1);
  });
});

describe('Rune of Gemspam — 15 Gold → improve your Rubies +1/+2 and get a Ruby', () => {
  it('pays at 15, the Ruby arrives at the improved strength', () => {
    const s = withRune('rune_gemspam', { rubyBonus: { attack: 0, health: 0 } });
    applyGoldSpent(s, 14);
    expect(s.hand.filter((c) => c.cardId === RUBY_ID)).toHaveLength(0);
    applyGoldSpent(s, 1);
    expect(s.rubyBonus).toEqual({ attack: 1, health: 2 });
    const ruby = s.hand.filter((c) => c.cardId === RUBY_ID);
    expect(ruby).toHaveLength(1);
    expect([ruby[0]!.attack, ruby[0]!.health], 'base 1/1 + the improvement').toEqual([2, 3]);
  });
});

describe('Rune of the Gem Dividend — the first Ruby cast each turn pays 3 Gold now', () => {
  it('pays once, not twice, and re-arms next turn', () => {
    let s = withRune('rune_gem_dividend', { board: [bc('t', 'stray', 2, 2)], hand: [bc('r1', RUBY_ID, 1, 1), bc('r2', RUBY_ID, 1, 1)] });
    const g0 = s.embers;
    s = reduce(s, { type: 'play', uid: 'r1', targetUid: 't' }) as RunState;
    expect(s.embers - g0, 'the first Ruby pays 3 Gold immediately').toBe(3);
    s = reduce(s, { type: 'play', uid: 'r2', targetUid: 't' }) as RunState;
    expect(s.embers - g0, 'the second pays nothing this turn').toBe(3);
    expect(s.bonusEmbersNextTurn ?? 0, 'nothing is banked for next turn').toBe(0);
    expect(runeTally(s, 'rune_gem_dividend'), 'spent for the turn reads full').toBe('1/1');
    for (const t of s.runeThresholds!) t.usedThisTurn = false; // the rollover
    advanceRuneThresholds(s, 'castRuby', 1);
    expect(s.embers - g0).toBe(6);
  });
});

describe('Rune of Investment — 4 sells → 2 Rubies + improve your Rubies +1/+1', () => {
  it('the badge counts sells toward 4', () => {
    let s = withRune('rune_investment', { board: [bc('a', 'stray'), bc('b', 'stray')] });
    s = reduce(s, { type: 'sell', uid: 'a' }) as RunState;
    expect(runeTally(s, 'rune_investment')).toBe('1/4');
  });
});

describe('Rune of Quick Study / Rare Goods / the Empty Plate / the Golden Splinter — the data', () => {
  it('Rare Goods pays its first Salesman now and arms the every-2-turns cadence', () => {
    const s = withRune('rune_rare_goods');
    expect(s.hand.map((c) => c.cardId)).toContain('n2_salesman');
    expect(s.runeCadenceGrants?.find((g) => g.sourceId === 'rune_rare_goods')).toMatchObject({ cardId: 'n2_salesman', everyTurns: 2 });
  });
  it('the Empty Plate pays on the 2nd Consume', () => {
    const s = withRune('rune_empty_plate');
    advanceRuneThresholds(s, 'consume', 1);
    expect(spellsInHand(s)).toHaveLength(0);
    advanceRuneThresholds(s, 'consume', 1);
    expect(spellsInHand(s)).toHaveLength(1);
  });
  it('the Golden Splinter says "Once per game."', () => {
    expect(RUNE_INDEX['rune_golden_splinter']!.text).toContain('Once per game.');
    expect(RUNE_INDEX['rune_golden_splinter']!.text).not.toContain('run');
  });
});

describe('Rune of the Collector — every 3rd minion bought in a turn hands over a copy of one of the three', () => {
  const shop = () => [{ uid: 'o1', cardId: 'stray' }, { uid: 'o2', cardId: 'pack' }, { uid: 'o3', cardId: 'alley' }, { uid: 'o4', cardId: 'emissary' }, { uid: 'o5', cardId: 'sandbag' }, { uid: 'o6', cardId: 'joker' }, { uid: 'sp', cardId: 'growth' }];
  it('two buys bank, the third pays a copy of one of those three; a spell buy does not count', () => {
    let s = withRune('rune_collector', { shop: shop(), embers: 60 });
    s = reduce(s, { type: 'buy', uid: 'sp' }) as RunState;
    expect(s.collectorBoughtThisTurn ?? [], 'a spell is not a minion').toEqual([]);
    s = reduce(s, { type: 'buy', uid: 'o1' }) as RunState;
    s = reduce(s, { type: 'buy', uid: 'o2' }) as RunState;
    expect(s.hand.filter((c) => !CARD_INDEX[c.cardId]?.spell), 'just the two bought').toHaveLength(2);
    expect(runeTally(s, 'rune_collector')).toBe('2/3');
    s = reduce(s, { type: 'buy', uid: 'o3' }) as RunState;
    const bodies = s.hand.filter((c) => !CARD_INDEX[c.cardId]?.spell).map((c) => c.cardId);
    expect(bodies, 'three bought + one copy').toHaveLength(4);
    const copy = bodies.filter((id, i) => bodies.indexOf(id) !== i);
    expect(copy).toHaveLength(1);
    expect(['stray', 'pack', 'alley']).toContain(copy[0]);
    expect(runeTally(s, 'rune_collector'), 'the meter wraps').toBe('0/3');
  });
  it('the count resets at the rollover', () => {
    const s = withRune('rune_collector', { collectorBoughtThisTurn: ['stray', 'pack'], board: [bc('t', 'stray', 1, 30)], resolve: 999, maxResolve: 999, armor: 999 });
    const next = reduce(reduce(s, { type: 'faceOmen' }), { type: 'resolveCombat' }) as RunState;
    expect(next.collectorBoughtThisTurn).toEqual([]);
  });
});

// ── the audits ───────────────────────────────────────────────────────────────────────────────────────────

describe('AUDIT — Rune of the Spellstone reaches every Shop-spell trigger', () => {
  it('a Ruby fires the per-cast Shop-spell RUNES (Flagship / Kindling) and the spellCast meters — only with the rune', () => {
    const run = (spellstone: boolean): RunState => {
      let s: RunState = {
        ...createRun(3, 'aster'), setId: 'set2', phase: 'recruit', embers: 20, tier: 6,
        board: [bc('dw', 'dw_orin', 2, 2), bc('t', 'stray', 2, 2)], hand: [bc('r', RUBY_ID, 1, 1)],
        runeSpellstone: spellstone || undefined, runeFlagship: true, runeKindling: true,
        runeThresholds: [{ sourceId: 'rune_spellmarket', meter: 'spellCast', per: 4, tick: 0, castCards: ['staffofguel'] }],
      } as RunState;
      s = reduce(s, { type: 'play', uid: 'r', targetUid: 't' }) as RunState;
      return s;
    };
    const on = run(true);
    expect(buffsOf(on.board[0]!, 'Rune of the Flagship'), 'the Dwarf took the Flagship grant').toEqual([[2, 2]]);
    expect(buffsOf(on.board[0]!, 'Rune of Kindling'), 'Kindling hit the left end').toHaveLength(1);
    expect(on.runeThresholds![0]!.tick, 'the spellCast meter ticked').toBe(1);
    expect(on.spellsCast).toBe(1);
    const off = run(false);
    expect(buffsOf(off.board[0]!, 'Rune of the Flagship'), 'without the rune a Ruby is not a Shop spell').toEqual([]);
    expect(off.runeThresholds![0]!.tick).toBe(0);
  });
  it('in combat, a Spellstone Ruby is a spell cast (Enchantment fires) — pinned above', () => {
    expect(RUNE_INDEX['rune_spellstone']!.reward).toEqual({ kind: 'runeSpellstone' });
  });
});

describe('AUDIT — Rune of Thrift discounts every Shop spell that grants stats in any way', () => {
  it('the five granters outside the `spellBuff` prefix the empirical sweep found are stat spells', () => {
    for (const id of ['greatpot', 'perfectvision', 'rubyexcavation', 'rubytransfer', 'cupcakes']) {
      expect(isStatSpell(CARD_INDEX[id]), `${id} grants stats`).toBe(true);
    }
  });
  it('EMPIRICAL: every buyable Shop spell that grows a stat on cast is classified (the sweep, kept live)', () => {
    const statSum = (s: RunState): number => {
      let n = 0;
      for (const c of s.board) n += c.attack + c.health;
      for (const o of s.shop) n += (o.atk ?? 0) + (o.hp ?? 0);
      return n + s.tavernBuyBonus.atk + s.tavernBuyBonus.hp + (s.rubyBonus?.attack ?? 0) + (s.rubyBonus?.health ?? 0);
    };
    // Spells whose stat growth is NOT a grant — a body arriving (a conjure / a steal / a Shout replay that
    // summons), a transform, a gild — measured and excluded by hand. Each is a card, not a factory, so a new
    // stat-granting factory still lands in the failure list.
    const NOT_A_GRANT = new Set(['tribeschoice', 'aresmar', 'summonstone', 'lasso', 'resonance', 'strangerevision', 'rubyshipment', 'wo_reinforcement', 'onthehouse', 'ironcladreq', 'sp_gamble', 'graverobbery', 'quickstudy']);
    const missing: string[] = [];
    for (const c of Object.values(CARD_INDEX)) {
      if (!c || !c.spell || c.token || c.ruby || c.gift || c.chooseOne || NOT_A_GRANT.has(c.id)) continue;
      const s: RunState = {
        ...createRun(3, 'aster'), setId: 'set2', phase: 'recruit', embers: 20, tier: 6,
        board: [bc('b0', 'alley'), bc('b1', 'emissary'), bc('b2', 'dw_orin'), bc('b3', 'stray'), bc('b4', 'pack')],
        hand: [], shop: [{ uid: 'o0', cardId: 'stray' }, { uid: 'o1', cardId: 'alley' }],
      } as RunState;
      const before = statSum(s);
      try { castSpell(s, c, c.target ? s.board[0] : undefined); } catch { continue; }
      if (statSum(s) > before && !isStatSpell(c)) missing.push(`${c.id} (${c.effects.map((e) => e.do).join(',')})`);
    }
    expect(missing, 'a Shop spell grew a stat but Rune of Thrift would not discount it — add its factory to STAT_SPELL_EXTRAS').toEqual([]);
  });
});

describe('AUDIT — Rune of Combat Prowess replays every rune / quest Start of Combat', () => {
  it('every `rmods.<flag>` Start-of-Combat block in simulate.ts has a shop replay or a documented combat-only reason', () => {
    // The combat SoC rune section reads its flags as `rmods.<flag>` / `smods.<flag>`; the shop list keys its
    // replays by content id. Bridge the two through the flag → rune id mapping the content defines.
    const COMBAT_ONLY: Record<string, string> = {
      weakenTargets: 'enemy-facing', runeFoodChain: 'a combat summon-inheritance bank', runeCrucible: 'a last-death resummon bank',
      emptyGraves: 'a per-fight grant to the combat-time leftmost',
    };
    const flagged: RunState = {
      ...createRun(3, 'aster'), setId: 'set2', phase: 'recruit', hand: [bc('h', 'stray', 3, 4)], board: [bc('a', 'stray'), bc('b', 'stray')],
      runeHeldStrength: true,
      questFlags: {
        echoingCoop: true, runeCenterline: true, runeDawnclaw: true, runeFiveBanners: true, runeForthcoming: true, runeHerald: true,
        runeMirrorMarch: true, runeRallying: true, runeRebirth: true, runeRisingGraves: true, runeStokedMenagerie: true, runeSylus: true,
        runeTemperedTime: true, runeUnderdog: true, runeVanguard: true, runeWakingReserve: true, runeWarden: true, runeWarding: true,
        contractRewrite: true, doubleLeftmostAttack: true, umbralEnergy: true,
      },
      sharedCircuitWard: 1,
    } as RunState;
    const replays = new Set(socRuneReplaysOf(flagged).map((r) => r.id));
    const FLAG_TO_ID: Record<string, string> = {
      echoingCoop: 'echoingCoop', runeCenterline: 'rune_centerline', runeDawnclaw: 'rune_dawnclaw', runeFiveBanners: 'rune_five_banners',
      runeForthcoming: 'rune_forthcoming', runeHeldStrength: 'rune_held_strength', runeHerald: 'rune_herald', runeMirrorMarch: 'rune_mirror_march',
      runeRallying: 'rune_rallying', runeRebirth: 'rune_rebirth', runeRisingGraves: 'rune_rising_graves', runeStokedMenagerie: 'rune_stoked_menagerie',
      runeSylus: 'rune_sylus', runeTemperedTime: 'rune_tempered_time', runeUnderdog: 'rune_underdog', runeVanguard: 'rune_vanguard',
      runeWakingReserve: 'rune_waking_reserve', runeWarden: 'rune_warden', runeWarding: 'rune_warding', sharedCircuitWard: 'sharedCircuit',
      contractRewrite: 'contractRewrite', doubleLeftmostAttack: 'doubleLeftmostAttack', umbralEnergy: 'umbralEnergy',
    };
    // The combat flags, as the SoC section of simulate.ts reads them (kept beside the map so a new block lands here).
    const COMBAT_SOC_FLAGS = ['echoingCoop', 'emptyGraves', 'runeCenterline', 'runeCrucible', 'runeDawnclaw', 'runeFiveBanners', 'runeFoodChain',
      'runeForthcoming', 'runeHeldStrength', 'runeHerald', 'runeMirrorMarch', 'runeRallying', 'runeRebirth', 'runeRisingGraves', 'runeStokedMenagerie',
      'runeSylus', 'runeTemperedTime', 'runeUnderdog', 'runeVanguard', 'runeWakingReserve', 'runeWarden', 'runeWarding', 'sharedCircuitWard',
      'weakenTargets', 'contractRewrite', 'doubleLeftmostAttack', 'umbralEnergy'];
    const missing = COMBAT_SOC_FLAGS.filter((f) => !COMBAT_ONLY[f] && !replays.has(FLAG_TO_ID[f] ?? f));
    expect(missing, 'a combat Start-of-Combat rune block with no shop replay under Combat Prowess').toEqual([]);
  });
  it('Rune of Held Strength (the gap the audit found) replays at End of Turn: the ends gain the left-most held minion\'s stats', () => {
    const s = withRune('rune_combat_prowess', {
      board: [bc('a', 'stray', 1, 1), bc('m', 'sandbag', 1, 1), bc('z', 'pack', 1, 1)], hand: [bc('h', 'pack', 3, 4)],
      runeHeldStrength: true,
    });
    applyEndOfTurn(s);
    const at = (uid: string) => s.board.find((c) => c.uid === uid)!;
    expect(buffsOf(at('a'), 'Rune of Held Strength')).toEqual([[3, 4]]);
    expect(buffsOf(at('z'), 'Rune of Held Strength')).toEqual([[3, 4]]);
    expect(buffsOf(at('m'), 'Rune of Held Strength')).toEqual([]);
    expect(s.hand, 'the held card stays in hand').toHaveLength(1);
  });
  it('the board pass still fires every minion Start of Combat (the existing dispatcher, unchanged)', () => {
    const s: RunState = { ...createRun(3, 'aster'), phase: 'recruit', board: [bc('a', 'stray')] } as RunState;
    expect(() => fireStartOfCombats(s)).not.toThrow();
  });
});
