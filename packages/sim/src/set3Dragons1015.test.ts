import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, seedEchoEffects, type BoardMinion, type CombatEvent } from '@game/core';
import { CARD_INDEX, SETS, WHISPER_IDS, poolFor } from '@game/content';
import { createRun, reduce, type Action, type BoardCard, type BoardSnapshot, type RunState } from './index';
import { fireRallies, fireRecruitDeathrattlesForTest, instanceEffects } from './recruit';
import { snapshotBoard } from './snapshot';
import { opponentBoard } from './opponents';
import { HUM_PER_TURN } from './whisper';

/**
 * SET 3 DRAGON BATCH 2 (owner 2026-10-15):
 *
 *  - Gravestar Seer archived; Chorus Drake, Flutterbutter and Transcendant join Set 3 by reference.
 *  - GATHERER (T4 5/4)  "Rally: Get a random Dragon."                                  R-DRAGON-GATHERER-01
 *  - GRAVUS (T5 8/3, Dragon + Undead) "Echo: Give this minion's Attack to 2 friendly minions."  R-DRAGON-GRAVUS-01
 *  - WELL WATCHER (T5 8/8) "Whisper: Discover a Dragon." (Well of Dragons)              R-WHISPER-08
 *  - MATRIARCH (T6 4/12) "When you cast a spell, give your minions +3 Health."          R-SPELL-MATRIARCH-01
 *  - WOOZY (T3 5/3) "Avenge (3): Get 2 Whispers."                                       R-WHISPER-09
 *  - IMMUNE IGGY (T5 7/2) "Immune while attacking. (Twice per combat)"                  R-IMMUNE-IGGY-01
 *  - HUM (T2 2/5) "The first Whisper cast on this each turn is permanent."              R-WHISPER-10
 *  - GARDENER (T1 1/1) "Whisper: Give a minion 'Echo: Summon a 3/3 Drake Pup with Taunt.'" (Seed)  R-WHISPER-11
 */

const bc = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
};
const act = (s: RunState, a: Action): RunState => reduce(s, a) as RunState;
const run = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(7, undefined, 'ascent', undefined, 'set3'), phase: 'recruit', embers: 40, tier: 6, hand: [], board: [], ...over } as RunState);
const at = (s: RunState, uid: string): BoardCard => s.board.find((c) => c.uid === uid)!;
const whispersIn = (s: RunState, id?: string): BoardCard[] => s.hand.filter((c) => CARD_INDEX[c.cardId]?.whisper && (!id || c.cardId === id));
const cast = (s: RunState, whisperUid: string, targetUid?: string): RunState => act(s, { type: 'play', uid: whisperUid, ...(targetUid ? { targetUid } : {}) } as Action);
const play = (s: RunState, uid: string): RunState => act(s, { type: 'play', uid, toIndex: s.board.length } as Action);
/** A quiet wall, so a fight never kills the run's board (the Whisper lifecycle is what these tests watch). */
const quiet: BoardSnapshot = { v: 1, wave: 1, heroId: 'indy', resolve: 30, tier: 1, triples: 0, tribes: [], threat: 'glass', power: 1, minions: [{ cardId: 'sandbag', attack: 0, health: 300, keywords: [] }], seed: 1, origin: 'self' };
const nextTurn = (s: RunState): RunState => {
  const served = { ...s, servedBoards: { ...(s.servedBoards ?? {}), [s.wave]: { ...quiet, wave: s.wave } } } as RunState;
  const after = act(act(act(served, { type: 'faceOmen' }), { type: 'settleCombat' }), { type: 'resolveCombat' });
  // Skip the turn-6 Runeforge (a modal that would hold the turn): these tests watch the Whisper lifecycle only.
  return { ...after, runeforgeOffer: undefined } as RunState;
};

const m = (cardId: string, over: Partial<BoardMinion> = {}): BoardMinion =>
  ({ cardId, attack: CARD_INDEX[cardId]!.attack, health: CARD_INDEX[cardId]!.health, keywords: [...CARD_INDEX[cardId]!.keywords], ...over } as unknown as BoardMinion);
