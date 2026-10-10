import { describe, it, expect } from 'vitest';
import { ARCHIVED_CARDS, CARD_INDEX, RUNE_INDEX, SETS, poolFor, type SetId } from '@game/content';
import { aleGrantCount, combatSide, damageMeterOf, makeRng, simulate, ALE_IDS, type BoardMinion } from '@game/core';
import { createRun, reduce, type BoardCard, type RunState } from './index';
import { applyEndOfTurn, endOfTurnTicksOf, eotTickCount, fireRecruitDeathrattlesForTest, projectEndOfTurnSteps } from './recruit';

/**
 * OWNER BALANCE BATCH 2026-10-10 (Demons, Dwarves, Beasts, the Gift runes, the archives, two new Tier 6 minions).
 * Each change is proved through the real path: the play / Runeforge reducer, End of Turn and its projection, the
 * shop Echo ritual and `simulate`.
 */
const ALL_SETS: SetId[] = ['set1', 'set2', 'set3'];
const body = (cardId: string, uid: string, extra: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...extra };
};
const recruit = (extra: Partial<RunState> = {}): RunState =>
  ({ ...createRun(7), setId: 'set2', wave: 6, tier: 6, phase: 'recruit', embers: 40, ...extra } as RunState);
const withRune = (id: string, extra: Partial<RunState> = {}): RunState =>
  reduce({ ...createRun(3, 'runesmith'), wave: 7, tier: 6, phase: 'recruit', embers: 40, runeforgeOffer: [id], ...extra } as RunState, { type: 'buyRune', index: 0 }) as RunState;
const turn = (s: RunState): RunState => {
  const safe = { ...s, resolve: 999, maxResolve: 999, armor: 999 } as RunState;
  return reduce(reduce(safe, { type: 'faceOmen' }) as RunState, { type: 'resolveCombat' }) as RunState;
};
const ales = (s: RunState): number => s.hand.filter((c) => ALE_IDS.includes(c.cardId)).length;
const SET2 = poolFor('set2').all.map((c) => c.id);

const ARCHIVED = ['dm_maw', 'dw_arnold', 'dw_chickenbrawl', 'commonground', 'mightofaeon', 'sp_dissipate', 'rivalsreflection', 'ironcladreq'];

describe('2026-10-10 archives: out of every set, still resolvable', () => {
  it('the three minions and five spells are in the archive and in no set pool, but still resolve by id', () => {
    for (const id of ARCHIVED) {
      expect(ARCHIVED_CARDS.some((c) => c.id === id), `${id} archived`).toBe(true);
      expect(CARD_INDEX[id], `${id} still resolves`).toBeDefined();
      for (const set of ALL_SETS) expect(poolFor(set).all.some((c) => c.id === id), `${id} not in ${set}`).toBe(false);
    }
  });

  it('set 3 builds without Dissipate and Rival\'s Reflection in its shared spell list', () => {
    const ids = poolFor('set3').spells.map((c) => c.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids).not.toContain('sp_dissipate');
    expect(ids).not.toContain('rivalsreflection');
  });

  it('OWNER RULING: Rune of Might still casts the archived Might of Aeon (lookup by id)', () => {
    expect(RUNE_INDEX['rune_might']!.previewCards).toEqual(['mightofaeon']);
    expect(CARD_INDEX['mightofaeon']!.effects[0]!.do).toBe('spellBuffRandomFriendlies');
    const pouch = { uid: 'p', cardId: 'emberpouch', tribe: 'neutral' as const, attack: 0, health: 1, keywords: [], golden: false };
    const board = [body('alley', 'a'), body('dw_brakka', 'b'), body('dw_pimm', 'c')]; // three DIFFERENT minions (three Alley Cats would triple)
    const base = board.reduce((n, c) => n + c.attack + c.health, 0);
    const armed = recruit({ runeMight: true, ownedRunes: ['rune_might'], board, hand: [pouch] } as Partial<RunState>);
    const after = reduce(armed, { type: 'play', uid: 'p' }) as RunState;
    const total = after.board.reduce((n, c) => n + c.attack + c.health, 0);
    // Might of Aeon: 3 random friendlies +2/+3 each (spell power 0) = +15 total stats on a 3-minion board.
    expect(total - base, 'Might of Aeon landed').toBe(15);
    const unarmed = reduce(recruit({ board: board.map((c) => ({ ...c })), hand: [pouch] }), { type: 'play', uid: 'p' }) as RunState;
    expect(unarmed.board.reduce((n, c) => n + c.attack + c.health, 0) - base, 'no rune, no cast').toBe(0);
  });
});

