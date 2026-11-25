import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatEvent, type CombatResult } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { createRun, reduce, type BoardCard, type RunState } from './index';
import { summonBuffText } from '../../ui/src/cardText';

/**
 * R-KENNEL-01 — OWNER REWORK 2026-11-14 (1/5 and Avenge (3) since 2026-11-25). Kennelmaster reads "When you summon a Beast, give it +1 Attack.
 * Avenge (3): Improve this by +1 Attack." It is no longer a Start of Combat card.
 *
 * One body for both phases (`ARENA_EFFECTS.buffOnSummon`, `(1 + summonBonus) x golden`): a Beast played or summoned in
 * the Shop keeps the buff; a Beast summoned mid-fight gets it for that fight only. The Avenge improvement is permanent
 * per instance (summonBonus, carried back). Gilded is +2 improving +2; a triple is the sum of the two best copies
 * (R-GILD-SUM-01). Every surface prints the current value.
 */

const ALL_TRIBES = ['beast', 'dragon', 'undead', 'mech', 'demon', 'kobold', 'dwarf'];
const bc = (uid: string, cardId: string, extra: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...extra } as BoardCard;
};
const bm = (cardId: string, uid: string, attack = 2, health = 900, extra: Partial<BoardMinion> = {}): BoardMinion =>
  ({ cardId, attack, health, sourceUid: uid, keywords: [...(CARD_INDEX[cardId]?.keywords ?? [])], ...extra });
const sim = (p: BoardMinion[], e: BoardMinion[], seed = 3) =>
  simulate(p, e, makeRng(seed), CARD_INDEX, combatSide({ tier: 6, tribes: ALL_TRIBES }), combatSide({ tier: 6, tribes: ALL_TRIBES }));
const buffs = (r: CombatResult) => r.events.filter((e): e is Extract<CombatEvent, { type: 'buff' }> => e.type === 'buff');
const shop = (board: BoardCard[], hand: BoardCard[]): RunState =>
  ({ ...createRun(5, 'warden', 'ascent', undefined, 'set2'), phase: 'recruit', embers: 60, tier: 6, board, hand } as RunState);
const play = (s: RunState, uid: string): RunState => reduce(s, { type: 'play', uid }) as RunState;
const settleOnto = (board: BoardCard[], r: CombatResult): RunState =>
  reduce({ ...createRun(1), phase: 'combat', board, lastCombat: r } as RunState, { type: 'resolveCombat' }) as RunState;
const liveKennel = (sb: number, golden: boolean): string =>
  summonBuffText('kennel', sb, golden) ?? (golden ? CARD_INDEX['kennel']!.goldenText! : CARD_INDEX['kennel']!.text);

describe('R-KENNEL-01: the card', () => {
  it('is a 1/5 tier 2 Beast with no Start of Combat', () => {
    const d = CARD_INDEX['kennel']!;
    expect([d.tier, d.attack, d.health, d.tribe]).toEqual([2, 1, 5, 'beast']);
    expect(d.keywords).not.toContain('SC');
    expect(d.effects.map((e) => e.do)).toEqual(['buffOnSummon', 'avengeImproveSummon']);
    expect(d.text).toBe('When you summon a **Beast**, give it **+1 Attack**. **Avenge (3):** Improve this by **+1 Attack**.');
    expect(d.goldenText).toBe('When you summon a **Beast**, give it **+2 Attack**. **Avenge (3):** Improve this by **+2 Attack**.');
  });
});