const SET3_POOL = poolFor('set3').all.map((c) => c.id);
const fight = (p: BoardMinion[], e: BoardMinion[], seed = 5) =>
  simulate(p, e, makeRng(seed), CARD_INDEX, combatSide({ tier: 6, poolIds: SET3_POOL }), combatSide({ tier: 6, poolIds: SET3_POOL }));
const wall = (attack = 0): BoardMinion[] => [{ cardId: 'sandbag', attack, health: 5000, keywords: [] } as unknown as BoardMinion];
const pupSummons = (events: readonly CombatEvent[], side: 'player' | 'enemy' = 'player') =>
  events.filter((e) => e.type === 'summon' && e.side === side && e.minion.cardId === 'd3_drakepup');
const isDragon = (id: string): boolean => {
  const d = CARD_INDEX[id];
  return !!d && (d.tribe === 'dragon' || d.tribe2 === 'dragon' || !!d.universalTribe);
};

describe('the batch is Set 3 content', () => {
  it('the eight new Dragons are Set 3 Dragons at the owner tiers / stats; Gravus is Dragon AND Undead', () => {
    const want: [string, number, number, number][] = [
      ['d3_gatherer', 4, 5, 4], ['d3_gravus', 6, 10, 3] /* T5 8/3 -> T6 10/3 + Taunt, owner 2026-10-23 */, ['d3_wellwatcher', 5, 8, 8] /* T6 -> T5, owner 2026-10-15 */, ['d3_matriarch', 6, 4, 12],
      ['d3_woozy', 3, 5, 3], ['d3_iggy', 5, 7, 2], ['d3_hum', 2, 2, 5], ['d3_gardener', 1, 1, 1],
      ['d3_baitbrood', 2, 2, 4], ['d3_hatcher', 4, 5, 4], ['d3_whispwarder', 5, 7, 5], // owner additions on #2097
    ];
    const ids = poolFor('set3').buyable.map((c) => c.id);
    for (const [id, tier, a, h] of want) {
      const d = CARD_INDEX[id]!;
      expect([d.tribe, d.tier, d.attack, d.health], id).toEqual(['dragon', tier, a, h]);
      expect(ids, id).toContain(id);
      for (const t of [d.text, d.goldenText ?? '']) expect(/—|--/.test(t), `${id}: ${t}`).toBe(false);
    }
    expect(CARD_INDEX['d3_gravus']!.tribe2).toBe('undead');
    expect(CARD_INDEX['d3_drakepup']).toMatchObject({ tribe: 'dragon', attack: 3, health: 3, keywords: ['T'], token: true });
    expect(ids).not.toContain('d3_drakepup');
  });

  it('Chorus Drake, Flutterbutter and Transcendant are in Set 3 by reference (Set 2 keeps them, unchanged ids)', () => {
    for (const id of ['d2_chorus', 'd2_flutterdrake', 'd2_transcendence']) {
      expect(poolFor('set3').buyable.map((c) => c.id), id).toContain(id);
      expect(poolFor('set2').buyable.map((c) => c.id), id).toContain(id);
      expect(poolFor('set3').buyable.find((c) => c.id === id)).toBe(CARD_INDEX[id]); // the shared definition
    }
  });

  it('Gravestar Seer is archived: in no set, still resolvable by id', () => {
    for (const set of Object.keys(SETS) as (keyof typeof SETS)[]) expect(poolFor(set).all.some((c) => c.id === 'ce3_seer'), set).toBe(false);
    expect(CARD_INDEX['ce3_seer']?.name).toBe('Gravestar Seer');
  });

  it('the Whisper pool grows by Well of Dragons and Seed (granted, never drawable)', () => {
    expect([...WHISPER_IDS]).toEqual(['w4_tome', 'w4_runebind', 'w3_ripple', 'w3_wellofdragons', 'w3_seed', 'w3_bait', 'w3_clutch', 'w3_wardingcall']);
    for (const id of ['w3_wellofdragons', 'w3_seed', 'w3_bait', 'w3_clutch', 'w3_wardingcall']) expect(poolFor('set3').all.some((c) => c.id === id), id).toBe(false);
  });
});