describe('2026-10-10 set membership: Striker, Drunk Daniel and Hydraskus appended to set 2', () => {
  it('Striker joins set 2 and stays in set 3; the three adds sit at the very END of set 2\'s own list', () => {
    expect(SETS.set3.own.some((c) => c.id === 'dw3_striker')).toBe(true);
    const own = SETS.set2.own.map((c) => c.id);
    expect(own.slice(-3)).toEqual(['dw3_striker', 'dw_drunkdaniel', 'dm_hydraskus']);
    const buyable = poolFor('set2').buyable.map((c) => c.id);
    for (const id of ['dw3_striker', 'dw_drunkdaniel', 'dm_hydraskus']) expect(buyable, id).toContain(id);
  });

  it('the new cards: Drunk Daniel T6 6/6 Dwarf, Hydraskus T6 6/8 Demon', () => {
    const d = CARD_INDEX['dw_drunkdaniel']!;
    expect([d.tribe, d.tier, d.attack, d.health, d.token ?? false]).toEqual(['dwarf', 6, 6, 6, false]);
    const h = CARD_INDEX['dm_hydraskus']!;
    expect([h.tribe, h.tier, h.attack, h.health, h.token ?? false]).toEqual(['demon', 6, 6, 8, false]);
  });
});

describe('Doubletap Brewer: "End of Turn: Get a Dwarven Ale. Get another if you are Shop Tier 5+."', () => {
  it('the card: T4 4/2, one End of Turn effect, no Shout or Echo', () => {
    const c = CARD_INDEX['dw_brewer']!;
    expect([c.tier, c.attack, c.health]).toEqual([4, 4, 2]);
    expect(c.effects).toEqual([{ on: 'endOfTurn', do: 'grantRandomAle', params: { count: 1, bonusAtTier: 5, bonusCount: 1 } }]);
    expect(c.text).toBe('**End of Turn:** get a **Dwarven Ale**. Get another if you are **Shop Tier 5+**.');
  });

  it('the shared count: 1 below Tier 5, 2 at Tier 5+, doubled gilded', () => {
    const p = CARD_INDEX['dw_brewer']!.effects[0]!.params;
    expect([aleGrantCount(p, 4, false), aleGrantCount(p, 5, false), aleGrantCount(p, 6, false)]).toEqual([1, 2, 2]);
    expect([aleGrantCount(p, 4, true), aleGrantCount(p, 5, true)]).toEqual([2, 4]);
    expect(aleGrantCount({ count: 1 }, 6, false), 'no condition: the old flat grant').toBe(1);
  });

  it('SHOP End of Turn: 1 Ale at Tier 4, 2 at Tier 5, 4 gilded at Tier 5', () => {
    const at = (tier: number, golden = false): number => {
      const s = recruit({ tier, hand: [], board: [body('dw_brewer', 'b', { golden })] });
      applyEndOfTurn(s);
      return ales(s);
    };
    expect(at(4)).toBe(1);
    expect(at(5)).toBe(2);
    expect(at(5, true)).toBe(4);
  });
});

describe('Brunni: "Taunt. Echo: Get a Dwarven Ale."', () => {
  it('keeps Taunt, its End of Turn is gone, and its Echo pays in the shop', () => {
    const c = CARD_INDEX['dw_brunni']!;
    expect(c.keywords).toEqual(['T']);
    expect(c.goldenText).toBe('**Taunt.** **Echo:** get **2 Dwarven Ales**.');
    const s = recruit({ hand: [], board: [body('dw_brunni', 'br')] });
    applyEndOfTurn(s);
    expect(ales(s), 'no End of Turn Ale any more').toBe(0);
    fireRecruitDeathrattlesForTest(s, s.board[0]!);
    expect(ales(s), 'the Echo grants one').toBe(1);
  });

  it('COMBAT: a dying Brunni sends an Ale home', () => {
    const brunni = { cardId: 'dw_brunni', attack: 3, health: 1, keywords: ['T'], sourceUid: 'br' } as unknown as BoardMinion;
    const foe = { cardId: 'sandbag', attack: 10, health: 50, keywords: [] } as unknown as BoardMinion;
    const r = simulate([brunni], [foe], makeRng(4), CARD_INDEX, combatSide({ tier: 3, poolIds: SET2 }), combatSide({ tier: 3 }));
    expect((r.playerHandGrants ?? []).filter((id) => ALE_IDS.includes(id)).length).toBe(1);
  });
});