describe('R-KENNEL-01: Shop', () => {
  it('a Beast you play gets +1 Attack permanently; a non-Beast and Kennelmaster itself do not', () => {
    let s = shop([bc('K', 'kennel')], [bc('A', 'alley'), bc('N', 'sandbag')]);
    s = play(s, 'A');
    s = play(s, 'N');
    const a = s.board.find((c) => c.uid === 'A')!;
    const n = s.board.find((c) => c.uid === 'N')!;
    const k = s.board.find((c) => c.uid === 'K')!;
    expect([a.attack, a.health]).toEqual([CARD_INDEX['alley']!.attack + 1, CARD_INDEX['alley']!.health]);
    expect([n.attack, n.health]).toEqual([CARD_INDEX['sandbag']!.attack, CARD_INDEX['sandbag']!.health]);
    expect([k.attack, k.health]).toEqual([1, 5]);
  });

  it('playing Kennelmaster does not buff itself', () => {
    const s = play(shop([], [bc('K', 'kennel')]), 'K');
    const k = s.board.find((c) => c.uid === 'K')!;
    expect([k.attack, k.health]).toEqual([1, 5]);
  });

  it('the grant is base + accrual: two Avenge improves read +3, gilded +6', () => {
    let s = play(shop([bc('K', 'kennel', { summonBonus: 2 })], [bc('A', 'alley')]), 'A');
    expect(s.board.find((c) => c.uid === 'A')!.attack).toBe(CARD_INDEX['alley']!.attack + 3);
    s = play(shop([bc('K', 'kennel', { golden: true })], [bc('A', 'alley')]), 'A');
    expect(s.board.find((c) => c.uid === 'A')!.attack, 'a fresh Gilded copy gives +2').toBe(CARD_INDEX['alley']!.attack + 2);
    s = play(shop([bc('K', 'kennel', { golden: true, summonBonus: 2 })], [bc('A', 'alley')]), 'A');
    expect(s.board.find((c) => c.uid === 'A')!.attack).toBe(CARD_INDEX['alley']!.attack + 6);
  });
});

describe('R-KENNEL-01: combat', () => {
  it('is not a Start of Combat buff: the Beasts already on the board get nothing', () => {
    const r = sim([bm('kennel', 'K', 1, 900), bm('alley', 'A', 1, 900)], [{ cardId: 'sandbag', attack: 1, health: 90000 }]);
    const ally = r.initial.player[1]!.uid;
    const kUid = r.initial.player[0]!.uid;
    expect(buffs(r).filter((b) => b.source === kUid && b.target === ally)).toEqual([]);
  });

  it('a Beast summoned mid-fight gets +1 Attack, and Avenge (3) raises the next summons at once', () => {
    // Pack summons two Pups on death; sandbags are the Avenge fodder. The kill order is up to the fight, so the
    // contract is checked per grant: every Kennelmaster grant = 1 + the improves logged before it.
    let sawImprovedGrant = false;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const fodder = (i: number) => bm('sandbag', `F${i}`, 0, 1);
      const r = sim([bm('kennel', 'K', 1, 900), fodder(1), fodder(2), fodder(3), fodder(4), bm('pack', 'P', 1, 1), bm('pack', 'Q', 1, 1)],
        [{ cardId: 'sandbag', attack: 50, health: 90000 }, { cardId: 'sandbag', attack: 50, health: 90000 }], seed);
      const kUid = r.initial.player[0]!.uid;
      let improves = 0;
      let grants = 0;
      for (const e of r.events) {
        if (e.type === 'improve' && e.target === kUid) improves += e.amount;
        if (e.type === 'buff' && e.source === kUid) {
          grants++;
          expect([e.attack, e.health], `seed ${seed}`).toEqual([1 + improves, 0]);
          if (improves > 0) sawImprovedGrant = true;
        }
      }
      expect(grants, `seed ${seed}: four Pups summoned, four grants`).toBe(4);
    }
    expect(sawImprovedGrant, 'some seed summons a Pup after the Avenge').toBe(true);
  });

  // R-SUMMON-RETURN-01: a Rise or Rebirth return IS a combat summon, so the returning Beast is buffed on its return
  // (and only then: it was already on the board at the start, which is not a summon).
  const returnGrants = (r: CombatResult) => {
    const kUid = r.initial.player[0]!.uid;
    const back = r.events.findIndex((e) => e.type === 'reborn');
    expect(back, 'the Beast returned').toBeGreaterThanOrEqual(0);
    const uid = (r.events[back] as Extract<CombatEvent, { type: 'reborn' }>).target;
    const mine = (from: number, to: number) => r.events.slice(from, to)
      .filter((e): e is Extract<CombatEvent, { type: 'buff' }> => e.type === 'buff' && e.source === kUid && e.target === uid);
    return { before: mine(0, back), after: mine(back + 1, r.events.length), rebirth: !!(r.events[back] as { rebirth?: boolean }).rebirth };
  };

  it('a Beast that RISES is summoned again: it gets +1 Attack on the return', () => {
    const r = sim([bm('kennel', 'K', 1, 900), bm('gryphon', 'G', 2, 1, { keywords: ['R', 'T'] })],
      [{ cardId: 'sandbag', attack: 5, health: 90000 }]);
    const g = returnGrants(r);
    expect(g.rebirth).toBe(false);
    expect(g.before, 'nothing while it was a starting body').toEqual([]);
    expect(g.after.map((b) => [b.attack, b.health])).toEqual([[1, 0]]);
  });

  it('a Beast with REBIRTH is summoned again: it gets +1 Attack on the return', () => {
    const r = sim([bm('kennel', 'K', 1, 900), bm('gryphon', 'G', 2, 1, { keywords: ['RB', 'T'] })],
      [{ cardId: 'sandbag', attack: 5, health: 90000 }]);
    const g = returnGrants(r);
    expect(g.rebirth).toBe(true);
    expect(g.before).toEqual([]);
    expect(g.after.map((b) => [b.attack, b.health])).toEqual([[1, 0]]);
  });

  it('the Avenge improvement carries back; the combat summon buff does not touch the run board', () => {
    const fodder = (i: number) => bm('sandbag', `F${i}`, 0, 1);
    const r = sim([bm('kennel', 'K', 1, 900), fodder(1), fodder(2), fodder(3), fodder(4)], [{ cardId: 'sandbag', attack: 5, health: 90000 }]);
    const s = settleOnto([bc('K', 'kennel'), bc('F1', 'sandbag'), bc('F2', 'sandbag'), bc('F3', 'sandbag'), bc('F4', 'sandbag')], r);
    const k = s.board.find((c) => c.uid === 'K')!;
    expect(k.summonBonus).toBe(1);
    expect([k.attack, k.health], 'its own stats are untouched').toEqual([1, 5]);
    expect(liveKennel(k.summonBonus ?? 0, false)).toContain('{{+2 Attack}}');
  });

  it('Gilded: a mid-fight summon gets +2, and each Avenge adds +2', () => {
    const fodder = (i: number) => bm('sandbag', `F${i}`, 0, 1);
    const r = sim([bm('kennel', 'K', 1, 900, { golden: true }), fodder(1), fodder(2), fodder(3), fodder(4), bm('pack', 'P', 1, 1)],
      [{ cardId: 'sandbag', attack: 50, health: 90000 }], 4);
    const kUid = r.initial.player[0]!.uid;
    let improves = 0;
    let grants = 0;
    for (const e of r.events) {
      if (e.type === 'improve' && e.target === kUid) improves += e.amount;
      if (e.type === 'buff' && e.source === kUid) { grants++; expect(e.attack).toBe((1 + improves) * 2); }
    }
    expect(grants).toBe(2);
  });
});

