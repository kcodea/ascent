import { describe, it, expect } from 'vitest';
import { ARCHIVED_CARDS, ARCHIVED_RUNES, CARD_INDEX, EPIC_RUNES, RUNES, RUNE_INDEX, poolFor, type SetId } from '@game/content';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatEvent } from '@game/core';
import { createRun, reduce, type BoardCard, type RunState } from './index';
import { applyEndOfTurn, fireSpellCastWatchersForRuby, isStatGrantingSpell } from './recruit';
import { runSpells } from './spellPool';

/**
 * OWNER BALANCE BATCH 2026-10-07 (data half): the archives, the rune numbers, the minion reworks and the new
 * Dwarf, each proved through the real path (the Runeforge buy reducer, the play reducer, End of Turn, `simulate`).
 */
const SETS: SetId[] = ['set1', 'set2', 'set3'];
const body = (cardId: string, uid: string, extra: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...extra };
};
const recruit = (extra: Partial<RunState> = {}): RunState =>
  ({ ...createRun(7), wave: 6, tier: 6, phase: 'recruit', embers: 40, ...extra } as RunState);
/** Buy `id` from a one-rune forge on a rich turn-7 shop. */
const withRune = (id: string, extra: Partial<RunState> = {}): RunState =>
  reduce({ ...createRun(3, 'runesmith'), wave: 7, tier: 6, phase: 'recruit', embers: 40, runeforgeOffer: [id], ...extra } as RunState, { type: 'buyRune', index: 0 }) as RunState;
/** Face the next opponent and settle it: one full turn, on a run that cannot lose. */
const turn = (s: RunState): RunState => {
  const safe = { ...s, resolve: 999, maxResolve: 999, armor: 999 } as RunState;
  return reduce(reduce(safe, { type: 'faceOmen' }) as RunState, { type: 'resolveCombat' }) as RunState;
};
const bm = (cardId: string, uid: string, attack: number, health: number, extra: Partial<BoardMinion> = {}): BoardMinion =>
  ({ cardId, attack, health, sourceUid: uid, keywords: [], ...extra });

const ARCHIVED_SPELLS = ['hourglassreserve', 'fleetingvigor', 'deepdelvewrit', 'layaway', 'sp_solidground', 'openthegates', 'sp_partingcry',
  'sp_closedcasket', 'sp_containmentrune', 'farseersreport', 'markedtarget', 'sp_beefy', 'sp_stoleninitiative'];
const ARCHIVED_RUNE_IDS = ['rune_ruby_resonance', 'rune_contraband', 'rune_gemcutting', 'rune_shifting_facets', 'rune_gem_dividend',
  'rune_gemscript', 'rune_gemstorm', 'rune_redirection', 'rune_ruby_shrapnel', 'rune_last_call', 'rune_profit_sharing', 'rune_chef',
  'rune_blasting_voices', 'rune_last_word'];