describe('R-DRAGON-GATHERER-01: Gatherer, "Rally: Get a random Dragon."', () => {
  it('combat: every swing hands a random Set 3 Dragon to hand, mid-fight; Gilded gets 2', () => {
    for (const golden of [false, true]) {
      const r = fight([m('d3_gatherer', { health: 500, golden })], wall());
      const k = r.initial.player[0]!.uid;
      const swings = r.events.filter((e) => e.type === 'attack' && e.attacker === k).length;
      const got = r.playerHandGrants ?? [];
      expect(swings).toBeGreaterThan(0);
      expect(got.length, `golden ${golden}`).toBe(Math.min(swings * (golden ? 2 : 1), got.length));
      expect(got.length).toBeGreaterThan(0);
      for (const id of got) { expect(isDragon(id), id).toBe(true); expect(SET3_POOL, id).toContain(id); }
    }
  });

  it('Shop: a Shop-phase Rally (Rune of Lasting Cadence\'s pass) gets the Dragon now', () => {
    const s = run({ board: [bc('g', 'd3_gatherer')] });
    fireRallies(s);
    expect(s.hand).toHaveLength(1);
    expect(isDragon(s.hand[0]!.cardId)).toBe(true);
    expect(poolFor('set3').buyable.map((c) => c.id)).toContain(s.hand[0]!.cardId);
  });
});

describe('R-DRAGON-GRAVUS-01: Gravus, "Echo: Give this minion\'s Attack to 2 friendly minions."', () => {
  it('combat: its Attack at death goes to 2 DIFFERENT other friendlies (a combat buff); Gilded spreads twice', () => {
    for (const golden of [false, true]) {
      const r = fight([m('d3_gravus', { attack: 8, health: 1, golden }), m('sandbag', { attack: 0, health: 900 }), m('sandbag', { attack: 0, health: 900 }), m('sandbag', { attack: 0, health: 900 })], wall(50));
      const g = r.initial.player[0]!.uid;
      const gifts = r.events.filter((e): e is Extract<CombatEvent, { type: 'buff' }> => e.type === 'buff' && e.source === g && e.attack === 8);
      expect(gifts, `golden ${golden}`).toHaveLength(golden ? 4 : 2);
      expect(new Set(gifts.slice(0, 2).map((b) => b.target)).size).toBe(2); // distinct within a spread
      expect(gifts.every((b) => b.target !== g)).toBe(true);
    }
  });

  it('Shop: an Echo fired in the Shop gives its Attack to 2 other friendlies, permanently', () => {
    const s = run({ board: [bc('g', 'd3_gravus'), bc('a', 'venom'), bc('b', 'venom'), bc('c', 'venom')] });
    const before = s.board.map((c) => c.attack);
    fireRecruitDeathrattlesForTest(s, at(s, 'g'));
    const gained = s.board.map((c, i) => c.attack - before[i]!);
    expect(gained[0]).toBe(0); // never itself
    expect(gained.filter((x) => x === 10)).toHaveLength(2); // its Attack (10 since the owner's 2026-10-23 T6 10/3 change)
  });
});

describe('R-WHISPER-08: Well Watcher grants Well of Dragons, "Discover a Dragon"', () => {
  it('played from hand it hands over the Whisper; casting it (untargeted) opens a Dragon Discover from the run\'s pool; a counted spell', () => {
    let s = play(run({ hand: [bc('w', 'd3_wellwatcher')] }), 'w');
    const well = whispersIn(s, 'w3_wellofdragons')[0]!;
    expect(well).toBeTruthy();
    const before = s.spellsCast;
    s = cast(s, well.uid);
    expect(whispersIn(s, 'w3_wellofdragons')).toHaveLength(0);
    expect(s.spellsCast).toBe(before + 1);
    expect(s.discover?.length).toBeGreaterThan(0);
    for (const id of s.discover!) { expect(isDragon(id), id).toBe(true); expect(poolFor('set3').buyable.map((c) => c.id)).toContain(id); }
    expect(s.discoverQueue ?? []).toHaveLength(0);
  });

  it('Gilded: a gilded Well, two Discovers (the second queued)', () => {
    let s = play(run({ hand: [bc('w', 'd3_wellwatcher', { golden: true })] }), 'w');
    const well = whispersIn(s, 'w3_wellofdragons')[0]!;
    expect(well.whisperMult).toBe(2);
    s = cast(s, well.uid);
    expect(s.discover?.length).toBeGreaterThan(0);
    expect(s.discoverQueue).toHaveLength(1);
  });

  it('it fades at End of Turn like every Whisper, and a fresh one arrives next turn', () => {
    let s = play(run({ hand: [bc('w', 'd3_wellwatcher')] }), 'w');
    s = nextTurn(s);
    expect(whispersIn(s, 'w3_wellofdragons')).toHaveLength(1); // the old one faded, the Start of Turn granted one
  });
});

