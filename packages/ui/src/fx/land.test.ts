import { describe, it, expect } from 'vitest';
import {
  scheduleLands, cascade, volley, waves, beatExceedsGap, scheduleDuration, landHolds, type Recipient, type Land,
} from './land';

/**
 * The traversal schedule — one shape covering every order in `docs/fx-vocabulary.md`.
 *
 * Two systems fed into this, and the tests are grouped by which case each came from: the Ruby cue contributed
 * per-recipient STACKS, the buff-tendril replay contributed WAVES (members firing together) and the group
 * CAP. Neither knew about the other, and the union has to keep both honest.
 */
const r = (uid: string, count?: number): Recipient => (count === undefined ? { uid } : { uid, count });
const at = (lands: { uid: string; at: number }[]): [string, number][] => lands.map((l) => [l.uid, l.at]);

describe('cascade — one group per recipient', () => {
  it('walks recipients by gap', () => {
    expect(at(scheduleLands(cascade([r('a'), r('b'), r('c')]), { gap: 100 })))
      .toEqual([['a', 0], ['b', 100], ['c', 200]]);
  });

  /** THE headline case: a stack nests INSIDE the walk, not alongside it. */
  it('nests a 2-stack inside the gap', () => {
    expect(at(scheduleLands(cascade([r('a', 2), r('b', 2)]), { gap: 100, beat: 50 })))
      .toEqual([['a', 0], ['a', 50], ['b', 100], ['b', 150]]);
  });

  it('skips a recipient with no payload but KEEPS its slot, so the rhythm holds', () => {
    expect(scheduleLands(cascade([r('a', 0), r('b')]), { gap: 100 }))
      .toEqual([{ uid: 'b', group: 1, member: 0, at: 100 }]);
  });
});

describe('volley — one group holding everyone', () => {
  it('lands every recipient together', () => {
    const out = scheduleLands(volley([r('a'), r('b'), r('c')]), { gap: 100 });
    expect(out.every((l) => l.at === 0)).toBe(true);
  });

  it('is empty for no recipients', () => {
    expect(scheduleLands(volley([]), { gap: 100 })).toEqual([]);
  });
});

describe('waves — the buff-tendril shape', () => {
  /** Every member of a wave fires TOGETHER (all the Mechs pulse at once); the stagger applies only BETWEEN
   *  waves. This is the behaviour `replayBuffFxEvents` had and must keep. */
  it('fires a wave together and staggers wave to wave', () => {
    const out = scheduleLands(waves([[r('a'), r('b')], [r('c'), r('d')]]), { gap: 120 });
    expect(at(out)).toEqual([['a', 0], ['b', 0], ['c', 120], ['d', 120]]);
  });

  it('drops empty waves rather than spending a gap on nothing', () => {
    expect(at(scheduleLands(waves([[r('a')], [], [r('b')]]), { gap: 100 })))
      .toEqual([['a', 0], ['b', 100]]);
  });
});

describe('maxGroups — the cap lifted from coalesceWaves', () => {
  /** ~30 itemized-reward waves collapse into a strobe, so everything past the cap pulses as one final wave. */
  it('merges everything past the cap into one last group', () => {
    const g = [[r('a')], [r('b')], [r('c')], [r('d')], [r('e')]];
    const out = scheduleLands(waves(g), { gap: 100, maxGroups: 3 });
    expect(at(out)).toEqual([['a', 0], ['b', 100], ['c', 200], ['d', 200], ['e', 200]]);
  });

  it('leaves a traversal under the cap untouched', () => {
    const out = scheduleLands(waves([[r('a')], [r('b')]]), { gap: 100, maxGroups: 5 });
    expect(at(out)).toEqual([['a', 0], ['b', 100]]);
  });

  it('never caps below one group', () => {
    const out = scheduleLands(waves([[r('a')], [r('b')]]), { gap: 100, maxGroups: 0 });
    expect(out.every((l) => l.group === 0)).toBe(true);
  });
});