describe('2026-10-07 archives: out of every set, still resolvable', () => {
  it('the thirteen spells are in the archive and in no set pool, but still resolve by id', () => {
    for (const id of ARCHIVED_SPELLS) {
      expect(ARCHIVED_CARDS.some((c) => c.id === id), `${id} archived`).toBe(true);
      expect(CARD_INDEX[id], `${id} still resolves`).toBeDefined();
      for (const set of SETS) expect(poolFor(set).all.some((c) => c.id === id), `${id} not in ${set}`).toBe(false);
    }
  });

  it('the fourteen runes are in the rune archive with sets: [], out of both forge stocks, and still in RUNE_INDEX', () => {
    for (const id of ARCHIVED_RUNE_IDS) {
      expect(ARCHIVED_RUNES.find((r) => r.id === id)?.sets, `${id} archived with no sets`).toEqual([]);
      expect([...RUNES, ...EPIC_RUNES].some((r) => r.id === id), `${id} not stocked`).toBe(false);
      expect(RUNE_INDEX[id], `${id} still resolves`).toBeDefined();
    }
    // Rune of Resonance is a different rune and stays.
    expect([...RUNES, ...EPIC_RUNES].some((r) => r.id === 'rune_resonance')).toBe(true);
  });

  it('cross-check with the Dragon rune batch: the Spell Generator (Wise Armory) stat-spell pool never offers an archived spell', () => {
    for (const set of SETS) {
      const pool = runSpells({ setId: set, tribes: ['beast', 'dragon', 'undead', 'mech', 'demon', 'kobold', 'dwarf', 'spirit', 'celestial'] }).filter((c) => isStatGrantingSpell(c));
      expect(pool.length, set).toBeGreaterThan(0);
      for (const id of ARCHIVED_SPELLS) expect(pool.some((c) => c.id === id), `${id} in ${set}`).toBe(false);
    }
  });

  it('OWNER RULING: Arnold still casts the archived Beefy on himself at End of Turn', () => {
    const s = recruit({ hand: [], board: [body('dw_arnold', 'a'), body('alley', 'n')] });
    applyEndOfTurn(s);
    expect(s.board.find((c) => c.uid === 'a')!.attack, 'Beefy landed on Arnold').toBeGreaterThan(9);
  });

  it('OWNER RULING: Dwarven Sharpshooter still grants the archived Deep Delve Writ, and the Writ still casts', () => {
    let s = recruit({ board: [], hand: [body('dw_sharpshooter', 'ss')], shop: [] });
    s = reduce(s, { type: 'play', uid: 'ss' }) as RunState;
    const writ = s.hand.find((c) => c.cardId === 'deepdelvewrit');
    expect(writ, 'one Writ granted').toBeDefined();
    // A Dwarf in the shop to steal.
    s = { ...s, shop: [{ uid: 'o1', cardId: 'dw_pimm' }] } as RunState;
    s = reduce(s, { type: 'play', uid: writ!.uid }) as RunState;
    expect(s.hand.some((c) => c.uid === writ!.uid), 'the Writ was cast').toBe(false);
    expect(s.hand.some((c) => c.cardId === 'dw_pimm'), 'it stole the shop Dwarf').toBe(true);
  });
});

