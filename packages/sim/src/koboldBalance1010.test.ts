import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, RUBY_TYPE_IDS, type BoardMinion } from '@game/core';
import { CARD_INDEX, poolFor } from '@game/content';
import { createRun, reduce, type Action, type BoardCard, type RunState } from './index';
import { applyEndOfTurn, endOfTurnTicksOf, eotTickCount } from './recruit';

/**
 * THE OWNER'S KOBOLD / RUBY BALANCE BATCH (2026-10-10) — each change through the real reducer / End-of-Turn /
 * `simulate` paths. The cards are shared, so Set 2 and Set 3 get the same numbers.
 *
 * The 2026-10-11 nerf batch moved five of these numbers (Ruby Mender, Cave Cutter, Crownvein, Portsmith, Gemling);
 * the pins below carry today's values, and `koboldBalance1011.test.ts` is the suite for that batch.
 */

const body = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
};
const run = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(1), setId: 'set2', phase: 'recruit', embers: 20, tier: 6, hand: [], board: [], shop: [], ...over } as RunState);
const act = (s: RunState, a: Action): RunState => reduce(s, a);
const rubyBuff = (c: { buffs?: { source: string; attack: number; health: number; count?: number }[] } | undefined) =>
  c?.buffs?.filter((b) => b.source === 'Ruby').reduce((n, b) => ({ attack: n.attack + b.attack, health: n.health + b.health }), { attack: 0, health: 0 });
const rubiesInHand = (s: RunState): BoardCard[] => s.hand.filter((c) => !!CARD_INDEX[c.cardId]?.ruby);
const spell = (uid: string, cardId: string): BoardCard => ({ uid, cardId, tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false });

// "Shout: Cast Veinstorm" was Storm Chaser from 2026-10-10 until the owner made it "Get a Veinstorm" again on
// 2026-10-13 (stormChaser1013.test.ts). Shardluck's Choose One branch is the card left on `battlecryCastNamedSpell`,
// so the factory, its Shop cast and its real-time combat split (R-STORMCHASER-01) are pinned here through a probe def
// that IS the 10-10 Storm Chaser: same body, one cast, Gilded two.
const CAST = 'dbg_1010_stormchaser_cast';
CARD_INDEX[CAST] = {
  ...CARD_INDEX['k_stormchaser']!, id: CAST,
  effects: [{ on: 'onPlay', do: 'battlecryCastNamedSpell', params: { spellId: 'veinstorm', count: 1 } }],
  text: '**Shout:** Cast **Veinstorm**.', goldenText: '**Shout:** Cast **Veinstorm** twice.',
};

// Veinstorm's "on your minions AND the Shop" half (this batch) was REMOVED on 2026-10-13: it gems the Shop only again.
// Its tests, Storm Chaser's minion-half pins and Gemling's cast counts moved to `koboldBalance1013.test.ts`. What
// stays here is what is still true: the Shop half, and Storm Chaser's combat cast banking that half for settle.
describe('Veinstorm: the Shop half', () => {
  it('gems the Shop and banks it, at the run Ruby strength', () => {
    const s0 = run({ rubyBonus: { attack: 2, health: 1 }, board: [body('a', 'sandbag')], shop: [{ uid: 'o1', cardId: 'sandbag' }], hand: [spell('vs', 'veinstorm')] });
    const s = act(s0, { type: 'play', uid: 'vs' });
    expect(rubyBuff(s.shop.find((o) => o.uid === 'o1'))).toEqual({ attack: 3, health: 2 });
    expect(s.veinstormRubies, 'the Shop bank grows').toEqual({ atk: 3, hp: 2 });
  });
});

describe('Facetwright: both options are +2', () => {
  it.each([[0, { attack: 2, health: 0 }], [1, { attack: 0, health: 2 }]] as const)('option %i raises the Ruby strength by %o', (index, gain) => {
    let s = act(run({ hand: [spell('f', 'facetwright')] }), { type: 'play', uid: 'f' });
    if (s.chooseOne) s = act(s, { type: 'chooseOne', index });
    expect(s.rubyBonus).toEqual(gain);
  });
});

