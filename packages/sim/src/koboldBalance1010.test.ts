import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, RUBY_TYPE_IDS, type BoardMinion } from '@game/core';
import { CARD_INDEX, poolFor } from '@game/content';
import { createRun, reduce, type Action, type BoardCard, type RunState } from './index';
import { applyEndOfTurn, endOfTurnTicksOf, eotTickCount, projectEndOfTurnSteps } from './recruit';

/**
 * THE OWNER'S KOBOLD / RUBY BALANCE BATCH (2026-10-10) — each change through the real reducer / End-of-Turn /
 * `simulate` paths. The cards are shared, so Set 2 and Set 3 get the same numbers.
 */

const body = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
};
const run = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(1), setId: 'set2', phase: 'recruit', embers: 20, tier: 6, hand: [], board: [], shop: [], ...over } as RunState);
const act = (s: RunState, a: Action): RunState => reduce(s, a);
const at = (s: RunState, uid: string): BoardCard => s.board.find((c) => c.uid === uid)!;
const rubyBuff = (c: { buffs?: { source: string; attack: number; health: number; count?: number }[] } | undefined) =>
  c?.buffs?.filter((b) => b.source === 'Ruby').reduce((n, b) => ({ attack: n.attack + b.attack, health: n.health + b.health }), { attack: 0, health: 0 });
const rubiesInHand = (s: RunState): BoardCard[] => s.hand.filter((c) => !!CARD_INDEX[c.cardId]?.ruby);
const spell = (uid: string, cardId: string): BoardCard => ({ uid, cardId, tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false });

describe('Veinstorm: "Cast a Ruby on your minions and the shop"', () => {
  it('plays one Ruby on every friendly minion AND gems the Shop (the Shop half unchanged)', () => {
    const s0 = run({ board: [body('a', 'sandbag'), body('b', 'stray')], shop: [{ uid: 'o1', cardId: 'sandbag' }], hand: [spell('vs', 'veinstorm')] });
    const s = act(s0, { type: 'play', uid: 'vs' });
    expect(rubyBuff(at(s, 'a'))).toEqual({ attack: 1, health: 1 });
    expect(rubyBuff(at(s, 'b'))).toEqual({ attack: 1, health: 1 });
    expect(rubyBuff(s.shop.find((o) => o.uid === 'o1'))).toEqual({ attack: 1, health: 1 });
    expect(s.veinstormRubies, 'the Shop bank still grows').toEqual({ atk: 1, hp: 1 });
  });
  it('the minion Ruby carries the run Ruby strength, the same value the Shop half lands', () => {
    const s0 = run({ rubyBonus: { attack: 2, health: 1 }, board: [body('a', 'sandbag')], shop: [{ uid: 'o1', cardId: 'sandbag' }], hand: [spell('vs', 'veinstorm')] });
    const s = act(s0, { type: 'play', uid: 'vs' });
    expect(rubyBuff(at(s, 'a'))).toEqual({ attack: 3, health: 2 });
    expect(rubyBuff(s.shop.find((o) => o.uid === 'o1'))).toEqual({ attack: 3, health: 2 });
  });
});

describe('Facetwright: both options are +2', () => {
  it.each([[0, { attack: 2, health: 0 }], [1, { attack: 0, health: 2 }]] as const)('option %i raises the Ruby strength by %o', (index, gain) => {
    let s = act(run({ hand: [spell('f', 'facetwright')] }), { type: 'play', uid: 'f' });
    if (s.chooseOne) s = act(s, { type: 'chooseOne', index });
    expect(s.rubyBonus).toEqual(gain);
  });
});

describe('Storm Chaser: "Shout: Cast Veinstorm"', () => {
  it('playing it casts Veinstorm (board + Shop Rubies), no Veinstorm in hand; Gilded casts twice', () => {
    for (const golden of [false, true]) {
      const s0 = run({ board: [body('a', 'sandbag')], shop: [{ uid: 'o1', cardId: 'sandbag' }], hand: [body('sc', 'k_stormchaser', { golden })] });
      const s = act(s0, { type: 'play', uid: 'sc' });
      const casts = golden ? 2 : 1;
      expect(s.hand.some((c) => c.cardId === 'veinstorm')).toBe(false);
      expect(rubyBuff(at(s, 'a'))).toEqual({ attack: casts, health: casts });
      expect(s.veinstormRubies).toEqual({ atk: casts, hp: casts });
    }
  });
});