describe('2026-10-07 rune numbers', () => {
  const rune = (id: string) => RUNE_INDEX[id]!;
  it('costs: Stormcalling 3, Foundry 3, Summit 5, Deep 5, Summoning 1', () => {
    expect(['rune_stormcalling', 'rune_foundry', 'rune_summit', 'rune_deep', 'rune_summoning'].map((id) => rune(id).cost)).toEqual([3, 3, 5, 5, 1]);
  });

  it('Rune of Ascension is neutral (no tribe gate)', () => {
    expect(rune('rune_ascension').tribes ?? []).toEqual([]);
  });

  it('the Deep pays on purchase, skips the next turn, and pays again the turn after (every 2 turns)', () => {
    const t7 = (st: RunState) => st.hand.filter((c) => CARD_INDEX[c.cardId]?.tier === 7).length;
    const s0 = withRune('rune_deep', { hand: [], board: [body('sandbag', 't', { attack: 0, health: 50 })] });
    expect(rune('rune_deep').text).toBe('Get a random **Tier 7** minion. Repeat every **2 turns**.');
    expect(t7(s0), 'one on purchase').toBe(1);
    const s1 = turn(s0);
    expect(t7(s1), 'none at the next Start of Turn').toBe(1);
    expect(s1.runeDeepTick).toBe(1);
    const s2 = turn(s1);
    expect(t7(s2), 'one two turns after the purchase').toBe(2);
    expect(s2.runeDeepTick).toBe(0);
  });

  it('a run that armed the Deep before the cadence (no runeDeepEvery) still pays every turn', () => {
    const legacy = recruit({ hand: [], board: [body('sandbag', 't', { attack: 0, health: 50 })], runeDeep: 7, ownedRunes: ['rune_deep'] });
    const t7 = (st: RunState) => st.hand.filter((c) => CARD_INDEX[c.cardId]?.tier === 7).length;
    expect(t7(turn(legacy))).toBe(1);
  });

  it('the Runic Hoard gives 3 random Dragons +3/+4 per spell cast, read off the reward', () => {
    expect(rune('rune_runic_hoard').reward).toMatchObject({ kind: 'runeRunicHoard', attack: 3, health: 4 });
    const s = recruit({
      runeRunicHoard: true, ownedRunes: ['rune_runic_hoard'],
      board: [body('karwind', 'k')], hand: [{ uid: 'p', cardId: 'emberpouch', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
    });
    const before = s.board[0]!;
    const after = (reduce(s, { type: 'play', uid: 'p' }) as RunState).board.find((c) => c.uid === 'k')!;
    expect([after.attack - before.attack, after.health - before.health]).toEqual([3, 4]);
  });
});

describe('2026-10-07 Set 3 changes', () => {
  it('Lullaby Lou buffs a friendly Spirit on board +4/+6, never itself, and leaves the hand alone', () => {
    const lou = body('sp3_dreamcurrent', 'lou');
    const spirit = body('sp3_dreamcurrent', 'friend'); // any Spirit body
    const handMinion = body('alley', 'h');
    const s = recruit({ board: [lou, spirit], hand: [handMinion, { uid: 'p', cardId: 'emberpouch', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }] });
    const after = reduce(s, { type: 'play', uid: 'p' }) as RunState;
    const l = after.board.find((c) => c.uid === 'lou')!;
    const f = after.board.find((c) => c.uid === 'friend')!;
    // Both are Lous, so each buffs the OTHER once: each gains exactly +4/+6, never its own.
    expect([l.attack - lou.attack, l.health - lou.health]).toEqual([4, 6]);
    expect([f.attack - spirit.attack, f.health - spirit.health]).toEqual([4, 6]);
    expect(after.hand.find((c) => c.uid === 'h')!.attack, 'the hand is no longer the target').toBe(handMinion.attack);
  });

  it('a lone Lou has no other Spirit to buff', () => {
    const lou = body('sp3_dreamcurrent', 'lou');
    const s = recruit({ board: [lou], hand: [{ uid: 'p', cardId: 'emberpouch', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }] });
    const l = (reduce(s, { type: 'play', uid: 'p' }) as RunState).board[0]!;
    expect([l.attack, l.health]).toEqual([lou.attack, lou.health]);
  });

  it('Roundabout: End of Turn gives the shop +6/+7 permanently (gilded +12/+14)', () => {
    for (const [golden, a, h] of [[false, 6, 7], [true, 12, 14]] as const) {
      const s = recruit({ hand: [], board: [body('ce3_orbitkeeper', 'r', { golden })] });
      const before = { ...s.tavernBuyBonus };
      applyEndOfTurn(s);
      expect([s.tavernBuyBonus.atk - before.atk, s.tavernBuyBonus.hp - before.hp]).toEqual([a, h]);
    }
  });

  it('Lens Grinder / The Great Attractor numbers', () => {
    expect(CARD_INDEX['ce3_lensgrinder']!.text).toContain('+5/+5');
    expect(CARD_INDEX['ce3_lensgrinder']!.goldenText).toContain('+10/+10');
    expect(CARD_INDEX['ce3_accretionwarden']!.effects[0]).toMatchObject({ do: 'buffThisShop', params: { attack: 3, health: 2 } });
  });
});

describe('2026-10-07 Set 2 minions', () => {
  it('Flo Rida: +5/+5 to the summoned Beast, improving +5/+5 each time (5, 10, 15)', () => {
    // Three DIFFERENT vanilla Beasts (three copies of one card would triple).
    const ids = ['stray', 'pup', 'b2_trexbaby'];
    let s = recruit({ board: [body('b2_florida', 'flo')], hand: ids.map((id, i) => body(id, `b${i}`)) });
    const gains: number[] = [];
    ids.forEach((id, i) => {
      s = reduce(s, { type: 'play', uid: `b${i}` }) as RunState;
      const c = s.board.find((x) => x.uid === `b${i}`)!;
      gains.push(c.attack - CARD_INDEX[id]!.attack);
    });
    expect(CARD_INDEX['stray']!.tribe).toBe('beast');
    expect(gains).toEqual([5, 10, 15]);
  });

  it('Beardsley: +1/+1 improving +1/+1 each Beast, and no Ward', () => {
    expect(CARD_INDEX['b2_beardsley']!.keywords).toEqual([]);
    let s = recruit({ board: [body('b2_beardsley', 'bd')], hand: [body('stray', 'b1'), body('stray', 'b2')] });
    const base = CARD_INDEX['stray']!;
    const gains: number[] = [];
    for (const uid of ['b1', 'b2']) {
      s = reduce(s, { type: 'play', uid }) as RunState;
      gains.push(s.board.find((x) => x.uid === uid)!.attack - base.attack);
    }
    expect(gains).toEqual([1, 2]);
  });

  it('Wolvie: Echo gives a friendly Beast Rise with no empty buff; gilded gives 2 Beasts Rise', () => {
    for (const golden of [false, true]) {
      const player = [bm('b2_wolvie', 'w', 3, 1, { golden }), bm('alley', 'a1', 1, 30), bm('alley', 'a2', 1, 30)];
      const enemy = [bm('sandbag', 'e', 20, 400)];
      const r = simulate(player, enemy, makeRng(3), CARD_INDEX, combatSide({ tier: 6 }), combatSide({ tier: 6 }));
      const wolvieUid = r.initial.player[0]!.uid;
      const fromWolvie = r.events.filter((e) => (e as { source?: string }).source === wolvieUid);
      const buffs = fromWolvie.filter((e) => e.type === 'buff') as Extract<CombatEvent, { type: 'buff' }>[];
      expect(buffs.filter((b) => b.attack === 0 && b.health === 0), 'no empty +0/+0 buff').toEqual([]);
      const risen = new Set(r.events.filter((e) => e.type === 'keyword' && (e as { keyword?: string }).keyword === 'R' && (e as { source?: string }).source === wolvieUid).map((e) => (e as { target?: string }).target));
      expect(risen.size, golden ? 'two different Beasts' : 'one Beast').toBe(golden ? 2 : 1);
    }
  });

  it('Chef Gary Toast gives +5/+5 (+6/+5 since the owner balance 2026-10-10); Brunni is Tier 3 in Set 2 and Set 3', () => {
    expect(CARD_INDEX['dw_chef']!.effects[0]!.params).toMatchObject({ attack: 6, health: 5 });
    expect(CARD_INDEX['dw_brunni']!.tier).toBe(3);
    for (const set of ['set2', 'set3'] as const) expect(poolFor(set).buyable.some((c) => c.id === 'dw_brunni'), set).toBe(true);
  });

  it('Jewel is in Set 2 and Set 3; Brood Matron is in Set 1 and Set 2; both appended at the end of Set 2', () => {
    for (const set of ['set2', 'set3'] as const) expect(poolFor(set).buyable.some((c) => c.id === 'k3_jeweler'), set).toBe(true);
    for (const set of ['set1', 'set2'] as const) expect(poolFor(set).buyable.some((c) => c.id === 'brood'), set).toBe(true);
    const all = poolFor('set2').all.map((c) => c.id);
    // The 2026-10-10 adds (Striker, Drunk Daniel, Hydraskus) were appended after these two, so they sit just before them.
    expect(all.slice(-5, -3)).toEqual(['k3_jeweler', 'brood']);
  });

  it('Big Brain Billy: T2 Dwarf 2/2 in Set 2, +1/+1 per Shop spell (gilded +2/+2), a Ruby does not count', () => {
    const def = CARD_INDEX['dw_bigbrainbilly']!;
    expect([def.tier, def.attack, def.health, def.tribe, !!def.token]).toEqual([2, 2, 2, 'dwarf', false]);
    expect(poolFor('set2').buyable.some((c) => c.id === 'dw_bigbrainbilly')).toBe(true);
    for (const [golden, step] of [[false, 1], [true, 2]] as const) {
      const s = recruit({ board: [body('dw_bigbrainbilly', 'bb', { golden })], hand: [{ uid: 'p', cardId: 'emberpouch', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }] });
      const after = (reduce(s, { type: 'play', uid: 'p' }) as RunState).board[0]!;
      expect([after.attack, after.health]).toEqual([2 + step, 2 + step]);
    }
    const r = recruit({ board: [body('dw_bigbrainbilly', 'bb')] });
    fireSpellCastWatchersForRuby(r, CARD_INDEX['ruby']!, 1);
    expect([r.board[0]!.attack, r.board[0]!.health], 'a Ruby is not a Shop spell').toEqual([2, 2]);
  });
});