describe('Chef Gary Toast +6/+5 (separate health param) and Billings +6/+5', () => {
  it('playing a Dwarf gives your Dwarves +6/+5', () => {
    const s = recruit({ board: [body('dw_chef', 'c'), body('dw_brakka', 'b')], hand: [body('dw_pimm', 'p')] });
    const after = reduce(s, { type: 'play', uid: 'p' }) as RunState;
    const b = after.board.find((c) => c.uid === 'b')!;
    expect([b.attack - 5, b.health - 3]).toEqual([6, 5]);
  });

  it('Billings reads +6/+5', () => {
    expect(CARD_INDEX['dw_billings']!.effects[0]!.params).toMatchObject({ attack: 6, health: 5 });
  });
});

describe('Impossible Todd: "When a friendly Demon deals damage, give your Imps +2/+1. Pummel (20): Summon an Imp. (Once per combat.)"', () => {
  const todd = (over: Partial<BoardMinion> = {}): BoardMinion =>
    ({ cardId: 'dm_todd', attack: 10, health: 300, keywords: [], sourceUid: 't', ...over } as unknown as BoardMinion);
  const sandbag = (health: number): BoardMinion => ({ cardId: 'sandbag', attack: 0, health, keywords: [] } as unknown as BoardMinion);
  const fight = (board: BoardMinion[], foes: BoardMinion[]) =>
    simulate(board, foes, makeRng(9), CARD_INDEX, combatSide({ tier: 6, poolIds: SET2 }), combatSide({ tier: 6 }));
  const impSummons = (r: ReturnType<typeof fight>) =>
    r.events.filter((e) => e.type === 'summon' && e.side === 'player' && e.minion.cardId === 'impscrap');

  it('the card: no Ward, no self-buff, a Pummel (20) summon meter', () => {
    const c = CARD_INDEX['dm_todd']!;
    expect(c.keywords).toEqual([]);
    expect(damageMeterOf(c)).toEqual({ do: 'dealtDamageSummonToken', every: 20 });
    expect(c.effects[0]).toEqual({ on: 'friendlyDemonDealtDamage', do: 'onFriendlyDemonDamageBuffSelf', params: { impAttack: 2, impHealth: 1 } });
  });

  it('20 damage dealt summons ONE Imp beside it, once per combat, and Todd does not grow', () => {
    const r = fight([todd()], [sandbag(25), sandbag(25), sandbag(25)]);
    expect(impSummons(r).length, 'once per combat').toBe(1);
    expect(r.events.filter((e) => e.type === 'pummelTrigger' && e.marker === 'dealtDamageSummonToken').length).toBe(1);
    // Todd's own Attack never grew from his hits (no self-buff any more).
    const toddBuffs = r.events.filter((e) => e.type === 'buff' && (e as { target?: string }).target === r.initial.player[0]!.uid);
    expect(toddBuffs.length).toBe(0);
  });

  it('below 20 damage nothing is summoned; gilded summons 2', () => {
    expect(impSummons(fight([todd({ attack: 5 })], [sandbag(15)])).length, '15 damage dealt in all').toBe(0);
    const golden = fight([todd({ golden: true, attack: 20 })], [sandbag(100)]);
    expect(impSummons(golden).length).toBe(2);
  });
});

describe('Kennelmaster: "+2 Attack. Avenge (3): Improve this." (+2 per improve; gilded +4 improving +4)', () => {
  it('params and text', () => {
    const c = CARD_INDEX['kennel']!;
    expect(c.effects[0]!.params).toMatchObject({ attack: 2, stepAttack: 2 });
    expect(c.effects[1]!.params).toEqual({ count: 3 });
    expect(c.text).toBe('**Start of Combat:** Give all Friendly and summoned Beasts **+2 Attack**. **Avenge (3):** Improve this.');
  });
});

describe('Dawnclaw: "Taunt. Echo: Trigger both adjacent minions\' Shouts."', () => {
  it('no longer picks one neighbour', () => {
    expect(CARD_INDEX['b2_dawnclaw']!.effects).toEqual([{ on: 'onDeath', do: 'deathrattleReplayAdjacentBattlecry', params: {} }]);
  });

  it('SHOP Echo: both neighbouring Shouts fire (once plain, twice gilded)', () => {
    const fire = (golden: boolean): number => {
      const s = recruit({ board: [body('dw_orin', 'l'), body('b2_dawnclaw', 'd', { golden }), body('dw_pimm', 'r')], bonusEmbersNextTurn: 0 });
      fireRecruitDeathrattlesForTest(s, s.board[1]!);
      return s.bonusEmbersNextTurn ?? 0;
    };
    expect(fire(false), 'Pimm (right) fires once: +1 Gold next turn').toBe(1);
    expect(fire(true), 'gilded: twice').toBe(2);
  });
});

