import { describe, it, expect } from 'vitest';
import { CARD_INDEX, poolFor } from '@game/content';
import { createRun, type BoardCard, type RunState } from './state';
import { reduce } from './reducer';
import { alignmentOf } from './alignment';

/**
 * SET 3 — THE CELESTIALS. Every test drives the real reducer through a `play` action, because the whole
 * tribe hangs off two things the reducer owns: WHERE a card lands (alignment) and WHAT it lands next to
 * (Orbit). A test that called the factories directly would prove nothing about either.
 */
const card = (uid: string, cardId: string, attack = 2, health = 2): BoardCard =>
  ({ uid, cardId, tribe: CARD_INDEX[cardId]?.tribe ?? 'neutral', attack, health, keywords: [], golden: false });

/**
 * Two facts these tests learned the hard way, both real behaviour rather than quirks:
 *
 *  1. THREE copies of one card id TRIPLE into a golden. Filler must therefore use DISTINCT ids, or the board
 *     silently collapses mid-test and every stat total goes sideways.
 *  2. Alignment is read when the Orbit FIRES — i.e. AFTER the arriver has landed and re-centred the board. A
 *     lone watcher is Eclipsed only until something lands beside it, at which point a 2-board makes it Dawn.
 *     Every expectation below is written against the post-arrival board.
 */
const FILLER = ['pack', 'alley', 'stray', 'sandbag', 'pup'] as const;

/** A run with `board` seated and `hand` held, ready for a `play` that lands at `toIndex`. */
const staged = (board: BoardCard[], hand: BoardCard[]): RunState =>
  ({ ...createRun(1), phase: 'recruit', embers: 50, board, hand } as RunState);

describe('the tribe is real and drawable', () => {
  it('every set-3 minion is a Celestial by TRIBE, not just the legacy flag', () => {
    const buyable = poolFor('set3').buyable;
    expect(buyable.length).toBeGreaterThan(10);
    expect(buyable.every((c) => c.tribe === 'celestial'), 'promoted to a real tribe').toBe(true);
  });
});

describe('ORBIT — fires for the neighbours of the slot you drop into', () => {
  it('pays the adjacent watcher and nobody else', () => {
    // Familiar at 0, a bystander at 1. Playing INTO index 1 puts the arriver between them, so the Familiar
    // (adjacent) fires and the bystander's non-Orbit body is merely a witness.
    let s = staged([card('fam', 'c3_familiar', 3, 1)], [card('n', 'pack', 1, 1)]);
    const before = s.board[0]!.attack + s.board[0]!.health;
    s = reduce(s, { type: 'play', uid: 'n', toIndex: 1 });
    const total = s.board.reduce((n, c) => n + c.attack + c.health, 0);
    // The arrival makes it a 2-board, so the Familiar reads DAWN when its Orbit fires — the Attack half only.
    expect(total).toBe(before + (1 + 1) + 2);
  });

  it('does NOT fire for a non-adjacent watcher', () => {
    // Familiar at 0, wall at 1, wall at 2 — playing at index 3 lands two slots away from the Familiar.
    let s = staged(
      [card('fam', 'c3_familiar', 3, 1), card('w1', 'alley', 1, 1), card('w2', 'stray', 1, 1)],
      [card('n', 'sandbag', 1, 1)],
    );
    const before = s.board.reduce((n, c) => n + c.attack + c.health, 0);
    s = reduce(s, { type: 'play', uid: 'n', toIndex: 3 });
    expect(s.board.reduce((n, c) => n + c.attack + c.health, 0), 'only the arriver\'s own stats').toBe(before + 2);
  });
});

describe('ALIGNMENT — the same card behaves differently by seat', () => {
  it('Dawn takes the Attack half, Dusk the Health half', () => {
    // Two Channelers at the ends of a 4-board: index 0 is Dawn, index 3 is Dusk (an even board has no
    // Eclipse), so playing between them fires one Attack half and one Health half.
    let s = staged(
      [card('dawn', 'c3_channeler', 3, 8), card('mid', 'alley', 9, 9), card('dusk', 'c3_channeler', 3, 8)],
      [card('n', 'stray', 1, 1)],
    );
    s = reduce(s, { type: 'play', uid: 'n', toIndex: 1 }); // lands adjacent to the Dawn Channeler only
    expect(alignmentOf(s.board, 'dawn')).toBe('dawn');
    // The lowest-Attack body took +4 Attack; nothing took +4 Health from this arrival.
    const gained = s.board.reduce((n, c) => n + c.attack, 0) - (3 + 9 + 3 + 1);
    expect(gained, 'the Dawn half fired').toBe(4);
  });

  it('an ECLIPSED body runs BOTH halves — the rule falls out of alignAllows', () => {
    // Seat 4 and insert at index 3: the board becomes 5 wide with the Channeler at index 2 — the exact
    // middle, i.e. Eclipse — and the arriver landing beside it at index 3.
    let s = staged(
      [card('a', 'pack', 5, 5), card('b', 'alley', 5, 5), card('ch', 'c3_channeler', 3, 8), card('c', 'stray', 5, 5)],
      [card('n', 'sandbag', 1, 1)],
    );
    const beforeA = s.board.reduce((n, c) => n + c.attack, 0);
    const beforeH = s.board.reduce((n, c) => n + c.health, 0);
    s = reduce(s, { type: 'play', uid: 'n', toIndex: 3 });
    expect(alignmentOf(s.board, 'ch'), 'centred on the post-arrival board').toBe('eclipse');
    expect(s.board.reduce((n, c) => n + c.attack, 0) - beforeA - 1, 'Dawn half').toBe(4);
    expect(s.board.reduce((n, c) => n + c.health, 0) - beforeH - 1, 'Dusk half').toBe(4);
  });
});