describe('the "Shout: Cast Veinstorm" body (Storm Chaser 10-10 to 10-13; probe)', () => {
  it('playing it casts Veinstorm (the Shop is gemmed), no Veinstorm in hand; Gilded casts twice', () => {
    for (const golden of [false, true]) {
      const s0 = run({ board: [body('a', 'sandbag')], shop: [{ uid: 'o1', cardId: 'sandbag' }], hand: [body('sc', CAST, { golden })] });
      const s = act(s0, { type: 'play', uid: 'sc' });
      const casts = golden ? 2 : 1;
      expect(s.hand.some((c) => c.cardId === 'veinstorm')).toBe(false);
      expect(s.veinstormRubies).toEqual({ atk: casts, hp: casts });
    }
  });
});

describe('"Shout: Cast Veinstorm" in combat: "Split (real time)" (owner ruling 2026-10-10; probe)', () => {
  // Ryme (5 Attack, 1 Health) re-fires its neighbour's Shout in combat; the omen wall never dies.
  const refire = (golden: boolean, side = combatSide({ tier: 6 })) => simulate(
    [{ cardId: 'ryme', attack: 5, health: 1 } as BoardMinion, { cardId: CAST, attack: 0, health: 100, golden, sourceUid: 'SC' } as BoardMinion],
    [{ cardId: 'omen', attack: 50, health: 2000 } as BoardMinion], makeRng(1), CARD_INDEX, side, combatSide({ tier: 1 }));

  it('the cast is live in combat (its own line / beat) and banks ONE Shop half; nothing defers as a Shout', () => {
    const r = refire(false);
    expect(r.playerDeferredBattlecries ?? [], 'no longer a Shop-only Shout').toEqual([]);
    expect(r.events.some((e) => e.type === 'sc' && /casts Veinstorm/.test((e as { text: string }).text)), 'the cast has its own line / beat').toBe(true);
    expect(r.playerShoutCarry?.shopSpellHalves, 'ONE Shop half banked for settle').toEqual(['veinstorm']);
  });

  it('Gilded casts twice: two banked Shop halves', () => {
    const r = refire(true);
    expect(r.playerShoutCarry?.shopSpellHalves).toEqual(['veinstorm', 'veinstorm']);
  });

  it('settle applies the Shop half ONCE per cast; the run board gets no second Ruby', () => {
    const r = refire(false);
    const s0 = run({ phase: 'combat', lastCombat: r, board: [body('SC', CAST)], shop: [{ uid: 'o1', cardId: 'sandbag' }] } as Partial<RunState>);
    const s = act(s0, { type: 'resolveCombat' });
    expect(s.veinstormRubies, 'the Shop bank grew by one Veinstorm').toEqual({ atk: 1, hp: 1 });
    expect(rubyBuff(s.board.find((c) => c.uid === 'SC')) ?? { attack: 0, health: 0 }, 'combat Rubies are temporary; settle adds none to the board').toEqual({ attack: 0, health: 0 });
  });

  it('Shrieker (End of Turn: trigger Shouts) runs in the Shop: its Storm Chaser re-fire casts Veinstorm', () => {
    const s = run({ board: [body('sh', 'd2_shrieker'), body('sc', CAST)], shop: [{ uid: 'o1', cardId: 'sandbag' }] });
    applyEndOfTurn(s);
    expect(s.veinstormRubies).toEqual({ atk: 1, hp: 1 });
  });
});

