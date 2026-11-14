import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { createRun, reduce, type BoardCard, type RunState } from './index';
import { ALE_IDS, aleHandMagnitude, castSpell, spellCasts } from './recruit';

/**
 * EDWARD KEG-HANDS, owner rework 2026-11-14 (R-EDWARD-01), through the real reducer: "Your Dwarven Ales cast from
 * hand have double effect" (Gilded: triple). The Ale is cast ONCE with its NUMBERS multiplied (never its targets);
 * highest Edward only; only a cast FROM HAND; each cast another multiplier adds is multiplied too.
 */

const body = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
};
const ale = (uid: string, id: string): BoardCard => body(uid, id);
const run = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(1), setId: 'set2', phase: 'recruit', embers: 20, tier: 6, hand: [], board: [], shop: [], ...over } as RunState);
const play = (s: RunState, uid: string): RunState => reduce(s, { type: 'play', uid });
const aleBuff = (c: BoardCard | undefined): [number, number] =>
  (c?.buffs ?? []).filter((b) => b.source === 'Ale' || b.source.endsWith('Ale')).reduce((t, b) => [t[0] + b.attack, t[1] + b.health], [0, 0] as [number, number]);

const EDWARD = (uid = 'e', golden = false): BoardCard => body(uid, 'dw_edward', { golden });
const FILLERS = (): BoardCard[] => [body('a', 'dw_brakka'), body('b', 'dw_brunni'), body('c', 'dw_pimm'), body('d', 'dw_chef')];

describe('Edward Keg-hands (2026-11-14): hand-cast Dwarven Ales have double effect', () => {
  it('prints the new texts and has no effect of its own', () => {
    const d = CARD_INDEX['dw_edward']!;
    expect([d.text, d.goldenText]).toEqual([
      'Your **Dwarven Ales** cast from hand have **double** effect.',
      'Your **Dwarven Ales** cast from hand have **triple** effect.',
    ]);
    expect(d.effects).toEqual([]);
  });

  it('adds NO casts: the Ale cast count is 1 with Edward on board', () => {
    const s = run({ board: [EDWARD(), EDWARD('g', true)] });
    for (const id of ALE_IDS) expect(spellCasts(s, CARD_INDEX[id]!), id).toBe(1);
  });

  it('highest Edward only: plain x2, any Gilded x3, extra copies add nothing', () => {
    expect(aleHandMagnitude(run(), 'wo_mine')).toBe(1);
    expect(aleHandMagnitude(run({ board: [EDWARD()] }), 'wo_mine')).toBe(2);
    expect(aleHandMagnitude(run({ board: [EDWARD('e1'), EDWARD('e2')] }), 'wo_mine')).toBe(2);
    expect(aleHandMagnitude(run({ board: [EDWARD('e1'), EDWARD('e2', true)] }), 'wo_mine')).toBe(3);
    expect(aleHandMagnitude(run({ board: [EDWARD('e1', true), EDWARD('e2', true)] }), 'wo_mine')).toBe(3);
    expect(aleHandMagnitude(run({ board: [EDWARD()] }), 'growth'), 'a non-Ale').toBe(1);
  });

  it('Golden Ale: 4 Gold (6 Gilded), and ONE cast for every watcher', () => {
    for (const [golden, gold] of [[false, 4], [true, 6]] as const) {
      const s0 = run({ board: [EDWARD('e', golden)], hand: [ale('x', 'wo_mine')] });
      const s = play(s0, 'x');
      expect(s.embers - s0.embers, `golden=${golden}`).toBe(gold); // playing a spell from hand is free
    }
  });

  it("Champion's Ale: +10/+10 on the left-most (+15/+15 Gilded)", () => {
    for (const [golden, n] of [[false, 10], [true, 15]] as const) {
      const s = play(run({ board: [body('l', 'dw_brakka'), EDWARD('e', golden)], hand: [ale('x', 'wo_champion')] }), 'x');
      expect(aleBuff(s.board.find((c) => c.uid === 'l')), `golden=${golden}`).toEqual([n, n]);
    }
  });

  it('Defensive / Bloody Ale: still 3 minions, +6 each (the targets never double)', () => {
    for (const [id, want] of [['wo_health', [0, 6]], ['wo_attack', [6, 0]]] as const) {
      const s = play(run({ board: [...FILLERS(), EDWARD()], hand: [ale('x', id)] }), 'x');
      const hit = s.board.filter((c) => aleBuff(c)[0] + aleBuff(c)[1] > 0);
      expect(hit.length, `${id} hit count`).toBe(3);
      for (const c of hit) expect(aleBuff(c), `${id} on ${c.uid}`).toEqual(want);
    }
  });

  it('Reinforcing Ale: 2 minions (3 Gilded)', () => {
    for (const [golden, n] of [[false, 2], [true, 3]] as const) {
      const s = play(run({ board: [body('a', 'dw_brakka'), body('b', 'dw_brunni'), EDWARD('e', golden)], hand: [ale('x', 'wo_reinforcement')] }), 'x');
      expect(s.hand.length, `golden=${golden}`).toBe(n);
    }
  });

  it('spell power is part of the number and doubles with it', () => {
    const s = play(run({ spellBonus: { attack: 1, health: 1 }, board: [body('l', 'dw_brakka'), EDWARD()], hand: [ale('x', 'wo_champion')] }), 'x');
    expect(aleBuff(s.board.find((c) => c.uid === 'l'))).toEqual([12, 12]);
  });

  it('the cast counts ONCE: spellsCast and the Ale tally rise by 1', () => {
    const s0 = run({ board: [EDWARD('e', true)], hand: [ale('x', 'wo_mine')] });
    const s = play(s0, 'x');
    expect((s.spellsCast ?? 0) - (s0.spellsCast ?? 0)).toBe(1);
    expect(s.alesCastThisTurn ?? 0).toBe(1);
  });

  it('a cast multiplier still adds casts, and EACH one is multiplied (Ancient Runes: 2 casts x 2 = 8 Gold)', () => {
    const s0 = run({ spellDoubleAlways: true, board: [EDWARD()], hand: [ale('x', 'wo_mine')] });
    const s = play(s0, 'x');
    expect(s.embers - s0.embers).toBe(8);
    expect((s.spellsCast ?? 0) - (s0.spellsCast ?? 0), 'two casts').toBe(2);
  });

  it('a run-wide extra Ale cast stacks the same way (Bottomless Cellar: 2 casts x 2)', () => {
    const s0 = run({ aleExtraCasts: 1, board: [EDWARD()], hand: [ale('x', 'wo_mine')] });
    expect(play(s0, 'x').embers - s0.embers).toBe(8);
  });

  it('an Ale NOT cast from hand resolves at normal strength', () => {
    const s = run({ board: [body('l', 'dw_brakka'), EDWARD('e', true)] });
    const before = s.embers;
    castSpell(s, CARD_INDEX['wo_mine']!);
    castSpell(s, CARD_INDEX['wo_champion']!);
    expect(s.embers - before).toBe(2);
    expect(aleBuff(s.board.find((c) => c.uid === 'l'))).toEqual([5, 5]);
  });

  it('a non-Ale spell is unaffected', () => {
    const gain = (edward: boolean): number => {
      const s = play(run({ board: [body('l', 'dw_brakka'), ...(edward ? [EDWARD('e', true)] : [])], hand: [body('g', 'growth')] }), 'g');
      return s.board.find((c) => c.uid === 'l')!.attack;
    };
    expect(gain(true), 'Growth').toBe(gain(false));
  });
});