describe('timing options', () => {
  it('lead delays the whole traversal, leaving room for a tell', () => {
    expect(scheduleLands(cascade([r('a'), r('b')]), { gap: 100, lead: 300 }).map((l) => l.at))
      .toEqual([300, 400]);
  });

  it('speed divides every offset', () => {
    expect(scheduleLands(cascade([r('a', 2), r('b')]), { gap: 100, beat: 50, speed: 2 }).map((l) => l.at))
      .toEqual([0, 25, 50]);
  });

  /** A paused replay can report speed 0. Dividing by it would put every land at Infinity — i.e. never. */
  it('treats a non-positive speed as 1 rather than producing Infinity', () => {
    for (const speed of [0, -1]) {
      expect(scheduleLands(cascade([r('a'), r('b')]), { gap: 100, speed }).map((l) => l.at)).toEqual([0, 100]);
    }
  });

  it('reports group and member so a caller can vary a land by its position', () => {
    expect(scheduleLands(cascade([r('a', 2), r('b')]), { gap: 100, beat: 50 }).map((l) => [l.group, l.member]))
      .toEqual([[0, 0], [0, 1], [1, 0]]);
  });
});

describe('beatExceedsGap', () => {
  it('flags timing that loses the count', () => {
    expect(beatExceedsGap({ gap: 100, beat: 100 })).toBe(true);
  });

  it('passes the shipped Ruby timing', () => {
    expect(beatExceedsGap({ gap: 100, beat: 50 })).toBe(false);
  });

  it('does not flag a volley or a beatless traversal', () => {
    expect(beatExceedsGap({ gap: 0, beat: 50 })).toBe(false);
    expect(beatExceedsGap({ gap: 100 })).toBe(false);
  });
});

describe('scheduleDuration', () => {
  it('is the last land’s offset', () => {
    expect(scheduleDuration(scheduleLands(cascade([r('a', 2), r('b', 2)]), { gap: 100, beat: 50 }))).toBe(150);
  });

  it('is 0 for an empty schedule', () => {
    expect(scheduleDuration([])).toBe(0);
  });
});

describe('landHolds', () => {
  /** One land per member, matching what `scheduleLands` actually produces for a 2-stack. */
  const land = (uid: string, at: number): Land => ({ uid, group: 0, member: 0, at });

  /** Task 5's Critical regression, generalised off the Ruby cue: a per-gem share of 1.5 landing twice must
   *  withhold exactly 3, never 4. This is the case a per-land-rounding implementation gets wrong — rounding
   *  `1.5` to `2` on each of the two lands and summing overstates the true delta by one. Multiplying the
   *  share by the recipient's count (2) BEFORE the single `Math.round` call is what keeps this at 3. */
  it('rounds ONCE over the whole recipient, not once per land in a stack', () => {
    const lands = [land('a', 0), land('a', 50)];
    const out = landHolds(lands, () => ({ attack: 1.5, health: 1 }));
    expect(out).toEqual([{ uid: 'a', attack: 3, health: 2, at: 0 }]);
  });

  it('collapses a stack to ONE hold, timed to the FIRST land — a caller must never rely on a per-land stagger', () => {
    const lands = [land('a', 0), land('a', 50), land('b', 100)];
    const out = landHolds(lands, () => ({ attack: 2, health: 2 }));
    expect(out.map((h) => h.uid)).toEqual(['a', 'b']);
    expect(out[0]!.at).toBe(0); // 'a's first land, not its second
    expect(out[1]!.at).toBe(100);
  });

  it('multiplies the per-gem share by THIS event\'s count for that uid, not any external total', () => {
    const lands = [land('a', 0), land('a', 50)];
    const out = landHolds(lands, () => ({ attack: 2, health: 1 }));
    expect(out).toEqual([{ uid: 'a', attack: 4, health: 2, at: 0 }]); // 2*2, 1*2
  });

  it('skips a uid whose perGemFor returns null — nothing safe to withhold', () => {
    expect(landHolds([land('a', 0)], () => null)).toEqual([]);
  });

  it('returns nothing for no lands', () => {
    expect(landHolds([], () => null)).toEqual([]);
  });
});