describe('R-SPELL-MATRIARCH-01: Matriarch, "When you cast a spell, give your minions +3 Health."', () => {
  it('Shop: a Whisper and a Ruby both count; permanent; Gilded +6', () => {
    for (const golden of [false, true]) {
      let s = run({ board: [bc('q', 'd3_matriarch', { golden }), bc('t', 'd4_tolan'), bc('x', 'venom')], hand: [bc('r', 'ruby')] });
      s = nextTurn(s);
      const hp = (): number[] => s.board.map((c) => c.health);
      const h0 = hp();
      s = cast(s, whispersIn(s, 'w4_runebind')[0]!.uid, 'x'); // a Whisper
      const h1 = hp();
      expect(h1[0]! - h0[0]!, 'Matriarch itself').toBe(golden ? 6 : 3);
      expect(h1[1]! - h0[1]!).toBe(golden ? 6 : 3);
      const rubyUid = s.hand.find((c) => c.cardId === 'ruby')?.uid;
      if (rubyUid) {
        s = act(s, { type: 'play', uid: rubyUid, targetUid: 't' } as Action); // a Ruby
        expect(at(s, 'q').health - h1[0]!, 'a Ruby is a spell').toBe(golden ? 6 : 3);
      }
      const keep = at(s, 'q').health;
      s = nextTurn(s);
      expect(at(s, 'q').health, 'permanent').toBe(keep);
    }
  });

  it('combat: Whaloo\'s Runebind casts and a Ruby played in combat each give +3 Health (a combat buff), per side', () => {
    const r = fight([m('d4_galas', { health: 60 }), m('d3_whaloo', { attack: 0, health: 100 }), m('d3_matriarch', { attack: 0, health: 100 })], wall());
    const q = r.initial.player[2]!.uid;
    const casts = r.events.filter((e) => e.type === 'sc' && e.spellId === 'w4_runebind').length;
    const gifts = r.events.filter((e) => e.type === 'buff' && e.source === q && e.health === 3 && e.attack === 0);
    expect(casts).toBeGreaterThan(0);
    expect(gifts.length).toBe(casts * 3); // all three living friendlies, once per cast
    const ruby = fight([m('k3_korn', { health: 60 }), m('d3_matriarch', { attack: 0, health: 100 })], wall());
    const q2 = ruby.initial.player[1]!.uid;
    expect(ruby.events.some((e) => e.type === 'buff' && e.source === q2 && e.health === 3), 'a combat Ruby is a spell').toBe(true);
    // The enemy's Rubies never pay the player's Matriarch.
    const foe = fight([m('d3_matriarch', { attack: 0, health: 100 })], [m('k3_korn', { health: 60 })]);
    expect(foe.events.some((e) => e.type === 'buff' && e.source === foe.initial.player[0]!.uid)).toBe(false);
  });
});