describe('Demon numbers', () => {
  it('Tormentor +8/+8, Enigma +4/+5, Butcher +2/+2, Hank +4/+3, Grobbus 2 Demons', () => {
    expect(CARD_INDEX['dm_tormentor']!.effects[0]!.params).toEqual({ attack: 8, health: 8 });
    expect(CARD_INDEX['dm_jumbo']!.effects[0]!.params).toEqual({ attack: 4, health: 5 });
    expect(CARD_INDEX['dm_butcher']!.effects[0]!.params).toEqual({ attack: 2, health: 2 });
    expect(CARD_INDEX['dm_hank']!.effects[0]!.params).toEqual({ attack: 4, health: 3 });
    expect(CARD_INDEX['dm_grobbus']!.effects[0]!.params).toMatchObject({ grant: 2 });
  });

  it('Big Huggies: Taunt (owner ruling) and Echo: 2 Picnics (4 gilded)', () => {
    expect(CARD_INDEX['dm_velvet']!.keywords).toEqual(['T']);
    expect(CARD_INDEX['dm_velvet']!.text).toBe('**Taunt.** **Echo:** get **2 Picnics**.');
    expect(CARD_INDEX['dm_velvet']!.goldenText).toBe('**Taunt.** **Echo:** get **4 Picnics**.');
    const grant = (golden: boolean): number => {
      const s = recruit({ hand: [], board: [body('dm_velvet', 'v', { golden })] });
      fireRecruitDeathrattlesForTest(s, s.board[0]!);
      return s.hand.filter((c) => c.cardId === 'sp_picnic').length;
    };
    expect([grant(false), grant(true)]).toEqual([2, 4]);
  });

  it('Soul Defiler casts Staff of Guel AND Picnic at End of Turn (both twice gilded)', () => {
    const cast = (golden: boolean): RunState => {
      const s = recruit({ board: [body('dm_curator', 's', { golden })], shop: [{ uid: 'o1', cardId: 'dm_knocked' }] } as Partial<RunState>);
      applyEndOfTurn(s);
      return s;
    };
    const plain = cast(false);
    const gilded = cast(true);
    expect(plain.spellsThisTurn, 'two casts').toBe(2);
    expect(gilded.spellsThisTurn, 'four casts').toBe(4);
  });
});

describe('Hydraskus: "End of Turn: Your Demons consume a minion in the Shop."', () => {
  const shop = (n: number) => Array.from({ length: n }, (_, i) => ({ uid: `o${i}`, cardId: 'dm_knocked' }));
  const demons = () => [body('dm_hydraskus', 'h'), body('dw_brakka', 'x'), body('dm_knocked', 'k1'), body('dm_leech', 'k2')];

  it('EVERY friendly Demon eats one Shop minion, left to right; the non-Demon eats nothing', () => {
    const s = recruit({ board: demons(), shop: shop(5) } as Partial<RunState>);
    expect(eotTickCount(s, CARD_INDEX['dm_hydraskus']!.effects[0]!), 'one tick per Demon').toBe(3);
    applyEndOfTurn(s);
    expect(s.shopEaten?.map((e) => e.eaterUid)).toEqual(['h', 'k1', 'k2']);
    expect(s.shop.length).toBe(2);
    const k1 = s.board.find((c) => c.uid === 'k1')!;
    expect([k1.attack, k1.health], 'Knocked ate a 2/2').toEqual([4, 4]);
  });

  it('the Shop running dry ends the feast: later Demons eat nothing', () => {
    const s = recruit({ board: demons(), shop: shop(2) } as Partial<RunState>);
    applyEndOfTurn(s);
    expect(s.shopEaten?.map((e) => e.eaterUid)).toEqual(['h', 'k1']);
    expect(s.shop.length).toBe(0);
  });

  it('gilded: every eater gains DOUBLE the meal', () => {
    const s = recruit({ board: [body('dm_hydraskus', 'h', { golden: true }), body('dm_knocked', 'k1')], shop: shop(3) } as Partial<RunState>);
    applyEndOfTurn(s);
    const k1 = s.board.find((c) => c.uid === 'k1')!;
    expect([k1.attack, k1.health]).toEqual([2 + 4, 2 + 4]);
  });

  it('each bite is its OWN End-of-Turn beat (one projected step per Demon), landing on the committed board', () => {
    const before = recruit({ board: demons(), shop: shop(5) } as Partial<RunState>);
    const { steps } = projectEndOfTurnSteps(before);
    expect(endOfTurnTicksOf(before, before.board[0]!)).toBe(3);
    expect(steps.length).toBe(3);
    const after = recruit({ board: demons(), shop: shop(5) } as Partial<RunState>);
    applyEndOfTurn(after);
    for (const c of after.board) expect(steps[2]![c.uid]).toEqual({ attack: c.attack, health: c.health });
  });
});