describe('Storm Chaser in combat: "Split (real time)" (owner ruling 2026-10-10)', () => {
  // Ryme (5 Attack, 1 Health) re-fires its neighbour's Shout in combat; the omen wall never dies.
  const refire = (golden: boolean, side = combatSide({ tier: 6 })) => simulate(
    [{ cardId: 'ryme', attack: 5, health: 1 } as BoardMinion, { cardId: 'k_stormchaser', attack: 0, health: 100, golden, sourceUid: 'SC' } as BoardMinion],
    [{ cardId: 'omen', attack: 50, health: 2000 } as BoardMinion], makeRng(1), CARD_INDEX, side, combatSide({ tier: 1 }));
  const rubyBuffs = (r: ReturnType<typeof refire>) =>
    r.events.filter((e): e is Extract<typeof e, { type: 'buff' }> => e.type === 'buff' && (e as { ruby?: boolean }).ruby === true);

  it('the minion half lands INSTANTLY in combat (a live Ruby on the living minions); nothing defers as a Shout', () => {
    const r = refire(false);
    expect(r.playerDeferredBattlecries ?? [], 'no longer a Shop-only Shout').toEqual([]);
    const sc = r.initial.player.find((m) => m.cardId === 'k_stormchaser')!.uid;
    const live = rubyBuffs(r);
    expect(live.some((e) => (e as { target: string }).target === sc), 'Storm Chaser itself gets the Ruby').toBe(true);
    for (const e of live) expect([(e as { attack: number }).attack, (e as { health: number }).health]).toEqual([1, 1]);
    expect(r.events.some((e) => e.type === 'sc' && /casts Veinstorm/.test((e as { text: string }).text)), 'the cast has its own line / beat').toBe(true);
    expect(r.playerShoutCarry?.shopSpellHalves, 'ONE Shop half banked for settle').toEqual(['veinstorm']);
  });

  it('Gilded casts twice: two live Rubies and two banked Shop halves', () => {
    const r = refire(true);
    expect(r.playerShoutCarry?.shopSpellHalves).toEqual(['veinstorm', 'veinstorm']);
  });

  it('spell power folds the same way as the Shop half (1 + Ruby strength + spell power)', () => {
    const r = refire(false, combatSide({ tier: 6, spellPowerAtk: 2, spellPowerHp: 1, rubyBonus: { attack: 1, health: 0 } }));
    const live = rubyBuffs(r);
    expect(live.length).toBeGreaterThan(0);
    for (const e of live) expect([(e as { attack: number }).attack, (e as { health: number }).health]).toEqual([4, 2]);
  });

  it('settle applies the Shop half ONCE per cast; the run board gets no second Ruby', () => {
    const r = refire(false);
    const s0 = run({ phase: 'combat', lastCombat: r, board: [body('SC', 'k_stormchaser')], shop: [{ uid: 'o1', cardId: 'sandbag' }] } as Partial<RunState>);
    const s = act(s0, { type: 'resolveCombat' });
    expect(s.veinstormRubies, 'the Shop bank grew by one Veinstorm').toEqual({ atk: 1, hp: 1 });
    expect(rubyBuff(s.board.find((c) => c.uid === 'SC')) ?? { attack: 0, health: 0 }, 'combat Rubies are temporary; settle adds none to the board').toEqual({ attack: 0, health: 0 });
  });

  it('in the Shop nothing changed: a played Storm Chaser still casts the whole Veinstorm at once', () => {
    const s = act(run({ board: [body('a', 'sandbag')], shop: [{ uid: 'o1', cardId: 'sandbag' }], hand: [body('sc', 'k_stormchaser')] }), { type: 'play', uid: 'sc' });
    expect(rubyBuff(at(s, 'a'))).toEqual({ attack: 1, health: 1 });
    expect(s.veinstormRubies).toEqual({ atk: 1, hp: 1 });
  });

  it('Shrieker (End of Turn: trigger Shouts) runs in the Shop: its Storm Chaser re-fire casts the whole Veinstorm', () => {
    const s = run({ board: [body('sh', 'd2_shrieker'), body('sc', 'k_stormchaser')], shop: [{ uid: 'o1', cardId: 'sandbag' }] });
    applyEndOfTurn(s);
    expect(s.veinstormRubies).toEqual({ atk: 1, hp: 1 });
    expect(rubyBuff(at(s, 'sh'))).toEqual({ attack: 1, health: 1 });
  });
});