describe('Gemling: the `times` End-of-Turn cast is one tick per cast, and gilding doubles the ticks', () => {
  // The card itself is "cast once and get a Ruby Transfer" since 2026-10-13 (koboldBalance1013.test.ts); this pins
  // the `castSpell { times }` tick contract the 10-10 batch introduced, which Gemling still rides.
  it('ticks: `times` plain, double gilded', () => {
    const s = run();
    for (const times of [1, 3]) {
      const eff = { do: 'castSpell', params: { spellId: 'veinstorm', times } };
      expect(eotTickCount(s, eff)).toBe(times);
      expect(eotTickCount(s, eff, true)).toBe(times * 2);
    }
    expect(endOfTurnTicksOf(s, body('g', 'k_gemline'))).toBe(1);
    expect(endOfTurnTicksOf(s, body('g', 'k_gemline', { golden: true }))).toBe(2);
  });
});

describe('Ruby stat-gain numbers', () => {
  it('Ruby Mender: Shout +1 Health (Gilded +2)', () => {
    for (const [golden, h] of [[false, 1], [true, 2]] as const) {
      const s = act(run({ hand: [body('m', 'k_deepvein', { golden })] }), { type: 'play', uid: 'm' });
      expect(s.rubyBonus).toEqual({ attack: 0, health: h });
    }
  });
  it('Cave Cutter: +1/+1 branch (2026-10-24), and the 4-Rubies branch', () => {
    let s = act(run({ hand: [body('c', 'k_veinbreaker')] }), { type: 'play', uid: 'c' });
    s = act(s, { type: 'chooseOne', index: 0 });
    expect(s.rubyBonus).toEqual({ attack: 1, health: 1 });
    s = act(run({ hand: [body('c', 'k_veinbreaker')] }), { type: 'play', uid: 'c' });
    s = act(s, { type: 'chooseOne', index: 1 });
    expect(rubiesInHand(s)).toHaveLength(4);
    for (const r of rubiesInHand(s)) expect(RUBY_TYPE_IDS).toContain(r.cardId);
  });
  it('Cave Cutter: Rune of the Unbroken Vein still grants BOTH halves', () => {
    const s = act(run({ runeUnbrokenVein: true, hand: [body('c', 'k_veinbreaker')] } as Partial<RunState>), { type: 'play', uid: 'c' });
    const done = s.chooseOne ? act(s, { type: 'chooseOne', index: 0 }) : s;
    expect(done.rubyBonus).toEqual({ attack: 1, health: 1 });
    expect(rubiesInHand(done)).toHaveLength(4);
  });
});

describe('random-Ruby grants', () => {
  it('Prospector: Shout gets ONE random Ruby (Gilded 2)', () => {
    for (const [golden, n] of [[false, 1], [true, 2]] as const) {
      const s = act(run({ hand: [body('p', 'k_chipwick', { golden })] }), { type: 'play', uid: 'p' });
      expect(rubiesInHand(s)).toHaveLength(n);
      for (const r of rubiesInHand(s)) expect(RUBY_TYPE_IDS).toContain(r.cardId);
    }
  });
  it('Beggy: Sell gets ONE random Ruby (Gilded 2)', () => {
    for (const [golden, n] of [[false, 1], [true, 2]] as const) {
      const s = act(run({ board: [body('b', 'k_beggy', { golden })] }), { type: 'sell', uid: 'b' } as Action);
      expect(rubiesInHand(s)).toHaveLength(n);
    }
  });
  it('Beggy draws its Ruby type from the run RNG (more than one type across seeds)', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      const s = act(run({ rngCursor: seed, board: [body('b', 'k_beggy')] }), { type: 'sell', uid: 'b' } as Action);
      for (const r of rubiesInHand(s)) seen.add(r.cardId);
    }
    expect(seen.size).toBeGreaterThan(1);
  });
  it('Tunneller Rik (combat): one Rally gets 1 random Ruby (owner balance 2026-10-24, was 2)', () => {
    const r = simulate([{ cardId: 'k_tunnelcharger', attack: 3, health: 300, sourceUid: 'T', keywords: ['RL'] } as BoardMinion],
      [{ cardId: 'sandbag', attack: 0, health: 3 }], makeRng(2), CARD_INDEX, combatSide({ tier: 6 }), combatSide({ tier: 1 }));
    expect(r.playerRubyGrantIds ?? []).toHaveLength(1);
    for (const id of r.playerRubyGrantIds ?? []) expect(RUBY_TYPE_IDS).toContain(id);
    expect(r.playerRubyGrants ?? 0, 'none are plain-Ruby mints').toBe(0);
  });
});