describe('Drunk Daniel: "End of Turn: Give your Shop spells +2/+2."', () => {
  it('raises the run-wide spell power by +2/+2 each End of Turn (+4/+4 gilded)', () => {
    for (const [golden, n] of [[false, 2], [true, 4]] as const) {
      const s = recruit({ board: [body('dw_drunkdaniel', 'd', { golden })] });
      const b0 = { ...s.spellBonus };
      applyEndOfTurn(s);
      expect([s.spellBonus.attack - b0.attack, s.spellBonus.health - b0.health], `golden ${golden}`).toEqual([n, n]);
    }
  });
});

describe('The Gift runes: Happy Birthday every 3 turns, Merry Christmas every 2', () => {
  const gifts = (s: RunState) => s.hand.filter((c) => CARD_INDEX[c.cardId]?.gift).length;

  it('texts', () => {
    expect(RUNE_INDEX['rune_happy_birthday']!.text).toBe('Get a random **Gift**. Repeat every **3 turns**.');
    expect(RUNE_INDEX['rune_merry_christmas']!.text).toBe('Discover a **Gift**. Repeat every **2 turns**.');
  });

  it('Happy Birthday: one on purchase, then nothing for two turns, then one on the third', () => {
    const s0 = withRune('rune_happy_birthday', { hand: [] });
    expect(gifts(s0)).toBe(1);
    expect(s0.giftBirthdayEvery).toBe(3);
    const s1 = turn(s0);
    const s2 = turn(s1);
    expect(gifts(s2), 'nothing at the next two turn setups').toBe(gifts(s0));
    expect(s2.giftBirthdayTick).toBe(2);
    // The third turn setup pays (a fresh shop turn carrying the same counter: the runesmith run's wave 9 opens a modal
    // that holds the omen, which is not what this test is about).
    const s3 = turn(recruit({ hand: [], runeHappyBirthday: true, giftBirthdayEvery: 3, giftBirthdayTick: 2, ownedRunes: ['rune_happy_birthday'], board: [body('sandbag', 't', { attack: 0, health: 50 })] } as Partial<RunState>));
    expect(s3.giftBirthdayTick).toBe(0);
    expect(gifts(s3), 'a Gift three turns after the purchase').toBe(1);
  });

  it('Merry Christmas: a Discover on purchase, none the next turn, one the turn after', () => {
    const s0 = withRune('rune_merry_christmas', { hand: [] });
    expect(s0.giftChristmasEvery).toBe(2);
    const discovering = (s: RunState): boolean => !!s.discover || (s.discoverQueue?.length ?? 0) > 0;
    expect(discovering(s0), 'the first Discover opens on purchase').toBe(true);
    const clear = (s: RunState): RunState => ({ ...s, discover: undefined, discoverQueue: [] } as unknown as RunState);
    const s1 = turn(clear(s0));
    expect(s1.giftChristmasTick).toBe(1);
    expect(discovering(s1), 'no Discover at the next turn setup').toBe(false);
    const s2 = turn(clear(s1));
    expect(s2.giftChristmasTick).toBe(0);
    expect(discovering(s2), 'the Discover two turns after the purchase').toBe(true);
  });

  it('a Christmas armed before the cadence (no giftChristmasEvery) still offers every turn', () => {
    const legacy = recruit({ runeMerryChristmas: true, ownedRunes: ['rune_merry_christmas'], board: [body('sandbag', 't', { attack: 0, health: 50 })] } as Partial<RunState>);
    const after = turn(legacy);
    expect(!!after.discover || (after.discoverQueue?.length ?? 0) > 0).toBe(true);
  });
});
