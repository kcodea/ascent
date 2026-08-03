import { describe, it, expect } from 'vitest';
import { createRun, type BoardCard, type RunState } from './state';
import { reduce } from './reducer';

/**
 * Frenzied Excavator plays REAL Rubies — N separate applications, not one of N× magnitude.
 *
 * The card reads "play a Ruby on all of your minions", and gilded doubles it. `battlecryPlayRubiesAll` used to
 * fold the multiplier into the AMOUNT and call `addBuff` once, so a gilded Excavator was indistinguishable
 * from an ungilded one to everything that counts Rubies rather than measures them: the targets' `onRubyPlayed`
 * watchers (which it never fired at all), `rubiesOnThisTurn`, and the board cue.
 *
 * Its sibling `spellPlayRubiesAll` (Ruby Excavation) already looped. Two implementations of the same sentence,
 * disagreeing — and only one of them matched its printed text.
 *
 * The STATS are deliberately unchanged: `per × (1 + rubyBonus)` is the same total either way. What changes is
 * the trigger count, which is the whole point.
 */
const card = (uid: string, cardId: string, tribe: BoardCard['tribe'] = 'kobold'): BoardCard =>
  ({ uid, cardId, tribe, attack: 1, health: 1, keywords: [], golden: false });

/** DISTINCT cardIds: three copies of one minion triple on play and collapse the board, which would quietly
 *  make these tests prove nothing. */
const board = (): BoardCard[] => [card('b1', 'stray'), card('b2', 'spore')];

const play = (golden: boolean, extra: Partial<RunState> = {}): RunState => reduce(
  { ...createRun(1), phase: 'recruit', embers: 20, board: board(),
    hand: [{ ...card('f1', 'k_frenzied'), golden }], ...extra },
  { type: 'play', uid: 'f1' },
);

const rubyCount = (s: RunState, uid: string): number =>
  s.board.find((c) => c.uid === uid)?.buffs?.find((b) => b.source === 'Ruby')?.count ?? 0;
const rubyGain = (s: RunState, uid: string): number => {
  const e = s.board.find((c) => c.uid === uid)?.buffs?.find((b) => b.source === 'Ruby');
  return (e?.attack ?? 0) + (e?.health ?? 0);
};

describe('Frenzied Excavator plays separate Rubies', () => {
  it('ungilded applies ONE Ruby to each minion', () => {
    expect(rubyCount(play(false), 'b1')).toBe(1);
    expect(rubyCount(play(false), 'b2')).toBe(1);
  });

  /** The headline: "play 2 Rubies" now means two applications, not one double. */
  it('gilded applies TWO Rubies to each minion', () => {
    expect(rubyCount(play(true), 'b1')).toBe(2);
    expect(rubyCount(play(true), 'b2')).toBe(2);
  });

  /** The balance guard. Gilded must still be worth exactly double in stats — this is a trigger-count change,
   *  and if the totals moved it would be a silent buff or nerf riding along. */
  it('leaves the STAT total exactly double, not more or less', () => {
    expect(rubyGain(play(true), 'b1')).toBe(rubyGain(play(false), 'b1') * 2);
  });

  /** It never fired the targets' on-Ruby effects at all — a bare `addBuff` skips them. `rubiesOnThisTurn` is
   *  the counter `fireOnRubyPlayed` bumps, so a non-zero value proves the notification now happens. */
  it('tells each target a Ruby landed, once per Ruby', () => {
    const plain = play(false).board.find((c) => c.uid === 'b1');
    const gild = play(true).board.find((c) => c.uid === 'b1');
    expect(plain?.rubiesOnThisTurn).toBe(1);
    expect(gild?.rubiesOnThisTurn).toBe(2);
  });

  /** With Ruby strength on the run, each application carries the CURRENT bonus — the loop must not bake the
   *  multiplier into one oversized Ruby again. */
  it('applies the run rubyBonus per Ruby', () => {
    const s = play(true, { rubyBonus: { attack: 1, health: 1 } });
    // two Rubies of (1+1)/(1+1) = +4/+4 total, and still two applications
    expect(rubyCount(s, 'b1')).toBe(2);
    expect(rubyGain(s, 'b1')).toBe(8);
  });
});