describe('R-WHISPER-09: Woozy, "Avenge (3): Get 2 Whispers."', () => {
  it('every 3 friendly deaths: 2 random Whispers fly to hand mid-fight; Gilded: 2 GILDED Whispers', () => {
    for (const golden of [false, true]) {
      const r = fight([m('d3_woozy', { attack: 0, health: 5000, golden }), m('venom', { health: 1, keywords: [] }), m('venom', { health: 1, keywords: [] }), m('venom', { health: 1, keywords: [] })], wall(5));
      const got = (r.playerHandGrants ?? []).filter((id) => WHISPER_IDS.includes(id));
      expect(got, `golden ${golden}`).toHaveLength(2);
      const flown = r.events.filter((e) => e.type === 'toHand' && e.side === 'player' && WHISPER_IDS.includes(e.cardId));
      expect(flown).toHaveLength(2);
      const mults = r.playerShoutCarry?.handWhisperMults ?? [];
      expect(mults.length).toBe(golden ? 2 : 0);
      for (const x of mults) expect(x.mult).toBe(2);
    }
  });

  it('settle: they arrive in the next Shop\'s hand as Whispers (gilded kept) and fade at that turn\'s End of Turn', () => {
    const killers: BoardSnapshot = { ...quiet, minions: [{ cardId: 'sandbag', attack: 5, health: 5000, keywords: [] }] };
    let s = run({ wave: 1, board: [bc('w', 'd3_woozy', { attack: 0, health: 5000, golden: true }), bc('a', 'venom', { health: 1, keywords: [] }), bc('b', 'venom', { health: 1, keywords: [] }), bc('c', 'venom', { health: 1, keywords: [] })] });
    s = { ...s, servedBoards: { [s.wave]: killers } } as RunState;
    s = act(act(act(s, { type: 'faceOmen' }), { type: 'settleCombat' }), { type: 'resolveCombat' });
    const ws = whispersIn(s);
    expect(ws).toHaveLength(2);
    for (const w of ws) expect(w.whisperMult).toBe(2);
    s = act(s, { type: 'faceOmen' });
    expect(whispersIn(s)).toHaveLength(0);
  });
});

describe('R-IMMUNE-IGGY-01: Immune Iggy, "Immune while attacking. (Twice per combat)"', () => {
  it('its first 2 swings each combat take no retaliation; the 3rd does; Gilded: 4', () => {
    for (const golden of [false, true]) {
      const r = fight([m('d3_iggy', { health: 100, golden })], wall(1));
      const k = r.initial.player[0]!.uid;
      let swings = 0;
      const hurtOnSwing: number[] = [];
      for (let i = 0; i < r.events.length; i++) {
        const e = r.events[i]!;
        if (e.type === 'attack' && e.attacker === k) {
          swings++;
          const next = r.events.findIndex((x, j) => j > i && x.type === 'attack');
          const hit = r.events.slice(i, next < 0 ? undefined : next).some((x) => x.type === 'dmg' && x.target === k);
          if (hit) hurtOnSwing.push(swings);
        }
      }
      const cap = golden ? 4 : 2;
      expect(swings).toBeGreaterThan(cap);
      expect(hurtOnSwing[0], `golden ${golden}`).toBe(cap + 1);
    }
  });
});