describe('Crownvein, Scrapper, Portsmith, Kobe, Cavern Fiend', () => {
  it('Crownvein Rally params are +1/+2', () => {
    expect(CARD_INDEX['k_crownvein']!.effects[0]!.params).toMatchObject({ attack: 1, health: 2 });
  });
  it('Scrapper Echo is +1 Attack (owner balance 2026-10-24, was +1/+1)', () => {
    expect(CARD_INDEX['k_faultline']!.effects[0]!.params).toMatchObject({ attack: 1, health: 0 });
  });
  it('Portsmith Avenge (3): +1/+1 and 2 Kobolds, keeps Ward', () => {
    const d = CARD_INDEX['k_portsmith']!;
    expect(d.keywords).toContain('DS');
    expect(d.effects.map((e) => [e.on, e.do, e.params])).toEqual([
      ['avenge', 'avengeRubyStatGain', { count: 3, attack: 1, health: 1 }],
      ['avenge', 'avengeGrantRandomTribeMinion', { count: 3, tribe: 'kobold', grant: 2 }],
    ]);
  });
  it('Kobe has Taunt AND Ward and keeps its Pummel', () => {
    const d = CARD_INDEX['k_kobe']!;
    expect(d.keywords).toEqual(['T', 'DS']);
    expect(d.effects[0]!.do).toBe('dealtDamageGetRandomRuby');
  });
  it('Cavern Fiend consumes the HIGHEST-Health Shop minion (ties right-most); Gilded eats the top two', () => {
    const shop = [
      { uid: 'lo', cardId: 'sandbag', hp: 0 },
      { uid: 'hi', cardId: 'sandbag', hp: 20 },
      { uid: 'mid', cardId: 'sandbag', hp: 10 },
    ];
    // Three Rubies cast = one trigger of the "3 spells" cadence.
    const castThree = (golden: boolean): RunState => {
      let s = run({ board: [body('cf', 'k_gemgorge', { golden })], shop: shop.map((o) => ({ ...o })), hand: [] });
      for (let i = 0; i < 3; i++) {
        s = { ...s, hand: [...s.hand, { uid: `r${i}`, cardId: 'ruby', tribe: 'kobold', attack: 1, health: 1, keywords: [], golden: false }] };
        s = act(s, { type: 'play', uid: `r${i}`, targetUid: 'cf' });
      }
      return s;
    };
    const plain = castThree(false);
    expect(plain.shop.map((o) => o.uid).sort()).toEqual(['lo', 'mid']);
    const gilded = castThree(true);
    expect(gilded.shop.map((o) => o.uid)).toEqual(['lo']);
  });
});

describe('shared cards: Set 3 sees the same defs', () => {
  it('the Set 3 copies of the shared Kobolds are the same objects', () => {
    for (const id of ['k_beggy', 'k_kobe']) {
      const inSet3 = poolFor('set3').all.find((c) => c.id === id);
      if (inSet3) expect(inSet3).toBe(CARD_INDEX[id]);
    }
  });
});

describe('First Blood is archived (owner 2026-10-10)', () => {
  it('is offered in no set, but still resolves by id so old saves load', async () => {
    const { QUEST_INDEX } = await import('@game/content');
    const q = QUEST_INDEX['q_first_blood'];
    expect(q?.name, 'still resolvable by id').toBe('First Blood');
    expect(q?.sets, 'offered in no set').toEqual([]);
  });
});