describe('Gemling: "End of Turn: Cast Veinstorm 3 times" (Gilded 6), one beat per cast', () => {
  it('ticks: 3 plain, 6 gilded', () => {
    const eff = CARD_INDEX['k_gemline']!.effects[0]!;
    const s = run();
    expect(eotTickCount(s, eff)).toBe(3);
    expect(eotTickCount(s, eff, true)).toBe(6);
    expect(endOfTurnTicksOf(s, body('g', 'k_gemline'))).toBe(3);
    expect(endOfTurnTicksOf(s, body('g', 'k_gemline', { golden: true }))).toBe(6);
  });
  it.each([[false, 3], [true, 6]] as const)('golden=%s casts Veinstorm %i times at End of Turn, one projected step per cast', (golden, casts) => {
    const s = run({ board: [body('g', 'k_gemline', { golden })], shop: [{ uid: 'o1', cardId: 'sandbag' }] });
    const { steps } = projectEndOfTurnSteps(s);
    expect(steps.length).toBe(casts);
    applyEndOfTurn(s);
    expect(s.veinstormRubies).toEqual({ atk: casts, hp: casts });
    // Each cast also lands a Ruby on the Gemling itself (Veinstorm's minion half).
    expect(rubyBuff(at(s, 'g'))).toEqual({ attack: casts, health: casts });
  });
});

describe('Ruby stat-gain numbers', () => {
  it('Ruby Mender: Shout +2 Health (Gilded +4)', () => {
    for (const [golden, h] of [[false, 2], [true, 4]] as const) {
      const s = act(run({ hand: [body('m', 'k_deepvein', { golden })] }), { type: 'play', uid: 'm' });
      expect(s.rubyBonus).toEqual({ attack: 0, health: h });
    }
  });
  it('Cave Cutter: +2/+2 branch, and 4 RANDOM Rubies branch', () => {
    let s = act(run({ hand: [body('c', 'k_veinbreaker')] }), { type: 'play', uid: 'c' });
    s = act(s, { type: 'chooseOne', index: 0 });
    expect(s.rubyBonus).toEqual({ attack: 2, health: 2 });
    s = act(run({ hand: [body('c', 'k_veinbreaker')] }), { type: 'play', uid: 'c' });
    s = act(s, { type: 'chooseOne', index: 1 });
    expect(rubiesInHand(s)).toHaveLength(4);
    for (const r of rubiesInHand(s)) expect(RUBY_TYPE_IDS).toContain(r.cardId);
  });
  it('Cave Cutter: Rune of the Unbroken Vein still grants BOTH halves', () => {
    const s = act(run({ runeUnbrokenVein: true, hand: [body('c', 'k_veinbreaker')] } as Partial<RunState>), { type: 'play', uid: 'c' });
    const done = s.chooseOne ? act(s, { type: 'chooseOne', index: 0 }) : s;
    expect(done.rubyBonus).toEqual({ attack: 2, health: 2 });
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
  it('Tunneller Rik (combat): one Rally gets 2 Rubies (carried back as random types)', () => {
    const r = simulate([{ cardId: 'k_tunnelcharger', attack: 3, health: 300, sourceUid: 'T', keywords: ['RL'] } as BoardMinion],
      [{ cardId: 'sandbag', attack: 0, health: 3 }], makeRng(2), CARD_INDEX, combatSide({ tier: 6 }), combatSide({ tier: 1 }));
    expect(r.playerRubyGrantIds ?? []).toHaveLength(2);
    for (const id of r.playerRubyGrantIds ?? []) expect(RUBY_TYPE_IDS).toContain(id);
    expect(r.playerRubyGrants ?? 0, 'none are plain-Ruby mints').toBe(0);
  });
});

describe('Crownvein, Scrapper, Portsmith, Kobe, Cavern Fiend', () => {
  it('Crownvein Rally params are +2/+3', () => {
    expect(CARD_INDEX['k_crownvein']!.effects[0]!.params).toMatchObject({ attack: 2, health: 3 });
  });
  it('Scrapper Echo is +1/+1', () => {
    expect(CARD_INDEX['k_faultline']!.effects[0]!.params).toMatchObject({ attack: 1, health: 1 });
  });
  it('Portsmith Avenge (3): +2/+2 and 2 Kobolds, keeps Ward', () => {
    const d = CARD_INDEX['k_portsmith']!;
    expect(d.keywords).toContain('DS');
    expect(d.effects.map((e) => [e.on, e.do, e.params])).toEqual([
      ['avenge', 'avengeRubyStatGain', { count: 3, attack: 2, health: 2 }],
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