describe('R-WHISPER-10 / R-WHISPER-11: Gardener\'s Seed and Hum', () => {
  it('Seed gives a minion "Echo: Summon a 3/3 Drake Pup with Taunt" until the start of the next turn; it is a real Echo in combat', () => {
    let s = play(run({ board: [bc('x', 'venom')], hand: [bc('g', 'd3_gardener')] }), 'g');
    s = cast(s, whispersIn(s, 'w3_seed')[0]!.uid, 'x');
    expect(at(s, 'x').seedEchoesTemp).toBe(1);
    expect(instanceEffects(at(s, 'x')).filter((e) => e.do === 'deathrattleSummon' && e.params?.tokenId === 'd3_drakepup')).toHaveLength(1);
    expect(snapshotBoard(s).minions.find((mm) => mm.cardId === 'venom')?.seedEchoes).toBe(1);
    // Shop death: the Pup arrives.
    const shop = structuredClone(s);
    fireRecruitDeathrattlesForTest(shop, at(shop, 'x'));
    expect(shop.board.some((c) => c.cardId === 'd3_drakepup')).toBe(true);
    s = nextTurn(s);
    expect(at(s, 'x').seedEchoesTemp, 'gone at the next Start of Turn').toBeUndefined();
    expect(at(s, 'x').seedEchoes).toBeUndefined();
  });

  it('a Gilded Gardener\'s Seed grants 2 stacks', () => {
    let s = play(run({ board: [bc('x', 'venom')], hand: [bc('g', 'd3_gardener', { golden: true })] }), 'g');
    s = cast(s, whispersIn(s, 'w3_seed')[0]!.uid, 'x');
    expect(at(s, 'x').seedEchoesTemp).toBe(2);
  });

  it('Hum keeps the FIRST Whisper cast on it each turn (stats and Seed stacks); the second that turn is temporary; it re-arms next turn', () => {
    expect(HUM_PER_TURN).toBe(true); // owner 2026-10-15: "first per turn"
    let s = nextTurn(run({ board: [bc('h', 'd3_hum'), bc('g', 'd3_gardener'), bc('t', 'd4_tolan')] }));
    const base = at(s, 'h').attack;
    s = cast(s, whispersIn(s, 'w4_runebind')[0]!.uid, 'h'); // first: kept (+2/+2)
    s = cast(s, whispersIn(s, 'w3_seed')[0]!.uid, 'h'); // second this turn: temporary
    expect(at(s, 'h').whisperKeptThisTurn).toBe(1);
    expect(at(s, 'h').whisperBuffs ?? []).toHaveLength(0); // the Runebind became permanent
    expect(at(s, 'h').seedEchoesTemp).toBe(1);
    s = nextTurn(s);
    expect(at(s, 'h').attack, 'the kept Runebind stays').toBe(base + 2);
    expect(at(s, 'h').seedEchoesTemp).toBeUndefined();
    expect(at(s, 'h').seedEchoes).toBeUndefined();
    expect(at(s, 'h').whisperKeptThisTurn).toBe(0); // re-armed
    s = cast(s, whispersIn(s, 'w3_seed')[0]!.uid, 'h'); // first this turn: kept
    expect(at(s, 'h').seedEchoes).toBe(1);
  });

  it('Gilded Hum keeps the first 2 each turn', () => {
    let s = nextTurn(run({ board: [bc('h', 'd3_hum', { golden: true }), bc('g', 'd3_gardener'), bc('t', 'd4_tolan')] }));
    s = cast(s, whispersIn(s, 'w4_runebind')[0]!.uid, 'h');
    s = cast(s, whispersIn(s, 'w3_seed')[0]!.uid, 'h');
    expect(at(s, 'h').seedEchoes).toBe(1);
    expect(at(s, 'h').whisperBuffs ?? []).toHaveLength(0);
  });

  it('owner 2026-10-15: Seed stacks on Hum, 12 stacks over 12 turns, each its own Echo, surviving every turn', () => {
    let s = nextTurn(run({ board: [bc('h', 'd3_hum'), bc('g', 'd3_gardener')] }));
    for (let turn = 0; turn < 12; turn++) {
      s = cast(s, whispersIn(s, 'w3_seed')[0]!.uid, 'h');
      s = nextTurn(s);
    }
    expect(at(s, 'h').seedEchoes).toBe(12);
    expect(instanceEffects(at(s, 'h')).filter((e) => e.do === 'deathrattleSummon' && e.params?.tokenId === 'd3_drakepup')).toHaveLength(12);
    // Snapshot round trip: a served Hum carries every stack.
    const snap = snapshotBoard(s);
    expect(snap.minions.find((mm) => mm.cardId === 'd3_hum')?.seedEchoes).toBe(12);
    const served = opponentBoard(JSON.parse(JSON.stringify(snap)) as BoardSnapshot);
    expect(served.find((mm) => mm.cardId === 'd3_hum')?.seedEchoes).toBe(12);
  });

  it('a triple SUMS the copies\' stacks', () => {
    let s = nextTurn(run({ board: [bc('h1', 'd3_hum', { seedEchoes: 5 }), bc('h2', 'd3_hum', { seedEchoes: 3 }), bc('g', 'd3_gardener')], hand: [bc('h3', 'd3_hum', { seedEchoes: 1 })] }));
    // The third copy in hand is already a triple: the reducer merges on the next check (any play).
    s = cast(s, whispersIn(s, 'w3_seed')[0]!.uid, 'g');
    const golden = [...s.board, ...s.hand].find((c) => c.cardId === 'd3_hum' && c.golden);
    expect(golden, 'tripled').toBeTruthy();
    expect(golden!.seedEchoes).toBe(9);
  });
});