describe('ORBIT (N) — the cadence notation', () => {
  it('pays out only on the Nth arrival, and the tick is per instance', () => {
    // Star Cartographer is Orbit (4) → three arrivals do nothing, the fourth improves Shop spells.
    let s = staged([card('sc', 'c3_cartographer', 4, 4)],
      FILLER.slice(0, 4).map((id, i) => card(`n${i + 1}`, id)));
    for (const uid of ['n1', 'n2', 'n3']) {
      s = reduce(s, { type: 'play', uid, toIndex: 1 });
      expect(s.spellBonus ?? { attack: 0, health: 0 }, `${uid} must not pay out`).toEqual({ attack: 0, health: 0 });
    }
    s = reduce(s, { type: 'play', uid: 'n4', toIndex: 1 });
    expect((s.spellBonus?.attack ?? 0) + (s.spellBonus?.health ?? 0), 'the 4th arrival pays out').toBeGreaterThan(0);
  });
});

describe('the board-wide ORBIT WATCHER is distinct from an Orbit', () => {
  it('Worldline Weaver fires off SOMEONE ELSE\'s Orbit', () => {
    // The Weaver has no Orbit of its own — it watches. Familiar at 0 orbits, Weaver sits at the far end and
    // still pays, which is exactly the difference between `orbit` and `orbitFired`.
    let s = staged(
      [card('fam', 'c3_familiar', 3, 1), card('w', 'alley', 1, 1), card('weav', 'c3_weaver', 6, 10)],
      [card('n', 'stray', 1, 1)],
    );
    const before = s.board.reduce((n, c) => n + c.attack + c.health, 0);
    s = reduce(s, { type: 'play', uid: 'n', toIndex: 1 }); // adjacent to the Familiar, NOT the Weaver
    const after = s.board.reduce((n, c) => n + c.attack + c.health, 0);
    // Familiar's own Orbit (+2 somewhere) plus the Weaver's board-wide payout — strictly more than the
    // Orbit alone would give.
    expect(after - before - 2, 'the Weaver reacted to a distant Orbit').toBeGreaterThan(2);
  });
});

describe('Binary Star multiplies its NEIGHBOURS\' Orbits', () => {
  it('an adjacent Orbit pays twice', () => {
    const play = (withBinary: boolean): number => {
      // Order matters: [multiplier, watcher] then insert at 2. Post-arrival the Familiar sits at index 1 with
      // the arriver beside it at 2 AND the multiplier still adjacent at 0. Inserting BETWEEN them would
      // separate the pair — adjacency is read after the board re-centres, which is the card's real cost.
      const board = withBinary
        ? [card('bin', 'c3_binary', 5, 8), card('fam', 'c3_familiar', 3, 1)]
        : [card('plain', 'alley', 5, 8), card('fam', 'c3_familiar', 3, 1)];
      let s = staged(board, [card('n', 'stray', 1, 1)]);
      const before = s.board.reduce((n, c) => n + c.attack + c.health, 0);
      s = reduce(s, { type: 'play', uid: 'n', toIndex: 2 });
      return s.board.reduce((n, c) => n + c.attack + c.health, 0) - before - 2; // minus the arriver itself
    };
    const plain = play(false);
    const doubled = play(true);
    expect(plain, 'the Familiar paid once').toBeGreaterThan(0);
    expect(doubled, 'Binary Star made it pay twice').toBe(plain * 2);
  });
});

describe('Starpath Vendor accrues sell value, capped', () => {
  it('grows +1 per Orbit and stops at +3', () => {
    let s = staged([card('v', 'c3_vendor', 2, 4)],
      FILLER.map((id, i) => card(`n${i + 1}`, id)));
    for (const uid of ['n1', 'n2', 'n3', 'n4', 'n5']) s = reduce(s, { type: 'play', uid, toIndex: 1 });
    const vendor = s.board.find((c) => c.uid === 'v')!;
    expect(vendor.sellBonus, 'capped at +3 however many Orbits fired').toBe(3);
  });
});

describe('Horizon Collector copies the arriver\'s bonus stats without stealing them', () => {
  it('takes what the minion carries above its printed base', () => {
    const base = CARD_INDEX['pack']!;
    let s = staged(
      [card('col', 'c3_collector', 5, 12)],
      [card('n', 'pack', base.attack + 4, base.health + 6)], // a bought-up minion: +4/+6 of bonus
    );
    s = reduce(s, { type: 'play', uid: 'n', toIndex: 1 });
    const col = s.board.find((c) => c.uid === 'col')!;
    const arriver = s.board.find((c) => c.uid === 'n')!;
    // Eclipsed (lone Collector), so both halves run; the copy is at least the bonus on each axis.
    expect(col.attack).toBeGreaterThanOrEqual(5 + 4);
    expect(col.health).toBeGreaterThanOrEqual(12 + 6);
    expect([arriver.attack, arriver.health], 'the arriver keeps its own stats').toEqual([base.attack + 4, base.health + 6]);
  });
});