describe('R-KENNEL-01 + R-GILD-SUM-01: tripling', () => {
  const tripleOf = (bonuses: (number | undefined)[]): BoardCard => {
    let s = { ...createRun(1), setId: 'set1', phase: 'recruit', embers: 60, board: [], tier: 6,
      hand: bonuses.map((b, i) => bc(`c${i}`, 'kennel', b ? { summonBonus: b } : {})) } as RunState;
    for (let i = 0; i < bonuses.length; i++) s = play(s, `c${i}`);
    const g = [...s.hand, ...s.board].find((c) => c.cardId === 'kennel' && c.golden);
    expect(g, 'the triple produced a golden').toBeDefined();
    return g!;
  };
  const grant = (c: BoardCard) => (1 + (c.summonBonus ?? 0)) * (c.golden ? 2 : 1);

  it('+16 and +10 copies gild to +26 (the owner example)', () => {
    const g = tripleOf([15, 9, undefined]); // +16, +10, +1
    expect(grant(g)).toBe(26);
    expect(liveKennel(g.summonBonus ?? 0, true)).toContain('{{+26 Attack}}');
  });

  it('three fresh copies gild to the printed Gilded +2', () => {
    const g = tripleOf([undefined, undefined, undefined]);
    expect(grant(g)).toBe(2);
    expect(liveKennel(g.summonBonus ?? 0, true)).toContain('**+2 Attack**');
  });
});

describe('R-KENNEL-01: live text', () => {
  it('plain: the grant shows the current value, the step stays +1 Attack', () => {
    const t = liveKennel(2, false);
    expect(t).toContain('{{+3 Attack}}');
    expect(t).toContain('Improve this by **+1 Attack**');
  });
  it('gilded: the grant shows the current doubled value, the step reads +2 Attack', () => {
    const t = liveKennel(1, true);
    expect(t).toContain('{{+4 Attack}}');
    expect(t).toContain('Improve this by **+2 Attack**');
  });
  it('no accrual: the printed text is already current', () => {
    expect(liveKennel(0, false)).toContain('**+1 Attack**');
    expect(liveKennel(0, true)).toContain('**+2 Attack**');
  });
});