describe('R-WHISPER-11: a 12-stack Hum dying in combat', () => {
  const twelve = (golden = false) => m('d3_hum', { health: 1, seedEchoes: 12, golden });

  it('empty board: each stack is its own Echo; 7 Pups land (Taunt 3/3), the rest overflow', () => {
    const r = fight([twelve()], wall(50));
    const pups = pupSummons(r.events);
    expect(pups).toHaveLength(7);
    for (const p of pups) expect(p.type === 'summon' && [p.minion.attack, p.minion.health, p.minion.keywords.includes('T')]).toEqual([3, 3, true]);
    expect(r.initial.player[0]!.seedEchoes).toBe(12);
  });

  it('full board: one Pup fits, the other 11 overflow (Squatimus pays per overflow)', () => {
    const board = [twelve(), m('u3_squatimus', { attack: 0, health: 900 }), ...Array.from({ length: 5 }, () => m('sandbag', { attack: 0, health: 900 }))];
    const r = fight(board, wall(50));
    expect(pupSummons(r.events).length).toBeGreaterThanOrEqual(1);
    const sq = r.initial.player[1]!.uid;
    const firstPup = r.events.findIndex((e) => e.type === 'summon' && e.minion.cardId === 'd3_drakepup');
    const overflowPays = r.events.slice(firstPup).filter((e) => e.type === 'buff' && e.source === sq).length;
    expect(overflowPays).toBeGreaterThan(0);
  });

  it('Echo multipliers: Sylus doubles every stack (3 stacks -> 6 Pups)', () => {
    const plain = fight([m('d3_hum', { health: 1, seedEchoes: 3 })], wall(50));
    const sylus = fight([m('d3_hum', { health: 1, seedEchoes: 3 }), m('sylus', { attack: 0, health: 900 })], wall(50));
    expect(pupSummons(plain.events)).toHaveLength(3);
    expect(pupSummons(sylus.events)).toHaveLength(6);
  });

  it('Rise: the risen body carries its stacks into the fight (both deaths pay); the run card is untouched by combat', () => {
    const r = fight([m('d3_hum', { health: 1, seedEchoes: 2, keywords: ['R'] })], wall(50));
    expect(r.events.filter((e) => e.type === 'reborn')).toHaveLength(1);
    expect(pupSummons(r.events)).toHaveLength(4);
  });

  it('combat symmetry: an enemy Hum\'s stacks fire the same way', () => {
    const r = simulate(wall(50), [twelve()], makeRng(5), CARD_INDEX, combatSide({ tier: 6, poolIds: SET3_POOL }), combatSide({ tier: 6, poolIds: SET3_POOL }));
    expect(pupSummons(r.events, 'enemy')).toHaveLength(7);
  });

  it('seedEchoEffects mints independent effect objects (no shared params between stacks)', () => {
    const [a, b] = seedEchoEffects(2);
    expect(a).not.toBe(b);
    expect(a!.params).not.toBe(b!.params);
  });
});

describe('R-WHISPER-12: Bait Brood grants Bait, "+3/+5 and Taunt" until your next turn', () => {
  it('the stats AND the Taunt come off at the next Start of Turn; a Taunt the body had of its own stays', () => {
    let s = play(run({ board: [bc('x', 'venom'), bc('t', 'venom', { keywords: ['T'] })], hand: [bc('b', 'd3_baitbrood')] }), 'b');
    s = cast(s, whispersIn(s, 'w3_bait')[0]!.uid, 'x');
    expect([at(s, 'x').attack, at(s, 'x').health]).toEqual([CARD_INDEX['venom']!.attack + 3, CARD_INDEX['venom']!.health + 5]);
    expect(at(s, 'x').keywords).toContain('T');
    s = nextTurn(s);
    expect(at(s, 'x').keywords).not.toContain('T');
    expect([at(s, 'x').attack, at(s, 'x').health]).toEqual([CARD_INDEX['venom']!.attack, CARD_INDEX['venom']!.health]);
    s = cast(s, whispersIn(s, 'w3_bait')[0]!.uid, 't'); // already has Taunt: the strip must not take it
    s = nextTurn(s);
    expect(at(s, 't').keywords).toContain('T');
  });

  it('Gilded: +6/+10 and one Taunt; Hum keeps the stats AND the Taunt', () => {
    let s = play(run({ board: [bc('h', 'd3_hum')], hand: [bc('b', 'd3_baitbrood', { golden: true })] }), 'b');
    s = cast(s, whispersIn(s, 'w3_bait')[0]!.uid, 'h');
    expect([at(s, 'h').attack, at(s, 'h').health]).toEqual([2 + 6, 5 + 10]);
    expect(at(s, 'h').keywords.filter((k) => k === 'T')).toHaveLength(1);
    s = nextTurn(s);
    expect([at(s, 'h').attack, at(s, 'h').health, at(s, 'h').keywords.includes('T')]).toEqual([8, 15, true]);
  });
});

describe('R-WHISPER-13: Whispwarder grants Warding Call, Ward until your next turn (Gilded: Resilient Ward)', () => {
  it('Ward comes off at the next Start of Turn; a Gilded copy gives Resilient Ward; Hum keeps it', () => {
    let s = play(run({ board: [bc('x', 'venom', { keywords: [] }), bc('h', 'd3_hum')], hand: [bc('w', 'd3_whispwarder')] }), 'w');
    s = cast(s, whispersIn(s, 'w3_wardingcall')[0]!.uid, 'x');
    expect(at(s, 'x').keywords).toContain('DS');
    expect(snapshotBoard(s).minions.find((mm) => mm.cardId === 'venom')?.keywords).toContain('DS'); // it fights with Ward
    s = nextTurn(s);
    expect(at(s, 'x').keywords).not.toContain('DS');
    s = cast(s, whispersIn(s, 'w3_wardingcall')[0]!.uid, 'h');
    s = nextTurn(s);
    expect(at(s, 'h').keywords).toContain('DS'); // kept by Hum
    let g = play(run({ board: [bc('x', 'venom', { keywords: [] })], hand: [bc('w', 'd3_whispwarder', { golden: true })] }), 'w');
    g = cast(g, whispersIn(g, 'w3_wardingcall')[0]!.uid, 'x');
    expect(at(g, 'x').keywords).toEqual(expect.arrayContaining(['RW', 'DS']));
    g = nextTurn(g);
    expect(at(g, 'x').keywords.some((k) => k === 'RW' || k === 'DS')).toBe(false);
  });
});

describe('R-WHISPER-14: Hatcher, "Get a random Tier 1 Dragon. Improves every turn."', () => {
  it('T1 on play, one tier higher every Start of Turn on the board, capped at T6; a Dragon of exactly that tier', () => {
    let s = play(run({ hand: [bc('h', 'd3_hatcher')] }), 'h');
    const tiers: number[] = [];
    for (let turn = 0; turn < 8; turn++) {
      const w = whispersIn(s, 'w3_clutch')[0]!;
      tiers.push(w.grantedTier ?? 0);
      const before = s.hand.length;
      s = cast(s, w.uid);
      const got = s.hand.slice(before - 1).filter((c) => !CARD_INDEX[c.cardId]?.whisper);
      expect(got).toHaveLength(1);
      expect(CARD_INDEX[got[0]!.cardId]!.tier).toBe(w.grantedTier);
      expect(isDragon(got[0]!.cardId)).toBe(true);
      s = { ...s, hand: s.hand.filter((c) => c.uid !== got[0]!.uid) } as RunState; // keep the hand clear
      s = nextTurn(s);
    }
    expect(tiers).toEqual([1, 2, 3, 4, 5, 6, 6, 6]);
  });

  it('it does not tick in hand; Gilded gets 2', () => {
    let s = run({ hand: [bc('h', 'd3_hatcher', { golden: true })] });
    s = nextTurn(nextTurn(s));
    s = play(s, 'h');
    const w = whispersIn(s, 'w3_clutch')[0]!;
    expect([w.grantedTier, w.whisperMult]).toEqual([1, 2]);
    const before = s.hand.length;
    s = cast(s, w.uid);
    expect(s.hand.length - (before - 1)).toBe(2);
  });

  it('a Clutch drawn with no tier (Jar of Secrets, Woozy) gets a Tier 1 Dragon', () => {
    let s = run({ hand: [{ ...bc('c', 'w3_clutch') }] });
    s = cast(s, 'c');
    expect(s.hand).toHaveLength(1);
    expect(CARD_INDEX[s.hand[0]!.cardId]!.tier).toBe(1);
  });
});
